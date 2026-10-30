# Module E: Proactive monitoring and AI incident assistant

**Goal:** find out about server and database problems **before** the website goes down, and diagnose them in minutes instead of hours.

## What it does

```
EC2 (CloudWatch Agent) ─┐
RDS MySQL ──────────────┤                 ┌─ warning topic ─┐
ALB ────────────────────┼─ CloudWatch ────┤                 ├─► Incident assistant Lambda ─► Slack
Route 53 uptime checks ─┤    alarms       └─ critical topic ┘     │  (reads metrics + logs,
Storage forecast ───────┘                       │                 │   asks Claude for a diagnosis)
                                                └─► email (backup)│
                                                                  └─► CloudWatch Logs Insights
```

| Stack | What it creates |
|-------|-----------------|
| `01-alerting.yaml` | Warning and critical SNS topics, the **AI incident assistant** Lambda, an optional email backup, and an alarm if the assistant itself fails |
| `02-rds-alarms.yaml` | RDS free storage (warning / critical), CPU, connections, freeable memory, read/write latency |
| `03-ec2-alarms.yaml` | Web server CPU, status checks, **memory** and **disk** (needs the CloudWatch Agent) |
| `04-cloudwatch-agent.yaml` | Installs and configures the CloudWatch Agent through SSM (no SSH), and ships Laravel, nginx and PHP-FPM error logs |
| `05-alb-alarms.yaml` | App 5xx, load balancer 5xx, p95 response time, unhealthy servers (skip if there's no ALB) |
| `06-uptime.yaml` | Route 53 health checks on key pages every 30 s. **Deploy in us-east-1.** |
| `07-storage-forecast.yaml` | Every 6 h, predicts **days until the disk is full**. Warns at 14 days, critical at 5. |
| `08-dashboard.yaml` | One CloudWatch dashboard for the whole system |

Every alert reaches Slack with: what fired, on which resource, and the **AI diagnosis** (probable cause, impact, evidence, next steps, confidence), plus buttons for the alarm and the runbook. Recoveries are posted as **RESOLVED** without calling Claude.

**Runbooks** for the most common incidents are in [`src/incident_assistant/runbooks/`](src/incident_assistant/runbooks/). Claude reads the relevant one when it diagnoses an alert.

## Safety and security
- **Read-only.** The assistant only reads metrics and logs and recommends steps. It never changes infrastructure.
- **Least privilege.** Each Lambda can read only its own secrets, and query only the app log groups of its environment.
- **No secrets in code.** The Claude API key and Slack webhook live in Secrets Manager. The templates take only their ARNs.
- **Redaction.** Log lines are stripped of keys, tokens, passwords, emails, phone and card numbers, and IP host parts before they're sent to Claude.
- **The alert always arrives.** If Claude is slow or fails, the alert is still posted, marked "AI diagnosis unavailable". If the Lambda itself fails, an alarm emails the critical-alert address.
- **Cost cap.** At most 5 parallel diagnoses. Use a company API key with a monthly spend limit.

## Run it locally (no AWS needed)

```bash
cd monitoring
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt

pytest                                       # unit tests
cfn-lint cloudformation/*.yaml               # template validation
python scripts/simulate_alarm.py             # sample alert as Slack JSON (canned diagnosis)
python scripts/simulate_alarm.py --claude    # real Claude diagnosis (needs ANTHROPIC_API_KEY)
python scripts/simulate_alarm.py --claude --post   # also post to a test Slack channel (needs SLACK_WEBHOOK_URL)
```

Paste the JSON into [Slack Block Kit Builder](https://app.slack.com/block-kit-builder) to preview the message without posting.

## Deploy (DevOps)

**Prerequisites**
- AWS CLI v2 with permission to deploy CloudFormation, Lambda, IAM roles, SNS, CloudWatch, SSM and Route 53.
- An S3 bucket for Lambda code.
- The web servers' IAM role has `AmazonSSMManagedInstanceCore` and `CloudWatchAgentServerPolicy`, and the servers carry the tag `releaseguard:monitor=true`.

**1. Secrets.** Create them once and never commit them:
```bash
aws secretsmanager create-secret --name releaseguard/staging/anthropic-api-key --secret-string "<company Claude API key>"
aws secretsmanager create-secret --name releaseguard/staging/slack-webhook --secret-string "<Slack incoming webhook URL>"
```

**2. Build and upload the Lambda code**
```bash
python scripts/build.py
aws s3 cp build/incident_assistant.zip s3://<bucket>/releaseguard/incident_assistant.zip
aws s3 cp build/storage_forecast.zip   s3://<bucket>/releaseguard/storage_forecast.zip
```
After uploading new code, update the stack with a new `IncidentAssistantCodeKey` / `StorageForecastCodeKey` (for example a versioned file name) so Lambda picks it up.

**3. Deploy the stacks, in this order** (`ENV=staging`, main region e.g. `ap-southeast-1`):
```bash
aws cloudformation deploy --stack-name releaseguard-$ENV-alerting --template-file cloudformation/01-alerting.yaml \
  --capabilities CAPABILITY_IAM --parameter-overrides Environment=$ENV LambdaCodeBucket=<bucket> \
  AnthropicApiKeySecretArn=<arn> SlackWebhookSecretArn=<arn> CriticalAlertEmail=<oncall@company.com>

# Use the topic ARNs from the alerting stack outputs below
aws cloudformation deploy --stack-name releaseguard-$ENV-agent --template-file cloudformation/04-cloudwatch-agent.yaml \
  --parameter-overrides Environment=$ENV

aws cloudformation deploy --stack-name releaseguard-$ENV-rds --template-file cloudformation/02-rds-alarms.yaml \
  --parameter-overrides Environment=$ENV DBInstanceIdentifier=<db> WarningTopicArn=<arn> CriticalTopicArn=<arn> \
  FreeStorageWarningGiB=<20% of allocated> FreeStorageCriticalGiB=<10% of allocated> ConnectionsWarning=<80% of max_connections>

aws cloudformation deploy --stack-name releaseguard-$ENV-ec2-web-1 --template-file cloudformation/03-ec2-alarms.yaml \
  --parameter-overrides Environment=$ENV InstanceId=<i-...> ServerName=web-1 WarningTopicArn=<arn> CriticalTopicArn=<arn>

aws cloudformation deploy --stack-name releaseguard-$ENV-alb --template-file cloudformation/05-alb-alarms.yaml \
  --parameter-overrides Environment=$ENV LoadBalancerFullName=app/... TargetGroupFullName=targetgroup/... WarningTopicArn=<arn> CriticalTopicArn=<arn>

aws cloudformation deploy --region us-east-1 --stack-name releaseguard-$ENV-uptime --template-file cloudformation/06-uptime.yaml \
  --parameter-overrides Environment=$ENV SiteDomain=<crm.example.com> SecondaryPath=/admin/login IncidentAssistantFunctionArn=<arn>

aws cloudformation deploy --stack-name releaseguard-$ENV-forecast --template-file cloudformation/07-storage-forecast.yaml \
  --capabilities CAPABILITY_IAM --parameter-overrides Environment=$ENV LambdaCodeBucket=<bucket> \
  DBInstanceIdentifier=<db> InstanceId=<i-...> WarningTopicArn=<arn> CriticalTopicArn=<arn>

aws cloudformation deploy --stack-name releaseguard-$ENV-dashboard --template-file cloudformation/08-dashboard.yaml \
  --parameter-overrides Environment=$ENV DBInstanceIdentifier=<db> InstanceId=<i-...> LoadBalancerFullName=app/...
```

**4. Recommended database setting:** turn on RDS **storage autoscaling** (set a maximum storage threshold). It grows storage online before it runs out.

## Verify after deploying (acceptance tests)

| # | Test | Expected |
|---|------|----------|
| 1 | `aws cloudwatch set-alarm-state --alarm-name <env>-rds-<db>-cpu-warning --state-value ALARM --state-reason "ReleaseGuard test"` | Slack warning with an AI diagnosis within 2 minutes |
| 2 | Same command with `--state-value OK` | Slack **RESOLVED** message, no diagnosis |
| 3 | Trigger a critical alarm with the Slack secret temporarily wrong | The incident-assistant errors alarm emails the critical address |
| 4 | Check the dashboard after 1 hour | Memory and disk widgets show data (agent working) |
| 5 | Check `ReleaseGuard/Forecast` metrics after 2 days of agent data | `DaysUntilFull` published per resource |
| 6 | On staging, fill the disk with `fallocate -l <size> /tmp/fill` past 80%, then delete the file | Disk warning, then RESOLVED |
| 7 | Read the Lambda logs and the Slack message for a log-heavy alert | No email addresses, tokens or passwords appear |

## Monthly cost (approximate, varies by region)
- CloudWatch alarms (~30): about $3
- Agent metrics: about $3 per server
- Route 53 health checks: about $1–2
- Dashboard: $0 (first 3 dashboards are free)
- Logs: about $5–20, depending on volume
- Lambda, SNS, EventBridge: near $0
- Secrets Manager: about $1

Claude API usage is billed per alert diagnosis, and only on ALARM transitions. Set a monthly cap on the key.

"""Demo the incident assistant locally. No AWS account needed.

Runs a sample alarm through the real diagnosis and Slack formatting, using sample metrics and log
lines instead of CloudWatch.

  python scripts/simulate_alarm.py                     # Slack message with a canned diagnosis
  python scripts/simulate_alarm.py --claude            # real Claude diagnosis (needs ANTHROPIC_API_KEY)
  python scripts/simulate_alarm.py --claude --post     # also post to Slack (needs SLACK_WEBHOOK_URL)

Use a test Slack channel and a company API key.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from incident_assistant.alarm import parse_sns_record  # noqa: E402
from incident_assistant.diagnosis import diagnose  # noqa: E402
from incident_assistant.runbooks import load_runbook, runbook_key_for  # noqa: E402
from incident_assistant.slack import build_message, post  # noqa: E402

SAMPLE_EVENT = ROOT / "tests" / "events" / "rds_free_storage_critical.json"

# What collect_context() would return for a database that is filling up because of a runaway job.
SAMPLE_CONTEXT = {
    "metric_window": "last 3 hours",
    "log_window": "last 30 minutes",
    "metrics": [
        {"metric": "AWS/RDS FreeStorageSpace (Minimum)", "unit": "GiB", "datapoints": 36, "latest": 8.41, "minimum": 8.41,
         "maximum": 14.6, "change_over_window": -6.19, "recent_values_oldest_first": [10.9, 10.7, 10.4, 10.2, 9.9, 9.7, 9.4, 9.2, 9.0, 8.8, 8.6, 8.41]},
        {"metric": "AWS/RDS WriteIOPS (Average)", "datapoints": 36, "latest": 1840.0, "minimum": 210.0, "maximum": 1902.0,
         "change_over_window": 1612.0, "recent_values_oldest_first": [1790, 1801, 1822, 1835, 1840]},
        {"metric": "AWS/RDS CPUUtilization (Average)", "unit": None, "datapoints": 36, "latest": 41.2, "minimum": 12.0, "maximum": 44.0, "change_over_window": 29.0},
        {"metric": "AWS/RDS DatabaseConnections (Maximum)", "datapoints": 36, "latest": 38.0, "minimum": 30.0, "maximum": 41.0, "change_over_window": 4.0},
    ],
    "recent_errors": [
        {"log_group": "/releaseguard/production/laravel", "occurrences": 412, "latest_at": "2026-10-23 09:14:58",
         "example": "[2026-10-23 09:14:58] production.INFO: ImportActivityLogs chunk #### inserted ##### rows into activity_logs"},
        {"log_group": "/releaseguard/production/laravel", "occurrences": 3, "latest_at": "2026-10-23 09:12:10",
         "example": "[2026-10-23 09:12:10] production.ERROR: SQLSTATE[HY000]: General error: 1114 The table 'activity_log_archive' is full"},
    ],
    "notes": [],
}

CANNED_DIAGNOSIS = {
    "summary": "The production database lost 6.2 GiB of free space in 3 hours and has 8.4 GiB left.",
    "probable_cause": "A bulk import job (ImportActivityLogs) is writing large volumes into activity_logs. Write IOPS rose from about 210 to 1,840 at the same time.",
    "impact": "At this rate storage runs out in about 4 hours. Then every save in the CRM fails. One archive table is already full.",
    "evidence": [
        "FreeStorageSpace fell from 14.6 GiB to 8.41 GiB over 3 hours",
        "WriteIOPS rose from 210 to 1,840",
        "412 'ImportActivityLogs ... inserted rows' log lines in 30 minutes",
        "3 'SQLSTATE[HY000] 1114 table is full' errors",
    ],
    "next_steps": [
        "Pause the queue worker running ImportActivityLogs to stop the growth",
        "Increase RDS allocated storage, or enable storage autoscaling (online, no downtime)",
        "Check the size of activity_logs and activity_log_archive with information_schema.tables",
        "Agree on a retention rule before deleting any rows, and take a snapshot first",
    ],
    "confidence": "high",
    "is_likely_false_alarm": False,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--claude", action="store_true", help="call Claude for a real diagnosis")
    parser.add_argument("--post", action="store_true", help="post the message to SLACK_WEBHOOK_URL")
    args = parser.parse_args()

    os.environ.setdefault("ENVIRONMENT", "production (simulated)")
    alarm = parse_sns_record(json.loads(SAMPLE_EVENT.read_text(encoding="utf-8"))["Records"][0])
    runbook_key = runbook_key_for(alarm)

    if args.claude:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            sys.exit("Set ANTHROPIC_API_KEY first (never commit it).")
        diagnosis = diagnose(alarm, SAMPLE_CONTEXT, load_runbook(runbook_key), api_key=api_key)
    else:
        diagnosis = CANNED_DIAGNOSIS

    message = build_message(alarm, diagnosis, runbook_key)
    print(json.dumps(message, indent=2, ensure_ascii=False))

    if args.post:
        webhook = os.environ.get("SLACK_WEBHOOK_URL")
        if not webhook:
            sys.exit("Set SLACK_WEBHOOK_URL first (use a test channel).")
        post(webhook, message)
        print("\nPosted to Slack.")


if __name__ == "__main__":
    main()

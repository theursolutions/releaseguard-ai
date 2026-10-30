# ReleaseGuard AI

An internal platform that makes releases predictable. It combines Claude, Jira, Confluence, Bitbucket, AWS and Slack to cut rework between Dev and QA, close test-automation gaps, and catch server problems before users do.

## Architecture

```
                    ┌──────────────── docker network (internal) ─────────────────┐
Browser ──► Portal (Laravel + Vue, :8080)                                          │
            • voice workspace (home) · login & roles · products · history          │
            • Connections (encrypted secrets) · Services page                      │
            • sends each service only the credentials it needs                     │
              ├──► prd-service (FastAPI)         → Claude, Confluence              │
              ├──► monitoring-service (FastAPI)  → AWS CloudWatch, Claude, Slack   │
              │    (reuses the Module E incident assistant code)                   │
              └──► assistant-service (FastAPI)   → Claude (streaming, tools)       │
                   ◄── tool calls back to the portal for business data, as the     │
                       asking user (service token + signed user context)           │
                    └──────────────────────────────────────────────────────────────┘
AWS (separately deployed):  CloudWatch alarms → SNS → incident-assistant Lambda → Slack
```

| Part | Folder | Status |
|------|--------|--------|
| **Portal**: the single UI for everything, with the voice workspace as home | [`portal/`](portal/) | Built |
| **Assistant service**: conversational AI over ReleaseGuard data | [`services/assistant-service/`](services/assistant-service/) | Built (needs an approved Claude credential to answer) |
| **PRD service**: PRD quality checker (Module B) | [`services/prd-service/`](services/prd-service/) | Built |
| **Monitoring service**: alarm status and AI diagnosis for the portal | [`services/monitoring-service/`](services/monitoring-service/) | Built |
| **Module A: Claude Code developer toolkit** | [`toolkit/`](toolkit/) | Built |
| **Module E: AWS monitoring + AI incident assistant** (CloudFormation + Lambda) | [`monitoring/`](monitoring/) | Built, not yet deployed |
| Module C: QA coverage service | `services/qa-service/` | Planned |

How services plug in, and the rules they follow: [`services/README.md`](services/README.md).

## Run everything with Docker

```bash
cp .env.example .env          # fill in APP_KEY and the three service tokens (commands are in the file)
docker compose up --build -d
docker compose exec portal php artisan portal:make-admin you@company.com --name="Your Name"
```

Open http://localhost:8080 (or your `PORTAL_PORT`) and sign in. Then:
1. **Connections:** connect Claude with an approved runtime credential (see [Claude authentication](#claude-authentication-developer-vs-runtime)), and optionally Jira & Confluence, AWS read-only keys and Slack. Click **Test connection** on each.
2. **Services:** all three services should show **Online**.
3. **Products** (admins): add your products, an optional CloudWatch alarm prefix for each, and the members allowed to see them.
4. **Assistant** (home screen): ask by voice or text. Until Claude is connected it shows **Authentication required** and the exact next step, and never answers on its own.
5. **PRD Checker:** upload a PRD.
6. **Monitoring:** shows labelled demo data until AWS is connected. Click **AI explain** on an alarm.
7. **Users:** add your team as members or admins.

## Claude authentication: developer vs runtime

There are two different kinds of access, and they are kept separate.

| | Who | How | Used for |
|---|---|---|---|
| **Developer access** | A person writing code | Signing in to **Claude Code** with the company Claude Team account | Building ReleaseGuard. Stays on that person's machine. |
| **Runtime access** | The ReleaseGuard server | An approved credential saved by an admin on **Connections** | PRD checks, alarm diagnosis and the assistant, for every user. |

Anthropic's terms allow a Claude subscription sign-in (Free, Pro, Max, Team, Enterprise, including `claude setup-token` tokens) only in Claude Code and Anthropic's own apps. A custom application like ReleaseGuard must use one of these instead, and they are the only options on the Connections page:

1. **Company API key (Claude Console).** Preferred. Claude Team plans include monthly API credits ($20 per Standard seat and $100 per Premium seat, pooled and capped at $500 a month). They become usable once the **Team plan Owner links a Claude Console organisation**. The Owner (or a Console admin) then creates a key for a service account named for ReleaseGuard. Usage beyond the credits is billed at API prices.
2. **Server identity (Workload Identity Federation).** No key is stored in the portal. DevOps configures the services' environment so the Anthropic SDK resolves a federated identity itself.
3. **Amazon Bedrock.** Uses the company AWS account: a region, plus an IAM role (preferred) or an access key pair. It is billed through AWS. Claude must be enabled in Bedrock for that account.

What this means in practice:
- A developer's Claude Code sign-in is **never** copied to the server, the browser or the code, and it does not become available on a production server by itself.
- With no approved credential, every AI feature reports **Authentication required** with the next step. Nothing is simulated.
- The provider is chosen in one place (`services/*/app/providers.py`), so switching from an API key to Bedrock (or back) needs no code changes.

## AI providers

Connections has a card for **Claude** (company API key, server identity or Amazon Bedrock), **Google Gemini**, **OpenAI**, and any **OpenAI-compatible API** (Groq, Mistral, DeepSeek, OpenRouter, xAI, or a local Ollama at `http://host.docker.internal:11434/v1`). The **AI provider in use** card picks one, or *Automatic* uses the first one that is set up. All AI calls go through `services/shared/releaseguard_ai`. Each connection test makes one tiny real request, so a key with no credit is reported as such and never shown as connected.

## Performance dashboards (CRM & HomeNet)

1. Create a read-only database user: `CREATE USER 'releaseguard_ro'@'%' IDENTIFIED BY '…'; GRANT SELECT ON homenet.* TO 'releaseguard_ro'@'%';`
2. On **Connections → CRM & HomeNet database**, enter the host (`host.docker.internal` for Laragon on this computer), the `homenet` schema, that user and the `crm_` prefix.
3. Agency owners, agency admins and agents can now **sign in with their CRM email and password**. The password is checked against the CRM and never stored. They see only **Assistant** and **Performance**: owners and admins see their agency, agents see their own earnings and losses. ReleaseGuard admins see every agency. The scope is resolved from the person's live CRM role on every request.
4. Figures use the CRM's own definitions: won/lost revenue from completed/cancelled transactions, paid commissions, and won/lost leads by stage code. Mixed currencies are labelled and never converted.

Without the database connection, executives see clearly labelled demo figures.

## Voice workspace

The assistant at `/assistant` is the home screen, laid out as a command centre that fits the screen without scrolling (1280×720 and larger; smaller screens stack and scroll):

- **Centre:** the voice orb is the microphone. Tap it to listen, tap again (or **Send now**) to send, or **Stop listening** (`Esc`) to discard what was heard. Below it are the transcript and the text box.
- **Live widgets** on both sides: production monitoring, portal & services, developer toolkit, sales performance, PRD readiness and platform activity, plus a live feed of recent events along the bottom. They refresh from real data every 15 seconds while the page is visible (`GET /assistant/live`), show when they were last updated, and label demo data. Each widget loads on its own, so one failing source shows its error while the others keep updating. People signed in with a CRM account see only their sales performance.
- **PRD flows:** pick a reviewed PRD under the composer, then ask about a flow ("show me the invite flow") or press **Show flows**. The flow panel draws it as actor swimlanes (start, action, decision, system and end steps; decision branches labelled). **Run walkthrough** steps through it, narrated if voice output is on, and waits at each decision for you to pick a branch. It is a walkthrough of the documented flow: no code is executed. The review's author or an admin can **correct** the flow by voice or text; the AI applies the correction and it is saved as a new version (the original and every version stay, and any can be restored). Reviews made before swimlanes existed are drawn in one lane from their steps.
- History and voice settings open as side panels.

- **States follow real events only.** *Listening* starts when the browser's speech recogniser starts, and the orb's movement is the measured microphone level. *Thinking* means the request has been sent. *Checking company data* is shown when the service reports that a data tool is running. *Answering* starts with the first streamed words. *Speaking* follows the browser's speech events. *Stopped* means you interrupted (button or `Esc`). *Something went wrong* means a real error, with its message. No timers pretend that work is happening.
- **Data access.** The assistant reads ReleaseGuard data through read-only tools: portfolio overview, monitoring status, PRD reviews, PRD review details, PRD flows, alarm diagnoses, team activity, sales performance, platform status (services, AI provider, connections) and the developer toolkit. They run **as the asking user**: members see only their products, team activity and connection details are for admins only, and CRM users get sales performance only. Jira delivery KPIs and calendar meetings are reported as *not connected* rather than guessed.
- **Reduced motion** is respected: the orb becomes a still, state-coloured image.

**Browser speech (no extra service or cost).**

| | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Voice input (speech-to-text) | Yes | Yes | No. Type instead. |
| Voice output (text-to-speech) | Yes | Yes | Yes |

- In Chrome and Edge, recognition audio is sent to the browser vendor's online speech service. Do not dictate anything you would not send to that service.
- Browser voices sound more robotic than a dedicated neural voice service, and recognition accuracy varies with accents, background noise and the microphone. A neural voice provider can be added later behind the same states.

## Run for development (no Docker)

- Portal: `cd portal && composer install && npm install && php artisan migrate && composer run dev`
- Services: see [`services/README.md`](services/README.md)

## Tests

| Part | Command | Tests |
|------|---------|-------|
| Portal | `cd portal && php artisan test` | Feature tests: roles, secrets, uploads, service calls, jobs, export, assistant (context tokens, tool endpoint, product scoping, streaming relay) |
| Assistant service | `cd services/assistant-service && pytest` | API, auth, providers, tool validation, tool loop, streaming events, errors |
| PRD service | `cd services/prd-service && pytest` | API, auth, document types, Confluence host check, scoring |
| Monitoring service | `cd services/monitoring-service && pytest` | API, auth, demo mode, CloudWatch mapping, diagnosis, Slack URL check |
| Module E | `cd monitoring && pytest && cfn-lint cloudformation/*.yaml` | Lambda logic and templates |

## Security rules for this repo
- Never commit secrets. `.env` files are git-ignored. Portal connection secrets are encrypted with `APP_KEY`.
- Services are internal only, require a per-service token, and receive only the credentials they need.
- Claude credentials never reach the browser. The assistant's tool calls are authorised by a short-lived signed context, checked again on every call.
- All AI features are read-only towards production. They recommend; people act.

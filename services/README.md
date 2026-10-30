# ReleaseGuard microservices

Every ReleaseGuard tool runs as its own small service behind the portal. The portal is the only caller.

| Service | Folder | Does | Credentials it may receive |
|---------|--------|------|----------------------------|
| PRD service | [`prd-service/`](prd-service/) | Reviews PRDs (PDF, Word, text, Confluence) with the AI provider in use: actors, flows (each with a swimlane graph), Given/When/Then criteria, PM questions, readiness score, Mermaid diagrams. Revises one flow from a spoken or typed correction (`POST /v1/flows/revise`). | AI provider, Jira & Confluence |
| Monitoring service | [`monitoring-service/`](monitoring-service/) | CloudWatch alarm status, storage forecasts, AI diagnosis of alarms (reuses Module E's `incident_assistant` code). Demo data until AWS is connected. | AWS, Claude, Slack (only to test it) |
| Assistant service | [`assistant-service/`](assistant-service/) | The voice workspace's AI: streams Claude's answer as Server-Sent Events, and runs a short tool loop (at most 5 steps) over read-only ReleaseGuard data | Claude |

## The service contract

Every service must follow these rules, so the portal can plug in new tools the same way.

1. **`GET /health`** (public): `{"status": "ok", "service": "<name>", "version": "x.y.z"}`
2. **`GET /manifest`** (public): name, title, version, description, `capabilities`, `requires` (connections it cannot work without) and `optional` (connections it can use). The portal's **Services** page shows this.
3. **Everything else needs `Authorization: Bearer <SERVICE_TOKEN>`.** The token is unique per service and is shared only with the portal. A service with no `SERVICE_TOKEN` set refuses all calls (HTTP 503) rather than running open.
4. **Stateless and secret-free.** A service stores nothing. The portal sends only the credentials that service is allowed to receive, inside the request body as `credentials: {...}`. They are never logged.
5. **User-safe errors.** For problems the user can fix, return 404, 422 or 502 with `{"detail": "<plain-language message>"}`. The portal shows that message. Any other error is shown as a generic message, and the details stay in the service log.
6. **`POST /v1/connections/test`**: each connection is tested by the service that uses it, so the portal never calls external APIs itself.
7. **Internal network only.** In Docker Compose, services have no published ports.
8. **Claude through `app/providers.py` only.** The supported methods are `api_key` (company Claude Console key), `server_identity` (the SDK resolves a federated identity from the service environment) and `bedrock`. Subscription sign-in tokens are not accepted.

### The assistant service and its tool callbacks
- `POST /v1/status` checks the Claude connection and returns `connected`, `auth_required` or `error`.
- `POST /v1/chat` streams events: `state`, `text`, `tool_start`, `tool_result`, `done` and `error`. When the portal closes the stream (for example, the user pressed Stop), generation is cancelled.
- `prd_review` (`{id, title}`, optional) is the PRD the person selected in the workspace, already checked by the portal; questions about "the PRD" or a flow refer to it. When the `get_prd_flow` tool returns a flow, the workspace draws it in the flow panel.
- To read data, the service calls `POST {PORTAL_INTERNAL_URL}/internal/assistant/tools/{tool}` with its `SERVICE_TOKEN` and the `X-Assistant-Context` header it received from the portal. That context is signed by the portal, expires after 15 minutes and is checked again on every call, so a tool always runs as the asking user and the service cannot widen it. The portal address comes only from the service's environment, never from a request.

### PRD flows and corrections
- Every flow in a review has a `graph`: `lanes` (actors), `nodes` (`id`, `lane`, `kind`: start, action, decision, system or end, `label`) and `edges` (`from`, `to`, `label`; decision branches carry the condition). A graph that does not connect is dropped (`null`) and the portal draws that flow from its steps.
- `POST /v1/flows/revise` takes `prd_title`, `flow`, `instruction` (3–1000 characters) and `credentials`. It returns the revised `flow` (same id) and a `change_summary`, or 502 when the AI's revision does not connect, so nothing is saved. The portal stores each result as a new version (`prd_flow_revisions`); the service stores nothing.

### Adding a new service (for example a QA coverage service)
1. Create `services/<name>-service/` with FastAPI, the endpoints above, tests and a Dockerfile.
2. Add it to `docker-compose.yml` with its own `SERVICE_TOKEN`.
3. Register it in `portal/config/releaseguard.php` under `services`, listing the connections it may receive.
4. Add the portal page that calls it through `ServiceClient` and `CredentialBroker`.

## Run and test locally without Docker

```bash
cd services
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r prd-service/requirements.txt -r monitoring-service/requirements.txt -r assistant-service/requirements.txt pytest

cd prd-service && pytest && cd ..
cd monitoring-service && pytest && cd ..
cd assistant-service && pytest && cd ..

# Run (tokens must match PRD_SERVICE_TOKEN / MONITORING_SERVICE_TOKEN / ASSISTANT_SERVICE_TOKEN in portal/.env)
cd prd-service && SERVICE_TOKEN=<token> uvicorn app.main:app --port 8101
cd monitoring-service && SERVICE_TOKEN=<token> PYTHONPATH=../../monitoring/src uvicorn app.main:app --port 8102
cd assistant-service && SERVICE_TOKEN=<token> PORTAL_INTERNAL_URL=http://127.0.0.1:8000 uvicorn app.main:app --port 8103
```

Interactive API docs are at `/docs` on each service (for example http://127.0.0.1:8101/docs) when running locally.

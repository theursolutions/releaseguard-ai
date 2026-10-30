# CLAUDE.md

ReleaseGuard AI: an internal AI delivery platform (Ziba Property). It is a Laravel + Vue portal with FastAPI microservices, run by Docker Compose at http://localhost:8090 (local login `admin` / `123456`).

**Read `HANDOFF.md` first.** It covers the full context: architecture, AI providers, the voice assistant, CRM and HomeNet performance, the design system, test commands, open items and traps. Also read `README.md` and `services/README.md` (the service contract).

## Non-negotiable
- **Never commit or push** unless the user explicitly asks (the repo has no commits). Never add `Co-Authored-By`.
- Follow `.claude/rules/*` (mandatory): do exactly what is asked, ask when a requirement is ambiguous, never claim tests passed without running them.
- Never use a Claude subscription login (claude.ai or `claude setup-token`) as the app's runtime credential. Use only a Console API key, server identity or Bedrock, or the Gemini, OpenAI or compatible keys.
- Label demo data as demo data. Drive UI states from real events. Never put secrets in code, logs or the browser.

## Where things live
- `portal/`: Laravel 12, Inertia 2, Vue 3, TypeScript, Tailwind 3. Pages are in `resources/js/pages`, services in `app/Services/{Assistant,Crm,Platform,Monitoring,Prd,Connections}`.
- `services/{prd,monitoring,assistant,performance}-service`: FastAPI. `services/shared/releaseguard_ai` is the AI gateway.
- `monitoring/`: Module E (Lambda + CloudFormation). `toolkit/`: Module A (a Claude Code toolkit for other projects).

## Workflow (.claude/)
- Commands: `/start`, `/plan`, `/feature`, `/implement`, `/fix`, `/review`, `/audit`, `/test`, `/status`.
- Agents: planner, developer, tester, requirement-auditor, security-reviewer, performance-reviewer, frontend-developer, frontend-3d-developer.

## Verify
```bash
cd portal && php artisan test && ./vendor/bin/pint --test && npx vue-tsc --noEmit && npm run build
cd services/<svc> && ../.venv/Scripts/python.exe -m pytest -q
docker compose build <one service at a time> && docker compose up -d   # after portal changes rebuild portal AND portal-queue
```

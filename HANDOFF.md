# ReleaseGuard AI: handoff for the next session

Written 2026-10-27 at the end of the build session. Read this first, then `README.md` and `services/README.md`.

## 1. What this is

**ReleaseGuard AI** is an internal AI delivery platform for Ziba Property (msd-my.com). It is a company competition entry and team-training material. Its owner is Muhammad Umer, a developer at Ziba Property who is not an admin.

It gives executives one place to see everything: business performance from the CRM and HomeNet, requirement (PRD) readiness, production health, and a voice/text AI assistant that answers questions about all of it.

- Repo: `C:\laragon\www\releaseguard-ai`. This is a separate project, **not** the CRM at `C:\laragon\www\crm`.
- Local URL: **http://localhost:8090** (Docker; port 8080 is taken on this PC).
- Local login: **`admin` / `123456`**. This is a demo account and must be changed before anyone else can reach the portal.

### Rules the user set (follow them)
- **Never commit or push in this repo.** There are no commits at all; `main` is empty. Only commit if the user explicitly asks.
- Never add `Co-Authored-By` to commits.
- Do only what is asked. Ask when a requirement is ambiguous. Verify with real tests and report honestly; never claim something passed without running it. The CRM repo's `.claude/rules/*` describe the same working style.
- **Never use a Claude subscription login (claude.ai OAuth or `claude setup-token`) as the app's runtime credential.** Anthropic's terms reserve those for Claude Code and Anthropic's own apps. An earlier implementation of this was removed. Allowed methods are a Console API key, server identity (Workload Identity Federation) or Amazon Bedrock. The user knows this.
- Never show fake data as real. Every demo or simulated figure must be labelled. UI states must come from real events, never timers. Don't call the assistant "Jarvis".
- The user wants things done quickly, with a high-tech, eye-catching dark design.

### Claude Code workflow for this repo (`.claude/` + `CLAUDE.md`)
`CLAUDE.md` loads automatically and points here. The `.claude/` folder was copied from the CRM project, without the personal `settings.local.json`, and adapted to ReleaseGuard:
- `rules/00-core … 07-testing`: mandatory engineering rules. Do only what is asked, ask on ambiguity, write acceptance criteria, follow security, performance and testing standards, and never claim untested results.
- `commands/`:
  - `/start`, `/status`: orient yourself, report state;
  - `/plan`, `/feature`, `/implement`: requirement → plan → build;
  - `/fix`: bugs; `/review`, `/audit`: quality and security checks; `/test`: run and report tests.
  - The `implement` and `review` commands carry a ReleaseGuard-specific checklist, which replaced the Krayin one.
- `agents/`: planner, developer, tester, requirement-auditor, security-reviewer, performance-reviewer, plus **frontend-developer** and **frontend-3d-developer** from the toolkit (Module A). Use the two frontend agents for UI and 3D work.
- Module A, the reusable toolkit for *other* projects, is a separate thing: the **devcrew** Claude Code plugin in `toolkit/plugin` (agents, skills incl. the `/fix` `/feature` `/task` crew pipeline, rules injected by hook, safety hooks, Atlassian MCP, and the local 3D agent office at http://localhost:4317), with the `zibaproperty` marketplace in `toolkit/.claude-plugin` and a per-project local-scope installer `toolkit/install.js`. Tests: `node --test "toolkit/plugin/office/test/*.test.js"` and `claude plugin validate toolkit/plugin`.

## 2. Architecture

```
Browser ─► portal (Laravel 12 + Inertia 2 + Vue 3 + TS + Tailwind 3), Docker :8090 → container :8000
            ├─► prd-service          FastAPI  PRD review (AI)            needs: AI, optional Atlassian
            ├─► monitoring-service   FastAPI  CloudWatch + AI diagnosis  optional: AWS, AI, Slack (demo data without AWS)
            ├─► assistant-service    FastAPI  streaming chat + tool loop needs: AI; calls back to the portal for data
            └─► performance-service  FastAPI  CRM/HomeNet analytics + CRM sign-in   optional: CRM DB (demo without it)
Shared Python package: services/shared/releaseguard_ai   (the AI gateway used by all AI services)
Module E (AWS Lambda, CloudFormation): monitoring/  (Claude only, built, not deployed)
Module A: toolkit/  (Claude Code toolkit: rules, skills, agents, installer)
```

- Services are internal only. Each checks its own bearer `SERVICE_TOKEN`; if the token is missing they answer 503 rather than running open. They are **stateless**: the portal sends only the credentials a service is allowed to see, in each request (`config/releaseguard.php` → `services.*.credentials`, built by `App\Services\Platform\CredentialBroker`).
- The service contract (health, manifest, token, user-safe errors) is in `services/README.md`.
- Docker: the Python services build from the **repo root** (`context: .`) so they can include `services/shared`.
- The portal runs `php artisan serve --no-reload` with `PHP_CLI_SERVER_WORKERS=16` (it was 4: a slow CRM query held every worker and the whole page, widgets included, queued behind it). **Do not drop `--no-reload`.** Without it you get one worker, and the assistant's tool callbacks to the portal deadlock while an answer is streaming.
- Docker SQLite: the 4 portal workers and the queue worker share `/data/database.sqlite`. `docker-compose.yml` sets `DB_BUSY_TIMEOUT=5000`, `DB_JOURNAL_MODE=wal` and `CACHE_LIMITER=file` (rate-limit counters in files). Without the last one, parallel requests failed with "database is locked" on the limiter's counter update (a busy timeout does not help there, and SQLite `transaction_mode` needs PHP 8.4; the image has 8.3).
- The portal reads Module A through a read-only mount, `./toolkit:/var/www/toolkit:ro` (`TOOLKIT_PATH`).
- Env files: root `.env` (tokens, `APP_KEY`, `PORTAL_PORT=8090`) and `portal/.env` (local non-Docker). Both are git-ignored. The templates are `.env.example` and `portal/.env.example`.

### Run, build, test
```bash
cd C:/laragon/www/releaseguard-ai
docker compose build <service>   # build ONE image at a time: parallel builds hit a BuildKit "lease does not exist" error
docker compose up -d
# portal (local, sqlite :memory: in tests, safe)
cd portal && php artisan test && ./vendor/bin/pint --test && npx vue-tsc --noEmit && npm run build
# python (venv at services/.venv; Module E has its own monitoring/.venv)
cd services/<svc> && ../.venv/Scripts/python.exe -m pytest -q
cd services/shared && ../.venv/Scripts/python.exe -m pytest -q
cd monitoring && ./.venv/Scripts/python.exe -m pytest -q
```
Last results (2026-10-27, after the command-centre work):
- portal: 133 passed;
- shared: 19; prd: 40; monitoring: 16; assistant: 29;
- performance: 13 passed + 1 skipped (the opt-in live test via `RG_TEST_CRM_DB_PASSWORD_FILE`);
- Module E: 40;
- `vue-tsc` has 13 starter-kit errors that were already there (AppSidebarHeader etc.), and nothing new;
- Pint flags only `bootstrap/providers.php`, which was already there.

The portal Docker image runs `npm run build` itself. After frontend changes, rebuild **both** `portal` and `portal-queue`.

## 3. AI providers (gateway)

`services/shared/releaseguard_ai/`:
- `factory.make_provider(llm)` returns a provider from `anthropic_provider.py`, `gemini_provider.py`, `openai_provider.py` or `compatible_provider.py`.
- Every provider has `ping()`, `structured(system, parts, schema, schema_name, max_tokens)` and `stream_turn(system, conversation, tools)`.

| Provider | SDK / API | Default model | Notes |
|---|---|---|---|
| anthropic | `anthropic` 1.17; api_key, server_identity or Bedrock (`AnthropicBedrockMantle`) | `claude-opus-5-5` | structured output via `output_config.format`; server-side fallbacks beta on the first-party API only |
| gemini | `google-genai` 2.33, `generate_content(_stream)` | `gemini-3.8-flash` | parts kept **unmerged** so thought signatures survive; `additionalProperties` stripped from schemas |
| openai | `openai` 3.37, **Responses API** (current models support tools only there) | `gpt-6.1-sol` | `store=False`, `include=["reasoning.encrypted_content"]`, reasoning items replayed |
| openai_compatible | Chat Completions via `base_url` | admin-set | Groq, Mistral, DeepSeek, OpenRouter, xAI, Ollama (`http://host.docker.internal:11434/v1`); JSON-schema → json_object → plain fallback; **no PDF input** (clear error) |

- Conversations are provider-neutral dicts (`types.py`). Errors become `AIError(code, message)` (`errors.py`), with codes such as `auth_required`, `no_credit`, `rate_limited` and `model_not_found`.
- **`ping()` makes a real 1-token request on purpose.** A Claude key with no credit used to pass `models.retrieve` and falsely show "Connected".
- Portal side:
  - `ConnectionType::AiProvider` ('ai'): admins choose `auto`, anthropic, gemini, openai or openai_compatible.
  - `App\Services\Platform\AiProviderResolver`: an explicit choice that isn't set up means **no provider**, never a silent switch.
  - The broker sends `credentials.llm = {provider, ...fields}`.
- **Current state:** a real Claude Console key is saved, valid but with **NO credit** ("credit balance too low"). Status honestly shows "Claude has no API credit left…". A real AI answer has **never** been produced end to end. Next step: add credit, or add a Gemini key on Connections, then ask the assistant something.
- The Gemini and OpenAI paths are tested only with fake SDK clients and fake keys (Google, OpenAI and Groq all correctly rejected fake keys live).

## 4. Voice workspace (`/assistant`, the home page after login)

- `resources/js/pages/assistant/Index.vue`, `composables/useVoiceAssistant.ts`, `components/voice/VoiceOrb.vue` (Canvas 2D).
- **Command-centre layout (2026-10-27):** no page scroll at 1280×720 and up (verified at 1280×720, 1366×768, 1920×1080); below 1024 px it stacks and scrolls.
  - The orb is the microphone: tap to listen, tap again or **Send now** to send, **Stop listening** / `Esc` discards (`cancelListening()`). While listening, its spectrum ring shows the real microphone bands (`readSpectrum()` from the analyser).
  - Six live widgets (`components/assistant/LiveWidget.vue` + `widgets/*`) and a bottom ticker (`EventTicker.vue`), fed by `GET /assistant/live` (`App\Services\Assistant\LiveSummary`) as **two feeds** (`?sections=`): engineering widgets every 15 s, CRM sales every 60 s, so a slow CRM query never holds up the other widgets (`composables/useLiveSummary.ts`). The last response is kept in `sessionStorage` per user and product, so a reload shows it at once with its real age. Sales runs one CRM query at a time per viewer (cache lock) with a 25 s limit; the CRM's listings count can exceed MySQL's 15 s `MAX_EXECUTION_TIME` under load (error 3024). Each section fails on its own. CRM users get the performance section only. Caches: services 10 s, performance 60 s per viewer, toolkit 10 min, monitoring 8 s.
  - The old Insights panel and `/assistant/insights` were replaced by the widgets and `/assistant/live`. History and Settings are slide-over panels.
  - Each widget can be expanded (twice as tall, its side column wider) or collapsed to its title bar; remembered per browser in `localStorage`. The background has slowly drifting lights (no moving line); widgets have no corner brackets.
- **PRD flows:** prd-service adds a swimlane `graph` to each flow and `POST /v1/flows/revise` (see `services/README.md`).
  - Portal: `App\Services\Prd\PrdFlows`, `PrdFlowController` (`/prd/{analysis}/flows`, `/flows/{flow}`, `/corrections`, `/restore/{version}`), table `prd_flow_revisions` (version 0 = the review itself; corrections and restores add versions, nothing is overwritten). Corrections: author or admin (`PrdAnalysisPolicy@update`), synchronous, 90 s timeout.
  - **Flows by PRD module:** the review prompt asks for the PRD's `modules` and flows per module (`flow.module`, ids like `FLOW-CHECKOUT-01`) with every branch drawn (typically 10–25 steps); the analysis call allows 64k output tokens and 540 s. The review page (`pages/prd/Show.vue`, `components/prd/FlowCard.vue`) draws every flow at its latest version as coloured swimlanes, grouped by module (older reviews group by actor and suggest a Re-run), with a walkthrough that opens `FlowOverlay`. The per-actor Mermaid `diagrams` are still generated, but only the Markdown export uses them. `lib/flowLayout.ts` routes connections that skip columns, or whose label doesn't fit the gap, along the channel above the target's lane, so they never cross a step.
  - Front end: `components/flow/FlowOverlay.vue`, `FlowSwimlanes.vue` (SVG), `lib/flowLayout.ts`, `composables/useFlowWalkthrough.ts` (labelled "no code is executed"; narrated steps advance on the speech end event, silent ones on a timer; pauses at decisions), `composables/useDictation.ts` for voice corrections.
  - The composer's PRD picker (`GET /assistant/prd-reviews`) sends `prd_review_id` with chat; a `get_prd_flow` tool result opens the panel.
  - **Not verified with a real AI:** no PRD review exists yet (no AI credit), so real flow graphs and real corrections have only been tested with fake providers and browser-mocked responses.
- States: IDLE, LISTENING, PROCESSING, ANALYZING, RESPONDING, SPEAKING, INTERRUPTED, ERROR. All are event-driven, with no timers. Browser Web Speech API handles speech-to-text and text-to-speech, with its limits documented in the README.
- Chat: the portal's `AssistantController@chat` relays SSE from `assistant-service /v1/chat` and saves conversations (`assistant_conversations`, `assistant_messages`).
- Tools: the assistant calls back to the portal at `POST /internal/assistant/tools/{tool}` with its service token plus a signed `ContextToken` (HMAC from APP_KEY, 15-minute TTL), so every tool runs **as the asking user**. Tools live in `App\Services\Assistant\BusinessTools`:
  - portfolio overview, monitoring status, PRD reviews and review details (now listing flows), `get_prd_flow`, alarm diagnoses, team activity (admins only), `get_platform_status` (connections for admins only), `get_toolkit_inventory`;
  - **`get_sales_performance`**, the only tool available to CRM users.
- Products (admin page `/products`) scope PRD reviews and alarms (by alarm-name prefix) for members.
- Not done: the user mentioned an "Executive AI Assistant specification" document that was never provided. Jira delivery KPIs and calendar meetings report "not connected" by design.

## 5. CRM & HomeNet performance (the newest work)

### Data access
- **The CRM and HomeNet share ONE MySQL schema, `homenet`**:
  - CRM tables use the `crm_` prefix (`crm_leads`, `crm_transactions`, `crm_commissions`, `crm_lead_pipeline_stages`, `crm_roles`, …);
  - HomeNet tables have no prefix (`users`, `agents`, `agencies`, `moderator_users`, `agent_roles`, `vacancies`, `inquiries`).
- A local SELECT-only user **`releaseguard_ro`@'%'** exists on Laragon MySQL 8.0.30. Its password is saved only in the portal's encrypted Connections (CRM database card: host `host.docker.internal`, db `homenet`, prefix `crm_`). The service also sets `SESSION TRANSACTION READ ONLY` and `MAX_EXECUTION_TIME` to 15 s.
- Local data: about 470 leads, 14 deals, 20 commissions, 10 agencies, 9887 users and 61k listings, with mixed currencies (RM, S$, PKR).

### performance-service (`services/performance-service/app`)
- `identity.py`: **CRM sign-in and persona.**
  - Passwords are bcrypt; `$2y$` is normalised to `$2b$`. An unknown email and a wrong password return the same message.
  - Rules mirror the CRM's `User::getRoleIdAttribute`, first match wins:
    1. moderator_users → **moderator** (global);
    2. owns a live agency → **agency_owner**;
    3. agent_roles + crm_roles with permission_type all/agency (or the global "Administrator") → **agency_admin**, otherwise **agent**;
    4. `users.agency_id` set → **agent**, or **independent** if their live agents row has left the agency;
    5. a live agents row → **independent**.
  - Refused: inactive users, deleted users, non-active agent rows, and unpublished agencies.
  - The scope is resolved again on **every** request.
- `metrics.py` uses the CRM's own definitions:
  - **won revenue** = SUM(closed_price) of completed, published transactions, windowed on `updated_at`; **lost** = the same for cancelled;
  - **commission paid** = SUM(agent_net_amount) of paid commissions, windowed on `paid_at`;
  - **won/lost leads** by stage code, windowed on updated_at;
  - **sources** use the CRM's source_tag buckets (Enquiry, WhatsApp, Chat, Manual, Others);
  - deal scope: `agent_id IN scope AND (agency_id IS NULL OR the viewer's agency)`;
  - agency members = users with that agency_id and a live agents row, plus the owner;
  - **conversion** and **win rate** are ReleaseGuard definitions and are labelled as such;
  - currencies are never converted; "mixed" is flagged.
  - Outputs: KPIs with previous-period change, revenue and lead trends, funnel, sources, weekday×hour heatmap, lost reasons, leaderboard, agencies, earnings, and a drill-down directory.
- `demo.py`: labelled demo data used when no DB is connected (executives only).
- Endpoints: `/v1/identity/verify`, `/v1/performance/overview` (`viewer {kind: executive|crm, crm_user_id}`, period 7d/30d/90d/12m/all, `agency_id` and `agent_user_id` for drill-down), `/v1/connections/test` (warns if the DB user can write).
- Performance: a full overview took about 1 s after replacing the per-agency correlated subqueries. Failing SQL is logged as statement text only, never parameters. The CRM has no indexes on transaction dates, so watch larger datasets.

### Portal side
- CRM sign-in:
  - `LoginRequest` tries a local account first (`Auth::attemptWhen` skips CRM-linked users, so a password reset can't bypass the CRM's checks), then `App\Services\Crm\CrmSignIn`.
  - The linked local user has `crm_user_id`, `crm_persona`, `crm_agency_id` and `crm_agency_name` (migration `2026_10_25_000001`), a random unusable password, role `member`, and never becomes admin.
  - It refuses to take over a ReleaseGuard account that has the same email.
- Gates in `AppServiceProvider`:
  - `performance` = admin or CRM user;
  - `engineering` = not a CRM user (dashboard, PRD, monitoring);
  - CRM users see only **Assistant + Performance**; the sidebar is role-aware.
- `PerformanceController` (`/performance`, `/performance/data`) and `App\Services\Crm\PerformanceData`. The viewer always comes from the server, never from the browser.
- **The positive CRM sign-in path has not been tested with a real password.** Nobody's CRM password was available; a wrong password is correctly rejected live. Ask the user to try their own account (umer@msd-my.com owns Agency #8 in the CRM).

## 6. Frontend design system

- **Dark command-center theme is the default** (`useAppearance` DEFAULT `dark`; tokens in `resources/css/app.css` `.dark`). Light mode is still available.
- Helpers:
  - `.glass` (in dark mode it has **no backdrop-filter**, on purpose, for performance);
  - `.edge-glow`, `.hud-label`, `.metric-value`, `.metric-glow`;
  - the `AppBackground` grid, light fields and scan line.
- Charts: **ECharts 6.1** through `lib/charts.ts` (tree-shaken registration, `baseOption`, `categoryAxis`, `valueAxis`, opt-in `legend()`, `glow()`, palette) and `components/charts/EChart.vue`:
  - **lazy-initialised when scrolled into view**, follows the theme, honours reduced motion;
  - number formatting lives in `lib/numbers.ts` so pages without charts don't load ECharts.
- `components/charts/KpiTile.vue` shows an animated value, the change versus the previous period (inverted for "lost" metrics) and a sparkline.
- 3D (three.js 0.170, lazily loaded):
  - `components/OrbitScene.vue`: system orbit on the command center;
  - `components/three/PerformanceGalaxy.vue`: agencies as planets and agents as moons, sized by revenue and coloured by win rate; click to drill in; capped at 30 fps; still frame under reduced motion.
- Pages:
  - `pages/Dashboard.vue`: "Command center", with the business pulse for admins plus product health;
  - `pages/performance/Index.vue`: full analytics with drill-down;
  - `pages/assistant/Index.vue`: the command centre (see section 4);
  - also `pages/products/Index.vue` and `pages/connections/Index.vue` (generic cards for every ConnectionType).
- Browser verification scripts (Playwright with system Chrome) are in the old session's scratchpad, `…\scratchpad\shots\design.mjs` and `voice.mjs`. The command-centre check is `C:\Users\Lenovo\AppData\Local\Temp\claude\c--laragon-www-releaseguard-ai\f7987ae1-6552-4adc-b440-f7f1c969a928\scratchpad\verify-assistant.mjs` (it mocks only flow and chat responses, in the browser). Headless Chrome here has no GPU, so use `reducedMotion: 'reduce'` for screenshots, and remember `.hud-label` is uppercase when matching text.

## Presentation pack (`presentation/`)
- Made 2026-10-30 for the competition submission. **Only `presentation/ReleaseGuard-AI-Presentation.pdf` is kept in the repo** (the user's choice, 2026-10-31). The 3D HTML deck, its sources, the demo MP4, `JUDGES-GUIDE.md` and the sample PRD live in the user's own copy outside the repo. The PDF still mentions `presentation/JUDGES-GUIDE.md` and `presentation/sample-prd/agent-invitations.md`, which are not in the repo.
- Test counts on the slides (395 passing) are from 30 October 2026; time saved is labelled as **estimates**. Update both if they change.
- On this PC at that time: the AWS connection was rejected (`SignatureDoesNotMatch`), so the video shows monitoring through slides, not the live page.
- Updated 2026-10-31: the team is **Ziba Property** (not MYZESTY); 28 slides (slide 3 "How it was built", ≈ 20 hours); the stage is centred with `translate(-50%,-50%) scale()` so no window size cuts it off; every slide carries the "Developed by Muhammad Umer" credit. The video has real assistant answers (Gemini, Ziba monetization PRD), the devcrew office demo and a real QA cycle on Ziba staging. Recording scripts are in the session scratchpad `video/` (`record.mjs`, `live-assistant.mjs`, `qa-live.mjs`, `narrate.ps1`, `compose.mjs`, `assemble.mjs`).
- Portal: `components/DeveloperCredit.vue` (photo `public/images/team/muhammad-umer.jpg`, from `~/.devcrew/crew/umer.png`) at the bottom of every sidebar page, under the sign-in card, and beside the live feed on the Assistant page. The Toolkit and QA Testing images in `public/images/{toolkit,qa}` are dark-theme captures.

## 7. Open items / ideas (not started unless the user asks)

1. Get a working AI answer: add credit to the Claude Console org, or add a Gemini or OpenAI key. Then test the assistant tool loop, PRD analysis and alarm diagnosis for real.
2. Test CRM sign-in with a real agency-owner account and a real agent account, and check that their scopes match the CRM's own dashboard.
3. The "Executive AI Assistant specification" document from the user is still missing.
4. Jira delivery KPIs and calendar/meetings are not connected (the assistant says so).
5. Production deployment: replace `artisan serve` with nginx + php-fpm; EC2 + RDS MySQL; CloudFormation for Module E is written but not deployed.
6. Possible CRM `.env` typo noticed (`DB_PORT=3306a` in `C:\laragon\www\crm\.env`). It was reported to the user and not changed.
7. Some files (Dashboard.vue, performance/Index.vue, lib/charts.ts, ConnectionType.php, the gemini/openai providers, useVoiceAssistant.ts) were modified on disk after this session's last edit, perhaps by the user. Re-read them before editing, and re-run the tests and build.

## 8. Traps learned the hard way

- Docker: build images one at a time. Rebuild both `portal` and `portal-queue` after portal changes. `--no-reload` is required for multiple workers.
- In the bash tool, heredocs that contain backticks get mangled. Write Python patch scripts to a file instead.
- PyMySQL with parameters: a literal `%` in SQL must be written `%%` (DATE_FORMAT, LIKE).
- Query-string ids arrive as strings, so cast them to int before sending to services (the service compares them strictly).
- Inertia pages need the `.vue` file to exist for `assertInertia` tests to pass.
- Claude "Connected" is meaningless unless a real request works (no-credit keys).
- `overflow: hidden` containers can still be scrolled by focus; the workspace uses `overflow: clip` so opening a panel never shifts the page.
- On Windows, Python `Path.write_text` writes CRLF and Pint then fails with `line_ending`. Write with `newline="\n"` (or bytes) and keep each file's existing line endings. Shell heredocs also eat backslashes: write patch scripts to a file.
- Another Claude session may be working in this repo at the same time (a Toolkit page appeared during the 2026-10-27 session). Re-read shared files such as `routes/web.php` before editing them.

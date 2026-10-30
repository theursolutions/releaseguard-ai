# devcrew onboarding: 15 minutes

## 1. Install Claude Code (3 min)

**Windows:** install [Git for Windows](https://git-scm.com/download/win) and [Node.js](https://nodejs.org) first. Then, in PowerShell:
```powershell
npm install -g @anthropic-ai/claude-code
```

**macOS:**
```bash
npm install -g @anthropic-ai/claude-code
```

Optional: install the **Claude Code** extension in VS Code. It uses the same plugins.

## 2. Sign in with your company seat (2 min)
```bash
claude
```
Type `/login` and choose the Claude account option. Sign in with **your own company** account. Never share a login.

## 3. Install devcrew in your project (2 min)
```bash
git clone <toolkit-repo-url> ai-dev-toolkit      # or unzip the download from the ReleaseGuard portal
node ai-dev-toolkit/install.js path/to/your-project
```
Nothing is added to the project's code or dependencies, and `git status` stays clean. Repeat for each project.

## 4. Connect Jira and Confluence (2 min)
Open the project in Claude Code (`cd path/to/your-project` then `claude`, or open the folder in VS Code). If asked, approve the `atlassian` server, then type `/mcp`, pick **atlassian** and sign in in the browser. Claude only sees what your own Jira account can see.

## 5. Your daily commands (6 min to try)

| When | Type | What happens |
|------|------|--------------|
| Any work, in plain words | `/devcrew:task add CSV export to the agents list` | The router picks the crew and runs it end to end |
| Fixing a bug | `/devcrew:fix ZP-1234` | Plan → failing test → root-cause fix → tests → regression → review |
| Building a story | `/devcrew:feature ZP-1234` | Reads the ticket and PRD → plan → developers in parallel → QA → regression → review |
| Requirements check | `/devcrew:prd-check <PRD link>` | Missing flows, questions for the PM, readiness score |
| Plan only, no code | `/devcrew:plan ZP-1234` | Scope, acceptance criteria, files, DB changes, tests, risks |
| Review your diff | `/devcrew:review` | Review against the ticket and rules, plus lint and tests |
| Tests for your changes | `/devcrew:test` | Missing unit and feature tests |
| E2E tests | `/devcrew:e2e ZP-1234` | Playwright tests from acceptance criteria (when the project has Playwright) |
| PR text | `/devcrew:pr` | Ready-to-paste PR description with QA steps |
| Before a release | `/devcrew:release-check 1.4.0` | GO / NO-GO checklist |
| Watch the crew | `/devcrew:office` | Opens http://localhost:4317 (add `demo` to see a demo run) |
| Link this project to a QA app | `/devcrew:qa-link releaseguard` | The crew can now run QA's test cases on your local app |
| Run QA's test cases | `/devcrew:qa-run` | The linked app's QA cycle on your local app, with a short report |
| Write test cases from a PRD | `/devcrew:qa-from-prd homenet-staging <confluence link or file>` | Draft cases on the QA page, for QA to review and add |

The short form (`/fix`, `/task`, …) also works when no other command in the project has that name.

**Try now:** run `/devcrew:office demo` and open http://localhost:4317.

## How the crew runs
The crew works **on its own** from the command to the final report. It stops only when:
- a requirement is unclear (it asks you instead of guessing),
- the planner finds a blocking question, or
- tests still fail after two fix rounds.

You still own the result: **read the report and review the diff before you commit.** The crew never commits or pushes.

## QA test cycles

**For QA, no code needed:**
1. Install devcrew into an empty folder: `node ai-dev-toolkit/install.js C:\qa-workspace` (create the folder first).
2. Open that folder in Claude Code and type `/devcrew:office`, then open **http://localhost:4317/qa**.
3. Click **Add app**: its name and web address per environment, or **Use a ready-made app → ReleaseGuard portal**.
4. Add a test account, paste your test cases (one per line, in plain English) and click **Run test cycle**.

**For developers:** link your project folder to QA's app with `/devcrew:qa-link <app-id>` (or under **Project folders on this computer** in the app's settings on the QA page). The app needs a **Local** environment. From then on `/devcrew:fix`, `/feature` and `/task` run QA's cases on your local app after the regression check, and send newly failing cases back to the developer with their root cause. Keep your local server running. `/devcrew:qa-run` runs the cycle on its own.

## Things that are blocked on purpose
You'll see "Blocked by devcrew" or "Blocked by team toolkit" if Claude tries to:
- read or edit `.env` files or keys, or edit `vendor/`, lock files or compiled assets
- run `migrate:fresh`, `db:wipe`, `DROP` / `TRUNCATE`, `git reset --hard` or force-push
- print secrets (`cat .env`, `printenv`)

If you really need one of these, run it yourself.

## Help
Ask in the team channel. To suggest an improvement, open a PR on the `ai-dev-toolkit` repo.

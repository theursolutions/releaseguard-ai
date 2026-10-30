# AI Dev Toolkit: the devcrew plugin

A Claude Code plugin that gives every developer and QA engineer the same AI crew: the same rules, the same commands, the same safety checks, and a live 3D office that shows which agent is doing what.

Type one command. The crew decides who does the work:

```
/devcrew:fix ZP-1234
  router ─► planner + regression baseline ─► developer ∥ frontend-developer ─► test-engineer ∥ qa-automation ─► regression-tester ─► QA cycle ─► code-reviewer
```

Watch it at **http://localhost:4317**.

## It never touches your project
- The plugin lives in Claude Code's own folder (`~/.claude/plugins`), not in the project.
- It adds **no** packages, config files or folders to the project, and nothing to commit.
- It's installed per project, for you only ("local" scope). The only trace is Claude's personal `.claude/settings.local.json`, which the installer adds to `.git/info/exclude` (git's private ignore list), so `git status` stays clean.
- The office runs only on your computer (`127.0.0.1`) and records no prompts, file contents or command arguments.

## Install

Requires Node.js and Claude Code ([docs/ONBOARDING.md](docs/ONBOARDING.md)).

```bash
git clone <toolkit-repo-url> ai-dev-toolkit        # or download the zip from the ReleaseGuard portal (Toolkit page)
node ai-dev-toolkit/install.js path/to/your-project --dry-run   # preview
node ai-dev-toolkit/install.js path/to/your-project             # install
```

Run it once for each project you want the crew in. To remove it: `node ai-dev-toolkit/install.js path/to/your-project --uninstall`.

**Updates:** `git pull` in `ai-dev-toolkit`. The plugin is read from that folder, so changes apply at your next Claude Code session.

## What's inside (`plugin/`)

| Part | Where | What it does |
|------|-------|--------------|
| **Crew commands** | `skills/fix`, `feature`, `task` | Route work to the right agents and run plan → build → QA → regression → review automatically |
| **Other commands** | `skills/` | `/devcrew:plan`, `review`, `test`, `e2e`, `pr`, `prd-check`, `release-check`, `office`, `qa-run`, `qa-link`, `qa-from-prd` |
| **Agents** | `agents/` | `planner`, `prd-analyst`, `developer`, `frontend-developer`, `frontend-3d-developer`, `test-engineer`, `qa-automation`, `regression-tester`, `code-reviewer` |
| **Team rules** | `rules/` | Given to the session and every agent at start (scope, Definition of Done, security, testing, git, Laravel) |
| **Safety hooks** | `hooks/` | Block reading or editing `.env` and keys, database wipes, force-push; syntax-check PHP after every edit |
| **Jira and Confluence** | `.mcp.json` | Atlassian connection; each person signs in with `/mcp` |
| **Agent office** | `office/` | Local server + 3D page at http://localhost:4317. Try it with `/devcrew:office demo` |
| **QA test cycles** | `qa/` | Testers write cases in plain English at http://localhost:4317/qa, no code needed. Developers link the project (`/devcrew:qa-link`) so `/devcrew:qa-run` and the crew run them on the local app |

## Learn more
- [docs/ONBOARDING.md](docs/ONBOARDING.md): 15 minutes from zero to your first crew run
- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): routing, the office, and how to add your own agents and commands
- [docs/WORKSHOP.md](docs/WORKSHOP.md): a 90-minute hands-on team workshop
- [docs/CLAUDE-TEMPLATE.md](docs/CLAUDE-TEMPLATE.md): optional template if a project wants its own `CLAUDE.md` (that's the project's choice; devcrew never creates it)

## Improving the toolkit
Change files under `plugin/`, test with `node --test "plugin/office/test/*.test.js"` and `claude plugin validate plugin`, try it on a real project, then open a PR.

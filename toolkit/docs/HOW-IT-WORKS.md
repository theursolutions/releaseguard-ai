# How devcrew works

devcrew is a Claude Code **plugin**. Claude Code loads it from its own plugin folder for each project where you installed it. Nothing lives in the project itself.

## The building blocks

| Block | In the plugin | Loaded when | Use it for |
|-------|---------------|-------------|------------|
| **Skills** (commands) | `skills/<name>/SKILL.md` | When you type `/devcrew:<name>` | Workflows: `/fix`, `/feature`, `/task`, review, tests… |
| **Agents** | `agents/<name>.md` | When the router hands work to them | Specialists with their own context and tools |
| **Rules** | `rules/*.md` | Injected at session start and into every agent (hook `context.js`) | Standards for every task: Definition of Done, security, testing |
| **Hooks** | `hooks/hooks.json` | Automatically, around every tool call | Safety nets and office events |
| **MCP** | `.mcp.json` | When Claude needs Jira or Confluence | Reading tickets and PRDs |
| **Office** | `office/` | Started by the first hook | The live 3D view of the crew |

Plugins can't ship `rules/` or `CLAUDE.md` the normal way, so `hooks/context.js` adds the rules as context to the main session (SessionStart) and to every agent (SubagentStart). `laravel.md` is added only when the project has an `artisan` file.

## How routing works, for example `/devcrew:fix ZP-1234`

```
You type /devcrew:fix ZP-1234
  └─ skills/fix  ──► loads skills/pipeline (the shared crew pipeline)
       1. Triage (the router = your main session)
            reads the ticket (Atlassian), decides: bug or change? backend / frontend / 3D?
            finds the test commands, shows the crew card
       2. planner  ∥  regression-tester (BASELINE: what fails before we start)
       3. developer ∥ frontend-developer ∥ frontend-3d-developer   (one per area, never the same file)
       4. test-engineer ∥ qa-automation (E2E only if the project already has it)
       5. regression-tester (COMPARE: new failures vs the baseline)
       6. QA cycle: QA's cases for the linked app, on its local environment (skipped when nothing is linked)
       7. fix loop: failures go back to the owning developer, at most 2 rounds
       8. code-reviewer (Critical/High findings → one more fix round)
       9. report: crew table, acceptance criteria, files, test results
```

`∥` means the agents run at the same time. The router starts them in a single message.

The crew runs without asking for approval. It stops only for unclear requirements, blocking questions from the planner, or tests that still fail after two rounds.

## How the office works

```
Claude Code hooks ──(async, never blocks)──► office/emit.js ──► http://127.0.0.1:4317/events
                                                                        │
                       browser ◄── /api/state + /api/stream (live) ◄────┘
```

- **Events:** `emit.js` runs on session start, each prompt, each tool call, and each agent start and stop. It reduces every event to the agent name, the tool, the file **name** and the short hand-off description. Prompts, file contents, command arguments and agent replies never leave it.
- **The server** (`office/server.js`, Node with no dependencies):
  - starts by itself on the first event and stops after 4 idle hours
  - listens only on `127.0.0.1`
  - accepts events only with a token stored in `~/.devcrew` on your computer
  - refuses other host names
  - keeps the last 500 events in memory only
- **The lounge:**
  - When nothing is being worked on, the whole crew sits in the Done lounge, taking turns talking.
  - When work starts, each agent walks from the lounge to its room, then back again when it finishes.
- **The page** (`office/public/`) uses Three.js, bundled in the plugin, so it works offline. It has a 2D view for computers without WebGL and for reduced motion.
- **Port:** set `DEVCREW_OFFICE_PORT` to use another one.

### Real names and photos (optional)
You can show agents as real team members on your own computer. Put square headshots in `~/.devcrew/crew/`, then create `~/.devcrew/crew.json`:

```json
{
  "developer": { "name": "Muhammad Umer", "title": "Sr. Full stack developer", "photo": "umer.png" },
  "test-engineer": { "name": "Rafey Hassani", "title": "QA", "photo": "rafey.png" }
}
```

- **Keys** are agent names from `agents/`, plus `router` for the main session.
- **Photos** are PNG, JPG or WebP, up to 2 MB, and must be inside `~/.devcrew/crew/`.
- **To apply changes,** reload the office page.
- **Where it shows:** the photo appears as the character's face and in the panels. Each name carries an **AI** tag, so nobody reads the agent's work as that person's.
- **Privacy:** the file and photos stay on your computer and are never part of the toolkit or a project. Ask each person before using their photo.

## QA test cycles

The office also serves a QA page at **http://localhost:4317/qa**. It is for testers who have no source code, only the app's URL and test accounts.

```
QA page ──► /api/qa ──► runner.js (one process per run)
              setup:   installs Playwright + Chromium once, into ~/.devcrew/qa
              test:    cases learned before replay with Playwright, no AI; plus a smoke crawl and page speed
              prepare: new or edited cases → background Claude Code writes a Playwright test (once per case)
              retest:  the cases learned in this run replay the same way
              report:  pass/fail, screenshots, videos, traces, comparison with the previous run
browsers ──(live frames)──► /qa/events ──► the page's browser wall;  progress also shows in the 3D office
```

- **Setting up an app:** add environments (base URL, login path), test accounts and plain-English cases, one per line. Then click **Run test cycle**.
- **Learning order:** cases learned before are tested first, so their results show within minutes. New cases are then learned, 4 at a time by default (1 to 6 in the run settings), with Sonnet when **Fast learning** is on (off uses your Claude Code model). Each case gets at most 4 minutes to learn. The new cases are tested as soon as all are learned.
- **Cases that couldn't be learned** are grouped on the QA page by reason: needs test data, can't be automated (captcha, email, SMS), the app works differently, the case is unclear, took too long, or a setup problem. Each group says what to do and has a **Re-learn** button for the whole group.
- **Where data lives:** apps, cases and runs are in `~/.devcrew/qa/`, and passwords are in `~/.devcrew/qa-secrets/` (owner-only file). Nothing is written into a project or a git repository. Each app keeps its last 50 runs.
- **Code:** everything is in `plugin/qa/`; `routes.js` is mounted by `office/server.js`.

### QA without code
A tester needs no project and no source code. Install devcrew into an empty folder (for example `node ai-dev-toolkit/install.js C:\qa-workspace`), open that folder in Claude Code and type `/devcrew:office`. Then open http://localhost:4317/qa, add the app (or pick the ready-made **ReleaseGuard portal**), add a test account, paste the cases and click **Run test cycle**.

### Test cases from a PRD
QA can have Claude Code write the cases from a PRD instead of typing them. Nothing is added until QA reviews it.
- **On the QA page:** **Write them from a PRD** above the case box. Paste the PRD text or choose a .txt or .md file. A background Claude Code with no tools and no connections reads it (with Sonnet, at most 4 minutes) and writes one case per acceptance criterion, edge case and error case.
- **In Claude Code:** `/devcrew:qa-from-prd <app-id> <confluence link | page id | file>`. It reads a Confluence page with your own Atlassian sign-in, or a PDF, Word or text file, follows the same rules (`qa/cli.js prd-rules`) and sends the drafts to the QA page with `qa/cli.js prd-drafts`.
- **Review:** the drafts are grouped by flow. Cases that need test data or a manual step (captcha, email, SMS) start unticked, and cases already in the list can't be added twice. If the same PRD was imported before, cases that are no longer in it are listed so QA can delete them.
- **Traceability:** each added case keeps its PRD title, link and flow. The case list, the report and the copied bug report show it.
- **Safety:** the PRD is treated as material to test, never as instructions. Drafts are kept in `~/.devcrew/qa/apps/<app>/prd-draft.json` until they are added or discarded.

### Linking a project (developers)
An app can be linked to the code folders of the project (**Project folders on this computer** in the app's settings on the QA page, or `/devcrew:qa-link <app-id>` in Claude Code). A folder belongs to one app at most: linking it elsewhere moves it. Then `/devcrew:qa-run` runs that app's cycle from Claude Code, on its **local** environment by default, and prints a short report with the root cause and steps to reproduce of each failure.

Both commands use `qa/cli.js` (`status`, `link`, `unlink`, `run`, `wait`). It talks to the office API like the page does, so it never reads the QA files or a password. `run` waits up to 8 minutes per call (Claude Code stops a command after 10), then prints the `wait` command to continue. Exit codes: 0 no newly failing cases, 1 newly failing cases, 2 error, 3 not ready (nothing linked, no local environment, no cases or accounts, the app is not running), 4 another test is running, 5 still running.

### The QA cycle in the crew pipeline
After the regression check, `/devcrew:fix`, `/devcrew:feature` and `/devcrew:task` run the linked app's QA cycle on its local environment, so the developer's local server must be up. Newly failing cases go into the fix loop like regression failures, with their root cause and steps to reproduce. Cases that also failed before are reported, not fixed. When nothing is linked, there is no local environment or no case, the app is not running, or another test is running, the stage is skipped with one line in the crew report and never blocks the crew.

### Load and stress tests
The **Load & stress test** card on the QA page sends many plain GET requests to chosen pages of the app, without a browser. A **load test** runs a set number of virtual users for a set time. Each user visits the pages in turn and pauses between them (500 ms by default). A **stress test** starts with a few users and adds more every step. It stops at the first step where too many requests fail (5% by default) or 1 in 20 is too slow (p95 above 2000 ms by default), and reports that as the breaking point. Otherwise it reports "held up to N users". Requests still waiting at the end of a step count as slow. Users can be logged in as a test account: the login runs in a separate browser process, and the users then share its session cookie. The page shows requests per second, response times, the error rate and active users live, second by second. The report adds totals, percentiles, a per-page table and the charts. Tests run in `qa/load-runner.js` (engine: `qa/lib/load-engine.js`, Node built-ins only), and are kept with the test cycles as runs of kind `load` or `stress`.

The server enforces these limits, both when a test starts and again in the engine:
- never on a production environment, even when "allow production" is ticked
- at most 50 users, and from 10 seconds to 5 minutes (a stress test's planned steps must fit in 5 minutes too)
- only one test at a time, whether a test cycle or a load test
- GET requests only, and only to paths on the environment's own address (other sites, full URLs and `//` paths are refused)
- a 10-second timeout per request, and redirects are counted but not followed (a redirect to the login page is reported as a lost session)

### Safety rules
- **Passwords never leave the computer's QA files.** They never reach Claude, prompts, tests, logs, events, reports or the browser. Claude sees account labels such as "Agent". Logins run in a separate browser process, so a password never appears in a trace or report.
- **The case-preparing Claude is boxed in.** It has no file, shell or web tools, only three QA tools (explore, try, save). Every test it writes must pass `validateSpec`: imports only from the fixture, and no `require`, `process`, files, `eval` or reflection.
- **Production is off by default.** A production environment runs only when "allow production" is ticked, and then only cases tagged `readonly`. The smoke crawl never submits forms and skips logout and delete links.
- **Only this computer can use the page.** Writes need a page token that only the page itself can read. Runner events need the office token. Run files are served only from a run's report and artifacts folders.

## Why these choices
- **Commands run only when you type them** (`disable-model-invocation: true`), because they change code.
- **The reviewer and regression-tester can't edit files.** Their tool lists leave out Edit and Write.
- **Every agent gets the rules,** because agents don't see your conversation.
- **Hooks are Node.js,** so they behave the same on Windows and Mac.
- **Local install scope:** each person and each project opts in, and nothing reaches the project's git history.

## Adding your own
- **A command:** `plugin/skills/<name>/SKILL.md` with `name`, `description`, `argument-hint` and `disable-model-invocation: true`. Use `$ARGUMENTS` for what the user typed.
- **An agent:** `plugin/agents/<name>.md` with `name`, `description`, optional `tools`, and `model: inherit`. To give it a room in the office, add it to `AGENTS` in `office/lib/stages.js`. Unknown agents appear on the Dev floor.
- **A rule:** a short `.md` file in `plugin/rules/`. Keep it short, because every agent receives it.

Check your change with:
```bash
claude plugin validate plugin
node --test "plugin/office/test/*.test.js" "plugin/qa/test/*.test.js"
```
Then try it on a real ticket and open a PR on the toolkit repo.

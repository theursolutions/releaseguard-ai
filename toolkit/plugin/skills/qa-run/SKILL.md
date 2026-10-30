---
name: qa-run
description: Run this project's QA test cycle on its linked app (local environment by default) and summarise the result.
argument-hint: "[environment-id] [--tag <tag>]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# QA test cycle

Runs the test cases QA wrote on the QA page for the app linked to this project, in real browsers. By default it tests the app's **local** environment, so the app must be running on this computer (start the dev server first).

Give every Bash call below a timeout of 600000 ms (10 minutes). One call never waits longer than 9 minutes.

1. **Check the link.** Run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" status`.
   If the exit code is 3, no QA app is linked to this folder. Show the printed help (link with `/devcrew:qa-link <app-id>`, or on the QA page) and stop.
2. **Start the cycle.** Run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" run`.
   - If `$ARGUMENTS` starts with an environment id (lowercase letters, numbers and dashes), add `--env <id>`.
   - If `$ARGUMENTS` has `--tag <tag>`, add it unchanged. Pass nothing else from `$ARGUMENTS` to the command.
   - Tell the user they can watch the browsers live at the printed "Watch it live" link.
3. **Wait.** While the output ends with `still running: node "…" wait <runId>`, run that exact command again.
4. **Read the exit code:**
   - 0: finished with no newly failing cases
   - 1: finished with newly failing cases
   - 2: the run ended in an error or was stopped, or the office could not be reached
   - 3: not ready to run (no local environment, no test cases or accounts, or the app is not running). Pass the printed message on.
   - 4: another test is running on this computer. Try again when it finishes.
5. **Summarise** from the printed report: app, environment, counts, newly failing, fixed and still failing. For each failed case give the failed step, expected and actual, the root cause and the steps to reproduce. End with the report link.

This command only tests and reports. It never changes code. To fix a failure, the user can run `/devcrew:fix` with the case's report. Test-account passwords stay on the QA page: never ask for them or print them.

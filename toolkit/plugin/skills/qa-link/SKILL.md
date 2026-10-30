---
name: qa-link
description: Link this project folder to a QA app, so /devcrew:qa-run and the crew can run its QA test cycle after a change. With no app id, lists the QA apps.
argument-hint: "[app-id]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# Link this project to a QA app

QA apps are added by testers on the QA page (http://localhost:4317/qa): the app, its environments, test accounts and test cases. Linking tells devcrew which of those apps this code folder belongs to. A folder is linked to one app at most; linking it to another app moves it.

1. If `$ARGUMENTS` is empty, run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" status` and show the result: the app already linked, or the QA apps on this computer (id and name). Tell the user to run `/devcrew:qa-link <app-id>`, then stop.
2. Otherwise take the first word of `$ARGUMENTS` as the app id. It must only use lowercase letters, numbers and dashes. If it doesn't, ask for the id instead of running anything.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" link <app-id>` and show what it printed.
   - Exit code 3: there is no QA app with that id. Show the listed apps.
4. After a link, run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" status` and point out what is still missing for a QA cycle: a **Local** environment (the crew tests the app as it runs on this computer), a test account and test cases. QA adds those on the QA page.
5. Next steps: `/devcrew:qa-run` runs the cycle now. `/devcrew:fix`, `/devcrew:feature` and `/devcrew:task` run it after the change, before code review.

To unlink, run `node "${CLAUDE_PLUGIN_ROOT}/qa/cli.js" unlink`, or remove the folder in the app's settings on the QA page.

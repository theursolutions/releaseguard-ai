---
name: fix
description: Fix a bug with the whole crew, automatically. The router picks the agents (backend, frontend or 3D developer), reproduces the bug with a failing test, fixes the root cause, then runs QA, regression and code review.
argument-hint: <JIRA-KEY | bug description>
disable-model-invocation: true
---

# Fix: $ARGUMENTS

1. If `$ARGUMENTS` is empty, take the Jira key from the current branch name (pattern `ABC-123`). If there's still nothing, ask what to fix.
2. Load the **devcrew:pipeline** skill with the Skill tool, and follow it with **type = bug** and this request.
3. Bug-specific requirements for the crew. Pass them on in the hand-offs:
   - **Planner:** summarise the bug in two lines (what happens, what should happen), give the steps to reproduce, and the likely root cause with file:line. Check `git log -p` on the suspect code.
   - **Developer:** first write a test that reproduces the bug and **fails** for the right reason. Then make the smallest change that fixes the **root cause**, not the symptom, and keep the test as the regression test. If the bug can't be reproduced in a test (UI-only, environment, data), explain why and how it was traced instead.
   - **Similar risks:** the planner lists the same mistake elsewhere (copied code, sibling features). The crew fixes only what this bug covers.
4. In the final report, add:
   - **Root cause:** one paragraph
   - **Regression test:** file and test name
   - **Jira comment draft:** a short note for QA on what was fixed and how to verify it. Don't post it unless the user asks.

---
name: task
description: Give the crew any piece of work in plain words. The router decides whether it's a bug or a change, which agents it needs, and runs plan, build, QA, regression and review automatically. Questions are answered directly without the crew.
argument-hint: <what you want done>
disable-model-invocation: true
---

# Task: $ARGUMENTS

1. If `$ARGUMENTS` is empty, ask what to do.
2. Load the **devcrew:pipeline** skill with the Skill tool, and follow it with this request. The router decides the type (bug or change) and the areas itself, in the triage step.
3. If triage decides it's a bug, also follow the bug requirements of **/fix**: reproduce with a failing test, fix the root cause, and report the root cause and the regression test.

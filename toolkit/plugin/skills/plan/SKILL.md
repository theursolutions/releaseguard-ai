---
name: plan
description: Plan a feature, story or change before writing code. Produces a reviewed plan with scope, acceptance criteria, affected files, database changes, tests, steps, risks and an estimate.
argument-hint: <JIRA-KEY | PRD link | short description>
disable-model-invocation: true
---

# Plan: $ARGUMENTS

1. If `$ARGUMENTS` is empty, ask what to plan: a Jira key, a PRD link or a description.
2. Use the **planner** agent with the request. It researches the code and requirements and drafts the plan.
3. Show the plan to the user. If it has **blocking open questions**, list them first and stop until they're answered. Then update the plan.
4. Ask the user to approve or change the plan. Don't write any code in this skill.
5. When it's approved, offer to:
   - save it to `docs/plans/<JIRA-KEY or short-name>.md` for review and handover
   - start building it with `/feature <JIRA-KEY>`

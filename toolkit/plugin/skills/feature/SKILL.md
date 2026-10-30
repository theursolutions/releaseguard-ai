---
name: feature
description: Build a Jira story or feature with the whole crew, automatically. Reads the ticket and linked PRD, then plans, builds (backend, frontend and 3D developers in parallel), tests, runs regression and reviews.
argument-hint: <JIRA-KEY | feature description>
disable-model-invocation: true
---

# Feature: $ARGUMENTS

1. If `$ARGUMENTS` is empty, take the Jira key from the current branch name (pattern `ABC-123`). If there's still nothing, ask what to build.
2. Read the ticket with the Atlassian tools: summary, description, acceptance criteria, comments, linked issues and any linked Confluence PRD. If the tools are unavailable, ask the user to paste the ticket. Never guess requirements.
3. Restate the acceptance criteria as a numbered list. If anything is ambiguous or missing, use the **devcrew:prd-analyst** agent on the ticket and PRD. Show its questions and **stop until the user answers**. Don't pick an interpretation yourself.
4. If a plan for this ticket is already saved in `docs/plans/`, give it to the planner as the starting point.
5. Load the **devcrew:pipeline** skill with the Skill tool, and follow it with **type = change**, these acceptance criteria and this request.
6. In the final report, list each acceptance criterion and where it's met (file:line).

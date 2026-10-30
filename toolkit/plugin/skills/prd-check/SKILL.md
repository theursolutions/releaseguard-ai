---
name: prd-check
description: Check a PRD or Jira epic for missing flows, unclear rules and contradictions before development. Gives a 0–100 readiness score and a list of questions for the PM.
argument-hint: <confluence-url | page-id | JIRA-KEY>
disable-model-invocation: true
---

# PRD check: $ARGUMENTS

1. If `$ARGUMENTS` is empty, ask for a Confluence page link, page ID or Jira key.
2. Use the **prd-analyst** agent on that source and pass on its full output.
3. End with a short summary for the user:
   - **Score:** N/100. Ready for sprint (70 or above) or Not ready.
   - **Top 3 blocking questions**
   - "Shall I post the questions as a comment on the page or ticket?" Only post if the user says yes. Never edit the PRD itself.

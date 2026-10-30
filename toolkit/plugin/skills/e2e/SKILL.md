---
name: e2e
description: Turn a Jira story's acceptance criteria into end-to-end Playwright tests that QA can run on every release.
argument-hint: <JIRA-KEY>
disable-model-invocation: true
---

# E2E tests for $ARGUMENTS

1. Get the Jira key from `$ARGUMENTS` or the branch name. If there is none, ask.
2. Read the acceptance criteria with the Atlassian tools.
3. Use the **qa-automation** agent with the key and the criteria.
4. Report:
   - A table of each criterion, its test file and test name, and Automated / Not automated
   - Test results
   - Any `data-testid` attributes developers should add for stable selectors

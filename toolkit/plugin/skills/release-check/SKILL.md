---
name: release-check
description: Pre-release checklist for a release branch or Jira fix version. Covers tests, migrations, config and env changes, dependencies, open tickets and the rollback plan.
argument-hint: "[fix-version or base..head]"
disable-model-invocation: true
---

# Release check

Arguments: `$ARGUMENTS`. A Jira fix version (for example `1.4.0`) or a git range (for example `main..release/1.4.0`). If empty, ask for the range.

Check each item and mark it PASS, WARN or FAIL with evidence:

| # | Check | How |
|---|-------|-----|
| 1 | Tests pass | Run the suite, following the team testing rules |
| 2 | Migrations reviewed | List new migrations. For each: reversible? Data loss? Locks a large table? Has the indexes it needs? |
| 3 | Config and env | Changes to `.env.example` and `config/`. List every new key that must be set on the server. |
| 4 | Dependencies | Changes to `composer.json` / `package.json`. New packages and major version bumps. |
| 5 | Queues, cron, events | New jobs, scheduled commands, listeners or broadcast channels that need workers or cron |
| 6 | Assets | Does the frontend need a build? |
| 7 | Jira tickets | If a fix version was given: tickets not Done, open bugs, tickets returned from QA (Atlassian tools) |
| 8 | Leftovers | Debug code, TODOs added in this range, hard-coded URLs or credentials |
| 9 | Rollback plan | Can the code and migrations be rolled back? Write the steps. |

## Output
1. **Release verdict:** GO / GO WITH WARNINGS / NO-GO
2. The checklist table with evidence
3. **Deployment steps:** the exact order, for example: maintenance mode → migrate → build → cache clear → restart queues
4. **Rollback steps**

Don't deploy, tag or merge anything.

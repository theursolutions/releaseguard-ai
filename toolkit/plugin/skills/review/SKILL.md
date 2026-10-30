---
name: review
description: Review your own changes before raising a PR. Checks the diff against the Jira acceptance criteria and the project rules, and runs lint and the related tests.
argument-hint: "[JIRA-KEY] [base-branch]"
disable-model-invocation: true
---

# Self-review

Arguments: `$ARGUMENTS`. An optional Jira key and an optional base branch.

## 1. Collect
1. **Base branch:** use the one given, else the remote default (`git rev-parse --abbrev-ref origin/HEAD`), else `main`.
2. **Diff:** `git diff <base>...HEAD` plus uncommitted changes (`git diff` and `git diff --cached`). List the changed files.
3. **Jira key:** use the one given, else the branch name. If found, read the acceptance criteria with the Atlassian tools.

## 2. Review
Use the **code-reviewer** agent. Give it the base branch, the list of changed files and the acceptance criteria.

## 3. Run checks
On the changed files only:
- PHP syntax: `php -l <file>`
- Formatting: `vendor/bin/pint --test <files>`, if Pint is installed
- JS/TS lint, if the project has a lint script
- Related tests, following the team testing rules (database safety first)

Also search the diff for leftovers: `dd(`, `dump(`, `var_dump(`, `console.log(`, `debugger`, `TODO` added in this diff, commented-out code, and hard-coded secrets or URLs.

## 4. Report
**Verdict:** READY FOR PR / NEEDS CHANGES

1. **Findings:** the code-reviewer table
2. **Acceptance criteria:** Met / Not met / Can't tell, with file:line for each
3. **Checks:** each check with pass or fail
4. **Leftovers found:** if any

Then ask: "Do you want me to fix the Critical and High findings?" Don't fix anything before the user answers.

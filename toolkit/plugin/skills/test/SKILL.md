---
name: test
description: Write unit and feature tests for changed or specified code, using the project's existing test framework and conventions.
argument-hint: "[file, class or folder]"
disable-model-invocation: true
---

# Write tests

Target: `$ARGUMENTS`. If empty, use the files changed on this branch (`git diff <default-branch>...HEAD --name-only` plus uncommitted changes), excluding tests, config and assets.

1. For each target, list the behaviours that need tests: public methods, endpoints, validation rules, permissions, and side effects such as events, jobs, mail and database writes.
2. Check which behaviours already have tests. Only add what's missing.
3. Use the **test-engineer** agent to write the tests. Give it the behaviour list and the acceptance criteria, if a Jira key is known.
4. Report:
   - A table of behaviour, test file and test name
   - Test results, in the format from the team testing rules
   - Behaviours not covered, and why

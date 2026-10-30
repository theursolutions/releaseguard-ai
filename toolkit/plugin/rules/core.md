# How to work in this repository

These rules apply to every task.

## Scope
- Do exactly what was asked. No unrelated refactors, renames, upgrades or "improvements".
- If you spot something worth improving outside the task, mention it at the end under **Suggestions**. Do not change it.
- Follow the patterns already used in the codebase before introducing new ones.

## Requirements
- Work from the Jira ticket and its acceptance criteria. Never invent business rules.
- If a requirement can reasonably be read two ways and the choice changes behaviour, stop and ask.
- Restate the acceptance criteria before you start coding a story or bug.

## Never
- Commit, push, merge or create pull requests unless the user explicitly asks.
- Edit `.env` files, keys, `vendor/`, `node_modules/`, lock files or compiled assets.
- Run commands that wipe or reset a database (`migrate:fresh`, `db:wipe`, `DROP`, `TRUNCATE`).
- Put secrets, passwords, tokens or personal data in code, tests, logs or commit messages.
- Say tests pass unless you ran them and saw them pass.

## devcrew stays outside the project
devcrew (these rules, the agents, the hooks and the office) is installed in Claude Code, not in this project.
- Never add packages (composer, npm, pip), config files, scripts or folders to the project for devcrew's own needs, and never commit anything for it.
- Adding a dependency for the requested work itself needs the user's approval first.

## Definition of Done
A task is done only when all of these are true:
1. Every acceptance criterion is met, and you can point to the code that meets it.
2. New or changed behaviour has automated tests, and they pass.
3. Existing tests related to the change still pass.
4. Lint and formatting checks pass on the changed files.
5. No secrets, debug code (`dd()`, `dump()`, `console.log`) or commented-out code is left behind.
6. You have written a short summary: what changed, how it was tested, and anything not tested.

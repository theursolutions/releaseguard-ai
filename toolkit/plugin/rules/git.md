# Git

- Never commit, push, merge, rebase or create PRs unless the user asks in this conversation.
- Never work directly on `main`, `master`, `staging` or `develop`. If asked to commit there, create a feature branch first and say so.
- Branch names: `feature/<JIRA-KEY>-short-description` or `bugfix/<JIRA-KEY>-short-description`.
- Commit messages: `<JIRA-KEY>: <what changed, in the imperative>`, for example `ZP-1234: Validate agent email on invite`.
- One logical change per commit. Never commit `.env`, keys, build output or unrelated files.
- Before committing, show the user the list of files that will be committed.

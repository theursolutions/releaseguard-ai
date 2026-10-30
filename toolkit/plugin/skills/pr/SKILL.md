---
name: pr
description: Write a clear pull request description with QA testing steps, from the branch's commits, diff and Jira ticket.
argument-hint: "[JIRA-KEY] [base-branch]"
disable-model-invocation: true
---

# PR description

Arguments: `$ARGUMENTS`. An optional Jira key and an optional base branch. Find the defaults the same way as /review.

1. Read the commits (`git log <base>..HEAD`), the diff and the Jira ticket (Atlassian tools).
2. Write the description in this exact format, ready to paste into Bitbucket:

```markdown
## <JIRA-KEY>: <ticket title>

**Jira:** <link>

### What changed
- <user-visible change, in plain words>

### Why
<1–2 sentences: the problem this solves>

### How to test (for QA)
1. <precondition / test data>
2. <step>
3. **Expected:** <result>

### Edge cases covered
- <case>

### Technical notes
- Migrations: <none / list>
- New env vars or config: <none / list>
- Dependencies added: <none / list>

### Risk and rollback
<what could break, and how to roll back>

### Screenshots
<add for UI changes>
```

3. Only state facts you can see in the diff or the ticket. If something is unknown, write `TODO:` so the author fills it in.
4. Don't create the PR. Just output the text.

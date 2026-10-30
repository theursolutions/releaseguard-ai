# Claude Engineering Workflow

This project uses a standardized Claude Code engineering workflow.

Developers should NOT manually manage the rules or agents.

The project contains:

```text
.claude/
├── commands/
├── rules/
└── agents/
```

`CLAUDE.md` contains project-specific architecture and development instructions.

`.claude/rules/` contains mandatory engineering standards.

`.claude/commands/` contains reusable engineering workflows.

`.claude/agents/` defines specialized engineering roles.

---

# 1. New Feature

Use:

```text
/feature <feature requirement>
```

Example:

```text
/feature Add automatic lead assignment based on agent workload.
```

Claude will:

1. Analyze the requirement.
2. Inspect the existing code.
3. Identify ambiguities.
4. Ask questions if necessary.
5. Create an implementation plan.
6. Wait for approval.
7. Implement after approval.
8. Test the implementation.
9. Review security and performance.
10. Audit requirements.
11. Report the final result.

Do not manually tell Claude to skip the planning phase.

---

# 2. Planning Only

Use:

```text
/plan <requirement>
```

Example:

```text
/plan Add WhatsApp conversation assignment to agents.
```

This command does NOT modify source code.

Use it when you want to review the architecture and implementation approach before development.

---

# 3. Implement an Approved Plan

Use:

```text
/implement
```

Use this only when an implementation plan has already been approved.

Claude must implement only the approved scope.

---

# 4. Testing

Use:

```text
/test
```

Use this after implementation when you want independent testing.

Testing must include appropriate:

* functional tests
* validation tests
* authorization tests
* edge cases
* regression tests
* smoke tests

The tester must report defects rather than silently changing application behavior.

---

# 5. Code Review

Use:

```text
/review
```

This performs an engineering review covering:

* architecture
* code quality
* OOP
* security
* performance
* database
* scope

The review should not modify the code.

---

# 6. Requirement Audit

Use:

```text
/audit
```

This is the final verification step.

It compares:

```text
Requirement
    ↓
Approved Plan
    ↓
Implementation
    ↓
Tests
```

Every requirement must be marked:

PASS
FAIL
NOT VERIFIED

It also checks whether unrequested functionality was added.

---

# 7. Bug Fix

Use:

```text
/fix <bug description>
```

Example:

```text
/fix Lead assignment creates duplicate notifications when the same lead is assigned twice.
```

Claude must:

1. Understand the defect.
2. Reproduce it where possible.
3. Identify the root cause.
4. Make the smallest appropriate fix.
5. Add/update regression tests.
6. Verify the fix.

---

# 8. Important Rule

Do not ask Claude to:

```text
"improve everything"
"clean up this module"
"optimize whatever you find"
"refactor this area"
```

unless that is explicitly the approved scope.

The engineering system is intentionally designed to prevent autonomous scope expansion.

---

# 9. Recommended Developer Workflow

For a normal feature:

```text
/feature <requirement>

        ↓

Claude asks questions if necessary

        ↓

Claude produces plan

        ↓

Developer reviews plan

        ↓

approved

        ↓

Claude implements

        ↓

Claude tests

        ↓

Claude reviews

        ↓

Claude audits

        ↓

READY FOR PR
```

For a bug:

```text
/fix <bug>

        ↓

Fix

        ↓

Test

        ↓

Review

        ↓

Audit

        ↓

READY FOR PR
```

---

# 10. Pull Request Requirement

Before creating a PR, the developer should be able to provide:

* requirement
* implementation plan
* changed files
* tests executed
* test results
* security review
* performance review
* requirement audit

The goal is not to produce more documentation.

The goal is to make engineering work predictable, reviewable, and repeatable.


our team should be able to write something as simple as:

New feature
/feature

Add automatic lead assignment based on agent skills,
workload and location, with round-robin fallback.
Bug
/fix

Lead assignment sometimes leaves the assigned_agent_id null.
Find the root cause and fix it without changing unrelated behavior.
Test
/test

Test the current lead assignment implementation against its
requirements and edge cases.
Review
/review

Review the current changes for architecture, security,
performance, maintainability and requirement compliance.
Status
/status

That's it.
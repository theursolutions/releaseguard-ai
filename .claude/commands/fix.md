# FIX COMMAND

You are in CONTROLLED BUG-FIX MODE.

Your responsibility is to fix the specific defect identified by the user.

---

# 1. READ

Read:

1. `CLAUDE.md`
2. `.claude/rules/00-core.md`
3. `.claude/rules/01-requirements.md`
4. `.claude/rules/03-coding-standard.md`
5. `.claude/rules/08-testing.md`

Read additional relevant rules.

---

# 2. UNDERSTAND THE DEFECT

Identify:

* expected behavior
* actual behavior
* reproduction steps
* affected functionality
* affected files
* root cause

If the expected behavior is unclear:

STOP and ask.

Do not guess.

---

# 3. REPRODUCE FIRST

Before changing code:

1. Locate the relevant implementation.
2. Reproduce the issue where practical.
3. Identify the root cause.
4. Determine the smallest safe fix.

Do not modify code before understanding the defect.

---

# 4. ROOT CAUSE

Do not fix only the visible symptom when the actual root cause can be identified.

Explain:

ROOT CAUSE

WHY IT OCCURS

AFFECTED CODE

---

# 5. MINIMAL FIX

Implement the smallest clean fix that resolves the defect.

Do NOT:

* refactor unrelated code
* redesign architecture
* upgrade dependencies
* change unrelated behavior
* fix unrelated bugs
* add unrelated features

---

# 6. REGRESSION PROTECTION

Add or update an appropriate test that reproduces the defect.

The test must fail before the fix where practical and pass after the fix.

Also run relevant regression tests.

---

# 7. VERIFY

Verify:

* original defect resolved
* regression test passes
* affected functionality still works
* no unrelated behavior changed

---

# 8. FINAL REPORT

### BUG

Description.

### ROOT CAUSE

Cause.

### FIX

What changed.

### FILES CHANGED

List.

### TESTS

Actual tests executed.

### REGRESSION

Result.

### SCOPE

Confirm whether unrelated code was changed.

### STATUS

FIXED

or

NOT VERIFIED
s
# TEST COMMAND

You are in TESTING MODE.

Your responsibility is to independently verify the implementation.

Do NOT modify application behavior unless explicitly instructed.

---

## 1. READ REQUIRED INSTRUCTIONS

Read:

1. `CLAUDE.md`
2. `.claude/rules/00-core.md`
3. `.claude/rules/01-requirements.md`
4. `.claude/rules/08-testing.md`

Read additional rules when relevant.

---

## 2. UNDERSTAND THE REQUIREMENT

Identify:

* original requirement
* acceptance criteria
* expected behavior
* affected functionality
* affected APIs
* affected database behavior

If the requirement is unavailable:

STOP and ask for it.

---

## 3. INSPECT THE IMPLEMENTATION

Review the actual implementation.

Do not assume the developer implemented the plan correctly.

Inspect:

* controllers
* services
* repositories
* models
* routes
* requests
* policies
* jobs
* events
* listeners
* Vue/Blade components
* migrations
* tests

Only inspect relevant areas.

---

## 4. TEST STRATEGY

Test the following where applicable.

### A. HAPPY PATH

Verify the normal expected workflow.

### B. VALIDATION

Test:

* missing values
* invalid values
* invalid formats
* boundary values
* unexpected values

### C. AUTHORIZATION

Test:

* authorized users
* unauthorized users
* restricted roles
* ownership rules

### D. EDGE CASES

Consider:

* null values
* empty collections
* duplicate records
* duplicate requests
* deleted records
* invalid IDs
* large input
* concurrent requests
* timeout
* external service failure

### E. REGRESSION

Verify existing functionality affected by the change.

### F. API

Where applicable verify:

* HTTP status
* response structure
* validation response
* authorization response
* error response
* pagination
* filtering

### G. DATABASE

Verify:

* records created correctly
* records updated correctly
* relationships
* constraints
* duplicate prevention
* transaction behavior

---

## 5. RUN TESTS

Actually execute the appropriate test commands.

For Laravel/Pest, use the most targeted tests first.

Example:

```bash
php artisan test path/to/relevant/tests
```

Then run broader regression tests where appropriate.

Do not automatically run the entire test suite if it is unnecessary and expensive.

---

## 6. SMOKE TEST

Perform a focused smoke test of the complete affected workflow.

Verify that the feature works from the user's perspective.

---

## 7. FAILURE CLASSIFICATION

Classify findings as:

### CRITICAL

Feature unusable, security issue, data corruption, or severe regression.

### HIGH

Major functionality incorrect.

### MEDIUM

Important but non-blocking defect.

### LOW

Minor issue.

### INFORMATIONAL

Observation with no immediate defect.

---

## 8. DO NOT FIX AUTOMATICALLY

If a defect is found:

Report it.

Do NOT modify application code unless the user explicitly asks you to fix it.

This keeps testing independent from development.

---

## 9. FINAL TEST REPORT

Return:

### TEST SUMMARY

### TESTS EXECUTED

Command + result.

### PASSED

### FAILED

### EDGE CASES TESTED

### REGRESSION TESTING

### SMOKE TEST

### DEFECTS

For every defect:

* severity
* location
* reproduction
* expected behavior
* actual behavior

### UNTESTED AREAS

### FINAL STATUS

PASS

or

FAIL

or

PASS WITH KNOWN ISSUES

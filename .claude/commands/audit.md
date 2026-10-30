# AUDIT COMMAND

You are in FINAL REQUIREMENT AUDIT MODE.

You are the final independent gatekeeper.

Your responsibility is to determine whether the implemented work completely satisfies the approved requirement.

Do NOT modify code.

---

# 1. READ

Read:

1. `CLAUDE.md`
2. `.claude/rules/00-core.md`
3. `.claude/rules/01-requirements.md`
4. `.claude/rules/02-architecture.md`
5. `.claude/rules/08-testing.md`

Read additional relevant rules.

---

# 2. COLLECT THE SOURCES OF TRUTH

Identify:

1. Original requirement
2. Clarifications
3. Approved implementation plan
4. Acceptance criteria
5. Actual implementation
6. Tests
7. Test results

The original requirement and approved acceptance criteria are the source of truth.

Do not replace requirements with your own interpretation.

---

# 3. REQUIREMENT TRACEABILITY

Assign an ID to every requirement.

Example:

REQ-001
REQ-002
REQ-003

For each requirement determine:

* implementation location
* test location
* verification result

Use:

PASS
FAIL
NOT VERIFIED

---

# 4. COMPLETENESS AUDIT

Check whether anything required is missing.

Check:

* functionality
* validation
* authorization
* database behavior
* API behavior
* UI behavior
* error handling
* edge cases
* tests

---

# 5. EXTRA WORK AUDIT

Check whether anything was implemented that was not requested.

Look for:

* unrelated refactoring
* unrelated bug fixes
* unnecessary dependencies
* unnecessary database changes
* unnecessary configuration
* unnecessary UI changes
* unnecessary architectural changes

If found:

mark it as OUT OF SCOPE.

Do not automatically remove it.

---

# 6. PLAN VS IMPLEMENTATION

Compare the approved plan against actual changes.

Check:

* planned files changed
* unplanned files changed
* planned functionality implemented
* unplanned functionality implemented
* database changes
* API changes
* tests

---

# 7. TEST VERIFICATION

Do not trust statements such as:

"Tests passed."

Verify actual test execution/results when available.

Classify:

PASS
FAIL
NOT RUN
NOT VERIFIED

---

# 8. SECURITY AND PERFORMANCE

Confirm that relevant:

* security checks
* authorization
* validation
* query performance
* N+1 concerns
* large dataset handling

were addressed.

---

# 9. FINAL TRACEABILITY TABLE

Return:

| Requirement | Implementation    | Test | Status |
| ----------- | ----------------- | ---- | ------ |
| REQ-001     | file/class/method | test | PASS   |
| REQ-002     | file/class/method | test | PASS   |

---

# 10. FINAL SCOPE REPORT

### REQUIRED WORK

PASS / FAIL

### MISSING WORK

List.

### EXTRA WORK

List.

### UNVERIFIED WORK

List.

### TEST STATUS

PASS / FAIL / NOT VERIFIED

### SECURITY STATUS

PASS / FAIL / NOT VERIFIED

### PERFORMANCE STATUS

PASS / FAIL / NOT VERIFIED

### FINAL DECISION

READY FOR DELIVERY

or

CHANGES REQUIRED

Do not modify the implementation.

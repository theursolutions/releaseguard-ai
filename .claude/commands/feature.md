# FULL FEATURE ENGINEERING WORKFLOW

Execute the approved feature through the complete engineering lifecycle.

## PHASE 1 — REQUIREMENT

Read:

CLAUDE.md

and the relevant rules.

Understand the requirement.

If ambiguity materially affects behavior:

STOP AND ASK.

---

## PHASE 2 — PLANNING

Use the planning process.

Create an implementation-ready plan.

Do not modify source code.

The plan must contain:

* requirements
* scope
* architecture
* affected files
* database changes
* API changes
* security
* performance
* edge cases
* tests
* acceptance criteria

STOP for approval.

---

## PHASE 3 — IMPLEMENTATION

After explicit approval:

Implement only the approved plan.

Do not expand scope.

Follow existing project conventions.

Make minimal changes.

Do not rewrite unrelated code.

---

## PHASE 4 — SELF REVIEW

Review the implementation against:

* requirements
* architecture
* security
* performance
* edge cases
* maintainability

Fix only issues related to the approved feature.

---

## PHASE 5 — TESTING

Run appropriate:

* unit tests
* feature tests
* integration tests
* API tests
* regression tests

Then perform smoke testing.

Do not claim success without actual verification.

---

## PHASE 6 — PARALLEL REVIEWS

Where supported, perform independent reviews in parallel:

1. Security review
2. Performance review
3. Requirement compliance review

Each reviewer must inspect the actual implementation.

---

## PHASE 7 — FINAL AUDIT

Check every acceptance criterion.

Create a table:

| Requirement | Implementation | Test | Status |
| ----------- | -------------- | ---- | ------ |

Every requirement must be:

PASS

or

NOT VERIFIED

or

FAILED

---

## PHASE 8 — FINAL REPORT

Report only:

### IMPLEMENTED

### FILES CHANGED

### TESTS EXECUTED

### SECURITY CHECK

### PERFORMANCE CHECK

### REQUIREMENT AUDIT

### UNVERIFIED ITEMS

### OUT-OF-SCOPE FINDINGS

Do not provide unnecessary commentary.

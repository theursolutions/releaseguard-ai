# TESTING STANDARD

Every implementation must have appropriate verification.

## TEST LEVELS

Use the appropriate combination of:

1. Unit tests
2. Feature tests
3. Integration tests
4. API tests
5. Database tests
6. Authorization tests
7. Regression tests
8. Smoke tests

## TEST CASES

At minimum consider:

* happy path
* invalid input
* unauthorized access
* missing data
* duplicate data
* boundary conditions
* failure conditions
* integration failure
* concurrency where relevant

## TESTING RULE

Never say:

"Tests should pass."

Instead actually execute the relevant tests.

Report:

COMMAND

RESULT

FAILURES

UNTESTED AREAS

## REGRESSION

Existing functionality affected by the change must be tested.

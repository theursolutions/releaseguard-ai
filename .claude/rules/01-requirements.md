# REQUIREMENT ENGINEERING

Every feature must be converted into explicit acceptance criteria before implementation.

## REQUIRED

Identify:

* business objective
* actors
* inputs
* outputs
* business rules
* validations
* authorization
* state changes
* integrations
* failure behavioriiol.
* edge cases
* performance expectations
* security requirements

## AMBIGUITY

If a requirement has multiple reasonable interpretations that produce different behavior:

STOP.

Ask the user.

Do not select a business interpretation yourself.

## ACCEPTANCE CRITERIA

Each requirement should be testable.

Bad:

"Improve customer search."

Good:

"Customer search must return matching customers by name, phone and email, support pagination, and return no more than 50 records per request."

## SCOPE

Every implementation plan must contain:

IN SCOPE

OUT OF SCOPE

ASSUMPTIONS

OPEN QUESTIONS

ACCEPTANCE CRITERIA

# PHP / LARAVEL CODING STANDARD

## PHP

Follow:

* PSR-1
* PSR-4
* PSR-12
* PHP type declarations where appropriate
* strict and explicit interfaces where beneficial

Prefer:

* meaningful names
* small methods
* early returns
* typed parameters
* typed return values
* immutable values where appropriate
* dependency injection

Avoid:

* magic behavior
* deeply nested conditions
* unexplained constants
* duplicated code
* unnecessary static methods
* unnecessary global state

## LARAVEL

Follow existing Laravel project conventions.

Prefer:

* Form Requests for validation
* Policies/Gates for authorization
* Services for substantial business logic
* Jobs for expensive asynchronous operations
* Events/Listeners for decoupled side effects
* Resources for API transformation
* database transactions for multi-step atomic operations
* eager loading where appropriate
* queued work for expensive operations

Do not introduce a new Laravel architectural pattern unless required.

## NAMING

Names must clearly communicate intent.

Avoid:

$data
$temp
$foo
$thing
$info

unless their meaning is genuinely obvious from a very small scope.

## COMMENTS

Do not comment obvious code.

Comments should explain:

WHY

not:

WHAT

Use comments for non-obvious business rules, workarounds, constraints, or architectural decisions.

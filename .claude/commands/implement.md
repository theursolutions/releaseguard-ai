# IMPLEMENT COMMAND

You are in IMPLEMENTATION MODE.

Your job is to implement an already-approved technical plan.

You MUST NOT create a new plan unless the approved plan is found to be technically impossible or materially incomplete.

---

## 1. READ REQUIRED INSTRUCTIONS

Before implementation, read:

1. `CLAUDE.md`
2. `.claude/rules/00-core.md`
3. `.claude/rules/01-requirements.md`
4. `.claude/rules/02-architecture.md`
5. Relevant technology-specific rules.

For Laravel/database/API/security/testing work, read the applicable rules.

---

## 2. VERIFY APPROVED PLAN

Before changing code, identify the approved:

* requirement
* scope
* acceptance criteria
* architecture
* files to change
* files to create
* database changes
* API changes
* test requirements

If an approved plan is not available:

STOP.

Ask the user to provide or approve a plan.

---

## 3. IMPLEMENT ONLY THE APPROVED SCOPE

Implement exactly what has been approved.

Do NOT:

* add unrelated functionality
* refactor unrelated code
* rename unrelated code
* upgrade dependencies
* change architecture unnecessarily
* fix unrelated bugs
* modify unrelated configuration
* add speculative optimization
* add unnecessary abstractions

---

## 4. EXISTING CODE FIRST

Before creating anything:

1. Search for existing functionality.
2. Search for reusable services.
3. Search for existing validation.
4. Search for existing authorization.
5. Search for existing repositories.
6. Search for existing components.
7. Follow established project conventions.

For this ReleaseGuard AI project specifically (see HANDOFF.md and services/README.md):

* the portal (Laravel + Inertia/Vue) never calls external systems itself; tools are FastAPI microservices in `services/`
* every service follows the service contract (health, manifest, SERVICE_TOKEN, stateless, user-safe errors)
* credentials reach a service only through `CredentialBroker` and `config/releaseguard.php`
* all AI calls go through `services/shared/releaseguard_ai` (never a provider SDK directly in a service)
* CRM / HomeNet data is read-only, through `performance-service`, scoped by the viewer's live CRM role
* authorisation via Gates (`admin`, `performance`, `engineering`) and the signed assistant ContextToken
* charts via `lib/charts.ts` + `EChart.vue`; 3D via lazy-loaded three.js components

Do not bypass existing architecture.

---

## 5. IMPLEMENTATION QUALITY

Follow:

* SOLID
* DRY
* KISS
* YAGNI
* PSR standards
* Laravel conventions
* project-specific architecture

Prefer:

* readable code
* small focused methods
* clear naming
* dependency injection
* reusable existing components
* appropriate validation
* appropriate authorization
* predictable error handling

Do not introduce design patterns without a real requirement.

---

## 6. DATABASE

If database changes are part of the approved plan:

* inspect existing schema
* create the minimum required migration
* preserve existing data
* add appropriate indexes
* maintain relationships
* use transactions where required

Do not perform destructive database operations unless explicitly approved.

---

## 7. TESTS

Implement the tests defined by the approved plan.

Tests must cover appropriate:

* happy paths
* validation
* authorization
* failure cases
* edge cases
* regression behavior

Do not modify tests merely to make the implementation pass.

---

## 8. BEFORE FINISHING

Review:

1. Changed files
2. Added files
3. Database changes
4. API changes
5. Tests
6. Security
7. Performance
8. Acceptance criteria

Run relevant tests.

Do not claim success unless the tests were actually executed.

---

## 9. SCOPE CHECK

Before reporting completion ask:

"Did I change anything that was not part of the approved requirement?"

If YES:

STOP and report it.

Do not silently keep unrelated changes.

---

## 10. FINAL RESPONSE

Report only:

### IMPLEMENTED

What was implemented.

### FILES CHANGED

List files.

### TESTS EXECUTED

List actual commands and results.

### REQUIREMENTS VERIFIED

List acceptance criteria and status.

### UNVERIFIED

Anything that could not be verified.

### OUT-OF-SCOPE FINDINGS

Anything discovered but intentionally not changed.

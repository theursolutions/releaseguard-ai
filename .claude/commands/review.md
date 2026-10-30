# REVIEW COMMAND

You are in CODE REVIEW MODE.

Review the implementation as an independent Principal Software Engineer.

Do NOT modify code during the review.

---

## 1. READ

Read:

1. `CLAUDE.md`
2. `.claude/rules/00-core.md`
3. `.claude/rules/02-architecture.md`
4. `.claude/rules/03-coding-standard.md`
5. `.claude/rules/06-security.md`
6. `.claude/rules/07-performance.md`

Read other applicable rules.

---

# 2. REVIEW SCOPE

Review only the requested feature and its directly affected code.

Do not turn the review into a review of the entire repository.

---

# 3. ARCHITECTURE REVIEW

Check:

* separation of concerns
* SOLID
* coupling
* cohesion
* responsibilities
* reuse
* dependency injection
* appropriate abstraction
* existing architecture compliance

For this ReleaseGuard AI project verify:

* the change is in the right place (portal vs microservice vs `services/shared`)
* the service contract is kept (token, stateless, user-safe errors, no secrets in logs)
* credentials only through `CredentialBroker`; nothing secret reaches the browser
* AI only through the `releaseguard_ai` gateway; demo data always labelled
* CRM data stays read-only and scoped server-side (never trust the browser for scope)
* Gates / ContextToken authorisation, and tests for each role
* existing frontend conventions (dark theme tokens, `lib/charts.ts`, lazy 3D)

---

# 4. CODE QUALITY

Check:

* naming
* readability
* method size
* duplication
* complexity
* error handling
* maintainability
* unnecessary comments
* unnecessary abstractions
* unnecessary dependencies

---

# 5. DATABASE REVIEW

Check:

* query efficiency
* N+1
* indexes
* relationships
* transactions
* constraints
* unnecessary queries
* data integrity

---

# 6. SECURITY REVIEW

Check:

* authentication
* authorization
* validation
* mass assignment
* IDOR
* SQL injection
* XSS
* CSRF
* sensitive data
* secret exposure
* insecure logging

---

# 7. PERFORMANCE REVIEW

Check:

* unnecessary queries
* expensive loops
* unnecessary API calls
* memory usage
* large dataset handling
* pagination
* caching
* queue opportunities
* blocking operations

Do not recommend optimization without a reasonable technical justification.

---

# 8. REQUIREMENT COMPLIANCE

Compare:

Requirement
→
Implementation
→
Acceptance Criteria

Identify:

* missing requirements
* partially implemented requirements
* incorrect behavior
* unnecessary implementation

---

# 9. REVIEW FINDINGS

Classify findings:

CRITICAL
HIGH
MEDIUM
LOW
INFO

For every finding provide:

* severity
* file
* location
* problem
* impact
* recommended solution

---

# 10. SCOPE REVIEW

Check whether unrelated changes were introduced.

Report:

* unrelated files
* unrelated refactoring
* unnecessary dependencies
* unrelated configuration changes
* unrelated bug fixes

---

# 11. FINAL RESULT

Return:

### ARCHITECTURE

PASS / FAIL

### CODE QUALITY

PASS / FAIL

### SECURITY

PASS / FAIL

### PERFORMANCE

PASS / FAIL

### REQUIREMENTS

PASS / FAIL

### SCOPE

PASS / FAIL

### FINDINGS

List findings by severity.

### FINAL RECOMMENDATION

APPROVE

or

CHANGES REQUIRED

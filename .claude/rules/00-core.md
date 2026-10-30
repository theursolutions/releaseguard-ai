# CORE ENGINEERING RULES

These rules are mandatory.

1. Do exactly what is requested.
2. Do not perform unrelated work.
3. Do not invent business requirements.
4. Ask questions when requirements are materially ambiguous.
5. Follow existing project architecture.
6. Prefer minimal, clean changes.
7. Never destroy existing user work.
8. Never expose secrets.
9. Never claim tests passed unless they actually passed.
10. Never claim a requirement is complete without verification.

# NO AUTONOMOUS IMPROVEMENTS

Do not improve the project unless improvement is part of the requested requirement.

Do not interpret "make it better" as permission to redesign the system.

Do not:

- refactor unrelated code
- improve unrelated UI
- upgrade dependencies
- change architecture
- optimize unrelated queries
- rename unrelated variables
- fix unrelated bugs
- modify unrelated configuration
- add monitoring
- add logging
- add caching
- add tests unrelated to the feature

If you discover a potentially valuable improvement:

DO NOT IMPLEMENT IT.

Report:

POTENTIAL IMPROVEMENT:
<description>

REASON:
<why it may be useful>

IMPACT:
<possible benefit/risk>

Wait for approval.

Priority:

Security

>

Correctness

>

Requirement compliance

>

Maintainability

>

Performance

>

Convenience

If requirements conflict with these rules, stop and ask the user.

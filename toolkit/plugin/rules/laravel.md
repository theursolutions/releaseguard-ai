---
paths:
  - "**/*.php"
  - "**/*.blade.php"
---

# Laravel conventions

- Follow the structure the project already uses (packages, modules, repositories, services). Do not introduce a new pattern for one feature.
- **Validation** in Form Requests. **Authorization** in Policies, Gates or the project's ACL.
- Keep controllers thin: coordinate the request, call a service or repository, and return the response.
- Wrap multi-step writes in a database transaction.
- **Queries:** eager-load relations you loop over (no N+1), select only the columns you need, paginate or chunk large result sets.
- **Migrations:** reversible (`down()` works), no data loss without explicit approval, and add indexes for columns used in `where`, `join` and `orderBy`.
- Put user-facing text in translation files, not hard-coded in views or controllers.
- Format PHP with the project's formatter (`vendor/bin/pint`) on the files you changed only.

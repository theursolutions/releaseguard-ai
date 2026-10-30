# Security

Check every change against these before calling it done.

- **Authorization:** every route and action checks that the current user may do it. Never trust IDs from the request without checking ownership (IDOR).
- **Validation:** validate all input on the server, even if the UI already validates it.
- **SQL:** use the query builder or bound parameters. Never concatenate user input into SQL, including `orderBy` and raw expressions.
- **Output:** escape output. In Blade use `{{ }}`. Use `{!! !!}` only for trusted, sanitised HTML.
- **Mass assignment:** use `$fillable` or validated data only. Never pass `$request->all()` straight to `create()` or `update()`.
- **Files:** validate type and size of uploads. Never trust the client file name. Store files outside the public root unless they are meant to be public.
- **Secrets:** read them from config/env. Never hard-code or log them.
- **Errors:** never show stack traces, SQL or internal messages to end users.
- **Outbound requests:** never fetch a URL taken from user input without an allow-list (SSRF).

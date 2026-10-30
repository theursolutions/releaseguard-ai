# Testing

- Use the test framework the project already uses (check `composer.json`, `package.json`, `phpunit.xml`, `playwright.config.*`).
- Every bug fix gets a regression test that fails before the fix and passes after it.
- Every new behaviour gets tests for the happy path, invalid input, unauthorized access and the main edge cases.
- Run the narrowest set of tests that covers the change, for example a single test file or `--filter`, then widen if needed.

## Database safety
Before running any test suite that touches the database, confirm it uses a **separate test database**:
- Check `phpunit.xml` (`DB_CONNECTION` / `DB_DATABASE`) and `.env.testing` if present.
- Safe: SQLite in memory, or a database whose name clearly marks it as a test database.
- If you cannot confirm this, **do not run the tests**. Tell the user and ask them to set up a test database. Tests using `RefreshDatabase` will wipe whatever database they point at.

## Reporting
Always report test results as:
- **Command:** what you ran
- **Result:** passed / failed, with counts
- **Failures:** each failure and its cause
- **Not tested:** anything you could not verify, and why

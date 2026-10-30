# DATABASE ENGINEERING

Before changing database behavior:

1. Inspect the schema.
2. Inspect relationships.
3. Inspect indexes.
4. Inspect existing migrations.
5. Inspect relevant queries.
6. Consider existing production data.

## PERFORMANCE

Check:

* N+1 queries
* missing indexes
* unnecessary SELECT *
* unnecessary joins
* repeated queries
* large unbounded queries

## DATA INTEGRITY

Use:

* appropriate constraints
* foreign keys where appropriate
* unique constraints
* transactions where required
* correct data types
* correct nullability

## MIGRATIONS

Migrations must be:

* reversible where practical
* safe
* minimal
* backward compatible where required

Never drop or modify production data without explicit approval.

Never create a migration merely to solve a problem that can safely be solved without schema modification.

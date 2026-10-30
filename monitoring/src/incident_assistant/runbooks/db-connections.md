# Runbook: database connections exhausted (RDS DatabaseConnections)

**Alarms:** RDS database connections above 80% of `max_connections`.
**Why it matters:** once the limit is reached, new requests fail with "Too many connections" and the site goes down.

## 1. Confirm (read-only)
1. `SHOW VARIABLES LIKE 'max_connections';` and `SHOW STATUS LIKE 'Threads_connected';`
2. See who's connected:
   ```sql
   SELECT user, host, db, command, COUNT(*) AS connections, MAX(time) AS longest_seconds
   FROM information_schema.processlist GROUP BY user, host, db, command ORDER BY connections DESC;
   ```
3. Many connections in `Sleep` from web servers means PHP-FPM workers × servers is higher than the database can take, or persistent connections are on.
4. Many active connections that are slow means a slow query is causing pile-ups (see `cpu-spike`).

## 2. Fix (safest first)
1. If one slow query is causing the pile-up, kill that query (`CALL mysql.rds_kill(<id>);`) and fix it.
2. Restart stuck queue workers (`php artisan queue:restart`). Workers can hold connections open.
3. Lower PHP-FPM `pm.max_children` so the total across servers stays below `max_connections`, leaving room for admin and migrations.
4. If legitimate load needs more, raise `max_connections` in the DB parameter group (memory permitting), or move to a larger instance class.
5. Longer term, put **RDS Proxy** in front of the database to pool connections.

# Runbook: database disk filling up (RDS FreeStorageSpace)

**Alarms:** RDS free storage warning (< 20%) / critical (< 10%), storage forecast DaysUntilFull.
**Why it matters:** when RDS storage is full, MySQL stops accepting writes and the site fails on every save.

## 1. Confirm (read-only)
1. In the RDS console, check **FreeStorageSpace** over the last 7 days. Is it a steady decline or a sudden drop?
2. Check whether **storage autoscaling** is on (Modify → Storage → *Maximum storage threshold*).
3. Find the biggest tables:
   ```sql
   SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024 / 1024, 2) AS size_gb
   FROM information_schema.tables WHERE table_schema = DATABASE()
   ORDER BY (data_length + index_length) DESC LIMIT 15;
   ```
4. Check for large binary logs or a long-running transaction holding undo space: `SHOW BINARY LOGS;` and `SHOW ENGINE INNODB STATUS\G`.

## 2. Common causes
- Log or audit tables growing without cleanup (activity logs, jobs, failed_jobs, notifications, sessions).
- A runaway job inserting rows in a loop.
- Binary log retention set too long.
- Normal growth that has caught up with allocated storage.

## 3. Fix (safest first)
1. **Buy time:** increase allocated storage, or enable autoscaling with a sensible maximum. This is online, with no downtime, but you can't shrink storage afterwards.
2. Stop a runaway job: pause the queue worker or scheduled command that is inserting rows.
3. Clean up with an approved retention rule. Delete in batches (`DELETE ... LIMIT 10000`) during low traffic. **Never** truncate or drop tables without sign-off and a recent snapshot.
4. Reduce binary log retention if it's too long: `CALL mysql.rds_set_configuration('binlog retention hours', 24);`

## 4. Prevent
- Turn on storage autoscaling with a maximum.
- Add scheduled pruning for log-type tables (for example Laravel `model:prune`).
- Keep the storage forecast alarm enabled.

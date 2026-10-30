# Runbook: site down, 5xx errors or unhealthy servers (often after a deployment)

**Alarms:** ALB 5xx errors, slow response time, unhealthy hosts, Route 53 uptime check failing, EC2 status check failed.
**Why it matters:** users see errors or can't reach the site at all.

## 1. Confirm (read-only)
1. **Did something just change?** Check the last deployment time in Bitbucket Pipelines, and any config, migration or infrastructure change in the last hour.
2. **Who is returning the errors?**
   - `HTTPCode_ELB_5XX`: the load balancer can't reach healthy targets (servers down, 502/503/504).
   - `HTTPCode_Target_5XX`: the application itself returns 500s, so look at the Laravel logs.
3. Read the latest Laravel errors in `storage/logs/laravel*.log` or the CloudWatch log group: missing env var, failed migration, class not found, permission denied on `storage/`.
4. Check the ALB target group's health check reason (timeout, 502, 404 on the health path).
5. EC2 status check failed: the instance or host itself has a problem. Check the instance's system log.

## 2. Common causes after a deployment
- A migration not run, or failed halfway.
- A new `.env` key missing on the server, or the config cache stale (`php artisan config:cache` not rerun).
- Frontend assets not built or deployed (`npm run build`).
- Wrong file permissions on `storage/` and `bootstrap/cache/`.
- PHP-FPM or queue workers not restarted after the deployment.

## 3. Fix (safest first)
1. **If the deployment caused it and the fix isn't obvious within 10 minutes: roll back** to the previous release. Recovery first, investigation second.
2. Missing config: add the key, then run `php artisan config:clear && php artisan config:cache`.
3. Run pending migrations only if they are safe and reviewed. Never run `migrate:fresh` or `migrate:reset` in production.
4. Restart services: `sudo systemctl restart php*-fpm nginx` and `php artisan queue:restart`.
5. Instance failure: stop and start the instance (it moves to new hardware). Don't terminate it unless it's disposable.

## 4. After recovery
Write a short incident note: timeline, cause, fix, and what would have caught it before release (a test, a release-check item, or an alarm).

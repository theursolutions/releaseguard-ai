# Runbook: CPU spike or slow database (EC2/RDS CPUUtilization, RDS latency)

**Alarms:** CPU warning (> 80%) / critical (> 95%) on EC2 or RDS, RDS read/write latency.
**Why it matters:** pages slow down, requests time out, and the load balancer may mark the server unhealthy.

## 1. Confirm (read-only)
1. Which resource: the **web server (EC2)** or the **database (RDS)**? Did it start suddenly or build up?
2. Did a **deployment**, scheduled command or import start at the same time?
3. **On EC2:** `top -o %CPU`, or `ps aux --sort=-%cpu | head`. Look for many busy `php-fpm` workers, a stuck `artisan` command or queue worker.
4. **On RDS:** open **Performance Insights** (top SQL by load), or run `SHOW FULL PROCESSLIST;` to see long-running queries.
5. Check the ALB **RequestCount**. A traffic spike (a campaign or a bot) looks different from a slow query.

## 2. Common causes
- A slow query with no index, often a new listing filter, report or dashboard widget (N+1, a full table scan).
- A heavy scheduled job or import running during business hours.
- A bot or crawler hammering search or listing endpoints.
- Too few PHP-FPM workers for the traffic, or too many for the available RAM.

## 3. Fix (safest first)
1. **A bad query:** kill only that long-running query (`CALL mysql.rds_kill(<id>);`) if it's blocking others, then add the missing index through a reviewed migration.
2. **A heavy job:** pause or reschedule it to off-peak hours.
3. **Bot traffic:** rate-limit or block it at the ALB/WAF or in nginx.
4. **Capacity:** scale out (add an instance behind the ALB) or up (a bigger instance class) as a temporary measure while you fix the root cause.

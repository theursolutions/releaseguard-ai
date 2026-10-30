# Runbook: memory pressure or memory leak (EC2 mem_used_percent, RDS FreeableMemory)

**Alarms:** EC2 memory used warning (> 85%) / critical (> 95%), RDS freeable memory low.
**Why it matters:** when memory runs out, Linux kills processes (often PHP-FPM or MySQL), and the site returns 502/504 errors.

## 1. Confirm (read-only)
1. **Leak or load?** Memory that climbs steadily for hours or days and never drops is a leak. Memory that rises with traffic and then drops is load.
2. **On EC2:** `free -m` and `ps aux --sort=-%mem | head -15`.
3. Check for out-of-memory kills: `dmesg -T | grep -i -E "killed process|out of memory"`.
4. Long-running PHP processes (queue workers, `schedule:work`, Reverb/websocket servers) are the usual leak sources. Check their age and RSS.
5. **On RDS:** low FreeableMemory with high connections usually means too many connections, each using buffers.

## 2. Fix (safest first)
1. **Queue workers leaking:** restart them gracefully with `php artisan queue:restart`. Make sure workers run with `--max-jobs` or `--max-time` so they recycle.
2. **PHP-FPM:** set `pm.max_requests` (for example 500) so workers recycle. Size `pm.max_children` to available RAM (RAM ÷ average worker RSS).
3. **Swap:** if the instance has no swap, adding a small swap file prevents sudden OOM kills while you investigate.
4. **RDS:** reduce connections (see `db-connections`), or move to a larger instance class.

## 3. Prevent
- Supervisor configs with `--max-jobs` / `--max-time` for every worker.
- Keep the memory alarms. They are why the CloudWatch Agent is installed.

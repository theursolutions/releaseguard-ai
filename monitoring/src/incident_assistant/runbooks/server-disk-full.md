# Runbook: server disk filling up (EC2 disk_used_percent)

**Alarms:** EC2 disk used warning (> 80%) / critical (> 90%), storage forecast DaysUntilFull.
**Why it matters:** a full disk stops Laravel writing logs, sessions, cache and uploads, and can stop nginx and PHP-FPM.

## 1. Confirm (read-only)
1. Connect with SSM Session Manager, then run `df -h` and `df -i` (inodes can run out before space does).
2. Find what's large: `sudo du -xh / --max-depth=2 2>/dev/null | sort -rh | head -20`
3. Usual suspects:
   - `storage/logs/` (Laravel logs, especially without daily rotation)
   - `storage/framework/cache`, `storage/framework/sessions`, `storage/framework/views`
   - `/var/log/nginx`, `/var/log/php*-fpm.log`, `/var/log/journal`
   - old releases or deploy artifacts, `/tmp`, core dumps

## 2. Fix (safest first)
1. Compress or remove **old rotated** logs, for example `laravel-YYYY-MM-DD.log` files older than 14 days. Never delete today's log while it's open. Truncate it instead with `: > file`.
2. Clear Laravel caches safely: `php artisan cache:clear` and `php artisan view:clear`.
3. Vacuum the systemd journal: `sudo journalctl --vacuum-size=200M`.
4. If growth is legitimate, expand the EBS volume (online), then grow the partition and file system.

## 3. Prevent
- Set `LOG_CHANNEL=daily` with `LOG_DAILY_DAYS=14`, and use logrotate for nginx and PHP-FPM.
- Store uploads in S3, not on the instance disk.
- Keep the storage forecast alarm enabled.

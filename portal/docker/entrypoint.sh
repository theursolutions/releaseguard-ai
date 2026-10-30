#!/bin/sh
set -e

if [ -z "$APP_KEY" ]; then
    echo "APP_KEY is not set. Copy .env.example to .env in the repository root and fill it in." >&2
    exit 1
fi

touch /data/database.sqlite

# Only the web server ("php artisan serve") runs migrations, so the queue worker never races it.
if [ "$2" = "artisan" ] && [ "$3" = "serve" ]; then
    php artisan migrate --force --no-interaction
fi

php artisan config:cache --no-interaction >/dev/null
php artisan route:cache --no-interaction >/dev/null

exec "$@"

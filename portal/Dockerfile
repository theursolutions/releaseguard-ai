# --- PHP dependencies ---
FROM composer:2 AS vendor
WORKDIR /build
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --ignore-platform-req=ext-*
COPY . .
RUN composer dump-autoload --optimize --no-dev --classmap-authoritative

# --- Frontend assets (resources/js/app.ts imports Ziggy from vendor/) ---
FROM node:22-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY resources ./resources
COPY vite.config.ts tsconfig.json tailwind.config.js components.json ./
COPY --from=vendor /build/vendor/tightenco ./vendor/tightenco
RUN npm run build

# --- Runtime ---
FROM php:8.3-cli-bookworm
WORKDIR /var/www/portal

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-dev libzip-dev unzip \
    && docker-php-ext-install pdo_sqlite zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=vendor /build /var/www/portal
COPY --from=assets /build/public/build ./public/build
COPY docker/entrypoint.sh /usr/local/bin/portal-entrypoint
RUN chmod +x /usr/local/bin/portal-entrypoint \
    && rm -rf node_modules tests .env \
    && mkdir -p /data storage/app/private storage/framework/cache storage/framework/sessions storage/framework/views storage/logs \
    && chown -R www-data:www-data /data storage bootstrap/cache

USER www-data
# HOME must be writable for artisan tinker (www-data has no home directory in this image).
ENV DB_CONNECTION=sqlite DB_DATABASE=/data/database.sqlite LOG_CHANNEL=stderr HOME=/tmp
EXPOSE 8000

ENTRYPOINT ["portal-entrypoint"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000", "--no-reload"]

<?php

namespace App\Services\Assistant;

use App\Models\Product;
use App\Models\User;

/**
 * A short-lived, signed statement of "who is asking, about which product". The portal gives it to
 * the assistant service with each chat request; the service sends it back on every tool call, and
 * the portal only runs the tool as that user. The service cannot forge or widen it.
 */
class ContextToken
{
    private const TTL_SECONDS = 15 * 60;

    public static function issue(User $user, ?Product $product): string
    {
        $payload = self::encode(json_encode(['u' => $user->id, 'p' => $product?->id, 'e' => now()->addSeconds(self::TTL_SECONDS)->timestamp]));

        return $payload.'.'.self::sign($payload);
    }

    /** @return array{user: User, product: Product|null}|null */
    public static function verify(?string $token): ?array
    {
        if (! $token || substr_count($token, '.') !== 1) {
            return null;
        }
        [$payload, $signature] = explode('.', $token);
        if (! hash_equals(self::sign($payload), $signature)) {
            return null;
        }

        $data = json_decode(self::decode($payload), true);
        if (! is_array($data) || ($data['e'] ?? 0) < now()->timestamp) {
            return null;
        }

        $user = User::query()->find($data['u'] ?? null);
        $product = isset($data['p']) ? Product::query()->find($data['p']) : null;
        // Re-check access now: a removed user or revoked product access stops working immediately.
        if (! $user || (isset($data['p']) && (! $product || ! $user->canAccessProduct($product)))) {
            return null;
        }

        return ['user' => $user, 'product' => $product];
    }

    private static function sign(string $payload): string
    {
        // A key derived from APP_KEY and dedicated to this purpose.
        $key = hash_hmac('sha256', 'releaseguard-assistant-context', (string) config('app.key'));

        return self::encode(hash_hmac('sha256', $payload, $key, true));
    }

    private static function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function decode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'));
    }
}

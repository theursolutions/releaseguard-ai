<?php

namespace App\Services\Platform;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

/** Health of ReleaseGuard itself: its services, the AI provider in use and (for admins) its connections. */
class PlatformStatus
{
    public function __construct(private readonly ServiceClient $services, private readonly AiProviderResolver $ai) {}

    /** @return array<string, mixed> */
    public function for(User $user): array
    {
        $services = Cache::remember('platform.services', (int) config('releaseguard.assistant.live.services_cache_seconds'), fn () => array_map(
            fn (string $name) => collect($this->services->status($name))->only(['name', 'title', 'online', 'version', 'error'])->all(),
            $this->services->names(),
        ));
        $active = $this->ai->active();

        return [
            'services' => $services,
            'online' => count(array_filter($services, fn ($s) => $s['online'] ?? false)),
            // "Configured" only: whether the provider really answers is the assistant's status check.
            'ai_provider' => $active ? ['configured' => true, 'label' => $active->type->label()] : ['configured' => false, 'note' => $this->ai->missingMessage()],
            'connections' => $user->isAdmin()
                ? collect(ConnectionType::cases())->map(fn (ConnectionType $type) => [
                    'type' => $type->value,
                    'label' => $type->label(),
                    'status' => Connection::for($type)?->status ?? 'not_configured',
                ])->values()->all()
                : null,
        ];
    }
}

<?php

namespace App\Services\Platform;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

/** Calls a registered ReleaseGuard microservice (config/releaseguard.php). */
class ServiceClient
{
    /** @return list<string> */
    public function names(): array
    {
        return array_keys(config('releaseguard.services'));
    }

    /** @return array<string, mixed> */
    public function config(string $service): array
    {
        $config = config("releaseguard.services.{$service}");
        if (! is_array($config)) {
            throw new InvalidArgumentException("Unknown service [{$service}].");
        }

        return $config;
    }

    /**
     * Health and manifest for the Services page. Never throws.
     *
     * @return array<string, mixed>
     */
    public function status(string $service): array
    {
        $config = $this->config($service);
        $status = ['name' => $service, 'title' => $config['title'], 'url' => $config['url'], 'token_configured' => filled($config['token'])];

        try {
            $health = $this->request($service, 5)->get('/health');
            $manifest = $this->request($service, 5)->get('/manifest');
        } catch (ConnectionException) {
            return $status + ['online' => false, 'error' => 'Not reachable'];
        }

        return $status + [
            'online' => $health->successful() && $health->json('status') === 'ok',
            'version' => $manifest->json('version'),
            'description' => $manifest->json('description'),
            'capabilities' => $manifest->json('capabilities', []),
            'requires' => $manifest->json('requires', []),
            'optional' => $manifest->json('optional', []),
            'error' => $health->successful() ? null : "HTTP {$health->status()}",
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     *
     * @throws ServiceException
     */
    public function post(string $service, string $path, array $payload, ?int $timeout = null): array
    {
        $config = $this->config($service);
        if (blank($config['token'])) {
            throw new ServiceException("The {$config['title']} service is not configured (missing token).");
        }

        // An empty PHP array encodes as a JSON list ([]); the services expect an object ({}).
        if (array_key_exists('credentials', $payload) && $payload['credentials'] === []) {
            $payload['credentials'] = new \stdClass;
        }

        try {
            $response = $this->request($service, $timeout ?? $config['timeout'])->post($path, $payload);
        } catch (ConnectionException) {
            throw new ServiceException("The {$config['title']} service is not reachable. Check that it is running.");
        }

        if ($response->successful()) {
            return $response->json() ?? [];
        }

        // Services return user-safe messages in "detail" for 4xx/502. Anything else stays in the log.
        $detail = $response->json('detail');
        if (is_string($detail) && in_array($response->status(), [403, 404, 422, 502], true)) {
            throw new ServiceException($detail, $response->status());
        }

        Log::warning('Microservice call failed', ['service' => $service, 'path' => $path, 'status' => $response->status()]);
        throw new ServiceException("The {$config['title']} service returned an error (HTTP {$response->status()}).", $response->status());
    }

    private function request(string $service, int $timeout): PendingRequest
    {
        $config = $this->config($service);

        return Http::baseUrl(rtrim($config['url'], '/'))
            ->withToken((string) $config['token'])
            ->acceptJson()
            ->asJson()
            ->connectTimeout(5)
            ->timeout($timeout);
    }
}

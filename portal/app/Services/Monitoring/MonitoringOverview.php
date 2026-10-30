<?php

namespace App\Services\Monitoring;

use App\Enums\ConnectionType;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Support\Facades\Cache;

/** Alarm status from the monitoring service, shared by the Monitoring page and the assistant. */
class MonitoringOverview
{
    // Many viewers (and assistant questions) cause at most one CloudWatch read per window.
    public const CACHE_SECONDS = 8;

    public function __construct(private readonly ServiceClient $services, private readonly CredentialBroker $broker) {}

    /** @return array{data: array<string, mixed>|null, error: string|null} */
    public function fetch(): array
    {
        $credentials = $this->broker->forService('monitoring', [ConnectionType::Aws]);
        $key = 'monitoring.overview.'.hash('sha256', json_encode($credentials));

        if ($cached = Cache::get($key)) {
            return ['data' => $cached, 'error' => null];
        }

        try {
            $data = $this->services->post('monitoring', '/v1/overview', ['credentials' => $credentials]);
            Cache::put($key, $data, now()->addSeconds(self::CACHE_SECONDS));

            return ['data' => $data, 'error' => null];
        } catch (ServiceException $e) {
            return ['data' => null, 'error' => $e->getMessage()];
        }
    }
}

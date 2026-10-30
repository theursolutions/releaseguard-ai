<?php

namespace App\Services\Crm;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;

/** Fetches performance figures for a user, from the performance service (shared by the page and the assistant). */
class PerformanceData
{
    public function __construct(private readonly ServiceClient $services, private readonly CredentialBroker $broker) {}

    public function connected(): bool
    {
        return (bool) Connection::for(ConnectionType::CrmDatabase)?->isComplete();
    }

    /**
     * @param  array{period?: string|null, agency_id?: int|null, agent_user_id?: int|null}  $filters
     * @param  int|null  $timeout  seconds; null uses the service's configured timeout
     * @return array<string, mixed>
     *
     * @throws ServiceException
     */
    public function overview(User $user, array $filters = [], ?int $timeout = null): array
    {
        if (! $user->canSeePerformance()) {
            throw new ServiceException('Performance data is for executives, agency owners and agents.', 403);
        }

        return $this->services->post('performance', '/v1/performance/overview', array_filter([
            'viewer' => $user->performanceViewer(),
            'period' => $filters['period'] ?? '30d',
            'agency_id' => isset($filters['agency_id']) ? (int) $filters['agency_id'] : null,
            'agent_user_id' => isset($filters['agent_user_id']) ? (int) $filters['agent_user_id'] : null,
            'credentials' => $this->broker->forService('performance'),
        ], fn ($value) => $value !== null), $timeout);
    }
}

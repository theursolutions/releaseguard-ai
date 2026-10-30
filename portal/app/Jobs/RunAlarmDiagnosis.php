<?php

namespace App\Jobs;

use App\Enums\ConnectionType;
use App\Models\AlarmDiagnosis;
use App\Models\PrdAnalysis;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

class RunAlarmDiagnosis implements ShouldQueue
{
    use Queueable;

    public int $timeout = 330;

    public int $tries = 1;

    public function __construct(public readonly int $diagnosisId) {}

    public function handle(ServiceClient $services, CredentialBroker $broker): void
    {
        $diagnosis = AlarmDiagnosis::query()->find($this->diagnosisId);
        if (! $diagnosis || $diagnosis->isFinished()) {
            return;
        }

        $diagnosis->update(['status' => PrdAnalysis::STATUS_RUNNING]);

        try {
            $response = $services->post('monitoring', '/v1/alarms/diagnose', [
                'alarm_name' => $diagnosis->alarm_name,
                // Slack is not needed to diagnose, so it is not sent.
                'credentials' => $broker->forService('monitoring', [ConnectionType::Aws, ConnectionType::AiProvider]),
            ]);
        } catch (ServiceException $e) {
            $diagnosis->update(['status' => PrdAnalysis::STATUS_FAILED, 'error' => mb_substr($e->getMessage(), 0, 500), 'completed_at' => now()]);

            return;
        } catch (Throwable $e) {
            Log::error('Alarm diagnosis failed', ['diagnosis' => $diagnosis->id, 'exception' => $e]);
            $diagnosis->update(['status' => PrdAnalysis::STATUS_FAILED, 'error' => 'Something went wrong while diagnosing this alarm.', 'completed_at' => now()]);

            return;
        }

        $diagnosis->update([
            'status' => PrdAnalysis::STATUS_COMPLETED,
            'alarm' => $response['alarm'] ?? $diagnosis->alarm,
            'is_demo' => (bool) ($response['demo'] ?? false),
            'result' => ($response['diagnosis'] ?? []) + ['canned' => (bool) ($response['canned'] ?? false)],
            'model' => $response['model'] ?? null,
            'completed_at' => now(),
        ]);
    }
}

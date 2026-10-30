<?php

namespace App\Jobs;

use App\Models\PrdAnalysis;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

class RunPrdAnalysis implements ShouldQueue
{
    use Queueable;

    public int $timeout = 660;

    // AI calls cost money: a failed analysis is shown to the user, not silently retried.
    public int $tries = 1;

    public function __construct(public readonly int $analysisId) {}

    public function handle(ServiceClient $services, CredentialBroker $broker): void
    {
        $analysis = PrdAnalysis::query()->find($this->analysisId);
        if (! $analysis || $analysis->isFinished()) {
            return;
        }

        $analysis->update(['status' => PrdAnalysis::STATUS_RUNNING, 'started_at' => now(), 'error' => null]);

        try {
            $response = $services->post('prd', '/v1/analyses', [
                'title' => $analysis->title,
                'document' => $this->document($analysis),
                'credentials' => $broker->forService('prd'),
            ]);
        } catch (ServiceException $e) {
            $this->fail($analysis, $e->getMessage());

            return;
        } catch (Throwable $e) {
            Log::error('PRD analysis failed', ['analysis' => $analysis->id, 'exception' => $e]);
            $this->fail($analysis, 'Something went wrong while analysing this PRD. Please try again.');

            return;
        }

        $analysis->update([
            'status' => PrdAnalysis::STATUS_COMPLETED,
            'title' => $analysis->source_type === 'confluence' && filled($response['source_title'] ?? null) ? $response['source_title'] : $analysis->title,
            'result' => $response['result'] ?? [],
            'score' => $response['score'] ?? null,
            'model' => $response['model'] ?? null,
            'input_tokens' => $response['usage']['input_tokens'] ?? null,
            'output_tokens' => $response['usage']['output_tokens'] ?? null,
            'completed_at' => now(),
        ]);
    }

    /** @return array<string, string> */
    private function document(PrdAnalysis $analysis): array
    {
        return match ($analysis->source_type) {
            'confluence' => ['kind' => 'confluence', 'url' => (string) $analysis->source_name],
            'text' => ['kind' => 'text', 'text' => (string) $analysis->source_text],
            default => $this->uploadedDocument($analysis),
        };
    }

    /** @return array<string, string> */
    private function uploadedDocument(PrdAnalysis $analysis): array
    {
        if (! $analysis->file_path || ! Storage::disk('local')->exists($analysis->file_path)) {
            throw new ServiceException('The uploaded file is no longer available. Upload it again.');
        }
        $contents = Storage::disk('local')->get($analysis->file_path);

        return match (true) {
            $analysis->file_mime === 'application/pdf' => ['kind' => 'pdf', 'data_base64' => base64_encode($contents)],
            str_contains((string) $analysis->file_mime, 'wordprocessingml') => ['kind' => 'docx', 'data_base64' => base64_encode($contents)],
            default => ['kind' => 'text', 'text' => $contents],
        };
    }

    private function fail(PrdAnalysis $analysis, string $message): void
    {
        $analysis->update(['status' => PrdAnalysis::STATUS_FAILED, 'error' => mb_substr($message, 0, 500), 'completed_at' => now()]);
    }
}

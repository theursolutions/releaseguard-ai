<?php

namespace App\Services\Assistant;

use App\Models\AlarmDiagnosis;
use App\Models\PrdAnalysis;
use App\Models\Product;
use App\Models\User;
use App\Services\Crm\PerformanceData;
use App\Services\Monitoring\MonitoringOverview;
use App\Services\Platform\PlatformStatus;
use App\Services\Platform\ServiceException;
use App\Services\Toolkit\ToolkitInventory;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * The command-centre widgets around the voice assistant, built from real data for the asking user.
 * Each section loads on its own, so one failing source shows its error while the others keep updating.
 * The page asks for slow sources (CRM sales) separately, so they never hold up the other widgets.
 */
class LiveSummary
{
    public const SECTIONS = ['performance', 'monitoring', 'platform', 'toolkit', 'prd', 'activity'];

    public function __construct(
        private readonly BusinessTools $tools,
        private readonly MonitoringOverview $monitoring,
        private readonly PerformanceData $performance,
        private readonly PlatformStatus $platform,
        private readonly ToolkitInventory $toolkit,
    ) {}

    /**
     * @param  list<string>|null  $only  just these sections (null: all the person may see)
     * @return array{generated_at: string, sections: array<string, mixed>}
     */
    public function for(User $user, ?Product $product, ?array $only = null): array
    {
        $sections = ['performance' => fn () => $user->canSeePerformance() ? $this->sales($user) : null];

        // People signed in with a CRM account only see sales performance.
        if (! $user->isCrmUser()) {
            $sections += [
                'monitoring' => fn () => $this->monitoringSection($product),
                'platform' => fn () => $this->platform->for($user),
                'toolkit' => fn () => $this->toolkit->summary(),
                'prd' => fn () => $this->tools->prdSummary($user, $product) + ['recent' => $this->tools->prdReviews($user, $product, 5, false)['reviews']],
                'activity' => fn () => [
                    'events' => $this->events($user, $product),
                    'team' => $user->isAdmin() ? $this->tools->teamActivity($user, $product, 30) : null,
                ],
            ];
        }

        if ($only !== null) {
            $sections = array_intersect_key($sections, array_flip($only)); // the others are never computed
        }

        return [
            'generated_at' => now()->toIso8601String(),
            'sections' => array_map(function (callable $section) {
                try {
                    return $section();
                } catch (ServiceException $e) {
                    return ['error' => $e->getMessage()];
                } catch (Throwable $e) {
                    report($e);

                    return ['error' => 'This section could not be loaded.'];
                }
            }, $sections),
        ];
    }

    /** @return array<string, mixed> */
    private function monitoringSection(?Product $product): array
    {
        $status = $this->tools->monitoringStatus($product, 'all');
        if (! $status['available']) {
            return $status;
        }
        $series = collect($this->monitoring->fetch()['data']['alarms'] ?? [])->pluck('series', 'name');

        return [
            'available' => true,
            'demo_data' => $status['demo_data'],
            'note' => $status['note'],
            'counts' => $status['counts'],
            'as_of' => $status['as_of'],
            'alarms' => collect($status['alarms'])
                ->sortBy(fn ($a) => [$a['state'] === 'ALARM' ? 0 : 1, ($a['severity'] ?? '') === 'critical' ? 0 : 1])
                ->take(5)
                ->map(fn ($a) => collect($a)->put('series', array_slice($series->get($a['name']) ?? [], -24))->all())
                ->values()->all(),
            'forecasts' => array_slice($status['forecasts'], 0, 3),
        ];
    }

    /** @return array<string, mixed> */
    private function sales(User $user): array
    {
        $key = "live.performance.{$user->id}.".md5(json_encode($user->performanceViewer()));
        $config = config('releaseguard.assistant.live');

        // One CRM query at a time per viewer: other tabs and refreshes wait for its result instead of
        // sending the same slow query to the CRM database again.
        try {
            $data = Cache::get($key) ?? Cache::lock("{$key}.lock", (int) $config['performance_timeout_seconds'] + 5)
                ->block((int) $config['performance_timeout_seconds'], fn () => Cache::remember(
                    $key,
                    (int) $config['performance_cache_seconds'],
                    fn () => $this->performance->overview($user, ['period' => '30d'], (int) $config['performance_timeout_seconds']),
                ));
        } catch (LockTimeoutException) {
            return ['error' => 'The CRM figures are still being calculated. They appear on the next refresh.'];
        }

        return [
            'demo' => (bool) ($data['demo'] ?? false),
            'note' => $data['note'] ?? null,
            'scope' => $data['scope']['label'] ?? null,
            'currency' => $data['currency']['primary'] ?? null,
            'currency_mixed' => (bool) ($data['currency']['mixed'] ?? false),
            'kpis' => $data['kpis'] ?? [],
            'trend' => array_map(fn ($t) => $t['won'], $data['revenue_trend'] ?? []),
            'top_agents' => array_slice($data['leaderboard'] ?? [], 0, 4),
            'earnings' => $data['earnings'] ?? null,
        ];
    }

    /**
     * Recent real events for the ticker: finished PRD reviews, alarm diagnoses and alarms firing now.
     *
     * @return list<array<string, mixed>>
     */
    private function events(User $user, ?Product $product): array
    {
        $reviews = $this->tools->reviewQuery($user, $product)
            ->whereIn('status', [PrdAnalysis::STATUS_COMPLETED, PrdAnalysis::STATUS_FAILED])
            ->latest('updated_at')->limit(6)->get(['id', 'title', 'status', 'score', 'updated_at'])
            ->map(fn (PrdAnalysis $r) => [
                'kind' => 'prd',
                'tone' => $r->status === PrdAnalysis::STATUS_FAILED ? 'bad' : ($r->isReady() ? 'good' : 'warn'),
                'label' => $r->status === PrdAnalysis::STATUS_FAILED ? "PRD review failed: {$r->title}" : "PRD \"{$r->title}\" scored {$r->score}",
                'at' => $r->updated_at?->toIso8601String(),
                'demo' => false,
            ]);

        $diagnoses = $this->tools->diagnosisQuery($product)->latest()->limit(4)->get(['alarm_name', 'status', 'is_demo', 'created_at'])
            ->map(fn (AlarmDiagnosis $d) => [
                'kind' => 'diagnosis',
                'tone' => 'info',
                'label' => "AI diagnosis {$d->status}: {$d->alarm_name}",
                'at' => $d->created_at?->toIso8601String(),
                'demo' => (bool) $d->is_demo,
            ]);

        $monitoring = $this->tools->monitoringStatus($product, 'ALARM');
        $alarms = collect($monitoring['alarms'] ?? [])->take(4)->map(fn ($a) => [
            'kind' => 'alarm',
            'tone' => ($a['severity'] ?? '') === 'critical' ? 'bad' : 'warn',
            'label' => "Alarm: {$a['name']}",
            'at' => $a['updated_at'] ?? null,
            'demo' => (bool) ($monitoring['demo_data'] ?? false),
        ]);

        return $alarms->merge($reviews)->merge($diagnoses)->sortByDesc('at')->values()->take(12)->all();
    }
}

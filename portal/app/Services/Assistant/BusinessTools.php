<?php

namespace App\Services\Assistant;

use App\Enums\ConnectionType;
use App\Models\AlarmDiagnosis;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\Product;
use App\Models\User;
use App\Services\Crm\PerformanceData;
use App\Services\Monitoring\MonitoringOverview;
use App\Services\Platform\PlatformStatus;
use App\Services\Platform\ServiceException;
use App\Services\Prd\PrdFlows;
use App\Services\Toolkit\ToolkitInventory;
use Illuminate\Database\Eloquent\Builder;
use InvalidArgumentException;

/**
 * The assistant's business-data tools, run as the asking user. Every result comes from real data in
 * ReleaseGuard. Sources that are not connected are reported as such, never invented.
 */
class BusinessTools
{
    public const NAMES = [
        'get_portfolio_overview', 'get_monitoring_status', 'get_prd_reviews',
        'get_prd_review_details', 'get_prd_flow', 'get_alarm_diagnoses', 'get_team_activity', 'get_sales_performance',
        'get_platform_status', 'get_toolkit_inventory',
    ];

    /** People signed in with a CRM account only get sales performance, scoped to their CRM role. */
    public const CRM_TOOLS = ['get_sales_performance'];

    public function __construct(
        private readonly MonitoringOverview $monitoring,
        private readonly PerformanceData $performance,
        private readonly PlatformStatus $platform,
        private readonly ToolkitInventory $toolkit,
        private readonly PrdFlows $flows,
    ) {}

    /** @param array<string, mixed> $input */
    public function run(string $tool, array $input, User $user, ?Product $product): array
    {
        if ($user->isCrmUser() && ! in_array($tool, self::CRM_TOOLS, true)) {
            return ['authorised' => false, 'note' => 'This information is for the ReleaseGuard engineering team. You can ask about sales, agent and agency performance.'];
        }

        return match ($tool) {
            'get_portfolio_overview' => $this->portfolioOverview($user, $product),
            'get_monitoring_status' => $this->monitoringStatus($product, (string) ($input['state'] ?? 'all')),
            'get_prd_reviews' => $this->prdReviews($user, $product, $this->int($input, 'limit', 10, 1, 20), (bool) ($input['only_not_ready'] ?? false)),
            'get_prd_review_details' => $this->prdReviewDetails($user, $product, $this->int($input, 'review_id', 0, 1, PHP_INT_MAX)),
            'get_prd_flow' => $this->prdFlow($user, $product, $this->int($input, 'review_id', 0, 1, PHP_INT_MAX), mb_substr(trim((string) ($input['flow'] ?? '')), 0, 120)),
            'get_alarm_diagnoses' => $this->alarmDiagnoses($product, $this->int($input, 'limit', 5, 1, 10)),
            'get_team_activity' => $this->teamActivity($user, $product, $this->int($input, 'days', 30, 1, 90)),
            'get_sales_performance' => $this->salesPerformance($user, $input),
            'get_platform_status' => $this->platform->for($user),
            'get_toolkit_inventory' => $this->toolkit->summary(),
            default => throw new InvalidArgumentException("Unknown tool [{$tool}]."),
        };
    }

    public function portfolioOverview(User $user, ?Product $product): array
    {
        $monitoring = $this->monitoringStatus($product, 'all');

        return [
            'scope' => $product?->name ?? 'All authorised products',
            'prd' => $this->prdSummary($user, $product),
            'monitoring' => [
                'available' => $monitoring['available'],
                'demo_data' => $monitoring['demo_data'] ?? null,
                'counts' => $monitoring['counts'] ?? null,
                'note' => $monitoring['note'] ?? null,
            ],
            'alarm_diagnoses_last_7_days' => $this->diagnosisQuery($product)->where('created_at', '>=', now()->subDays(7))->count(),
            'data_sources' => $this->dataSources(),
        ];
    }

    /** @return array<string, int> */
    public function prdSummary(User $user, ?Product $product): array
    {
        $reviews = $this->reviewQuery($user, $product)->where('status', PrdAnalysis::STATUS_COMPLETED);
        $ready = config('releaseguard.prd.ready_score');

        return [
            'reviewed' => (clone $reviews)->count(),
            'ready_for_sprint' => (clone $reviews)->where('score', '>=', $ready)->count(),
            'not_ready' => (clone $reviews)->where('score', '<', $ready)->count(),
            'average_score_last_20' => (int) round((float) (clone $reviews)->latest()->limit(20)->pluck('score')->avg()),
            'ready_threshold' => $ready,
        ];
    }

    public function monitoringStatus(?Product $product, string $state): array
    {
        $overview = $this->monitoring->fetch();
        if (! $overview['data']) {
            return ['available' => false, 'note' => $overview['error'] ?? 'Monitoring is unavailable.'];
        }

        $alarms = collect($overview['data']['alarms'] ?? []);
        if ($product) {
            $alarms = $alarms->filter(fn ($alarm) => $product->ownsAlarm($alarm['name']));
        }
        $counts = [
            'ALARM' => $alarms->where('state', 'ALARM')->count(),
            'critical' => $alarms->where('state', 'ALARM')->where('severity', 'critical')->count(),
            'OK' => $alarms->where('state', 'OK')->count(),
            'INSUFFICIENT_DATA' => $alarms->where('state', 'INSUFFICIENT_DATA')->count(),
        ];
        if ($state !== 'all') {
            $alarms = $alarms->where('state', $state);
        }

        return [
            'available' => true,
            'demo_data' => (bool) ($overview['data']['demo'] ?? false),
            'note' => ($overview['data']['demo'] ?? false) ? 'AWS is not connected: these are simulated demo alarms, not production data.' : null,
            'product_filter' => $product ? ($product->alarm_prefix ? "alarms starting with {$product->alarm_prefix}" : 'this product has no alarm prefix configured, so no alarms are linked to it') : null,
            'counts' => $counts,
            'alarms' => $alarms->values()->map(fn ($a) => collect($a)->only(['name', 'state', 'severity', 'resource', 'description', 'updated_at']))->all(),
            'forecasts' => $product ? [] : ($overview['data']['forecasts'] ?? []),
            'as_of' => $overview['data']['generated_at'] ?? null,
        ];
    }

    public function prdReviews(User $user, ?Product $product, int $limit, bool $onlyNotReady): array
    {
        $query = $this->reviewQuery($user, $product)->with(['user:id,name', 'product:id,name'])->latest();
        if ($onlyNotReady) {
            $query->where('status', PrdAnalysis::STATUS_COMPLETED)->where('score', '<', config('releaseguard.prd.ready_score'));
        }

        return [
            'ready_threshold' => config('releaseguard.prd.ready_score'),
            'reviews' => $query->limit($limit)->get()->map(fn (PrdAnalysis $r) => [
                'id' => $r->id,
                'title' => $r->title,
                'product' => $r->product?->name,
                'status' => $r->status,
                'score' => $r->score,
                'author' => $r->user?->name,
                'created_at' => $r->created_at?->toIso8601String(),
            ])->all(),
        ];
    }

    public function prdReviewDetails(User $user, ?Product $product, int $id): array
    {
        $review = $this->reviewQuery($user, $product)->with('user:id,name')->find($id);
        if (! $review) {
            return ['found' => false, 'note' => 'No review with that id is visible to you in this scope.'];
        }
        $result = $review->result ?? [];

        return [
            'found' => true,
            'id' => $review->id,
            'title' => $review->title,
            'status' => $review->status,
            'score' => $review->score,
            'author' => $review->user?->name,
            'summary' => $result['summary'] ?? null,
            'score_breakdown' => $result['score_breakdown'] ?? [],
            'blocking_questions' => collect($result['questions'] ?? [])->where('blocking', true)->values()->take(10)->all(),
            'dependencies' => $result['dependencies'] ?? [],
            'contradictions' => $result['contradictions'] ?? [],
            'flows' => collect($this->flows->list($review))->map(fn ($flow) => array_intersect_key($flow, array_flip(['id', 'name', 'actor'])))->all(),
        ];
    }

    /**
     * One flow as actor swimlanes (latest corrected version). The workspace draws it from this result.
     */
    public function prdFlow(User $user, ?Product $product, int $reviewId, string $flow): array
    {
        $review = $this->reviewQuery($user, $product)->where('status', PrdAnalysis::STATUS_COMPLETED)->find($reviewId);
        if (! $review) {
            return ['found' => false, 'note' => 'No completed review with that id is visible to you in this scope.'];
        }
        $match = $this->flows->match($review, $flow);
        if (! $match['flow']) {
            return [
                'found' => false,
                'review' => ['id' => $review->id, 'title' => $review->title],
                'note' => $match['candidates'] ? 'Ask which of these flows the person means.' : 'This review has no flows.',
                'flows' => collect($match['candidates'])->map(fn ($f) => array_intersect_key($f, array_flip(['id', 'name', 'actor'])))->values()->all(),
            ];
        }

        return ['found' => true] + array_intersect_key($match['flow'], array_flip(['review', 'flow', 'graph_source', 'version']));
    }

    public function alarmDiagnoses(?Product $product, int $limit): array
    {
        return [
            'diagnoses' => $this->diagnosisQuery($product)->latest()->limit($limit)->get()->map(fn (AlarmDiagnosis $d) => [
                'alarm' => $d->alarm_name,
                'status' => $d->status,
                'demo_data' => $d->is_demo,
                'summary' => $d->result['summary'] ?? null,
                'probable_cause' => $d->result['probable_cause'] ?? null,
                'next_steps' => $d->result['next_steps'] ?? [],
                'created_at' => $d->created_at?->toIso8601String(),
            ])->all(),
        ];
    }

    public function teamActivity(User $user, ?Product $product, int $days): array
    {
        // Per-person data is for leads and managers only.
        if (! $user->isAdmin()) {
            return ['authorised' => false, 'note' => 'Team activity is only available to admins.'];
        }
        $since = now()->subDays($days);
        $reviews = $this->reviewQuery($user, $product)->where('created_at', '>=', $since)->with('user:id,name')->get();
        $diagnoses = $this->diagnosisQuery($product)->where('created_at', '>=', $since)->with('user:id,name')->get();

        $people = $reviews->pluck('user')->merge($diagnoses->pluck('user'))->filter()->unique('id');

        return [
            'authorised' => true,
            'period_days' => $days,
            'note' => 'ReleaseGuard platform activity only. Jira delivery KPIs (cycle time, returns, bugs) are not connected yet.',
            'people' => $people->map(fn ($person) => [
                'name' => $person->name,
                'prd_reviews' => $reviews->where('user_id', $person->id)->count(),
                'average_readiness' => (int) round((float) $reviews->where('user_id', $person->id)->whereNotNull('score')->avg('score')) ?: null,
                'alarm_diagnoses' => $diagnoses->where('user_id', $person->id)->count(),
            ])->sortByDesc('prd_reviews')->values()->all(),
        ];
    }

    /**
     * Sales, agent and agency performance from the CRM, condensed for the model. Executives see every
     * agency, agency owners and admins their agency, agents only themselves.
     *
     * @param  array<string, mixed>  $input
     */
    public function salesPerformance(User $user, array $input): array
    {
        if (! $user->canSeePerformance()) {
            return ['authorised' => false, 'note' => 'Sales performance is for executives, agency owners and agents.'];
        }
        $period = (string) ($input['period'] ?? '30d');
        if (! in_array($period, ['7d', '30d', '90d', '12m', 'all'], true)) {
            throw new InvalidArgumentException('Invalid period.');
        }
        $name = isset($input['agent_name']) ? trim((string) $input['agent_name']) : '';

        try {
            $data = $this->performance->overview($user, ['period' => $period]);
            if ($name !== '') {
                $match = collect($data['directory']['agents'] ?? $data['leaderboard'] ?? [])
                    ->first(fn ($person) => str_contains(mb_strtolower($person['name']), mb_strtolower($name)));
                if (! $match) {
                    return ['found' => false, 'note' => "No agent called \"{$name}\" is visible to you."];
                }
                $data = $this->performance->overview($user, ['period' => $period, 'agent_user_id' => $match['user_id']]);
            }
        } catch (ServiceException $e) {
            return ['available' => false, 'note' => $e->getMessage()];
        }

        return [
            'demo_data' => (bool) ($data['demo'] ?? false),
            'note' => $data['note'] ?? null,
            'scope' => $data['scope'],
            'period' => $data['period'],
            'currency' => $data['currency'],
            'currency_note' => ($data['currency']['mixed'] ?? false) ? 'Amounts in different currencies are added without conversion; mention this.' : null,
            'kpis' => collect($data['kpis'])->map(fn ($kpi) => array_intersect_key($kpi, array_flip(['value', 'change_pct'])))->all(),
            'definitions' => $data['definitions'] ?? [],
            'earnings' => array_intersect_key($data['earnings'] ?? [], array_flip(['paid', 'approved', 'pending_review'])),
            'top_agents' => collect($data['leaderboard'] ?? [])->take(8)->map(fn ($p) => array_intersect_key($p, array_flip(['name', 'agency', 'revenue', 'deals', 'leads', 'won', 'lost', 'win_rate', 'commission'])))->values()->all(),
            'agencies' => collect($data['agencies'] ?? [])->take(8)->values()->all(),
            'sources' => $data['sources'] ?? [],
            'lost_reasons' => array_slice($data['lost_reasons'] ?? [], 0, 5),
        ];
    }

    /** @return array<string, string> */
    public function dataSources(): array
    {
        $connected = fn (ConnectionType $type) => (bool) Connection::for($type)?->isComplete();

        return [
            'prd_reviews' => 'connected',
            'crm_sales_performance' => $this->performance->connected() ? 'connected' : 'demo data (CRM database not connected)',
            'monitoring' => $connected(ConnectionType::Aws) ? 'connected' : 'demo data (AWS not connected)',
            'jira_delivery_kpis' => 'not connected',
            'calendar_meetings' => 'not connected',
        ];
    }

    public function reviewQuery(User $user, ?Product $product): Builder
    {
        $query = PrdAnalysis::query();
        if ($product) {
            return $query->where('product_id', $product->id);
        }
        if (! $user->isAdmin()) {
            // Members: their products' reviews plus reviews not tied to any product.
            $ids = $user->products()->pluck('products.id');
            $query->where(fn ($q) => $q->whereNull('product_id')->orWhereIn('product_id', $ids));
        }

        return $query;
    }

    public function diagnosisQuery(?Product $product): Builder
    {
        $query = AlarmDiagnosis::query();
        if ($product) {
            $product->alarm_prefix
                ? $query->where('alarm_name', 'like', addcslashes($product->alarm_prefix, '%_\\').'%')
                : $query->whereRaw('1 = 0');
        }

        return $query;
    }

    /** @param array<string, mixed> $input */
    private function int(array $input, string $key, int $default, int $min, int $max): int
    {
        $value = $input[$key] ?? $default;
        if (! is_int($value) || $value < $min || $value > $max) {
            throw new InvalidArgumentException("Invalid {$key}.");
        }

        return $value;
    }
}

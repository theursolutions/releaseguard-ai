<?php

namespace App\Services\Prd;

use App\Enums\ConnectionType;
use App\Models\PrdAnalysis;
use App\Models\PrdFlowRevision;
use App\Models\User;
use App\Services\Platform\AiProviderResolver;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Support\Facades\DB;

/**
 * The user flows of a PRD review, drawn as actor swimlanes, and their corrected versions.
 * Version 0 is the flow as the review produced it; every correction or restore adds a version.
 */
class PrdFlows
{
    /** A saved flow larger than this is refused (the drawing stays readable well below it). */
    private const MAX_FLOW_BYTES = 64_000;

    public function __construct(
        private readonly ServiceClient $services,
        private readonly CredentialBroker $broker,
        private readonly AiProviderResolver $ai,
    ) {}

    /** @return list<array<string, mixed>> */
    public function list(PrdAnalysis $analysis): array
    {
        return array_map(fn (array $flow) => [
            'id' => $flow['id'],
            'name' => $flow['name'] ?? $flow['id'],
            'actor' => $flow['actor'] ?? null,
            'lanes' => $flow['graph']['lanes'],
            'version' => $flow['version'],
        ], $this->all($analysis));
    }

    /**
     * Every flow of the review at its latest version, with the graph to draw.
     *
     * @return list<array<string, mixed>>
     */
    public function all(PrdAnalysis $analysis): array
    {
        $latest = $this->latestRevisions($analysis);

        return collect($analysis->result['flows'] ?? [])
            ->filter(fn ($flow) => is_array($flow) && filled($flow['id'] ?? null))
            ->map(function (array $original) use ($latest) {
                $revision = $latest->get($original['id']);
                $flow = $revision?->flow ?? $original;
                ['graph' => $graph, 'source' => $source] = $this->graph($flow);

                return array_merge($flow, [
                    'id' => $original['id'],
                    'graph' => $graph,
                    'graph_source' => $source,
                    'version' => $revision?->version ?? 0,
                ]);
            })->values()->all();
    }

    /**
     * The latest version of one flow with its graph and version history, or null when the review has no such flow.
     *
     * @return array<string, mixed>|null
     */
    public function find(PrdAnalysis $analysis, string $flowId): ?array
    {
        $original = $this->original($analysis, $flowId);
        if (! $original) {
            return null;
        }
        $revisions = $analysis->flowRevisions()->where('flow_id', $original['id'])->with('user:id,name')->orderBy('version')->get();
        $latest = $revisions->last();
        ['graph' => $graph, 'source' => $source] = $this->graph($latest?->flow ?? $original);

        return [
            'review' => ['id' => $analysis->id, 'title' => $analysis->title],
            'flow' => ['graph' => $graph] + ($latest?->flow ?? $original),
            'graph_source' => $source,
            'version' => $latest?->version ?? 0,
            'versions' => collect([['version' => 0, 'change_summary' => 'Original flow from the PRD review.', 'instruction' => null, 'restored_from_version' => null, 'user' => null, 'created_at' => $analysis->completed_at?->toIso8601String()]])
                ->merge($revisions->map(fn (PrdFlowRevision $r) => [
                    'version' => $r->version,
                    'change_summary' => $r->change_summary,
                    'instruction' => $r->instruction,
                    'restored_from_version' => $r->restored_from_version,
                    'user' => $r->user?->name,
                    'created_at' => $r->created_at?->toIso8601String(),
                ]))->values()->all(),
        ];
    }

    /**
     * A flow by id, or by part of its name. Several matches return the candidates instead.
     *
     * @return array{flow: array<string, mixed>|null, candidates: list<array<string, mixed>>}
     */
    public function match(PrdAnalysis $analysis, string $query): array
    {
        $flows = collect($this->list($analysis));
        $query = mb_strtolower(trim($query));
        $exact = $flows->first(fn ($flow) => mb_strtolower($flow['id']) === $query);
        $matches = $exact ? collect([$exact]) : $flows->filter(fn ($flow) => $query !== '' && str_contains(mb_strtolower($flow['name']), $query))->values();

        return $matches->count() === 1
            ? ['flow' => $this->find($analysis, $matches->first()['id']), 'candidates' => []]
            : ['flow' => null, 'candidates' => ($matches->isEmpty() ? $flows : $matches)->all()];
    }

    /**
     * Applies a spoken or typed correction through the PRD service and saves it as a new version.
     *
     * @return array<string, mixed>
     *
     * @throws ServiceException
     */
    public function correct(PrdAnalysis $analysis, string $flowId, string $instruction, User $user): array
    {
        $current = $this->find($analysis, $flowId);
        $credentials = $this->broker->forService('prd', [ConnectionType::AiProvider]);
        if (! isset($credentials['llm'])) {
            throw new ServiceException($this->ai->missingMessage(), 422);
        }

        $reply = $this->services->post('prd', '/v1/flows/revise', [
            'prd_title' => $analysis->title,
            'flow' => $current['flow'],
            'instruction' => $instruction,
            'credentials' => $credentials,
        ], (int) config('releaseguard.prd.flow_revision_timeout'));

        $flow = $reply['flow'] ?? null;
        if (! is_array($flow) || strlen((string) json_encode($flow)) > self::MAX_FLOW_BYTES) {
            throw new ServiceException('The corrected flow could not be saved. Try a smaller correction.', 502);
        }
        $flow['id'] = $current['flow']['id'];

        $this->saveVersion($analysis, $flow, $user, [
            'instruction' => $instruction,
            'change_summary' => (string) ($reply['change_summary'] ?? 'Flow corrected.'),
            'model' => $reply['model'] ?? null,
        ]);

        return $this->find($analysis, $flowId);
    }

    /**
     * Saves an earlier version again as the newest one, so the history is never rewritten.
     *
     * @return array<string, mixed>|null null when that version does not exist
     */
    public function restore(PrdAnalysis $analysis, string $flowId, int $version, User $user): ?array
    {
        $original = $this->original($analysis, $flowId);
        $flow = $version === 0
            ? $original
            : $analysis->flowRevisions()->where('flow_id', $original['id'])->where('version', $version)->value('flow');
        if (! $flow) {
            return null;
        }
        $flow = is_array($flow) ? $flow : json_decode($flow, true);

        $this->saveVersion($analysis, $flow, $user, ['change_summary' => "Restored version {$version}.", 'restored_from_version' => $version]);

        return $this->find($analysis, $flowId);
    }

    /**
     * The flow's swimlane graph, or one lane built from its steps for reviews made before graphs existed.
     *
     * @param  array<string, mixed>  $flow
     * @return array{graph: array{lanes: list<string>, nodes: list<array<string, string>>, edges: list<array<string, string>>}, source: string}
     */
    public function graph(array $flow): array
    {
        $graph = $flow['graph'] ?? null;
        if (is_array($graph) && ! empty($graph['lanes']) && ! empty($graph['nodes'])) {
            return ['graph' => ['lanes' => array_values($graph['lanes']), 'nodes' => array_values($graph['nodes']), 'edges' => array_values($graph['edges'] ?? [])], 'source' => 'ai'];
        }

        $lane = (string) ($flow['actor'] ?? '') ?: 'Actor';
        $steps = array_values(array_filter($flow['steps'] ?? [], 'is_string'));
        $last = count($steps) - 1;
        $nodes = array_map(fn (string $step, int $i) => [
            'id' => "step{$i}",
            'lane' => $lane,
            'kind' => $i === 0 ? 'start' : ($i === $last ? 'end' : 'action'),
            'label' => $step,
        ], $steps, array_keys($steps));
        $edges = array_map(fn (int $i) => ['from' => 'step'.($i - 1), 'to' => "step{$i}", 'label' => ''], range(1, max(1, $last)));

        return ['graph' => ['lanes' => [$lane], 'nodes' => $nodes, 'edges' => $last > 0 ? $edges : []], 'source' => 'steps'];
    }

    /** @return array<string, mixed>|null */
    private function original(PrdAnalysis $analysis, string $flowId): ?array
    {
        return collect($analysis->result['flows'] ?? [])->first(fn ($flow) => is_array($flow) && ($flow['id'] ?? null) === $flowId);
    }

    private function latestRevisions(PrdAnalysis $analysis)
    {
        return $analysis->flowRevisions()->orderBy('version')->get()->keyBy('flow_id');
    }

    /**
     * @param  array<string, mixed>  $flow
     * @param  array<string, mixed>  $attributes
     */
    private function saveVersion(PrdAnalysis $analysis, array $flow, User $user, array $attributes): void
    {
        DB::transaction(function () use ($analysis, $flow, $user, $attributes) {
            $version = (int) $analysis->flowRevisions()->where('flow_id', $flow['id'])->lockForUpdate()->max('version') + 1;
            $analysis->flowRevisions()->create($attributes + [
                'flow_id' => $flow['id'],
                'version' => $version,
                'flow' => $flow,
                'user_id' => $user->id,
            ]);
        });
    }
}

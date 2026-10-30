<?php

namespace App\Services\Prd;

use App\Models\PrdAnalysis;

/** Renders a completed review as Markdown, ready to paste into Confluence or attach to Jira. */
class PrdMarkdownExporter
{
    public function export(PrdAnalysis $analysis): string
    {
        $r = $analysis->result ?? [];
        $ready = $analysis->score >= config('releaseguard.prd.ready_score') ? 'Ready for sprint' : 'Not ready for sprint';
        $lines = [
            "# PRD review: {$analysis->title}",
            '',
            "**Readiness score:** {$analysis->score}/100 ({$ready}) · Reviewed {$analysis->completed_at?->toDateString()} by ReleaseGuard AI",
            '',
            $r['summary'] ?? '',
            '',
            '## Score breakdown',
            '',
            '| Area | Points | Why |',
            '| --- | --- | --- |',
        ];
        foreach ($r['score_breakdown'] ?? [] as $area) {
            $lines[] = "| {$area['label']} | {$area['points']}/{$area['max']} | {$this->cell($area['reason'])} |";
        }

        $questions = collect($r['questions'] ?? [])->sortByDesc('blocking')->values();
        $lines = [...$lines, '', '## Questions for the PM', ''];
        foreach ($questions as $i => $q) {
            $tag = $q['blocking'] ? ' **(blocking)**' : '';
            $lines[] = ($i + 1).". [{$q['flow_id']}] {$q['question']}{$tag}  \n   _Why it matters:_ {$q['why_it_matters']}";
        }

        $lines = [...$lines, '', '## Actors', ''];
        foreach ($r['actors'] ?? [] as $actor) {
            $lines[] = "- **{$actor['name']}**: {$actor['description']}".($actor['permissions'] ? ' (can: '.implode(', ', $actor['permissions']).')' : '');
        }

        $lines = [...$lines, '', '## Flows'];
        foreach ($r['flows'] ?? [] as $flow) {
            $lines = [...$lines, '', "### {$flow['id']}: {$flow['name']} ({$flow['actor']})", ''];
            foreach ($flow['steps'] as $n => $step) {
                $lines[] = ($n + 1).". {$step}";
            }
            $lines = [...$lines, ...$this->list('Business rules', $flow['business_rules']), ...$this->list('Edge cases', $flow['edge_cases'])];
            if ($flow['acceptance_criteria']) {
                $lines = [...$lines, '', '**Acceptance criteria**', ''];
                foreach ($flow['acceptance_criteria'] as $ac) {
                    $lines[] = "- **Given** {$ac['given']} **when** {$ac['when']} **then** {$ac['then']}";
                }
            }
            $lines = [...$lines, ...$this->list('Missing from the PRD', $flow['missing'])];
        }

        if ($r['dependencies'] ?? []) {
            $lines = [...$lines, '', '## Dependencies', '', '| Dependency | Type | Owner | Needed by |', '| --- | --- | --- | --- |'];
            foreach ($r['dependencies'] as $d) {
                $lines[] = "| {$this->cell($d['name'])} | {$d['type']} | {$this->cell($d['owner'])} | {$this->cell($d['needed_by'])} |";
            }
        }

        if ($r['contradictions'] ?? []) {
            $lines = [...$lines, '', '## Contradictions', ''];
            foreach ($r['contradictions'] as $c) {
                $lines[] = "- {$c['description']}  \n  > {$c['quote_a']}  \n  > {$c['quote_b']}";
            }
        }

        $lines = [...$lines, ...$this->list('Out of scope', $r['out_of_scope'] ?? [], '##')];

        foreach ($r['diagrams'] ?? [] as $diagram) {
            $lines = [...$lines, '', "## Flow diagram: {$diagram['actor']}", '', '```mermaid', $diagram['mermaid'], '```'];
        }

        return implode("\n", $lines)."\n";
    }

    /** @return list<string> */
    private function list(string $heading, array $items, string $level = ''): array
    {
        if (! $items) {
            return [];
        }
        $title = $level ? "{$level} {$heading}" : "**{$heading}**";

        return ['', $title, '', ...array_map(fn ($item) => "- {$item}", $items)];
    }

    private function cell(?string $text): string
    {
        return str_replace(['|', "\n"], ['\|', ' '], (string) $text);
    }
}

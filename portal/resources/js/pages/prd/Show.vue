<script setup lang="ts">
import FlowOverlay, { type FlowRequest } from '@/components/flow/FlowOverlay.vue';
import PageHeader from '@/components/PageHeader.vue';
import FlowCard from '@/components/prd/FlowCard.vue';
import ScoreRing from '@/components/ScoreRing.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePolling } from '@/composables/usePolling';
import AppLayout from '@/layouts/AppLayout.vue';
import { formatDateTime } from '@/lib/format';
import { type BreadcrumbItem, type PrdAnalysis } from '@/types';
import type { ReviewFlow } from '@/types/assistant';
import { Head, router } from '@inertiajs/vue3';
import { Download, Layers, RotateCcw, Trash2 } from 'lucide-vue-next';
import { computed, ref } from 'vue';

const props = defineProps<{ analysis: PrdAnalysis; flows: ReviewFlow[]; readyScore: number; canDelete: boolean }>();

const breadcrumbs = computed<BreadcrumbItem[]>(() => [
    { title: 'PRD Checker', href: '/prd' },
    { title: props.analysis.title, href: `/prd/${props.analysis.id}` },
]);

const inProgress = computed(() => ['queued', 'running'].includes(props.analysis.status));
usePolling(inProgress, ['analysis']);

const result = computed(() => props.analysis.result);
const questions = computed(() => [...(result.value?.questions ?? [])].sort((a, b) => Number(b.blocking) - Number(a.blocking)));
const blockingCount = computed(() => questions.value.filter((q) => q.blocking).length);

/* ---------------- Flows, grouped by PRD module ---------------- */
// One colour per module (RGB), repeated when a PRD has more modules than colours.
const ACCENTS = ['34, 211, 238', '167, 139, 250', '52, 211, 153', '245, 158, 11', '251, 113, 133', '56, 189, 248', '232, 121, 249', '132, 204, 22'];

interface FlowGroup {
    name: string;
    description: string;
    accent: string;
    flows: ReviewFlow[];
    actors: string[];
}

// Reviews made before flows were grouped by module have no modules: those group by starting actor.
const byModule = computed(() => props.flows.some((flow) => flow.module));
const flowGroups = computed<FlowGroup[]>(() => {
    const described = new Map((result.value?.modules ?? []).map((m) => [m.name, m.description]));
    const groups = new Map<string, ReviewFlow[]>([...described.keys()].map((name) => [name, []]));
    for (const flow of props.flows) {
        const name = (byModule.value ? flow.module : flow.actor) || 'Other flows';
        groups.set(name, [...(groups.get(name) ?? []), flow]);
    }
    return [...groups.entries()]
        .filter(([, flows]) => flows.length)
        .map(([name, flows], index) => ({
            name,
            description: byModule.value ? (described.get(name) ?? '') : '',
            accent: ACCENTS[index % ACCENTS.length],
            flows,
            actors: [...new Set(flows.flatMap((flow) => flow.graph.lanes))],
        }));
});
const flowIds = computed(() => new Set(props.flows.map((flow) => flow.id)));
const moduleAnchor = (index: number) => `module-${index + 1}`;

// The flow viewer (walkthrough, versions and corrections) opens over the page.
const viewer = ref<FlowRequest | null>(null);
let viewerCount = 0;
function walkthrough(flowId: string) {
    viewer.value = { reviewId: props.analysis.id, reviewTitle: props.analysis.title, flowId, nonce: ++viewerCount };
}
function closeViewer() {
    viewer.value = null;
    router.reload({ only: ['flows'] }); // a correction made in the viewer shows on the page at once
}

function rerun() {
    router.post(route('prd.rerun', { analysis: props.analysis.id }));
}

function destroy() {
    if (confirm('Delete this review and its uploaded file? This cannot be undone.')) {
        router.delete(route('prd.destroy', { analysis: props.analysis.id }));
    }
}

const steps = ['Reading the document', 'Mapping actors and flows', 'Checking rules and edge cases', 'Scoring readiness'];
</script>

<template>
    <Head :title="analysis.title" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader :title="analysis.title" :description="`Reviewed by ${analysis.user?.name ?? 'a team member'} · ${formatDateTime(analysis.created_at)}${analysis.source_name ? ' · ' + analysis.source_name : ''}`">
                <template #actions>
                    <Button v-if="analysis.status === 'completed'" as-child variant="outline" size="sm">
                        <a :href="route('prd.export', { analysis: analysis.id })"><Download class="size-4" /> Export Markdown</a>
                    </Button>
                    <Button v-if="canDelete && !inProgress" variant="outline" size="sm" @click="rerun"><RotateCcw class="size-4" /> Re-run</Button>
                    <Button v-if="canDelete && !inProgress" variant="ghost" size="sm" class="text-red-700 hover:text-red-800 dark:text-red-400" @click="destroy">
                        <Trash2 class="size-4" /> Delete
                    </Button>
                </template>
            </PageHeader>

            <!-- In progress -->
            <Card v-if="inProgress">
                <CardContent class="flex flex-col items-center gap-6 py-12 text-center">
                    <StatusBadge :status="analysis.status" />
                    <div class="space-y-1">
                        <p class="text-lg font-medium">The AI is reviewing this PRD</p>
                        <p class="text-sm text-muted-foreground">This usually takes 1–3 minutes. The page updates by itself.</p>
                    </div>
                    <ol class="grid w-full max-w-md gap-2 text-left text-sm">
                        <li v-for="(step, index) in steps" :key="step" class="flex items-center gap-3 rounded-md border px-3 py-2">
                            <span class="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">{{ index + 1 }}</span>
                            {{ step }}
                        </li>
                    </ol>
                </CardContent>
            </Card>

            <!-- Failed -->
            <Card v-else-if="analysis.status === 'failed'" class="border-red-200 dark:border-red-900">
                <CardHeader>
                    <CardTitle class="text-base">The review could not be completed</CardTitle>
                    <CardDescription class="text-red-800 dark:text-red-300">{{ analysis.error }}</CardDescription>
                </CardHeader>
                <CardContent v-if="canDelete">
                    <Button size="sm" @click="rerun"><RotateCcw class="size-4" /> Try again</Button>
                </CardContent>
            </Card>

            <!-- Result -->
            <template v-else-if="result">
                <div class="grid gap-4 lg:grid-cols-3">
                    <Card class="reveal">
                        <CardContent class="flex flex-col items-center gap-3 pt-6 text-center">
                            <ScoreRing :score="analysis.score ?? 0" :ready-score="readyScore" />
                            <StatusBadge :status="(analysis.score ?? 0) >= readyScore ? 'ready' : 'not_ready'" :label="(analysis.score ?? 0) >= readyScore ? 'Ready for sprint' : 'Not ready for sprint'" />
                            <p class="text-sm text-muted-foreground">
                                {{ blockingCount }} blocking question{{ blockingCount === 1 ? '' : 's' }} · {{ result.flows.length }} flows · {{ result.actors.length }} actors
                            </p>
                        </CardContent>
                    </Card>
                    <Card class="reveal lg:col-span-2">
                        <CardHeader>
                            <CardTitle class="text-base">Summary</CardTitle>
                            <CardDescription class="text-sm text-foreground">{{ result.summary }}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul class="space-y-3">
                                <li v-for="area in result.score_breakdown" :key="area.area">
                                    <div class="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span class="font-medium">{{ area.label }}</span>
                                        <span class="tabular-nums text-muted-foreground">{{ area.points }}/{{ area.max }}</span>
                                    </div>
                                    <div class="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                                        <div
                                            class="h-full rounded-full"
                                            :class="area.points / area.max >= 0.7 ? 'bg-emerald-500' : area.points / area.max >= 0.4 ? 'bg-amber-500' : 'bg-red-500'"
                                            :style="{ width: `${(area.points / area.max) * 100}%` }"
                                        />
                                    </div>
                                    <p class="mt-1 text-xs text-muted-foreground">{{ area.reason }}</p>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>
                </div>

                <nav class="sticky top-2 z-20 -mx-1 flex gap-1.5 overflow-x-auto rounded-xl border bg-background/85 p-1.5 backdrop-blur [contain:inline-size]" aria-label="Sections of this review">
                    <a href="#questions" class="rv-tab">Questions <span class="rv-count">{{ questions.length }}</span></a>
                    <a href="#flows" class="rv-tab">Flows <span class="rv-count">{{ flows.length }}</span></a>
                    <a href="#actors" class="rv-tab">Actors &amp; dependencies</a>
                    <a v-if="result.contradictions.length" href="#contradictions" class="rv-tab">Contradictions <span class="rv-count rv-count-red">{{ result.contradictions.length }}</span></a>
                    <a v-if="result.out_of_scope.length" href="#out-of-scope" class="rv-tab">Out of scope</a>
                </nav>

                <Card id="questions" class="reveal scroll-mt-20">
                    <CardHeader>
                        <CardTitle class="text-base">Questions for the PM</CardTitle>
                        <CardDescription>Blocking questions first. Answer them before the story enters a sprint.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ol v-if="questions.length" class="space-y-3">
                            <li v-for="(question, index) in questions" :key="index" class="rounded-lg border p-3">
                                <div class="flex flex-wrap items-center gap-2">
                                    <a v-if="flowIds.has(question.flow_id)" :href="`#flow-${question.flow_id}`" class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs underline-offset-2 hover:underline">{{ question.flow_id }}</a>
                                    <span v-else class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{{ question.flow_id }}</span>
                                    <StatusBadge v-if="question.blocking" status="critical" label="Blocking" />
                                </div>
                                <p class="mt-2 text-sm font-medium">{{ question.question }}</p>
                                <p class="mt-1 text-xs text-muted-foreground">Why it matters: {{ question.why_it_matters }}</p>
                            </li>
                        </ol>
                        <p v-else class="text-sm text-muted-foreground">No open questions. Nice work.</p>
                    </CardContent>
                </Card>

                <div id="actors" class="grid scroll-mt-20 gap-4 lg:grid-cols-2">
                    <Card class="reveal">
                        <CardHeader><CardTitle class="text-base">Actors</CardTitle></CardHeader>
                        <CardContent>
                            <ul class="space-y-3">
                                <li v-for="actor in result.actors" :key="actor.name">
                                    <p class="text-sm font-medium">{{ actor.name }}</p>
                                    <p class="text-sm text-muted-foreground">{{ actor.description }}</p>
                                    <ul v-if="actor.permissions.length" class="mt-1 flex flex-wrap gap-1">
                                        <li v-for="permission in actor.permissions" :key="permission" class="rounded bg-muted px-1.5 py-0.5 text-xs">{{ permission }}</li>
                                    </ul>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>
                    <Card class="reveal">
                        <CardHeader><CardTitle class="text-base">Dependencies</CardTitle></CardHeader>
                        <CardContent>
                            <table v-if="result.dependencies.length" class="w-full text-sm">
                                <thead>
                                    <tr class="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th class="py-2 pr-2 font-medium">Dependency</th>
                                        <th class="py-2 pr-2 font-medium">Owner</th>
                                        <th class="py-2 font-medium">Needed by</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y">
                                    <tr v-for="dependency in result.dependencies" :key="dependency.name">
                                        <td class="py-2 pr-2">
                                            {{ dependency.name }}
                                            <span class="block text-xs text-muted-foreground">{{ dependency.type.replace('_', ' ') }}</span>
                                        </td>
                                        <td class="py-2 pr-2" :class="dependency.owner === 'Not stated' && 'text-amber-700 dark:text-amber-400'">{{ dependency.owner }}</td>
                                        <td class="py-2" :class="dependency.needed_by === 'Not stated' && 'text-amber-700 dark:text-amber-400'">{{ dependency.needed_by }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p v-else class="text-sm text-muted-foreground">No third-party dependencies mentioned.</p>
                        </CardContent>
                    </Card>
                </div>

                <section id="flows" class="scroll-mt-20 space-y-5" aria-labelledby="flows-title">
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 id="flows-title" class="text-lg font-semibold">Flows by {{ byModule ? 'module' : 'actor' }}</h2>
                            <p class="text-sm text-muted-foreground">
                                {{ flows.length }} flows in {{ flowGroups.length }} {{ byModule ? 'modules' : 'groups' }}. Each lane is an actor; colours show the kind of step.
                            </p>
                        </div>
                        <p v-if="!byModule && flows.length" class="max-w-md rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
                            This review was made before flows were grouped by PRD module. Re-run it to get flows for every module with each branch drawn.
                        </p>
                    </div>

                    <nav v-if="flowGroups.length > 1" class="flex flex-wrap gap-2" aria-label="Modules">
                        <a v-for="(group, index) in flowGroups" :key="group.name" :href="`#${moduleAnchor(index)}`" class="rv-module-chip" :style="{ '--pf-rgb': group.accent }">
                            <span class="size-2 rounded-full" :style="{ background: `rgb(${group.accent})` }" aria-hidden="true" />{{ group.name }}
                            <span class="text-muted-foreground">{{ group.flows.length }}</span>
                        </a>
                    </nav>

                    <p v-if="!flows.length" class="rounded-xl border p-6 text-center text-sm text-muted-foreground">This review has no user flows.</p>

                    <section v-for="(group, index) in flowGroups" :id="moduleAnchor(index)" :key="group.name" class="scroll-mt-24 space-y-3" :aria-label="group.name">
                        <header class="rv-module flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3" :style="{ '--pf-rgb': group.accent }">
                            <span class="grid size-8 place-items-center rounded-lg" :style="{ background: `rgba(${group.accent}, 0.16)`, color: `rgb(${group.accent})` }"><Layers class="size-4" aria-hidden="true" /></span>
                            <div class="min-w-0 flex-1">
                                <h3 class="font-semibold">{{ group.name }}</h3>
                                <p v-if="group.description" class="text-sm text-muted-foreground">{{ group.description }}</p>
                            </div>
                            <p class="text-xs text-muted-foreground">{{ group.flows.length }} {{ group.flows.length === 1 ? 'flow' : 'flows' }} · {{ group.actors.join(', ') }}</p>
                        </header>
                        <FlowCard v-for="flow in group.flows" :key="flow.id" :flow="flow" :accent="group.accent" @walkthrough="walkthrough" />
                    </section>
                </section>

                <Card v-if="result.contradictions.length" id="contradictions" class="scroll-mt-20 border-red-200 dark:border-red-900">
                    <CardHeader><CardTitle class="text-base">Contradictions</CardTitle></CardHeader>
                    <CardContent class="space-y-3">
                        <div v-for="(contradiction, i) in result.contradictions" :key="i" class="space-y-2 text-sm">
                            <p class="font-medium">{{ contradiction.description }}</p>
                            <blockquote class="border-l-2 pl-3 text-muted-foreground">“{{ contradiction.quote_a }}”</blockquote>
                            <blockquote class="border-l-2 pl-3 text-muted-foreground">“{{ contradiction.quote_b }}”</blockquote>
                        </div>
                    </CardContent>
                </Card>

                <Card v-if="result.out_of_scope.length" id="out-of-scope" class="scroll-mt-20">
                    <CardHeader><CardTitle class="text-base">Out of scope</CardTitle></CardHeader>
                    <CardContent>
                        <ul class="list-disc space-y-1 pl-5 text-sm">
                            <li v-for="(item, i) in result.out_of_scope" :key="i">{{ item }}</li>
                        </ul>
                    </CardContent>
                </Card>

                <p class="text-center text-xs text-muted-foreground">
                    AI-generated review ({{ analysis.model }}). It checks the document, not the product; confirm open questions with the PM.
                </p>
            </template>
        </div>

        <!-- Flow viewer: walkthrough, versions and corrections, over the page -->
        <div v-if="viewer" class="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" @click.self="closeViewer" @keydown.esc="closeViewer">
            <FlowOverlay :request="viewer" lang="en-US" :rate="1" :narrate-by-default="false" @close="closeViewer" />
        </div>
    </AppLayout>
</template>

<style scoped>
.rv-tab {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    border-radius: 0.5rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    transition: background-color 0.15s, color 0.15s;
}
.rv-tab:hover,
.rv-tab:focus-visible {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
    outline: none;
}
.rv-count {
    border-radius: 9999px;
    background: hsl(var(--muted));
    padding: 0 0.4rem;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
}
.rv-count-red {
    background: rgba(239, 68, 68, 0.15);
    color: rgb(220, 38, 38);
}
.rv-module {
    border: 1px solid rgba(var(--pf-rgb), 0.3);
    background: linear-gradient(100deg, rgba(var(--pf-rgb), 0.12), transparent 60%);
}
.rv-module-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.25rem;
    border-radius: 9999px;
    border: 1px solid rgba(var(--pf-rgb), 0.35);
    background: rgba(var(--pf-rgb), 0.08);
    padding: 0 0.85rem;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: background-color 0.15s;
}
.rv-module-chip:hover,
.rv-module-chip:focus-visible {
    background: rgba(var(--pf-rgb), 0.18);
    outline: none;
}
</style>

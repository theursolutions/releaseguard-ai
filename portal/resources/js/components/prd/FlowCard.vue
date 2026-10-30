<script setup lang="ts">
/**
 * One PRD flow on the review page: its swimlane diagram (one lane per actor, coloured by step type)
 * and, on request, its steps, rules, edge cases, acceptance criteria and gaps. The diagram draws
 * itself the first time the card scrolls into view and is scaled to fit the card's width.
 */
import FlowSwimlanes from '@/components/flow/FlowSwimlanes.vue';
import { layoutFlow } from '@/lib/flowLayout';
import type { ReviewFlow } from '@/types/assistant';
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core';
import { AlertTriangle, ChevronDown, GitBranch, ListOrdered, Play, Users } from 'lucide-vue-next';
import { computed, ref } from 'vue';

const props = defineProps<{ flow: ReviewFlow; accent: string }>();
const emit = defineEmits<{ walkthrough: [flowId: string] }>();

const layout = computed(() => layoutFlow(props.flow.graph));
const decisions = computed(() => props.flow.graph.nodes.filter((node) => node.kind === 'decision').length);
const missing = computed(() => props.flow.missing ?? []);
const hasDetails = computed(() =>
    Boolean(props.flow.steps?.length || props.flow.business_rules?.length || props.flow.edge_cases?.length || props.flow.acceptance_criteria?.length || missing.value.length),
);

const card = ref<HTMLElement | null>(null);
const canvas = ref<HTMLElement | null>(null);
const drawn = ref(false);
const width = ref(0);
const open = ref(false);

useIntersectionObserver(
    card,
    ([entry]) => {
        if (entry?.isIntersecting) drawn.value = true;
    },
    { rootMargin: '160px' },
);
useResizeObserver(canvas, ([entry]) => (width.value = entry.contentRect.width));

// Fit the card's width, but keep labels readable: a wide flow scrolls sideways instead.
const zoom = computed(() => (width.value ? Math.max(0.72, Math.min(1, (width.value - 8) / layout.value.width)) : 1));
const none = new Set<string>();

const LEGEND = [
    { kind: 'start', label: 'Start / end' },
    { kind: 'action', label: 'Action' },
    { kind: 'decision', label: 'Decision' },
    { kind: 'system', label: 'System step' },
] as const;
</script>

<template>
    <article :id="`flow-${flow.id}`" ref="card" class="pf-card scroll-mt-24 overflow-hidden rounded-xl border bg-card" :style="{ '--pf-rgb': accent }">
        <header class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-3 pt-4">
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="pf-id rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold">{{ flow.id }}</span>
                    <span v-if="flow.version > 0" class="rounded-full border px-2 py-px text-[11px] text-muted-foreground" title="Corrected in the flow panel">version {{ flow.version }}</span>
                </div>
                <h4 class="mt-1.5 text-base font-semibold leading-snug">{{ flow.name }}</h4>
                <p v-if="flow.actor" class="mt-0.5 text-sm text-muted-foreground">Started by {{ flow.actor }}</p>
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <span class="pf-stat"><ListOrdered class="size-3.5" aria-hidden="true" />{{ flow.graph.nodes.length }} steps</span>
                <span class="pf-stat"><GitBranch class="size-3.5" aria-hidden="true" />{{ decisions }} {{ decisions === 1 ? 'decision' : 'decisions' }}</span>
                <span class="pf-stat"><Users class="size-3.5" aria-hidden="true" />{{ flow.graph.lanes.length }} {{ flow.graph.lanes.length === 1 ? 'actor' : 'actors' }}</span>
                <span v-if="missing.length" class="pf-stat pf-stat-warn"><AlertTriangle class="size-3.5" aria-hidden="true" />{{ missing.length }} missing</span>
            </div>
        </header>

        <!-- Diagram: a dark canvas in both themes, so the step colours read the same everywhere. -->
        <div ref="canvas" class="pf-canvas mx-4 overflow-x-auto rounded-lg" :style="{ minHeight: `${layout.height * zoom + 16}px` }">
            <div class="p-2">
                <FlowSwimlanes v-if="drawn" :layout="layout" :current="null" :visited="none" :visited-edges="none" :active-edge="null" :zoom="zoom" />
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Diagram legend">
                <li v-for="item in LEGEND" :key="item.kind" class="flex items-center gap-1.5"><span class="pf-swatch" :class="`pf-swatch-${item.kind}`" aria-hidden="true" />{{ item.label }}</li>
            </ul>
            <p v-if="flow.graph_source === 'steps'" class="text-xs text-amber-700 dark:text-amber-400">Drawn from the listed steps: the AI gave no diagram for this flow.</p>
            <div class="ml-auto flex items-center gap-2">
                <button type="button" class="pf-btn pf-btn-primary" @click="emit('walkthrough', flow.id)"><Play class="size-3.5" aria-hidden="true" /> Walk through</button>
                <button v-if="hasDetails" type="button" class="pf-btn" :aria-expanded="open" :aria-controls="`flow-details-${flow.id}`" @click="open = !open">
                    Details <ChevronDown class="size-3.5 transition-transform" :class="open && 'rotate-180'" aria-hidden="true" />
                </button>
            </div>
        </div>

        <div v-if="open" :id="`flow-details-${flow.id}`" class="grid gap-4 border-t px-4 py-4 text-sm md:grid-cols-2">
            <section v-if="flow.steps?.length">
                <h5 class="mb-1.5 font-medium">Steps</h5>
                <ol class="list-decimal space-y-1 pl-5">
                    <li v-for="(step, i) in flow.steps" :key="i">{{ step }}</li>
                </ol>
            </section>
            <section v-if="flow.business_rules?.length">
                <h5 class="mb-1.5 font-medium">Business rules</h5>
                <ul class="list-disc space-y-1 pl-5">
                    <li v-for="(rule, i) in flow.business_rules" :key="i">{{ rule }}</li>
                </ul>
            </section>
            <section v-if="flow.edge_cases?.length">
                <h5 class="mb-1.5 font-medium">Edge and error cases</h5>
                <ul class="list-disc space-y-1 pl-5">
                    <li v-for="(edge, i) in flow.edge_cases" :key="i">{{ edge }}</li>
                </ul>
            </section>
            <section v-if="missing.length" class="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
                <h5 class="mb-1.5 font-medium text-amber-900 dark:text-amber-200">Missing from the PRD</h5>
                <ul class="list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-100">
                    <li v-for="(gap, i) in missing" :key="i">{{ gap }}</li>
                </ul>
            </section>
            <section v-if="flow.acceptance_criteria?.length" class="md:col-span-2">
                <h5 class="mb-2 font-medium">Acceptance criteria</h5>
                <ul class="space-y-2">
                    <li v-for="(ac, i) in flow.acceptance_criteria" :key="i" class="rounded-md bg-muted/60 px-3 py-2">
                        <span class="font-semibold">Given</span> {{ ac.given }} <span class="font-semibold">when</span> {{ ac.when }} <span class="font-semibold">then</span> {{ ac.then }}
                    </li>
                </ul>
            </section>
        </div>
    </article>
</template>

<style scoped>
.pf-card {
    border-top: 3px solid rgb(var(--pf-rgb));
    box-shadow: 0 14px 34px -26px rgba(var(--pf-rgb), 0.8);
}
/* Text stays in the foreground colour (readable in both themes); the module colour only tints. */
.pf-id {
    border-left: 3px solid rgb(var(--pf-rgb));
    background: rgba(var(--pf-rgb), 0.12);
}
.pf-stat {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    padding: 0.15rem 0.55rem;
    color: hsl(var(--muted-foreground));
}
.pf-stat-warn {
    border-color: rgba(245, 158, 11, 0.4);
    color: rgb(180, 83, 9);
}
:global(.dark) .pf-stat-warn {
    color: rgb(251, 191, 36);
}
.pf-canvas {
    /* The diagram's own width must not widen the page: the canvas takes the card's width and scrolls. */
    contain: inline-size;
    background:
        radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.09) 1px, transparent 0) 0 0 / 18px 18px,
        linear-gradient(160deg, rgba(var(--pf-rgb), 0.1), transparent 45%),
        rgb(7, 12, 24);
    border: 1px solid rgba(var(--pf-rgb), 0.22);
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
}
.pf-swatch {
    width: 0.8rem;
    height: 0.55rem;
    border-radius: 3px;
    border: 1.5px solid;
}
.pf-swatch-start { background: rgba(16, 185, 129, 0.25); border-color: rgb(52, 211, 153); border-radius: 9999px; }
.pf-swatch-action { background: rgba(14, 165, 233, 0.22); border-color: rgb(56, 189, 248); }
.pf-swatch-decision { background: rgba(245, 158, 11, 0.22); border-color: rgb(251, 191, 36); transform: rotate(45deg) scale(0.8); width: 0.6rem; height: 0.6rem; }
.pf-swatch-system { background: rgba(139, 92, 246, 0.24); border-color: rgb(167, 139, 250); border-style: dashed; }
.pf-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.25rem;
    border-radius: 0.5rem;
    border: 1px solid hsl(var(--border));
    padding: 0 0.8rem;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: background-color 0.15s, border-color 0.15s;
}
.pf-btn:hover {
    background: hsl(var(--muted));
}
.pf-btn:focus-visible {
    outline: 2px solid rgb(var(--pf-rgb));
    outline-offset: 2px;
}
.pf-btn-primary {
    border-color: rgba(var(--pf-rgb), 0.5);
    background: rgba(var(--pf-rgb), 0.12);
}
.pf-btn-primary:hover {
    background: rgba(var(--pf-rgb), 0.2);
}
</style>

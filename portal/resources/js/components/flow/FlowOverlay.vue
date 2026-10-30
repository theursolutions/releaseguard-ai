<script setup lang="ts">
/**
 * Right-side panel that draws a PRD flow as actor swimlanes, plays a walkthrough of it, and takes
 * corrections by voice or text. Each correction is applied by the AI and saved as a new version.
 * It opens on a real event: the person picked a flow, or the assistant's flow lookup returned one.
 */
import FlowSwimlanes from '@/components/flow/FlowSwimlanes.vue';
import { useDictation } from '@/composables/useDictation';
import { useFlowWalkthrough } from '@/composables/useFlowWalkthrough';
import { csrfToken } from '@/composables/useVoiceAssistant';
import { layoutFlow } from '@/lib/flowLayout';
import type { FlowDetail, FlowSummary } from '@/types/assistant';
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    History,
    LoaderCircle,
    Mic,
    Pause,
    Play,
    RotateCcw,
    Sparkles,
    Square,
    Volume2,
    VolumeX,
    Workflow,
    X,
    ZoomIn,
    ZoomOut,
} from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

export interface FlowRequest {
    reviewId: number;
    reviewTitle?: string;
    flowId?: string | null;
    nonce: number;
}

const props = defineProps<{ request: FlowRequest; lang: string; rate: number; narrateByDefault: boolean }>();
const emit = defineEmits<{ close: []; picked: [] }>();

const reviewTitle = ref(props.request.reviewTitle ?? '');
const flows = ref<FlowSummary[]>([]);
const detail = ref<FlowDetail | null>(null);
const loading = ref(false);
const loadError = ref('');
const showHistory = ref(false);

/* ---------------- Loading ---------------- */
// Lookups and clicks can overlap and their responses can arrive out of order; only the newest
// request may change what the panel shows.
let latestLoad = 0;

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || (response.status === 404 ? 'This flow is no longer available.' : `Could not load the flow (HTTP ${response.status}).`));
    return body as T;
}

async function loadList(ticket: number) {
    const body = await getJson<{ review: { title: string }; flows: FlowSummary[] }>(`/prd/${props.request.reviewId}/flows`);
    if (ticket !== latestLoad) return;
    reviewTitle.value = body.review.title;
    flows.value = body.flows;
}

async function openFlow(flowId: string, ticket = ++latestLoad) {
    loading.value = true;
    loadError.value = '';
    try {
        const flow = await getJson<FlowDetail>(`/prd/${props.request.reviewId}/flows/${encodeURIComponent(flowId)}`);
        if (ticket !== latestLoad) return;
        detail.value = flow;
        reviewTitle.value = flow.review.title;
        correctionResult.value = '';
    } catch (e) {
        if (ticket === latestLoad) loadError.value = e instanceof Error ? e.message : 'Could not load the flow.';
    } finally {
        if (ticket === latestLoad) loading.value = false;
    }
}

async function load() {
    const ticket = ++latestLoad;
    loading.value = true;
    loadError.value = '';
    detail.value = null;
    try {
        await loadList(ticket);
        if (props.request.flowId && ticket === latestLoad) await openFlow(props.request.flowId, ticket);
    } catch (e) {
        if (ticket === latestLoad) loadError.value = e instanceof Error ? e.message : 'Could not load the flows.';
    } finally {
        if (ticket === latestLoad) loading.value = false;
    }
}

/** Back to the list; a flow still loading must not reappear afterwards. */
function showList() {
    latestLoad++;
    loading.value = false;
    detail.value = null;
    walk.reset();
}

watch(() => props.request.nonce, load, { immediate: true });

/* ---------------- Drawing and walkthrough ---------------- */
const layout = computed(() => (detail.value ? layoutFlow(detail.value.flow.graph) : null));
const narrate = ref(props.narrateByDefault && 'speechSynthesis' in window);
const walk = useFlowWalkthrough(layout, { narrate, lang: () => props.lang, rate: () => props.rate });

const canvasEl = ref<HTMLElement | null>(null);
const zoom = ref(1);
let fitObserver: ResizeObserver | null = null;

function fit() {
    if (!canvasEl.value || !layout.value) return;
    // Fit the width, but never shrink labels below readable size: the canvas scrolls instead.
    zoom.value = Math.max(0.8, Math.min(1.25, (canvasEl.value.clientWidth - 16) / layout.value.width, (canvasEl.value.clientHeight - 16) / layout.value.height));
}
watch(layout, () =>
    requestAnimationFrame(() => {
        fit();
        canvasEl.value?.scrollTo({ left: 0, top: 0 }); // a new flow or version starts with the actor names in view
    }),
);
// The canvas exists only while a flow is open, so follow the element itself.
watch(canvasEl, (el) => {
    fitObserver?.disconnect();
    if (!el) return;
    fitObserver ??= new ResizeObserver(fit);
    fitObserver.observe(el);
});

// Keep the current step in view while the walkthrough moves.
watch(walk.current, (node) => {
    if (!node || !canvasEl.value) return;
    const el = canvasEl.value;
    const x = node.x * zoom.value;
    const y = node.y * zoom.value;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 160 || y < el.scrollTop || y > el.scrollTop + el.clientHeight - 80) {
        el.scrollTo({ left: x - el.clientWidth / 3, top: y - el.clientHeight / 3, behavior: 'smooth' });
    }
});

/* ---------------- Corrections (voice or text) ---------------- */
const correction = ref('');
const correcting = ref(false);
const correctionError = ref('');
const correctionResult = ref('');
const dictation = useDictation({
    lang: () => props.lang,
    onText: (text) => (correction.value = correction.value ? `${correction.value} ${text}` : text),
});

async function post(url: string, body?: object): Promise<FlowDetail> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.errors?.instruction?.[0] ?? data.message;
        throw new Error(response.status === 429 ? 'Too many corrections in a minute. Wait a moment and try again.' : message || `The correction failed (HTTP ${response.status}).`);
    }
    return data as FlowDetail;
}

async function applyCorrection() {
    const instruction = correction.value.trim();
    if (!detail.value || instruction.length < 3 || correcting.value) return;
    dictation.cancel();
    correcting.value = true;
    correctionError.value = '';
    try {
        detail.value = await post(`/prd/${detail.value.review.id}/flows/${encodeURIComponent(detail.value.flow.id)}/corrections`, { instruction });
        correctionResult.value = detail.value.versions[detail.value.versions.length - 1]?.change_summary ?? '';
        correction.value = '';
        void loadList(latestLoad);
    } catch (e) {
        correctionError.value = e instanceof Error ? e.message : 'The correction failed.';
    } finally {
        correcting.value = false;
    }
}

async function restore(version: number) {
    if (!detail.value || !confirm(`Restore version ${version}? It is saved as a new version; nothing is deleted.`)) return;
    correctionError.value = '';
    try {
        detail.value = await post(`/prd/${detail.value.review.id}/flows/${encodeURIComponent(detail.value.flow.id)}/restore/${version}`);
        correctionResult.value = `Restored version ${version}.`;
        void loadList(latestLoad);
    } catch (e) {
        correctionError.value = e instanceof Error ? e.message : 'The version could not be restored.';
    }
}

function onCorrectionKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void applyCorrection();
    }
}

function close() {
    walk.reset();
    dictation.cancel();
    emit('close');
}

onBeforeUnmount(() => fitObserver?.disconnect());

const stepNumber = computed(() => walk.visited.value.size);
</script>

<template>
    <aside class="fo absolute inset-y-0 right-0 z-40 flex w-full flex-col lg:w-[min(64rem,calc(100%-22rem))]" aria-label="PRD flow" @keydown.esc.stop="close">
        <span class="fo-edge" aria-hidden="true" />

        <!-- Header -->
        <header class="flex shrink-0 items-center gap-2 border-b border-cyan-300/10 px-4 py-2.5">
            <button v-if="detail" type="button" class="fo-btn" aria-label="All flows of this PRD" title="All flows" @click="showList"><ArrowLeft class="size-4" /></button>
            <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-400/15 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.3)]"><Workflow class="size-4" /></span>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-slate-100">{{ detail?.flow.name ?? 'Flows' }}</p>
                <p class="truncate text-[11px] text-slate-400">
                    {{ reviewTitle }}<template v-if="detail"> · {{ detail.flow.id }} · version {{ detail.version }}</template>
                </p>
            </div>
            <template v-if="detail">
                <button type="button" class="fo-btn" aria-label="Zoom out" @click="zoom = Math.max(0.4, zoom - 0.15)"><ZoomOut class="size-4" /></button>
                <button type="button" class="fo-btn text-[10px] font-semibold" aria-label="Fit to panel" title="Fit" @click="fit">{{ Math.round(zoom * 100) }}%</button>
                <button type="button" class="fo-btn" aria-label="Zoom in" @click="zoom = Math.min(2, zoom + 0.15)"><ZoomIn class="size-4" /></button>
                <button type="button" class="fo-btn" :aria-pressed="showHistory" aria-label="Version history" title="Versions" @click="showHistory = !showHistory"><History class="size-4" /></button>
            </template>
            <button type="button" class="fo-btn" aria-label="Close flow panel" title="Close (Esc)" @click="close"><X class="size-4" /></button>
        </header>

        <div v-if="loading && !detail" class="grid flex-1 place-items-center text-sm text-slate-400"><span class="flex items-center gap-2"><LoaderCircle class="size-4 animate-spin" /> Loading flows…</span></div>
        <p v-else-if="loadError" class="m-4 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">{{ loadError }}</p>

        <!-- Flow list -->
        <div v-else-if="!detail" class="fo-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <p v-if="!flows.length" class="text-sm text-slate-400">This review has no user flows.</p>
            <p v-else class="mb-3 text-xs text-slate-400">Pick a flow, or ask the assistant about one ("show me the {{ flows[0].name.toLowerCase() }} flow").</p>
            <ul class="grid gap-2 sm:grid-cols-2">
                <li v-for="flow in flows" :key="flow.id">
                    <button type="button" class="fo-card w-full rounded-xl p-3 text-left" @click="emit('picked'); openFlow(flow.id)">
                        <span class="block text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/70">{{ flow.id }}<template v-if="flow.version"> · v{{ flow.version }}</template></span>
                        <span class="mt-0.5 block text-sm font-medium text-slate-100">{{ flow.name }}</span>
                        <span class="mt-2 flex flex-wrap gap-1">
                            <span v-for="lane in flow.lanes" :key="lane" class="rounded-full border border-white/10 bg-white/5 px-2 py-px text-[10px] text-slate-300">{{ lane }}</span>
                        </span>
                    </button>
                </li>
            </ul>
        </div>

        <!-- Flow -->
        <template v-else-if="layout">
            <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-[11px]">
                <span class="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 font-semibold uppercase tracking-wider text-cyan-200">Walkthrough · no code is executed</span>
                <span v-if="detail.graph_source === 'steps'" class="text-amber-200/90">Drawn in one lane from the review's steps. Re-run the review for actor lanes.</span>
                <span class="ml-auto flex items-center gap-2 text-slate-500">
                    <span class="inline-flex items-center gap-1"><i class="fo-key bg-emerald-400/60" />Start/end</span>
                    <span class="inline-flex items-center gap-1"><i class="fo-key bg-sky-400/60" />Action</span>
                    <span class="inline-flex items-center gap-1"><i class="fo-key rotate-45 bg-amber-400/60" />Decision</span>
                    <span class="inline-flex items-center gap-1"><i class="fo-key bg-violet-400/60" />System</span>
                </span>
            </div>

            <div class="flex min-h-0 flex-1 gap-3 p-3 pt-2">
                <div ref="canvasEl" class="fo-canvas fo-scroll min-h-0 min-w-0 flex-1 overflow-auto rounded-xl">
                    <FlowSwimlanes
                        :key="`${detail.flow.id}-v${detail.version}`"
                        :layout="layout"
                        :current="walk.current.value?.id ?? null"
                        :visited="walk.visited.value"
                        :visited-edges="walk.visitedEdges.value"
                        :active-edge="walk.activeEdge.value"
                        :zoom="zoom"
                    />
                </div>

                <div class="fo-scroll hidden w-64 shrink-0 space-y-3 overflow-y-auto text-xs md:block">
                    <section v-if="showHistory" class="fo-card rounded-xl p-3">
                        <h3 class="fo-label">Versions</h3>
                        <ol class="mt-2 space-y-2">
                            <li v-for="item in [...detail.versions].reverse()" :key="item.version" class="border-l-2 pl-2" :class="item.version === detail.version ? 'border-cyan-400' : 'border-white/10'">
                                <p class="flex items-center justify-between gap-2">
                                    <span class="font-semibold text-slate-200">v{{ item.version }}<span v-if="item.version === detail.version" class="ml-1 text-cyan-300">current</span></span>
                                    <button v-if="detail.can_correct && item.version !== detail.version" type="button" class="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:underline" @click="restore(item.version)">
                                        <RotateCcw class="size-3" />Restore
                                    </button>
                                </p>
                                <p class="text-slate-400">{{ item.change_summary }}</p>
                                <p v-if="item.instruction" class="mt-0.5 italic text-slate-500">"{{ item.instruction }}"</p>
                                <p class="text-[10px] text-slate-600">{{ item.user ?? 'PRD review' }}<template v-if="item.created_at"> · {{ new Date(item.created_at).toLocaleString() }}</template></p>
                            </li>
                        </ol>
                    </section>

                    <section class="fo-card rounded-xl p-3">
                        <h3 class="fo-label">Current step</h3>
                        <template v-if="walk.current.value">
                            <p class="mt-1 text-[10px] uppercase tracking-wider text-cyan-300/80">Step {{ stepNumber }} · {{ walk.current.value.lane }} · {{ walk.current.value.kind }}</p>
                            <p class="mt-0.5 text-sm text-slate-100">{{ walk.current.value.label }}</p>
                        </template>
                        <p v-else class="mt-1 text-slate-500">Press Play to walk through the flow step by step.</p>
                        <p v-if="walk.finished.value" class="mt-1 text-emerald-300">End of this path.</p>
                        <p v-if="walk.note.value" class="mt-1 text-amber-200">{{ walk.note.value }}</p>
                    </section>

                    <section v-if="detail.flow.acceptance_criteria?.length" class="fo-card rounded-xl p-3">
                        <h3 class="fo-label">Acceptance criteria</h3>
                        <ul class="mt-2 space-y-2">
                            <li v-for="(ac, index) in detail.flow.acceptance_criteria" :key="index" class="leading-snug text-slate-300">
                                <span class="text-cyan-300">Given</span> {{ ac.given }} <span class="text-cyan-300">when</span> {{ ac.when }} <span class="text-cyan-300">then</span> {{ ac.then }}
                            </li>
                        </ul>
                    </section>
                    <section v-if="detail.flow.missing?.length" class="fo-card rounded-xl p-3">
                        <h3 class="fo-label">Not stated in the PRD</h3>
                        <ul class="mt-2 list-disc space-y-1 pl-4 text-amber-100/80">
                            <li v-for="(item, index) in detail.flow.missing" :key="index">{{ item }}</li>
                        </ul>
                    </section>
                </div>
            </div>

            <!-- Walkthrough controls -->
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-cyan-300/10 px-4 py-2">
                <button type="button" class="fo-play" :aria-label="walk.playing.value ? 'Pause walkthrough' : 'Run walkthrough'" @click="walk.playing.value ? walk.pause() : walk.play()">
                    <Pause v-if="walk.playing.value" class="size-4" /><Play v-else class="size-4 fill-current" />
                    <span>{{ walk.playing.value ? 'Pause' : walk.started.value && !walk.finished.value ? 'Resume' : 'Run walkthrough' }}</span>
                </button>
                <button type="button" class="fo-btn" aria-label="Previous step" :disabled="walk.visited.value.size < 2" @click="walk.back()"><ChevronLeft class="size-4" /></button>
                <button type="button" class="fo-btn" aria-label="Next step" :disabled="walk.finished.value || walk.choices.value.length > 0" @click="walk.next()"><ChevronRight class="size-4" /></button>
                <button v-if="walk.started.value" type="button" class="fo-btn" aria-label="Stop walkthrough" @click="walk.reset()"><Square class="size-3.5 fill-current" /></button>
                <label class="sr-only" for="fo-speed">Speed</label>
                <select id="fo-speed" v-model.number="walk.speed.value" class="rounded-lg border border-white/10 bg-slate-900/80 py-1 pl-2 pr-7 text-xs text-slate-200">
                    <option :value="0.5">0.5×</option>
                    <option :value="1">1×</option>
                    <option :value="1.5">1.5×</option>
                    <option :value="2">2×</option>
                </select>
                <button type="button" class="fo-btn" :aria-pressed="narrate" :aria-label="narrate ? 'Narration on' : 'Narration off'" :title="narrate ? 'Read each step aloud' : 'Silent walkthrough'" @click="narrate = !narrate">
                    <Volume2 v-if="narrate" class="size-4" /><VolumeX v-else class="size-4" />
                </button>
                <div v-if="walk.choices.value.length" class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose a branch">
                    <span class="text-[11px] text-amber-200">Decision: choose a branch</span>
                    <button
                        v-for="edge in walk.choices.value"
                        :key="edge.id"
                        type="button"
                        class="rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-300/20"
                        @click="walk.choose(edge)"
                    >
                        {{ edge.label || layout.nodes.find((n) => n.id === edge.to)?.label }}
                    </button>
                </div>
            </div>

            <!-- Correction by voice or text -->
            <form class="shrink-0 border-t border-cyan-300/10 px-4 py-2.5" @submit.prevent="applyCorrection">
                <p v-if="correctionResult" class="mb-1.5 flex items-center gap-1.5 text-[11px] text-emerald-300"><Sparkles class="size-3.5" />{{ correctionResult }}</p>
                <p v-if="correctionError || dictation.error.value" class="mb-1.5 text-[11px] text-rose-300">{{ correctionError || dictation.error.value }}</p>
                <p v-if="!detail.can_correct" class="text-[11px] text-slate-500">Only the review's author or an admin can correct this flow.</p>
                <div v-else class="fo-composer flex items-end gap-2 rounded-xl p-1.5">
                    <button
                        v-if="dictation.supported"
                        type="button"
                        class="grid size-9 shrink-0 place-items-center rounded-lg transition-colors"
                        :class="dictation.listening.value ? 'bg-cyan-400 text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.7)]' : 'bg-white/5 text-cyan-200 hover:bg-white/10'"
                        :aria-label="dictation.listening.value ? 'Finish dictating' : 'Dictate a correction'"
                        @click="dictation.listening.value ? dictation.stop() : dictation.start()"
                    >
                        <Mic class="size-4" />
                    </button>
                    <label for="fo-correction" class="sr-only">Correct this flow</label>
                    <textarea
                        id="fo-correction"
                        v-model="correction"
                        rows="1"
                        maxlength="1000"
                        class="max-h-24 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
                        :placeholder="dictation.listening.value ? dictation.interim.value || 'Listening… say the correction' : 'Correct this flow, e.g. “After approval the system emails the agent”'"
                        :disabled="correcting"
                        @keydown="onCorrectionKey"
                    />
                    <button type="submit" class="fo-apply" :disabled="correcting || correction.trim().length < 3">
                        <LoaderCircle v-if="correcting" class="size-4 animate-spin" /><Sparkles v-else class="size-4" />
                        <span>{{ correcting ? 'Applying…' : 'Apply' }}</span>
                    </button>
                </div>
            </form>
        </template>
    </aside>
</template>

<style scoped>
.fo {
    border-left: 1px solid rgba(34, 211, 238, 0.18);
    background: linear-gradient(180deg, rgb(10, 20, 40), rgb(5, 10, 22));
    box-shadow: -30px 0 60px -20px rgba(2, 6, 23, 0.9), -1px 0 30px -10px rgba(34, 211, 238, 0.35);
    animation: fo-in 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    color-scheme: dark;
}
.fo-edge {
    position: absolute;
    left: -1px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(180deg, transparent, rgba(103, 232, 249, 0.9), transparent);
    background-size: 100% 40%;
    background-repeat: no-repeat;
    animation: fo-scan 4s linear infinite;
}
.fo-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.25) transparent;
}
.fo-btn {
    display: grid;
    place-items: center;
    min-width: 2rem;
    height: 2rem;
    border-radius: 0.6rem;
    color: rgb(203 213 225);
}
.fo-btn:hover:not(:disabled),
.fo-btn[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.08);
    color: rgb(165 243 252);
}
.fo-btn:disabled {
    opacity: 0.35;
}
.fo-card {
    border: 1px solid rgba(125, 211, 252, 0.12);
    background: rgba(255, 255, 255, 0.025);
}
button.fo-card:hover {
    border-color: rgba(34, 211, 238, 0.45);
    background: rgba(34, 211, 238, 0.06);
}
.fo-canvas {
    border: 1px solid rgba(125, 211, 252, 0.1);
    background:
        radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.12) 1px, transparent 0) 0 0 / 22px 22px,
        rgba(2, 6, 23, 0.55);
}
.fo-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgb(148 163 184);
}
.fo-key {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
}
.fo-play,
.fo-apply {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 0.65rem;
    padding: 0.4rem 0.8rem;
    font-size: 12px;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, rgb(34 211 238), rgb(37 99 235));
    box-shadow: 0 0 20px -4px rgba(34, 211, 238, 0.7);
}
.fo-apply:disabled {
    opacity: 0.35;
    box-shadow: none;
}
.fo-composer {
    border: 1px solid rgba(125, 211, 252, 0.14);
    background: rgba(15, 23, 42, 0.75);
}
.fo-composer:focus-within {
    border-color: rgba(34, 211, 238, 0.45);
}
@keyframes fo-in {
    from { opacity: 0; transform: translateX(24px); }
    to { opacity: 1; transform: none; }
}
@keyframes fo-scan {
    from { background-position: 0 -40%; }
    to { background-position: 0 140%; }
}
@media (prefers-reduced-motion: reduce) {
    .fo, .fo-edge { animation: none; }
}
</style>

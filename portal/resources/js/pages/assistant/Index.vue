<script setup lang="ts">
import EventTicker from '@/components/assistant/EventTicker.vue';
import DeveloperCredit from '@/components/DeveloperCredit.vue';
import LiveWidget, { type WidgetSize } from '@/components/assistant/LiveWidget.vue';
import ActivityWidget from '@/components/assistant/widgets/ActivityWidget.vue';
import MonitoringWidget from '@/components/assistant/widgets/MonitoringWidget.vue';
import PerformanceWidget from '@/components/assistant/widgets/PerformanceWidget.vue';
import PlatformWidget from '@/components/assistant/widgets/PlatformWidget.vue';
import PrdWidget from '@/components/assistant/widgets/PrdWidget.vue';
import ToolkitWidget from '@/components/assistant/widgets/ToolkitWidget.vue';
import FlowOverlay, { type FlowRequest } from '@/components/flow/FlowOverlay.vue';
import VoiceOrb from '@/components/voice/VoiceOrb.vue';
import { useLiveSummary } from '@/composables/useLiveSummary';
import { useVoiceAssistant, type AssistantState } from '@/composables/useVoiceAssistant';
import { renderMarkdown } from '@/lib/markdown';
import { type SharedData } from '@/types';
import { sectionError, type ActivitySection, type LiveEvent, type LiveSummary, type PrdReviewOption } from '@/types/assistant';
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import {
    Activity,
    BarChart3,
    Boxes,
    CircleAlert,
    CircleCheck,
    FileCheck2,
    History,
    LayoutGrid,
    Mic,
    MicOff,
    Plus,
    Radio,
    SendHorizontal,
    Server,
    Settings2,
    Square,
    Trash2,
    Volume2,
    Workflow,
    X,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';

interface Product {
    id: number;
    name: string;
    description: string | null;
}
interface ConversationSummary {
    id: number;
    title: string | null;
    product_id: number | null;
    updated_at: string;
}

const props = defineProps<{ products: Product[]; conversations: ConversationSummary[]; isAdmin: boolean; canUseFlows: boolean; refreshSeconds: number }>();
const page = usePage<SharedData>();

const productId = ref<number | null>(null);
const prdReviewId = ref<number | null>(null);
const draft = ref('');
const panel = ref<'history' | 'settings' | null>(null);
const transcriptEl = ref<HTMLElement | null>(null);
const flowRequest = ref<FlowRequest | null>(null);
const pickedDuringAnswer = ref<string | null>(null); // id of the latest message when the person picked a flow
let flowRequestCount = 0;

const assistant = useVoiceAssistant({
    productId,
    prdReviewId,
    onToolResult: (name, data) => {
        // The assistant looked up a flow: show it in the flow panel (a real tool result, not a guess).
        if (name !== 'get_prd_flow' || !props.canUseFlows) return;
        // Once the person picked a flow in the panel, later lookups in the same answer leave it alone.
        if (pickedDuringAnswer.value !== null && pickedDuringAnswer.value === messages.value.at(-1)?.id) return;
        const result = data as { found?: boolean; review?: { id: number; title: string }; flow?: { id: string }; flows?: unknown[] };
        if (result.review && (result.found || result.flows?.length)) {
            openFlows(result.review.id, result.review.title, result.found ? result.flow?.id : null);
        }
    },
});
const { state, level, messages, interim, errorMessage, connection, connectionMessage, providerLabel, settings, voices } = assistant;

const STATE_LABELS: Record<AssistantState, { title: string; hint: string }> = {
    IDLE: { title: 'Ready', hint: 'Tap the core and speak, or type below.' },
    LISTENING: { title: 'Listening', hint: 'Speak naturally. Send when you finish, or stop listening.' },
    PROCESSING: { title: 'Thinking', hint: 'Your question is with the AI.' },
    ANALYZING: { title: 'Checking company data', hint: 'Reading ReleaseGuard records you are authorised to see.' },
    RESPONDING: { title: 'Answering', hint: 'The answer is arriving.' },
    SPEAKING: { title: 'Speaking', hint: 'Tap the core to talk over it, or press Stop.' },
    INTERRUPTED: { title: 'Stopped', hint: 'You interrupted the answer. Ask again whenever you are ready.' },
    ERROR: { title: 'Something went wrong', hint: '' },
};
const busy = computed(() => ['PROCESSING', 'ANALYZING', 'RESPONDING', 'SPEAKING'].includes(state.value));

const TOOL_LABELS: Record<string, string> = {
    get_portfolio_overview: 'Portfolio overview',
    get_monitoring_status: 'Monitoring',
    get_prd_reviews: 'PRD reviews',
    get_prd_review_details: 'PRD review details',
    get_prd_flow: 'PRD flow',
    get_alarm_diagnoses: 'Alarm diagnoses',
    get_team_activity: 'Team activity',
    get_sales_performance: 'Sales performance',
    get_platform_status: 'Platform status',
    get_toolkit_inventory: 'Toolkit',
};

const CONNECTION = computed(() => {
    switch (connection.value) {
        case 'connected':
            return { label: 'Connected', dot: 'bg-emerald-400', text: 'text-emerald-200' };
        case 'auth_required':
            return { label: 'Authentication required', dot: 'bg-amber-400', text: 'text-amber-200' };
        case 'error':
            return { label: 'Connection error', dot: 'bg-rose-400', text: 'text-rose-200' };
        default:
            return { label: 'Connecting', dot: 'bg-sky-400 motion-safe:animate-pulse', text: 'text-sky-200' };
    }
});

/* ---------------- Live widgets (real data, refreshed while visible) ---------------- */
const canSeePerformance = computed(() => props.isAdmin || Boolean(page.props.auth.isCrmUser));
// Two independent feeds: CRM sales can take seconds (it is cached for a minute on the server), so it
// never holds up the engineering widgets, which refresh every `refreshSeconds`.
const userId = page.props.auth.user.id;
const liveEngineering = useLiveSummary({ productId, userId, intervalSeconds: props.refreshSeconds, sections: 'monitoring,platform,toolkit,prd,activity', enabled: props.canUseFlows });
const liveSales = useLiveSummary({ productId, userId, intervalSeconds: 60, sections: 'performance', enabled: canSeePerformance.value });
const liveFor = (key: string) => (key === 'performance' ? liveSales : liveEngineering);
const sections = computed<LiveSummary['sections']>(() => ({ ...liveEngineering.data.value?.sections, ...liveSales.data.value?.sections }));

interface WidgetConfig {
    key: keyof LiveSummary['sections'];
    title: string;
    icon: Component;
    accent: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';
    component: Component;
    href?: string;
    demo?: (section: any) => boolean;
}

const leftRail = computed<WidgetConfig[]>(() =>
    props.canUseFlows
        ? [
              { key: 'monitoring', title: 'Production monitoring', icon: Activity, accent: 'rose', component: MonitoringWidget, href: '/monitoring', demo: (s) => Boolean(s?.demo_data) },
              { key: 'platform', title: 'Portal & services', icon: Server, accent: 'sky', component: PlatformWidget, href: props.isAdmin ? '/services' : undefined },
              { key: 'toolkit', title: 'Developer toolkit', icon: Boxes, accent: 'violet', component: ToolkitWidget, href: '/toolkit' },
          ]
        : [],
);
const rightRail = computed<WidgetConfig[]>(() => [
    ...(canSeePerformance.value
        ? [{ key: 'performance', title: 'Sales performance', icon: BarChart3, accent: 'emerald', component: PerformanceWidget, href: '/performance', demo: (s: any) => Boolean(s?.demo) } as WidgetConfig]
        : []),
    ...(props.canUseFlows
        ? ([
              { key: 'prd', title: 'PRD readiness', icon: FileCheck2, accent: 'amber', component: PrdWidget, href: '/prd' },
              { key: 'activity', title: 'Platform activity', icon: Radio, accent: 'cyan', component: ActivityWidget },
          ] as WidgetConfig[])
        : []),
]);

function widgetSection(key: WidgetConfig['key']) {
    const section = sections.value[key];
    return section && !sectionError(section) ? section : null;
}

const tickerEvents = computed<LiveEvent[]>(() => (widgetSection('activity') as ActivitySection | null)?.events ?? []);

/* Widget sizes: expanded (taller, and its side column wider), normal or collapsed to the title bar.
   Remembered in this browser only, as a personal layout preference. */
const SIZES_KEY = 'releaseguard.assistant.widget-sizes';
function loadSizes(): Record<string, WidgetSize> {
    try {
        return JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}');
    } catch {
        return {};
    }
}
const widgetSizes = ref<Record<string, WidgetSize>>(loadSizes());
watch(
    widgetSizes,
    (value) => {
        try {
            localStorage.setItem(SIZES_KEY, JSON.stringify(value));
        } catch {
            /* storage unavailable: the layout just won't be remembered */
        }
    },
    { deep: true },
);
const sizeOf = (key: string): WidgetSize => widgetSizes.value[key] ?? 'normal';
function resizeWidget(key: string, size: WidgetSize) {
    widgetSizes.value = { ...widgetSizes.value, [key]: size };
}

function railStyle(rail: WidgetConfig[]) {
    const rows = rail.map((w) => (sizeOf(w.key) === 'collapsed' ? 'auto' : sizeOf(w.key) === 'expanded' ? 'minmax(0, 2fr)' : 'minmax(0, 1fr)'));
    return { '--rail-rows': rows.join(' ') };
}

const gridClass = computed(() => {
    if (!leftRail.value.length && rightRail.value.length) return 'vw-cols-right';
    if (!rightRail.value.length) return 'lg:grid-cols-1';
    return 'vw-cols-3';
});
const leftWide = computed(() => leftRail.value.some((w) => sizeOf(w.key) === 'expanded'));
const rightWide = computed(() => rightRail.value.some((w) => sizeOf(w.key) === 'expanded'));

/* ---------------- PRD flows ---------------- */
const prdReviews = ref<PrdReviewOption[]>([]);
const prdReviewsLoaded = ref(false);

async function loadPrdReviews() {
    if (!props.canUseFlows) return;
    try {
        const query = productId.value ? `?product_id=${productId.value}` : '';
        const response = await fetch(`/assistant/prd-reviews${query}`, { headers: { Accept: 'application/json' } });
        if (response.ok) prdReviews.value = (await response.json()).reviews;
    } finally {
        prdReviewsLoaded.value = true;
    }
}

const selectedReview = computed(() => prdReviews.value.find((r) => r.id === prdReviewId.value) ?? null);

function openFlows(reviewId: number, reviewTitle?: string, flowId?: string | null) {
    panel.value = null;
    flowRequest.value = { reviewId, reviewTitle, flowId: flowId ?? null, nonce: ++flowRequestCount };
}

/* ---------------- Actions ---------------- */
function submit() {
    const text = draft.value;
    if (!text.trim() || busy.value) return;
    draft.value = '';
    void assistant.send(text);
}

function onComposerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
    }
}

/** The core is the microphone: tap to listen, tap again to send; while an answer plays, tap to talk over it. */
function toggleListening() {
    if (state.value === 'LISTENING') assistant.stopListening();
    else void assistant.startListening();
}

function togglePanel(name: 'history' | 'settings') {
    panel.value = panel.value === name ? null : name;
}

let reopeningConversation = false;
async function openConversation(id: number) {
    const loaded = await assistant.loadConversation(id);
    // Switching to the reopened conversation's product scope must not start a new conversation.
    reopeningConversation = true;
    if (loaded && props.products.some((p) => p.id === loaded.product_id)) productId.value = loaded.product_id;
    else if (loaded) productId.value = null;
    await nextTick();
    reopeningConversation = false;
    panel.value = null;
}

async function removeConversation(id: number) {
    if (!confirm('Delete this conversation?')) return;
    await assistant.deleteConversation(id);
    router.reload({ only: ['conversations'] });
}

function startNew() {
    assistant.newConversation();
}

/* ---------------- Reactions to real events ---------------- */
watch(productId, (value, previous) => {
    // A conversation belongs to one product scope, so changing scope starts a fresh one.
    if (!reopeningConversation && previous !== undefined && messages.value.length && assistant.conversationId.value !== null) startNew();
    prdReviewId.value = null;
    void loadPrdReviews();
});

watch(assistant.conversationId, (id, previous) => {
    if (id !== null && id !== previous) router.reload({ only: ['conversations'] });
});

watch(state, (value, previous) => {
    // Refresh the widgets once an answer finished, because the assistant may have looked at new data.
    if (['RESPONDING', 'SPEAKING'].includes(previous) && ['IDLE', 'SPEAKING'].includes(value) && value !== previous) {
        void liveEngineering.refresh();
        void liveSales.refresh();
    }
});

watch(
    () => [messages.value.length, messages.value[messages.value.length - 1]?.content, interim.value],
    async () => {
        await nextTick();
        transcriptEl.value?.scrollTo({ top: transcriptEl.value.scrollHeight, behavior: 'smooth' });
    },
);

function onGlobalKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (state.value === 'LISTENING') assistant.cancelListening();
    else if (busy.value) assistant.interrupt();
    else if (flowRequest.value) flowRequest.value = null;
    else if (panel.value) panel.value = null;
}

onMounted(() => {
    void assistant.checkConnection();
    void loadPrdReviews();
    window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function formatDate(value: string) {
    return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const LANGUAGES = [
    { value: 'en-US', label: 'English (US)' },
    { value: 'en-GB', label: 'English (UK)' },
    { value: 'en-AU', label: 'English (Australia)' },
    { value: 'en-IN', label: 'English (India)' },
    { value: 'ms-MY', label: 'Malay' },
    { value: 'ur-PK', label: 'Urdu' },
    { value: 'ar-SA', label: 'Arabic' },
];
const voicesForLanguage = computed(() => voices.value.filter((v) => v.lang.toLowerCase().startsWith(settings.lang.slice(0, 2).toLowerCase())));
</script>

<template>
    <Head title="Assistant" />

    <div class="voice-workspace relative flex h-dvh flex-col overflow-clip text-slate-100">
        <div class="pointer-events-none absolute inset-0" aria-hidden="true">
            <div class="vw-glow vw-glow-a" />
            <div class="vw-glow vw-glow-b" />
            <div class="vw-glow vw-glow-c" />
            <div class="vw-glow vw-glow-d" />
            <div class="vw-grid absolute inset-0" />
        </div>

        <!-- Top bar -->
        <header class="relative z-30 flex h-12 shrink-0 items-center gap-2 px-3 sm:gap-3 sm:px-4">
            <div class="flex min-w-0 items-center gap-2">
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400/90 to-blue-600/90 text-sm font-semibold text-white shadow-[0_0_24px_rgba(34,211,238,0.45)]">RG</span>
                <div class="hidden min-w-0 sm:block">
                    <p class="truncate text-sm font-medium tracking-wide">ReleaseGuard AI</p>
                    <p class="truncate text-[10px] uppercase tracking-[0.24em] text-cyan-200/60">Command centre</p>
                </div>
            </div>

            <label class="sr-only" for="product">Product</label>
            <select
                id="product"
                v-model="productId"
                class="ml-auto min-w-0 max-w-[9.5rem] truncate rounded-full border border-white/10 bg-white/5 py-1.5 pl-3 pr-8 text-xs text-slate-200 backdrop-blur focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 sm:max-w-[14rem]"
            >
                <option :value="null" class="bg-slate-900">All my products</option>
                <option v-for="product in products" :key="product.id" :value="product.id" class="bg-slate-900">{{ product.name }}</option>
            </select>

            <button
                type="button"
                class="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs backdrop-blur hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                :class="CONNECTION.text"
                :title="connectionMessage || 'Check the AI connection again'"
                @click="assistant.checkConnection()"
            >
                <span class="size-2 rounded-full" :class="CONNECTION.dot" aria-hidden="true" />
                <span class="hidden md:inline">{{ providerLabel || 'AI' }}:</span> <span class="hidden sm:inline">{{ CONNECTION.label }}</span>
                <span class="sr-only sm:hidden">{{ CONNECTION.label }}</span>
            </button>

            <nav class="flex shrink-0 items-center gap-1" aria-label="Workspace panels">
                <button type="button" class="vw-icon-btn" :aria-pressed="panel === 'history'" aria-label="Conversation history" @click="togglePanel('history')">
                    <History class="size-4" />
                </button>
                <button type="button" class="vw-icon-btn" :aria-pressed="panel === 'settings'" aria-label="Voice settings" @click="togglePanel('settings')">
                    <Settings2 class="size-4" />
                </button>
                <Link :href="canUseFlows ? '/dashboard' : '/performance'" class="vw-icon-btn" aria-label="Open portal tools" title="Portal tools">
                    <LayoutGrid class="size-4" />
                </Link>
            </nav>
        </header>

        <!-- Connection guidance: the exact next step, never a fake answer -->
        <div
            v-if="connection === 'auth_required' || connection === 'error'"
            class="relative z-20 mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border px-3 py-1.5 text-xs sm:mx-auto sm:max-w-3xl"
            :class="connection === 'auth_required' ? 'border-amber-400/25 bg-amber-400/10 text-amber-100' : 'border-rose-400/25 bg-rose-400/10 text-rose-100'"
            role="status"
        >
            <CircleAlert class="size-3.5 shrink-0" />
            <span class="font-medium">{{ connection === 'auth_required' ? 'No working AI provider for the assistant yet.' : 'The assistant connection failed.' }}</span>
            <span class="opacity-80">{{ connectionMessage }}</span>
            <span v-if="isAdmin">Next step: add a key on <Link href="/connections" class="underline underline-offset-2">Connections</Link>. The widgets below still show live data.</span>
            <span v-else>Next step: ask a ReleaseGuard admin to connect an AI provider. The widgets still show live data.</span>
        </div>

        <!-- Command centre: live widgets either side of the assistant. Only the inner lists scroll. -->
        <div
            class="relative z-10 grid min-h-0 flex-1 gap-3 overflow-y-auto overflow-x-clip px-4 pb-3 pt-3 sm:px-6 lg:gap-4 lg:overflow-clip"
            :class="gridClass"
            :data-left-wide="leftWide || undefined"
            :data-right-wide="rightWide || undefined"
        >
            <div
                v-if="leftRail.length"
                class="vw-rail order-2 grid min-h-0 gap-3 lg:order-1"
                :style="railStyle(leftRail)"
                aria-label="Engineering widgets"
            >
                <LiveWidget
                    v-for="widget in leftRail"
                    :key="widget.key"
                    :title="widget.title"
                    :icon="widget.icon"
                    :accent="widget.accent"
                    :href="widget.href"
                    :seconds-ago="liveFor(widget.key).secondsAgo.value"
                    :stale="liveFor(widget.key).stale.value"
                    :stamp="liveFor(widget.key).data.value?.generated_at"
                    :error="sectionError(sections[widget.key]) ?? (liveFor(widget.key).error.value && !liveFor(widget.key).data.value ? liveFor(widget.key).error.value : null)"
                    :demo="widget.demo?.(widgetSection(widget.key))"
                    :size="sizeOf(widget.key)"
                    @resize="(size: WidgetSize) => resizeWidget(widget.key, size)"
                >
                    <component :is="widget.component" v-if="widgetSection(widget.key)" :section="widgetSection(widget.key)" />
                    <div v-else class="space-y-2 pt-1" aria-label="Loading">
                        <div class="h-5 w-2/3 rounded bg-white/5 motion-safe:animate-pulse" />
                        <div class="h-3 w-full rounded bg-white/5 motion-safe:animate-pulse" />
                        <div class="h-3 w-4/5 rounded bg-white/5 motion-safe:animate-pulse" />
                    </div>
                </LiveWidget>
            </div>

            <!-- Centre stage -->
            <main class="order-1 flex min-h-[32rem] min-w-0 flex-col items-center lg:order-2 lg:min-h-0">
                <div class="flex w-full shrink-0 flex-col items-center" :class="messages.length ? '' : 'pt-[2vh]'">
                    <button
                        type="button"
                        class="vw-orb group relative transition-[height] duration-700 focus:outline-none"
                        :class="[messages.length ? 'h-[min(24vh,210px)]' : 'h-[min(42vh,380px)]', { 'vw-orb-listening': state === 'LISTENING' }]"
                        :disabled="!assistant.speechInputSupported"
                        :aria-label="!assistant.speechInputSupported ? 'Voice input is not supported in this browser' : state === 'LISTENING' ? 'Finish speaking and send' : 'Start listening'"
                        :title="!assistant.speechInputSupported ? 'Voice input needs Chrome, Edge or Safari. You can still type.' : state === 'LISTENING' ? 'Tap to send' : 'Tap to speak'"
                        @click="toggleListening"
                    >
                        <VoiceOrb :state="state" :level="level" :spectrum="assistant.readSpectrum" />
                        <span
                            v-if="assistant.speechInputSupported && (state === 'IDLE' || state === 'INTERRUPTED' || state === 'ERROR')"
                            class="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            aria-hidden="true"
                        >
                            <Mic class="size-7 text-slate-950/70" />
                        </span>
                    </button>

                    <div class="-mt-1 text-center" aria-live="polite">
                        <p class="vw-state text-sm font-semibold uppercase tracking-[0.28em]" :class="state === 'ERROR' ? 'text-rose-300' : state === 'INTERRUPTED' ? 'text-amber-200' : 'text-cyan-100'">
                            {{ STATE_LABELS[state].title }}
                        </p>
                        <p class="mt-0.5 max-w-md text-xs text-slate-400">{{ state === 'ERROR' ? errorMessage : STATE_LABELS[state].hint }}</p>
                    </div>

                    <div v-if="state === 'LISTENING'" class="mt-2 flex items-center gap-2">
                        <button type="button" class="vw-pill bg-cyan-400 text-slate-950 hover:bg-cyan-300" @click="assistant.stopListening()">
                            <SendHorizontal class="size-3.5" /> Send now
                        </button>
                        <button type="button" class="vw-pill border border-rose-300/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20" title="Stop listening (Esc)" @click="assistant.cancelListening()">
                            <MicOff class="size-3.5" /> Stop listening
                        </button>
                    </div>
                    <p v-else-if="!messages.length && state === 'IDLE'" class="mt-3 max-w-lg text-center text-xl font-light text-slate-200 sm:text-2xl">
                        Hello {{ page.props.auth.user.name.split(' ')[0] }}. What would you like to know?
                    </p>
                </div>

                <!-- Transcript -->
                <section
                    ref="transcriptEl"
                    class="vw-scroll mt-2 w-full max-w-2xl min-h-0 flex-1 space-y-4 overflow-y-auto pb-3"
                    role="log"
                    aria-label="Conversation transcript"
                    aria-live="polite"
                >
                    <article v-for="message in messages" :key="message.id" :class="message.role === 'user' ? 'flex justify-end' : ''">
                        <div
                            v-if="message.role === 'user'"
                            class="max-w-[85%] rounded-2xl rounded-br-md border border-cyan-300/15 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-50"
                        >
                            {{ message.content }}
                        </div>
                        <div v-else class="vw-answer text-[15px] leading-relaxed text-slate-200">
                            <div v-if="message.content" class="vw-md" v-html="renderMarkdown(message.content)" />
                            <p v-else-if="message.status === 'streaming'" class="text-sm text-slate-500">Waiting for the first words…</p>
                            <div v-if="message.tools.length || message.status !== 'complete'" class="mt-2 flex flex-wrap items-center gap-1.5">
                                <span
                                    v-for="(tool, index) in message.tools"
                                    :key="index"
                                    class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-400"
                                >
                                    <CircleCheck v-if="tool.ok" class="size-3 text-emerald-300" /><CircleAlert v-else class="size-3 text-amber-300" />
                                    {{ TOOL_LABELS[tool.name] ?? tool.name }}
                                </span>
                                <span v-if="message.status === 'interrupted'" class="text-[11px] text-amber-300">Interrupted</span>
                                <span v-if="message.status === 'error'" class="text-[11px] text-rose-300">Not completed</span>
                            </div>
                            <button
                                v-if="assistant.speechOutputSupported && message.status === 'complete' && message.content && !busy"
                                type="button"
                                class="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-cyan-200"
                                @click="assistant.speak(message.content)"
                            >
                                <Volume2 class="size-3" /> Read aloud
                            </button>
                        </div>
                    </article>
                    <p v-if="interim" class="text-right text-sm italic text-cyan-200/70">{{ interim }}</p>
                </section>

                <!-- Composer -->
                <div class="w-full max-w-2xl shrink-0 pb-1">
                    <div
                        v-if="state === 'ERROR' || state === 'INTERRUPTED'"
                        class="mb-2 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300"
                    >
                        <span>{{ state === 'ERROR' ? errorMessage : 'Answer stopped.' }}</span>
                        <button type="button" class="shrink-0 rounded-md px-2 py-1 text-cyan-200 hover:bg-white/10" @click="assistant.reset()">Dismiss</button>
                    </div>

                    <!-- PRD context: the assistant answers flow questions about this review -->
                    <div v-if="canUseFlows" class="mb-1.5 flex items-center gap-2 text-[11px]">
                        <Workflow class="size-3.5 shrink-0 text-cyan-300/80" aria-hidden="true" />
                        <label for="prd-context" class="shrink-0 text-slate-400">PRD for flow questions</label>
                        <select
                            id="prd-context"
                            v-model="prdReviewId"
                            class="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-slate-900/70 py-1 pl-2 pr-7 text-[11px] text-slate-200 focus:border-cyan-400/60 focus:outline-none"
                            :disabled="prdReviewsLoaded && !prdReviews.length"
                        >
                            <option :value="null">{{ prdReviewsLoaded && !prdReviews.length ? 'No completed PRD reviews yet' : 'None selected' }}</option>
                            <option v-for="review in prdReviews" :key="review.id" :value="review.id">
                                {{ review.title }} · {{ review.flows }} flow{{ review.flows === 1 ? '' : 's' }}{{ review.product ? ` · ${review.product}` : '' }}
                            </option>
                        </select>
                        <button
                            v-if="selectedReview"
                            type="button"
                            class="shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 font-medium text-cyan-100 hover:bg-cyan-400/20"
                            @click="openFlows(selectedReview.id, selectedReview.title)"
                        >
                            Show flows
                        </button>
                    </div>

                    <form class="vw-composer flex items-end gap-2 rounded-2xl p-2" @submit.prevent="submit">
                        <button
                            type="button"
                            class="vw-mic grid size-11 shrink-0 place-items-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                            :class="state === 'LISTENING' ? 'bg-cyan-400 text-slate-950' : 'bg-white/5 text-cyan-200 hover:bg-white/10'"
                            :disabled="!assistant.speechInputSupported"
                            :aria-label="!assistant.speechInputSupported ? 'Voice input is not supported in this browser' : state === 'LISTENING' ? 'Finish speaking' : 'Speak'"
                            :title="!assistant.speechInputSupported ? 'Voice input needs Chrome, Edge or Safari. You can still type.' : ''"
                            @click="toggleListening"
                        >
                            <MicOff v-if="!assistant.speechInputSupported" class="size-5 opacity-50" />
                            <Mic v-else class="size-5" />
                        </button>
                        <label for="composer" class="sr-only">Ask ReleaseGuard AI</label>
                        <textarea
                            id="composer"
                            v-model="draft"
                            rows="1"
                            maxlength="4000"
                            class="vw-input max-h-28 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
                            :placeholder="
                                state === 'LISTENING'
                                    ? 'Listening…'
                                    : page.props.auth.isCrmUser
                                      ? 'Ask about your agents, deals and earnings…'
                                      : selectedReview
                                        ? `Ask about a flow in “${selectedReview.title}”…`
                                        : 'Ask about sales, releases, PRDs, production or the toolkit…'
                            "
                            :disabled="state === 'LISTENING'"
                            @keydown="onComposerKey"
                        />
                        <button
                            v-if="busy || state === 'LISTENING'"
                            type="button"
                            class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 text-slate-100 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                            :aria-label="state === 'LISTENING' ? 'Stop listening' : 'Stop'"
                            :title="state === 'LISTENING' ? 'Stop listening (Esc)' : 'Stop (Esc)'"
                            @click="state === 'LISTENING' ? assistant.cancelListening() : assistant.interrupt()"
                        >
                            <Square class="size-4 fill-current" />
                        </button>
                        <button
                            v-else
                            type="submit"
                            class="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                            :disabled="!draft.trim()"
                            aria-label="Send"
                        >
                            <SendHorizontal class="size-4" />
                        </button>
                    </form>
                    <p v-if="!assistant.speechInputSupported" class="mt-1 text-center text-[11px] text-slate-500">
                        Voice input is not available in this browser. Use Chrome, Edge or Safari, or type your question.
                    </p>
                </div>
            </main>

            <div v-if="rightRail.length" class="vw-rail order-3 grid min-h-0 gap-3" :style="railStyle(rightRail)" aria-label="Business widgets">
                <LiveWidget
                    v-for="widget in rightRail"
                    :key="widget.key"
                    :title="widget.title"
                    :icon="widget.icon"
                    :accent="widget.accent"
                    :href="widget.href"
                    :seconds-ago="liveFor(widget.key).secondsAgo.value"
                    :stale="liveFor(widget.key).stale.value"
                    :stamp="liveFor(widget.key).data.value?.generated_at"
                    :error="sectionError(sections[widget.key]) ?? (liveFor(widget.key).error.value && !liveFor(widget.key).data.value ? liveFor(widget.key).error.value : null)"
                    :demo="widget.demo?.(widgetSection(widget.key))"
                    :size="sizeOf(widget.key)"
                    @resize="(size: WidgetSize) => resizeWidget(widget.key, size)"
                >
                    <component
                        :is="widget.component"
                        v-if="widgetSection(widget.key)"
                        :section="widgetSection(widget.key)"
                        @open-flows="(id: number, title: string) => openFlows(id, title)"
                    />
                    <div v-else class="space-y-2 pt-1" aria-label="Loading">
                        <div class="h-5 w-2/3 rounded bg-white/5 motion-safe:animate-pulse" />
                        <div class="h-3 w-full rounded bg-white/5 motion-safe:animate-pulse" />
                        <div class="h-3 w-4/5 rounded bg-white/5 motion-safe:animate-pulse" />
                    </div>
                </LiveWidget>
            </div>

            <!-- Flow panel (over the right side) -->
            <FlowOverlay
                v-if="flowRequest"
                :request="flowRequest"
                :lang="settings.lang"
                :rate="settings.rate"
                :narrate-by-default="settings.autoSpeak !== 'never'"
                @close="flowRequest = null"
                @picked="pickedDuringAnswer = messages.at(-1)?.id ?? null"
            />

            <!-- History panel -->
            <aside v-if="panel === 'history'" class="vw-panel left-0 border-r" aria-label="Conversation history">
                <div class="flex items-center justify-between px-4 pb-2 pt-4">
                    <h2 class="text-sm font-medium">History</h2>
                    <div class="flex gap-1">
                        <button type="button" class="vw-icon-btn" aria-label="New conversation" @click="startNew"><Plus class="size-4" /></button>
                        <button type="button" class="vw-icon-btn" aria-label="Close history" @click="panel = null"><X class="size-4" /></button>
                    </div>
                </div>
                <p v-if="!conversations.length" class="px-4 text-xs text-slate-400">Your conversations appear here.</p>
                <ul class="vw-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
                    <li v-for="item in conversations" :key="item.id" class="group flex items-center gap-1">
                        <button
                            type="button"
                            class="min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                            :class="assistant.conversationId.value === item.id ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-300'"
                            @click="openConversation(item.id)"
                        >
                            <span class="block truncate">{{ item.title || 'Conversation' }}</span>
                            <span class="text-[11px] text-slate-500">{{ formatDate(item.updated_at) }}</span>
                        </button>
                        <button
                            type="button"
                            class="vw-icon-btn opacity-60 hover:text-rose-300 group-hover:opacity-100"
                            :aria-label="`Delete ${item.title || 'conversation'}`"
                            @click="removeConversation(item.id)"
                        >
                            <Trash2 class="size-3.5" />
                        </button>
                    </li>
                </ul>
            </aside>

            <!-- Settings panel -->
            <aside v-if="panel === 'settings'" class="vw-panel right-0 border-l" aria-label="Voice settings">
                <div class="flex items-center justify-between px-4 pb-2 pt-4">
                    <h2 class="text-sm font-medium">Voice settings</h2>
                    <button type="button" class="vw-icon-btn" aria-label="Close settings" @click="panel = null"><X class="size-4" /></button>
                </div>
                <div class="vw-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 text-sm">
                    <div class="grid gap-1.5">
                        <label for="auto-speak" class="vw-label">Read answers aloud</label>
                        <select id="auto-speak" v-model="settings.autoSpeak" class="vw-select" :disabled="!assistant.speechOutputSupported">
                            <option value="voice">When I asked by voice</option>
                            <option value="always">Always</option>
                            <option value="never">Never</option>
                        </select>
                    </div>
                    <div class="grid gap-1.5">
                        <label for="lang" class="vw-label">Language</label>
                        <select id="lang" v-model="settings.lang" class="vw-select">
                            <option v-for="lang in LANGUAGES" :key="lang.value" :value="lang.value">{{ lang.label }}</option>
                        </select>
                    </div>
                    <div class="grid gap-1.5">
                        <label for="voice" class="vw-label">Voice</label>
                        <select id="voice" v-model="settings.voiceURI" class="vw-select" :disabled="!assistant.speechOutputSupported">
                            <option value="">Browser default</option>
                            <option v-for="voice in voicesForLanguage" :key="voice.voiceURI" :value="voice.voiceURI">{{ voice.name }}</option>
                        </select>
                    </div>
                    <div class="grid gap-1.5">
                        <label for="rate" class="vw-label">Speaking speed · {{ settings.rate.toFixed(1) }}×</label>
                        <input id="rate" v-model.number="settings.rate" type="range" min="0.7" max="1.5" step="0.1" class="accent-cyan-400" />
                    </div>

                    <div class="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
                        <p class="font-medium text-slate-300">About browser voice</p>
                        <p>
                            Voice input: <span :class="assistant.speechInputSupported ? 'text-emerald-300' : 'text-amber-200'">{{ assistant.speechInputSupported ? 'available' : 'not available in this browser' }}</span>.
                            Voice output: <span :class="assistant.speechOutputSupported ? 'text-emerald-300' : 'text-amber-200'">{{ assistant.speechOutputSupported ? 'available' : 'not available' }}</span>.
                        </p>
                        <p>Speech uses your browser's built-in services. In Chrome and Edge, recognition audio is processed by the browser vendor's online speech service.</p>
                        <p>Browser voices sound more robotic than a dedicated neural voice service, and accuracy varies with accents, noise and microphone quality.</p>
                    </div>
                </div>
            </aside>
        </div>

        <div class="relative z-20 flex h-8 shrink-0 items-center border-t border-cyan-300/10 bg-slate-950/60">
            <EventTicker v-if="canUseFlows" :events="tickerEvents" class="min-w-0 flex-1 border-t-0" />
            <DeveloperCredit compact class="ml-auto shrink-0 px-3" />
        </div>
    </div>
</template>

<style scoped>
.voice-workspace {
    background: radial-gradient(120% 80% at 50% 0%, #0d1a33 0%, #070d1c 55%, #04070f 100%);
    color-scheme: dark;
}
/* Soft lights drifting slowly behind everything: ambient decoration only. */
.vw-glow {
    position: absolute;
    border-radius: 9999px;
    filter: blur(90px);
    opacity: 0.35;
    will-change: transform;
    animation: vw-drift-a 38s ease-in-out infinite alternate;
}
.vw-glow-a {
    width: 46rem;
    height: 46rem;
    left: calc(50% - 23rem);
    top: 4%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.38), transparent 65%);
}
.vw-glow-b {
    width: 30rem;
    height: 30rem;
    right: -10rem;
    bottom: -10rem;
    background: radial-gradient(circle, rgba(79, 70, 229, 0.3), transparent 70%);
    animation-name: vw-drift-b;
    animation-duration: 46s;
}
.vw-glow-c {
    width: 26rem;
    height: 26rem;
    left: -8rem;
    bottom: 10%;
    background: radial-gradient(circle, rgba(16, 185, 129, 0.16), transparent 70%);
    animation-name: vw-drift-c;
    animation-duration: 52s;
}
.vw-glow-d {
    width: 20rem;
    height: 20rem;
    right: 18%;
    top: 8%;
    opacity: 0.4;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.32), transparent 70%);
    animation-name: vw-drift-d;
    animation-duration: 34s;
}
@keyframes vw-drift-a {
    0% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-6vw, 4vh) scale(1.08); }
    100% { transform: translate(5vw, -3vh) scale(0.95); }
}
@keyframes vw-drift-b {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(-22vw, -30vh) scale(1.15); }
}
@keyframes vw-drift-c {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(24vw, -28vh) scale(1.1); }
}
@keyframes vw-drift-d {
    0% { transform: translate(0, 0) scale(0.9); }
    50% { transform: translate(-30vw, 30vh) scale(1.1); }
    100% { transform: translate(-50vw, 6vh) scale(1); }
}
.vw-grid {
    background-image:
        linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent);
}
.vw-orb {
    aspect-ratio: 1;
    border-radius: 9999px;
    cursor: pointer;
}
.vw-orb-listening {
    filter: drop-shadow(0 0 28px rgba(34, 211, 238, 0.35));
}
.vw-orb:disabled {
    cursor: default;
}
.vw-orb:focus-visible {
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.45);
}
.vw-state {
    text-shadow: 0 0 16px rgba(34, 211, 238, 0.55);
}
.vw-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 9999px;
    padding: 0.35rem 0.85rem;
    font-size: 12px;
    font-weight: 600;
    transition: background-color 0.15s;
}
/* Columns: a side column widens while one of its widgets is expanded. */
@media (min-width: 1024px) {
    .vw-cols-3,
    .vw-cols-right {
        --left-w: 17rem;
        --right-w: 17rem;
        transition: grid-template-columns 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .vw-cols-3 {
        grid-template-columns: var(--left-w) minmax(0, 1fr) var(--right-w);
    }
    .vw-cols-right {
        --right-w: 22rem;
        grid-template-columns: minmax(0, 1fr) var(--right-w);
    }
    .vw-cols-3[data-left-wide] {
        --left-w: 22rem;
    }
    .vw-cols-3[data-right-wide] {
        --right-w: 22rem;
    }
    .vw-cols-right[data-right-wide] {
        --right-w: 28rem;
    }
    .vw-rail {
        grid-template-rows: var(--rail-rows);
    }
}
@media (min-width: 1280px) {
    .vw-cols-3 {
        --left-w: 20rem;
        --right-w: 20rem;
    }
    .vw-cols-3[data-left-wide] {
        --left-w: 26rem;
    }
    .vw-cols-3[data-right-wide] {
        --right-w: 26rem;
    }
}
@media (max-width: 1023px) {
    .vw-rail > * {
        min-height: 15rem;
    }
    .vw-rail > [data-size='expanded'] {
        min-height: 24rem;
    }
    .vw-rail > [data-size='collapsed'] {
        min-height: 0;
    }
}
.vw-icon-btn {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.75rem;
    color: rgb(203 213 225);
    transition: background-color 0.15s;
}
.vw-icon-btn:hover,
.vw-icon-btn[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.08);
    color: rgb(165 243 252);
}
.vw-icon-btn:focus-visible {
    outline: 2px solid rgba(34, 211, 238, 0.5);
    outline-offset: 1px;
}
.vw-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 45;
    display: flex;
    width: min(22rem, 100%);
    flex-direction: column;
    border-color: rgba(255, 255, 255, 0.08);
    background: rgba(8, 14, 28, 0.96);
    box-shadow: 0 0 60px -10px rgba(2, 6, 23, 0.9);
}
.vw-composer {
    border: 1px solid rgba(125, 211, 252, 0.14);
    background: rgba(15, 23, 42, 0.7);
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.02) inset,
        0 20px 50px -20px rgba(14, 165, 233, 0.35);
}
.vw-composer:focus-within {
    border-color: rgba(34, 211, 238, 0.4);
}
.vw-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgb(148 163 184);
}
.vw-select {
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(15, 23, 42, 0.8);
    padding: 0.45rem 2rem 0.45rem 0.75rem;
    font-size: 0.875rem;
    color: rgb(226 232 240);
}
.vw-select:focus {
    border-color: rgba(34, 211, 238, 0.5);
    outline: none;
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.2);
}
.vw-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.25) transparent;
}
.vw-md :deep(p) {
    margin: 0 0 0.6rem;
}
.vw-md :deep(.md-heading) {
    font-weight: 600;
    color: rgb(224 242 254);
}
.vw-md :deep(ul),
.vw-md :deep(ol) {
    margin: 0 0 0.6rem;
    padding-left: 1.2rem;
}
.vw-md :deep(ul) {
    list-style: disc;
}
.vw-md :deep(ol) {
    list-style: decimal;
}
.vw-md :deep(li) {
    margin: 0.15rem 0;
}
.vw-md :deep(li::marker) {
    color: rgb(34 211 238);
}
.vw-md :deep(strong) {
    color: rgb(240 249 255);
    font-weight: 600;
}
.vw-md :deep(code) {
    border-radius: 0.3rem;
    background: rgba(255, 255, 255, 0.08);
    padding: 0.05rem 0.35rem;
    font-size: 0.85em;
}
@media (prefers-reduced-motion: reduce) {
    .vw-glow {
        animation: none;
    }
}
</style>

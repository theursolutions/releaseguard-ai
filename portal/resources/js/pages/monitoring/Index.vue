<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue';
import OrbitScene, { type OrbitNode, type OrbitStatus } from '@/components/OrbitScene.vue';
import Sparkline from '@/components/Sparkline.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePolling } from '@/composables/usePolling';
import AppLayout from '@/layouts/AppLayout.vue';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type AlarmDiagnosis, type AlarmSummary, type BreadcrumbItem, type MonitoringOverview, type SharedData } from '@/types';
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { Activity, BellRing, HardDrive, LoaderCircle, Pause, Play, RefreshCw, Sparkles, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
    overview: { data: MonitoringOverview | null; error: string | null };
    refreshSeconds: number;
    aiConnected: boolean;
    diagnoses: AlarmDiagnosis[];
    selected: AlarmDiagnosis | null;
}>();

const page = usePage<SharedData>();
const breadcrumbs: BreadcrumbItem[] = [{ title: 'Monitoring', href: '/monitoring' }];
const data = computed(() => props.overview.data);

/* ---------------- Live updates ---------------- */
const live = ref(true);
const lastUpdated = ref(Date.now());
const now = ref(Date.now());
const { refreshNow } = usePolling(live, ['overview'], props.refreshSeconds * 1000, () => (lastUpdated.value = Date.now()));
const clockTimer = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clockTimer));

const secondsAgo = computed(() => Math.max(0, Math.round((now.value - lastUpdated.value) / 1000)));
const countdown = computed(() => Math.min(1, (now.value - lastUpdated.value) / (props.refreshSeconds * 1000)));

/* ---------------- State-change detection (flash + toasts) ---------------- */
interface Toast {
    id: number;
    title: string;
    detail: string;
    tone: 'alarm' | 'ok';
}
const toasts = ref<Toast[]>([]);
const flashing = ref<Record<string, 'alarm' | 'ok'>>({});
let previousStates: Record<string, string> | null = null;
let toastId = 0;

function pushToast(toast: Omit<Toast, 'id'>) {
    const id = ++toastId;
    toasts.value = [{ ...toast, id }, ...toasts.value].slice(0, 4);
    setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), 7000);
}

watch(
    () => data.value?.alarms,
    (alarms) => {
        if (!alarms) return;
        const current = Object.fromEntries(alarms.map((a) => [a.name, a.state]));
        if (previousStates) {
            for (const alarm of alarms) {
                const before = previousStates[alarm.name];
                if (before && before !== alarm.state) {
                    const tone = alarm.state === 'ALARM' ? 'alarm' : 'ok';
                    flashing.value = { ...flashing.value, [alarm.name]: tone };
                    setTimeout(() => {
                        const { [alarm.name]: _removed, ...rest } = flashing.value;
                        flashing.value = rest;
                    }, 2400);
                    pushToast({
                        tone,
                        title: alarm.state === 'ALARM' ? `${alarm.severity === 'critical' ? 'Critical' : 'Warning'}: ${alarm.name}` : `Recovered: ${alarm.name}`,
                        detail: alarm.description || alarm.reason,
                    });
                }
            }
        }
        previousStates = current;
    },
    { immediate: true },
);

/* ---------------- 3D system map ---------------- */
const groups: { id: string; label: string; match: (a: AlarmSummary) => boolean }[] = [
    { id: 'db', label: 'Database', match: (a) => a.resource.startsWith('DBInstanceIdentifier') || a.metric.startsWith('AWS/RDS') },
    { id: 'web', label: 'Web server', match: (a) => a.resource.startsWith('InstanceId') || /AWS\/EC2|CWAgent/.test(a.metric) },
    { id: 'alb', label: 'Load balancer', match: (a) => a.resource.startsWith('LoadBalancer') || a.resource.startsWith('TargetGroup') },
    { id: 'uptime', label: 'Uptime', match: (a) => a.resource.startsWith('HealthCheckId') },
    { id: 'forecast', label: 'Disk forecast', match: (a) => a.metric.startsWith('ReleaseGuard/Forecast') },
];

function groupStatus(alarms: AlarmSummary[]): OrbitStatus {
    if (alarms.some((a) => a.state === 'ALARM' && a.severity === 'critical')) return 'critical';
    if (alarms.some((a) => a.state === 'ALARM')) return 'warning';
    if (alarms.every((a) => a.state === 'INSUFFICIENT_DATA')) return 'idle';
    return 'ok';
}

const orbitNodes = computed<OrbitNode[]>(() => {
    const alarms = data.value?.alarms ?? [];
    return groups
        .map((group) => ({ group, members: alarms.filter(group.match) }))
        .filter(({ members }) => members.length)
        .map(({ group, members }) => ({
            id: group.id,
            label: group.label,
            status: groupStatus(members),
            detail: `${members.filter((m) => m.state === 'ALARM').length} of ${members.length} in alarm`,
        }));
});

/* ---------------- Alarm list ---------------- */
type Filter = 'ALARM' | 'all' | 'OK' | 'INSUFFICIENT_DATA';
const filter = ref<Filter>('all');
const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'ALARM', label: 'In alarm' },
    { value: 'OK', label: 'OK' },
    { value: 'INSUFFICIENT_DATA', label: 'No data' },
];
const alarms = computed(() => {
    const list = data.value?.alarms ?? [];
    const filtered = filter.value === 'all' ? list : list.filter((alarm) => alarm.state === filter.value);
    const rank = (a: AlarmSummary) => (a.state === 'ALARM' ? (a.severity === 'critical' ? 0 : 1) : a.state === 'INSUFFICIENT_DATA' ? 2 : 3);
    return [...filtered].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
});
const sparkTone = (a: AlarmSummary) => (a.state === 'ALARM' ? (a.severity === 'critical' ? 'red' : 'amber') : a.state === 'OK' ? 'green' : 'blue');

/* ---------------- AI diagnosis ---------------- */
const diagnosing = computed(() => props.selected !== null && ['queued', 'running'].includes(props.selected.status));
usePolling(diagnosing, ['selected', 'diagnoses']);

const starting = ref<string | null>(null);
function diagnose(alarm: AlarmSummary) {
    starting.value = alarm.name;
    const { series: _series, ...summary } = alarm;
    router.post(route('monitoring.diagnose'), { alarm_name: alarm.name, alarm: summary as Record<string, string | null> }, { preserveScroll: true, onFinish: () => (starting.value = null) });
}
function openDiagnosis(id: number) {
    router.get(route('monitoring.index'), { diagnosis: id }, { preserveScroll: true, only: ['selected'] });
}

/* ---------------- Forecast rings ---------------- */
const forecastTone = (days: number | null) => (days === null ? 'slate' : days < 5 ? 'red' : days < 14 ? 'amber' : 'emerald');
const ringColor = { red: '#dc2626', amber: '#d97706', emerald: '#059669', slate: '#94a3b8' };
const forecastFill = (days: number | null) => (days === null ? 0 : Math.max(0.04, Math.min(1, days / 60)));

const mounted = ref(false);
onMounted(() => requestAnimationFrame(() => (mounted.value = true)));
</script>

<template>
    <Head title="Monitoring" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <!-- Hero: live 3D system map -->
            <Card class="reveal overflow-hidden">
                <div class="grid grid-cols-1 items-stretch lg:grid-cols-5">
                    <div class="flex flex-col justify-between gap-6 p-6 lg:col-span-2">
                        <div class="space-y-3">
                            <div class="flex flex-wrap items-center gap-2">
                                <span
                                    :class="
                                        cn(
                                            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide',
                                            live
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                                                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
                                        )
                                    "
                                >
                                    <span v-if="live" class="live-dot" aria-hidden="true" />
                                    {{ live ? 'LIVE' : 'PAUSED' }}
                                </span>
                                <span v-if="data?.demo" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">DEMO DATA</span>
                            </div>
                            <h1 class="text-3xl font-semibold tracking-tight">System health</h1>
                            <p class="max-w-md text-sm text-muted-foreground">
                                CloudWatch alarms for the database, web servers, load balancer and uptime, refreshed every {{ refreshSeconds }} seconds. Ask the AI to explain any alarm.
                            </p>
                        </div>

                        <div class="flex flex-wrap items-center gap-3">
                            <Button size="sm" variant="outline" class="bg-white/70 dark:bg-background" @click="live = !live">
                                <Pause v-if="live" class="size-4" /><Play v-else class="size-4" />
                                {{ live ? 'Pause' : 'Resume' }}
                            </Button>
                            <Button size="sm" variant="outline" class="bg-white/70 dark:bg-background" @click="refreshNow">
                                <RefreshCw class="size-4" /> Refresh now
                            </Button>
                            <div class="flex items-center gap-2 text-xs text-muted-foreground" aria-live="off">
                                <svg viewBox="0 0 20 20" class="size-5 -rotate-90" aria-hidden="true">
                                    <circle cx="10" cy="10" r="8" fill="none" stroke-width="2.5" class="stroke-slate-200 dark:stroke-slate-700" />
                                    <circle
                                        cx="10"
                                        cy="10"
                                        r="8"
                                        fill="none"
                                        stroke-width="2.5"
                                        stroke-linecap="round"
                                        class="stroke-blue-600 transition-[stroke-dashoffset] dark:stroke-cyan-400 duration-1000 ease-linear"
                                        :stroke-dasharray="50.27"
                                        :stroke-dashoffset="50.27 * (1 - (live ? countdown : 0))"
                                    />
                                </svg>
                                Updated {{ secondsAgo < 2 ? 'just now' : `${secondsAgo}s ago` }}
                            </div>
                        </div>

                        <div v-if="data" class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                            <div
                                v-for="(tile, i) in [
                                    { label: 'Critical', value: data.counts.critical, cls: 'text-red-600 dark:text-red-400' },
                                    { label: 'In alarm', value: data.counts.ALARM, cls: 'text-amber-600 dark:text-amber-400' },
                                    { label: 'OK', value: data.counts.OK, cls: 'text-emerald-600 dark:text-emerald-400' },
                                    { label: 'No data', value: data.counts.INSUFFICIENT_DATA, cls: 'text-slate-500 dark:text-slate-400' },
                                ]"
                                :key="tile.label"
                                v-tilt="{ max: 10 }"
                                class="reveal relative rounded-xl border border-white/80 bg-white/70 px-3 py-2.5 shadow-sm dark:border-slate-400/10 dark:bg-slate-900/60"
                                :style="{ '--i': i + 1 }"
                            >
                                <span class="tilt-glare" />
                                <p class="text-xs text-muted-foreground">{{ tile.label }}</p>
                                <p :class="['text-2xl font-semibold', tile.cls]"><AnimatedNumber :value="tile.value" /></p>
                            </div>
                        </div>
                    </div>

                    <OrbitScene :nodes="orbitNodes" class="h-[320px] lg:col-span-3 lg:h-[420px]" />
                </div>
            </Card>

            <div v-if="overview.error" class="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
                {{ overview.error }}
            </div>
            <div v-if="data?.demo" class="reveal rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900 backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-100" style="--i: 2">
                <strong>Demo data.</strong> AWS is not connected, so these alarms are simulated and change every few minutes to show live updates.
                <Link v-if="page.props.auth.isAdmin" :href="route('connections.index')" class="font-medium underline">Connect AWS</Link> to see your real alarms.
            </div>

            <template v-if="data">
                <!-- Forecast rings -->
                <div v-if="data.forecasts.length" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Card v-for="(forecast, i) in data.forecasts" :key="forecast.resource" v-tilt class="reveal" :style="{ '--i': i + 3 }">
                        <span class="tilt-glare" />
                        <CardContent class="flex items-center gap-4 pt-6">
                            <div class="relative size-16 shrink-0">
                                <svg viewBox="0 0 64 64" class="size-16 -rotate-90" aria-hidden="true">
                                    <circle cx="32" cy="32" r="26" fill="none" stroke-width="7" class="stroke-slate-200/80 dark:stroke-slate-700/80" />
                                    <circle
                                        cx="32"
                                        cy="32"
                                        r="26"
                                        fill="none"
                                        stroke-width="7"
                                        stroke-linecap="round"
                                        :stroke="ringColor[forecastTone(forecast.days)]"
                                        :stroke-dasharray="163.4"
                                        :stroke-dashoffset="163.4 * (1 - (mounted ? forecastFill(forecast.days) : 0))"
                                        class="transition-[stroke-dashoffset] duration-1000 ease-out"
                                    />
                                </svg>
                                <HardDrive class="absolute inset-0 m-auto size-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                            </div>
                            <div>
                                <p class="text-sm text-muted-foreground">{{ forecast.label }}</p>
                                <p class="text-lg font-semibold" :style="{ color: ringColor[forecastTone(forecast.days)] }">
                                    <template v-if="forecast.days === null">Not enough data</template>
                                    <template v-else-if="forecast.days >= 365">Not filling up</template>
                                    <template v-else>Full in <AnimatedNumber :value="forecast.days" :decimals="1" /> days</template>
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div class="grid grid-cols-1 gap-6 xl:grid-cols-5">
                    <!-- Alarm list -->
                    <Card class="reveal xl:col-span-3" style="--i: 5">
                        <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                            <CardTitle class="flex items-center gap-2 text-base"><Activity class="size-4 text-blue-600 dark:text-cyan-400" aria-hidden="true" /> Alarms</CardTitle>
                            <div role="tablist" aria-label="Filter alarms" class="flex gap-1 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-800/60">
                                <button
                                    v-for="option in filters"
                                    :key="option.value"
                                    type="button"
                                    role="tab"
                                    :aria-selected="filter === option.value"
                                    :class="
                                        cn(
                                            'rounded-lg px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            filter === option.value
                                                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                                                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                                        )
                                    "
                                    @click="filter = option.value"
                                >
                                    {{ option.label }}
                                </button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <TransitionGroup v-if="alarms.length" name="list" tag="ul" class="relative divide-y divide-slate-200/70 dark:divide-slate-700/50">
                                <li
                                    v-for="alarm in alarms"
                                    :key="alarm.name"
                                    :class="cn('-mx-3 flex flex-col gap-3 rounded-lg px-3 py-3 sm:flex-row sm:items-center', flashing[alarm.name] === 'alarm' && 'flash-alarm', flashing[alarm.name] === 'ok' && 'flash-ok')"
                                >
                                    <div class="min-w-0 flex-1 space-y-1">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <StatusBadge :status="alarm.state === 'ALARM' ? alarm.severity : alarm.state" />
                                            <!-- min-w-0 + max-w-full let long names truncate instead of widening the page on phones. -->
                                            <span class="min-w-0 max-w-full truncate text-sm font-medium">{{ alarm.name }}</span>
                                        </div>
                                        <p class="text-xs text-muted-foreground">{{ alarm.description || alarm.reason }}</p>
                                        <p class="text-xs text-muted-foreground">{{ alarm.resource }} · since {{ timeAgo(alarm.updated_at) }}</p>
                                    </div>
                                    <Sparkline v-if="alarm.series?.length" :values="alarm.series" :tone="sparkTone(alarm)" :label="`${alarm.metric}, last hour`" class="shrink-0" />
                                    <Button
                                        v-if="alarm.state === 'ALARM'"
                                        size="sm"
                                        class="shrink-0 bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-blue-600/20 hover:opacity-95"
                                        :disabled="starting !== null || diagnosing"
                                        @click="diagnose(alarm)"
                                    >
                                        <LoaderCircle v-if="starting === alarm.name" class="size-4 animate-spin" />
                                        <Sparkles v-else class="size-4" />
                                        AI explain
                                    </Button>
                                </li>
                            </TransitionGroup>
                            <p v-else class="py-8 text-center text-sm text-muted-foreground">
                                {{ filter === 'ALARM' ? 'Nothing is in alarm right now.' : 'No alarms match this filter.' }}
                            </p>
                        </CardContent>
                    </Card>

                    <div class="flex flex-col gap-4 xl:col-span-2">
                        <!-- AI diagnosis -->
                        <Card v-if="selected" class="reveal overflow-hidden" aria-live="polite">
                            <div class="h-1 w-full bg-gradient-to-r from-blue-600 via-violet-500 to-cyan-400" :class="diagnosing && 'animate-pulse'" />
                            <CardHeader>
                                <CardTitle class="flex items-center gap-2 text-base"><Sparkles class="size-4 text-violet-600 dark:text-violet-400" aria-hidden="true" /> AI diagnosis</CardTitle>
                                <CardDescription class="break-all">{{ selected.alarm_name }}</CardDescription>
                            </CardHeader>
                            <CardContent class="space-y-4 text-sm">
                                <div v-if="diagnosing" class="space-y-3">
                                    <p class="flex items-center gap-2 text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Reading metrics and logs and asking the AI…</p>
                                    <div v-for="n in 3" :key="n" class="h-3 animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/60" :style="{ width: `${100 - n * 15}%` }" />
                                </div>
                                <p v-else-if="selected.status === 'failed'" class="text-red-700 dark:text-red-400">{{ selected.error }}</p>
                                <template v-else-if="selected.result">
                                    <p v-if="selected.result.canned" class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">Sample answer: connect an AI provider to get a real diagnosis.</p>
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs text-muted-foreground">Confidence</span>
                                        <StatusBadge :status="selected.result.confidence === 'high' ? 'ready' : selected.result.confidence === 'medium' ? 'warning' : 'not_configured'" :label="selected.result.confidence" />
                                    </div>
                                    <p class="font-medium">{{ selected.result.summary }}</p>
                                    <div>
                                        <p class="font-medium">Probable cause</p>
                                        <p class="text-muted-foreground">{{ selected.result.probable_cause }}</p>
                                    </div>
                                    <div>
                                        <p class="font-medium">Impact</p>
                                        <p class="text-muted-foreground">{{ selected.result.impact }}</p>
                                    </div>
                                    <div v-if="selected.result.evidence.length">
                                        <p class="font-medium">Evidence</p>
                                        <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
                                            <li v-for="(item, i) in selected.result.evidence" :key="i">{{ item }}</li>
                                        </ul>
                                    </div>
                                    <div v-if="selected.result.next_steps.length">
                                        <p class="font-medium">Next steps</p>
                                        <ol class="list-decimal space-y-1 pl-5">
                                            <li v-for="(step, i) in selected.result.next_steps" :key="i">{{ step }}</li>
                                        </ol>
                                    </div>
                                    <p v-if="selected.result.is_likely_false_alarm" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                                        This looks like a likely false alarm. Check the evidence before acting.
                                    </p>
                                    <p class="text-xs text-muted-foreground">AI-generated from metrics and logs. Verify before acting.</p>
                                </template>
                            </CardContent>
                        </Card>

                        <Card class="reveal" style="--i: 6">
                            <CardHeader>
                                <CardTitle class="text-base">Recent diagnoses</CardTitle>
                                <CardDescription v-if="!aiConnected">No AI provider is connected, so diagnoses use sample answers.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul v-if="diagnoses.length" class="divide-y divide-slate-200/70 dark:divide-slate-700/50">
                                    <li v-for="item in diagnoses" :key="item.id">
                                        <button
                                            type="button"
                                            class="-mx-2 flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/70 focus-visible:outline-none dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
                                            @click="openDiagnosis(item.id)"
                                        >
                                            <span class="min-w-0">
                                                <span class="block truncate text-sm">{{ item.alarm_name }}</span>
                                                <span class="text-xs text-muted-foreground">{{ item.user?.name }} · {{ timeAgo(item.created_at) }}{{ item.is_demo ? ' · demo' : '' }}</span>
                                            </span>
                                            <StatusBadge :status="item.status" />
                                        </button>
                                    </li>
                                </ul>
                                <p v-else class="py-4 text-center text-sm text-muted-foreground">No diagnoses yet. Click "AI explain" on an alarm.</p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </template>
        </div>

        <!-- Live change notifications -->
        <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
            <TransitionGroup name="toast">
                <div
                    v-for="toast in toasts"
                    :key="toast.id"
                    :class="
                        cn(
                            'pointer-events-auto flex items-start gap-3 rounded-xl border bg-white/90 p-3 shadow-xl backdrop-blur-xl dark:bg-slate-900/95',
                            toast.tone === 'alarm'
                                ? 'border-red-200 shadow-red-500/10 dark:border-red-900/60'
                                : 'border-emerald-200 shadow-emerald-500/10 dark:border-emerald-900/60',
                        )
                    "
                >
                    <BellRing :class="cn('mt-0.5 size-4 shrink-0', toast.tone === 'alarm' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')" aria-hidden="true" />
                    <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">{{ toast.title }}</p>
                        <p class="line-clamp-2 text-xs text-muted-foreground">{{ toast.detail }}</p>
                    </div>
                    <button type="button" class="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Dismiss" @click="toasts = toasts.filter((t) => t.id !== toast.id)">
                        <X class="size-4" />
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </AppLayout>
</template>

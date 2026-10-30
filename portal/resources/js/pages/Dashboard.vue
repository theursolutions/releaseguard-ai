<script setup lang="ts">
import EChart from '@/components/charts/EChart.vue';
import KpiTile from '@/components/charts/KpiTile.vue';
import OrbitScene, { type OrbitNode, type OrbitStatus } from '@/components/OrbitScene.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePerformance } from '@/composables/usePerformance';
import AppLayout from '@/layouts/AppLayout.vue';
import { categoryAxis, compact, glow, hexToRgba, isDark, PALETTE, valueAxis, type ChartOption } from '@/lib/charts';
import { timeAgo } from '@/lib/format';
import { type BreadcrumbItem, type JobStatus, type SharedData } from '@/types';
import { Head, Link, usePage } from '@inertiajs/vue3';
import { Activity, ArrowRight, AudioLines, BadgeDollarSign, FileSearch, Gauge, Handshake, Percent, PlugZap, ShieldCheck, Siren, Users } from 'lucide-vue-next';
import { computed, onMounted } from 'vue';

const props = defineProps<{
    prd: {
        total: number;
        average_score: number;
        ready: number;
        not_ready: number;
        recent: { id: number; title: string; status: JobStatus; score: number | null; created_at: string }[];
        scores: { score: number; created_at: string }[];
    };
    monitoring: {
        diagnoses: number;
        recent: { id: number; alarm_name: string; status: JobStatus; is_demo: boolean; created_at: string }[];
        available: boolean;
        demo: boolean;
        counts: { ALARM: number; OK: number; INSUFFICIENT_DATA: number; critical: number } | null;
        alarms: { name: string; severity: string; resource: string }[];
    };
    connections: { type: string; label: string; status: string }[];
    readyScore: number;
    showBusiness: boolean;
}>();

const page = usePage<SharedData>();
const breadcrumbs: BreadcrumbItem[] = [{ title: 'Command center', href: '/dashboard' }];
const firstName = computed(() => page.props.auth.user.name.split(' ')[0]);

/* ---------------- Business pulse (executives) ---------------- */
const performance = usePerformance();
onMounted(() => {
    if (props.showBusiness) void performance.load();
});
const biz = computed(() => performance.data.value);
const currency = computed(() => biz.value?.currency.primary ?? '');
const kpi = (name: string) => biz.value?.kpis[name] ?? { value: 0 };

const pulseOption = computed<ChartOption>(() => {
    const trend = biz.value?.revenue_trend ?? [];
    return {
        grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${currency.value} ${compact(v, 2)}` },
        xAxis: categoryAxis(trend.map((t) => new Date(t.bucket).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })), { boundaryGap: false }),
        yAxis: valueAxis({ minInterval: 1, axisLabel: { formatter: (v: number) => compact(v) } }),
        series: [
            { name: 'Won', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.won), lineStyle: { width: 2.5, color: PALETTE.cyan, shadowBlur: 12, shadowColor: hexToRgba(PALETTE.cyan, 0.6) }, areaStyle: { color: glow(PALETTE.cyan, 0.38) }, itemStyle: { color: PALETTE.cyan } },
            { name: 'Lost', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.lost), lineStyle: { width: 1.5, type: 'dashed', color: PALETTE.rose }, itemStyle: { color: PALETTE.rose } },
        ],
    };
});

/* ---------------- Product health ---------------- */
const connectionStatus = (status: string): OrbitStatus =>
    status === 'connected' ? 'ok' : status === 'failed' ? 'critical' : status === 'untested' ? 'warning' : 'idle';
const shortLabels: Record<string, string> = { ai: 'AI in use', anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI', openai_compatible: 'Compatible AI', atlassian: 'Jira & Confluence', slack: 'Slack', aws: 'AWS', crm_db: 'CRM database' };
// The orbit shows systems that are set up, plus the core ones even when they are not.
const orbitNodes = computed<OrbitNode[]>(() =>
    props.connections
        .filter((c) => c.status !== 'not_configured' || ['anthropic', 'aws', 'crm_db', 'atlassian'].includes(c.type))
        .map((c) => ({ id: c.type, label: shortLabels[c.type] ?? c.label, status: connectionStatus(c.status), detail: c.status.replace('_', ' ') })),
);
const connectedCount = computed(() => props.connections.filter((c) => c.status === 'connected').length);
const alarmCounts = computed(() => props.monitoring.counts ?? { ALARM: 0, OK: 0, INSUFFICIENT_DATA: 0, critical: 0 });
const systemState = computed(() => (alarmCounts.value.critical ? 'critical' : alarmCounts.value.ALARM ? 'warning' : 'ok'));

const readinessOption = computed<ChartOption>(() => ({
    series: [{
        type: 'gauge', startAngle: 220, endAngle: -40, min: 0, max: 100, radius: '95%', center: ['50%', '58%'],
        progress: { show: true, width: 11, roundCap: true, itemStyle: { color: glow(props.prd.average_score >= props.readyScore ? PALETTE.emerald : PALETTE.amber, 1, 0.6) } },
        axisLine: { roundCap: true, lineStyle: { width: 11, color: [[1, isDark() ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.15)']] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        title: { offsetCenter: [0, '40%'], color: isDark() ? '#94a3b8' : '#475569', fontSize: 11 },
        detail: { valueAnimation: true, offsetCenter: [0, '0%'], formatter: '{value}', color: isDark() ? '#e2e8f0' : '#0f172a', fontSize: 28, fontWeight: 600 },
        data: [{ value: props.prd.total ? props.prd.average_score : 0, name: 'avg readiness' }],
    }],
}));

const scoreTrendOption = computed<ChartOption>(() => ({
    grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: categoryAxis(props.prd.scores.map((s) => new Date(s.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))),
    yAxis: valueAxis({ min: 0, max: 100 }),
    series: [{
        name: 'Readiness', type: 'bar', data: props.prd.scores.map((s) => ({ value: s.score, itemStyle: { color: s.score >= props.readyScore ? glow(PALETTE.emerald, 0.95, 0.35) : glow(PALETTE.amber, 0.95, 0.35), borderRadius: [4, 4, 0, 0] } })),
        barMaxWidth: 14,
        markLine: { symbol: 'none', silent: true, lineStyle: { color: PALETTE.cyan, type: 'dashed' }, label: { formatter: 'sprint-ready', color: PALETTE.cyan }, data: [{ yAxis: props.readyScore }] },
    }],
}));

const alarmOption = computed<ChartOption>(() => ({
    tooltip: { trigger: 'item' },
    series: [{
        type: 'pie', radius: ['62%', '84%'], center: ['50%', '50%'], padAngle: 3,
        itemStyle: { borderRadius: 6 },
        label: { show: true, position: 'center', formatter: () => `${alarmCounts.value.ALARM}\nin alarm`, color: isDark() ? '#e2e8f0' : '#0f172a', fontSize: 18, fontWeight: 600, lineHeight: 22 },
        data: [
            { name: 'Critical', value: alarmCounts.value.critical, itemStyle: { color: PALETTE.rose } },
            { name: 'Warning', value: Math.max(0, alarmCounts.value.ALARM - alarmCounts.value.critical), itemStyle: { color: PALETTE.amber } },
            { name: 'OK', value: alarmCounts.value.OK, itemStyle: { color: PALETTE.emerald } },
            { name: 'No data', value: alarmCounts.value.INSUFFICIENT_DATA, itemStyle: { color: PALETTE.slate } },
        ],
    }],
}));
</script>

<template>
    <Head title="Command center" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-5 p-4 md:p-6">
            <!-- Hero -->
            <Card class="edge-glow reveal overflow-hidden">
                <div class="grid grid-cols-1 items-stretch lg:grid-cols-5">
                    <div class="flex flex-col justify-center gap-5 p-6 md:p-8 lg:col-span-2">
                        <p class="hud-label flex items-center gap-2">
                            <span class="live-dot" :class="systemState === 'critical' ? '!bg-rose-500 after:!bg-rose-500' : systemState === 'warning' ? '!bg-amber-400 after:!bg-amber-400' : ''" />
                            {{ systemState === 'critical' ? 'Critical alarms need attention' : systemState === 'warning' ? 'Alarms active' : 'All systems normal' }}
                        </p>
                        <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Good to see you, <span class="shimmer-text">{{ firstName }}</span></h1>
                        <p class="max-w-md text-sm text-muted-foreground">
                            Everything that matters in one place: business performance, requirement readiness and production health. {{ connectedCount }} of
                            {{ connections.length }} integrations are connected.
                        </p>
                        <div class="flex flex-wrap gap-2">
                            <Button as-child class="bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 hover:opacity-95">
                                <Link href="/assistant"><AudioLines class="size-4" /> Ask the assistant</Link>
                            </Button>
                            <Button v-if="showBusiness" as-child variant="outline" class="bg-background/40">
                                <Link href="/performance"><Gauge class="size-4" /> Performance</Link>
                            </Button>
                            <Button as-child variant="outline" class="bg-background/40">
                                <Link :href="route('monitoring.index')"><Activity class="size-4" /> Live monitoring</Link>
                            </Button>
                        </div>
                    </div>
                    <OrbitScene :nodes="orbitNodes" core-label="ReleaseGuard" class="h-[300px] lg:col-span-3 lg:h-[380px]" />
                </div>
            </Card>

            <!-- Business pulse -->
            <template v-if="showBusiness">
                <div class="flex items-end justify-between gap-2">
                    <div>
                        <p class="hud-label">Business pulse · last 30 days</p>
                        <p v-if="biz?.demo" class="text-xs text-amber-300">Demo figures: the CRM database is not connected.</p>
                        <p v-else-if="performance.error.value" class="text-xs text-rose-300">{{ performance.error.value }}</p>
                    </div>
                    <Link href="/performance" class="flex items-center gap-1 text-sm text-primary hover:underline">Full performance view <ArrowRight class="size-3.5" /></Link>
                </div>
                <div class="grid grid-cols-1 gap-4 xl:grid-cols-5">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-2">
                        <KpiTile label="Won revenue" format="money" :currency="currency" :value="kpi('won_revenue').value" :change-pct="kpi('won_revenue').change_pct" :icon="BadgeDollarSign" tone="cyan" />
                        <KpiTile label="Deals closed" :value="kpi('deals_closed').value" :change-pct="kpi('deals_closed').change_pct" :icon="Handshake" tone="violet" />
                        <KpiTile label="New leads" :value="kpi('leads').value" :change-pct="kpi('leads').change_pct" :icon="Users" tone="emerald" />
                        <KpiTile label="Win rate" format="percent" :value="kpi('win_rate').value" :icon="Percent" tone="amber" />
                    </div>
                    <Card class="edge-glow min-w-0 p-4 xl:col-span-3">
                        <p class="hud-label">Revenue pulse</p>
                        <div class="mt-1 h-60"><EChart :option="pulseOption" label="Won and lost revenue, last 30 days" /></div>
                    </Card>
                </div>
            </template>

            <!-- Product health -->
            <p class="hud-label">Product health</p>
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card class="edge-glow reveal min-w-0 p-4" style="--i: 2">
                    <div class="flex items-start justify-between">
                        <div>
                            <p class="hud-label flex items-center gap-1.5"><FileSearch class="size-3.5" /> Requirement readiness</p>
                            <p class="text-sm text-muted-foreground">{{ prd.ready }} sprint-ready · {{ prd.not_ready }} need work</p>
                        </div>
                        <Button as-child size="sm" variant="outline" class="bg-background/40"><Link :href="route('prd.index')">Review</Link></Button>
                    </div>
                    <div class="grid grid-cols-5 items-center gap-2">
                        <div class="col-span-2 h-40"><EChart :option="readinessOption" label="Average PRD readiness" /></div>
                        <div class="col-span-3 h-40">
                            <EChart v-if="prd.scores.length" :option="scoreTrendOption" label="Recent PRD readiness scores" />
                            <p v-else class="grid h-full place-items-center text-xs text-muted-foreground">No completed reviews yet.</p>
                        </div>
                    </div>
                </Card>

                <Card class="edge-glow reveal min-w-0 p-4" style="--i: 3">
                    <div class="flex items-start justify-between">
                        <div>
                            <p class="hud-label flex items-center gap-1.5"><Siren class="size-3.5" /> Production alarms</p>
                            <p class="text-sm text-muted-foreground">{{ monitoring.demo ? 'Demo alarms (AWS not connected)' : monitoring.available ? 'Live CloudWatch status' : 'Monitoring unavailable' }}</p>
                        </div>
                        <Button as-child size="sm" variant="outline" class="bg-background/40"><Link :href="route('monitoring.index')">Open</Link></Button>
                    </div>
                    <div class="grid grid-cols-5 items-center gap-2">
                        <div class="col-span-2 h-40"><EChart :option="alarmOption" label="Alarm states" /></div>
                        <ul class="col-span-3 space-y-1.5 text-xs">
                            <li v-for="alarm in monitoring.alarms" :key="alarm.name" class="flex items-center gap-2">
                                <span class="size-2 shrink-0 rounded-full" :class="alarm.severity === 'critical' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.9)]' : 'bg-amber-400'" />
                                <span class="min-w-0 truncate">{{ alarm.name }}</span>
                            </li>
                            <li v-if="!monitoring.alarms.length" class="flex items-center gap-2 text-emerald-400"><ShieldCheck class="size-4" /> No alarms firing</li>
                        </ul>
                    </div>
                </Card>

                <Card class="edge-glow reveal min-w-0 p-4" style="--i: 4">
                    <p class="hud-label flex items-center gap-1.5"><PlugZap class="size-3.5" /> Integrations</p>
                    <ul class="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                        <li v-for="connection in connections" :key="connection.type" class="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/30 px-2.5 py-1.5 text-xs">
                            <span class="min-w-0 truncate">{{ shortLabels[connection.type] ?? connection.label }}</span>
                            <StatusBadge :status="connection.status" />
                        </li>
                    </ul>
                    <Button v-if="page.props.auth.isAdmin" as-child variant="link" size="sm" class="mt-1 px-0"><Link :href="route('connections.index')">Manage connections</Link></Button>
                </Card>
            </div>

            <!-- Activity -->
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card class="edge-glow reveal min-w-0 p-4" style="--i: 5">
                    <p class="hud-label">Latest PRD reviews</p>
                    <ul v-if="prd.recent.length" class="mt-2 divide-y divide-border/50">
                        <li v-for="item in prd.recent" :key="item.id">
                            <Link :href="route('prd.show', { analysis: item.id })" class="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-all hover:translate-x-1 hover:bg-cyan-400/5">
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-medium">{{ item.title }}</p>
                                    <p class="text-xs text-muted-foreground">{{ timeAgo(item.created_at) }}</p>
                                </div>
                                <span v-if="item.status === 'completed' && item.score !== null" class="text-sm font-semibold tabular-nums" :class="item.score >= readyScore ? 'text-emerald-400' : 'text-amber-300'">{{ item.score }}/100</span>
                                <StatusBadge v-else :status="item.status" />
                            </Link>
                        </li>
                    </ul>
                    <p v-else class="py-8 text-center text-sm text-muted-foreground">No reviews yet. Upload your first PRD to see how ready it is.</p>
                </Card>
                <Card class="edge-glow reveal min-w-0 p-4" style="--i: 6">
                    <p class="hud-label">Latest AI alarm diagnoses</p>
                    <ul v-if="monitoring.recent.length" class="mt-2 divide-y divide-border/50">
                        <li v-for="item in monitoring.recent" :key="item.id" class="flex items-center justify-between gap-2 py-2.5 text-sm">
                            <div class="min-w-0">
                                <p class="truncate font-medium">{{ item.alarm_name }}</p>
                                <p class="text-xs text-muted-foreground">{{ timeAgo(item.created_at) }}<span v-if="item.is_demo"> · demo</span></p>
                            </div>
                            <StatusBadge :status="item.status" />
                        </li>
                    </ul>
                    <p v-else class="py-8 text-center text-sm text-muted-foreground">No diagnoses yet. Click "AI explain" on an alarm.</p>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

<script setup lang="ts">
import EChart from '@/components/charts/EChart.vue';
import KpiTile from '@/components/charts/KpiTile.vue';
import { Card } from '@/components/ui/card';
import { usePerformance, type LeaderboardRow, type Period } from '@/composables/usePerformance';
import AppLayout from '@/layouts/AppLayout.vue';
import { categoryAxis, compact, glow, hexToRgba, isDark, legend, PALETTE, SERIES_COLORS, valueAxis, type ChartOption } from '@/lib/charts';
import { type BreadcrumbItem } from '@/types';
import { Head } from '@inertiajs/vue3';
import {
    BadgeDollarSign,
    Building2,
    ChevronRight,
    CircleAlert,
    Handshake,
    Home,
    LoaderCircle,
    MessageSquareText,
    Percent,
    RefreshCw,
    Target,
    TrendingDown,
    Users,
    Wallet,
} from 'lucide-vue-next';
import { computed, defineAsyncComponent, onMounted } from 'vue';

// three.js is heavy: the galaxy loads as its own chunk.
const PerformanceGalaxy = defineAsyncComponent(() => import('@/components/three/PerformanceGalaxy.vue'));

const props = defineProps<{
    viewer: { kind: 'executive' | 'crm'; persona: string; agency: string | null; name: string };
    crmConnected: boolean;
}>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Performance', href: '/performance' }];
const { filters, data, loading, error, loadedAt, load } = usePerformance();
onMounted(load);

const PERIODS: { key: Period; label: string }[] = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
    { key: '12m', label: '12M' },
    { key: 'all', label: 'All' },
];
const PERSONAS: Record<string, string> = {
    executive: 'Executive view · all agencies',
    moderator: 'Moderator view · all agencies',
    agency_owner: 'Agency owner',
    agency_admin: 'Agency admin',
    agent: 'Agent',
    independent: 'Independent agent',
};

const currency = computed(() => data.value?.currency.primary ?? '');
const level = computed(() => data.value?.scope.level ?? 'global');
const kpi = (name: string) => data.value?.kpis[name] ?? { value: 0 };
const canDrillAgencies = computed(() => !!data.value?.directory.agencies);
const agents = computed(() => data.value?.directory.agents ?? []);

// Breadcrumb trail for drill-down (only within what the viewer may see).
const trail = computed(() => {
    const items: { label: string; action: () => void }[] = [];
    if (props.viewer.kind === 'executive' || props.viewer.persona === 'moderator') {
        items.push({ label: 'All agencies', action: () => Object.assign(filters, { agency_id: null, agent_user_id: null }) });
    }
    if (filters.agency_id || ['agency_owner', 'agency_admin'].includes(props.viewer.persona)) {
        const name = filters.agency_id ? (data.value?.scope.agency_name ?? 'Agency') : (props.viewer.agency ?? 'Your agency');
        items.push({ label: name, action: () => (filters.agent_user_id = null) });
    }
    if (filters.agent_user_id && data.value) items.push({ label: data.value.scope.label, action: () => undefined });
    return items;
});

function openAgency(id: number) {
    Object.assign(filters, { agency_id: id, agent_user_id: null });
}
function selectAgency(value: string) {
    Object.assign(filters, { agency_id: value ? Number(value) : null, agent_user_id: null });
}
function openAgent(row: { user_id: number }) {
    filters.agent_user_id = row.user_id;
}

/* ---------------- Charts ---------------- */
const shortBucket = (bucket: string) => {
    if (bucket.length === 7) return new Date(`${bucket}-01`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    return new Date(bucket).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const revenueOption = computed<ChartOption>(() => {
    const trend = data.value?.revenue_trend ?? [];
    return {
        legend: legend({ top: 0, right: 0 }),
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${currency.value} ${compact(v, 2)}` },
        xAxis: categoryAxis(trend.map((t) => shortBucket(t.bucket)), { boundaryGap: false }),
        yAxis: [valueAxis({ minInterval: 1, axisLabel: { formatter: (v: number) => compact(v) } }), valueAxis({ minInterval: 1, splitLine: { show: false }, axisLabel: { show: false } })],
        series: [
            { name: 'Won revenue', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.won), lineStyle: { width: 2.5, color: PALETTE.cyan, shadowBlur: 14, shadowColor: hexToRgba(PALETTE.cyan, 0.6) }, itemStyle: { color: PALETTE.cyan }, areaStyle: { color: glow(PALETTE.cyan, 0.4) } },
            { name: 'Lost revenue', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.lost), lineStyle: { width: 1.5, type: 'dashed', color: PALETTE.rose }, itemStyle: { color: PALETTE.rose }, areaStyle: { color: glow(PALETTE.rose, 0.12) } },
            { name: 'Deals', type: 'bar', yAxisIndex: 1, data: trend.map((t) => t.deals), barMaxWidth: 10, itemStyle: { color: hexToRgba(PALETTE.violet, 0.45), borderRadius: [4, 4, 0, 0] }, tooltip: { valueFormatter: (v: number) => `${v}` } },
        ],
    };
});

const leadTrendOption = computed<ChartOption>(() => {
    const trend = data.value?.lead_trend ?? [];
    return {
        legend: legend({ top: 0, right: 0 }),
        tooltip: { trigger: 'axis' },
        xAxis: categoryAxis(trend.map((t) => shortBucket(t.bucket))),
        yAxis: valueAxis({ minInterval: 1 }),
        series: [
            { name: 'New leads', type: 'bar', stack: 'l', data: trend.map((t) => t.created), barMaxWidth: 14, itemStyle: { color: glow(PALETTE.sky, 0.9, 0.35), borderRadius: [3, 3, 0, 0] } },
            { name: 'Won', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.won), lineStyle: { color: PALETTE.emerald, width: 2 }, itemStyle: { color: PALETTE.emerald } },
            { name: 'Lost', type: 'line', smooth: true, showSymbol: false, data: trend.map((t) => t.lost), lineStyle: { color: PALETTE.rose, width: 1.5, type: 'dashed' }, itemStyle: { color: PALETTE.rose } },
        ],
    };
});

const funnelOption = computed<ChartOption>(() => {
    const open = (data.value?.funnel ?? []).filter((f) => f.code !== 'lost');
    return {
        tooltip: { trigger: 'item', formatter: '{b}: {c} leads' },
        series: [{
            type: 'funnel', left: '6%', right: '6%', top: 10, bottom: 10, minSize: '12%', sort: 'none', gap: 3,
            label: { show: true, position: 'inside', color: '#e2e8f0', formatter: '{b}  {c}', fontSize: 12 },
            itemStyle: { borderWidth: 0, shadowBlur: 18, shadowColor: hexToRgba(PALETTE.cyan, 0.35) },
            data: open.map((f, i) => ({ name: f.stage, value: f.count, itemStyle: { color: f.code === 'won' ? PALETTE.emerald : SERIES_COLORS[[0, 5, 6, 1][i % 4]] } })),
        }],
    };
});

const sourceOption = computed<ChartOption>(() => ({
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number; data: { won: number; revenue: number } }) => `${p.name}<br/>${p.value} leads (${p.percent}%)<br/>${p.data.won} won · ${currency.value} ${compact(p.data.revenue)}` },
    legend: legend({ bottom: 0, left: 'center' }),
    series: [{
        type: 'pie', radius: ['38%', '70%'], center: ['50%', '45%'], roseType: 'radius',
        itemStyle: { borderRadius: 6, borderColor: isDark() ? '#070d1c' : '#fff', borderWidth: 2 },
        label: { color: isDark() ? '#cbd5e1' : '#334155', formatter: '{b}\n{d}%' },
        data: (data.value?.sources ?? []).map((s) => ({ name: s.source, value: s.leads, won: s.won, revenue: s.revenue })),
    }],
}));

const lostOption = computed<ChartOption>(() => {
    const reasons = [...(data.value?.lost_reasons ?? [])].reverse();
    return {
        grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { name: string; value: number; dataIndex: number }[]) => `${p[0].name}<br/>${p[0].value} leads · ${currency.value} ${compact(reasons[p[0].dataIndex].value)}` },
        xAxis: valueAxis({ minInterval: 1 }),
        yAxis: categoryAxis(reasons.map((r) => r.reason), { axisLabel: { width: 120, overflow: 'truncate', color: isDark() ? '#94a3b8' : '#475569' } }),
        series: [{ type: 'bar', data: reasons.map((r) => r.count), barMaxWidth: 14, label: { show: true, position: 'right', color: isDark() ? '#cbd5e1' : '#334155' }, itemStyle: { borderRadius: [0, 6, 6, 0], color: glow(PALETTE.rose, 0.9, 0.4) } }],
    };
});

const heatmapOption = computed<ChartOption>(() => {
    const heat = data.value?.heatmap;
    return {
        grid: { left: 8, right: 8, top: 8, bottom: 50, containLabel: true },
        tooltip: { position: 'top', formatter: (p: { value: [number, number, number] }) => `${heat?.days[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00 · ${p.value[2]} new leads` },
        xAxis: categoryAxis((heat?.hours ?? []).map((h) => `${h}`), { splitArea: { show: false } }),
        yAxis: categoryAxis(heat?.days ?? []),
        visualMap: {
            min: 0, max: Math.max(1, heat?.max ?? 1), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, itemWidth: 10,
            textStyle: { color: isDark() ? '#94a3b8' : '#475569' },
            inRange: { color: isDark() ? ['#0b1324', '#0e7490', '#22d3ee', '#a78bfa', '#f0abfc'] : ['#eff6ff', '#93c5fd', '#3b82f6', '#7c3aed'] },
        },
        series: [{ type: 'heatmap', data: (heat?.cells ?? []).map(([d, h, n]) => [h, d, n]), itemStyle: { borderRadius: 3, borderColor: isDark() ? '#060b18' : '#fff', borderWidth: 2 }, emphasis: { itemStyle: { shadowBlur: 12, shadowColor: hexToRgba(PALETTE.cyan, 0.7) } } }],
    };
});

// Agents × measures, each column scaled to its best performer: everything about the team in one view.
const MATRIX_MEASURES: { key: keyof LeaderboardRow; label: string; money?: boolean }[] = [
    { key: 'revenue', label: 'Revenue', money: true },
    { key: 'deals', label: 'Deals' },
    { key: 'commission', label: 'Commission', money: true },
    { key: 'leads', label: 'Leads' },
    { key: 'won', label: 'Won' },
    { key: 'win_rate', label: 'Win rate' },
    { key: 'listings', label: 'Listings' },
];
const matrixRows = computed(() => (data.value?.leaderboard ?? []).slice(0, 14));
const matrixOption = computed<ChartOption>(() => {
    const rows = matrixRows.value;
    const max = Object.fromEntries(MATRIX_MEASURES.map((m) => [m.key, Math.max(1, ...rows.map((r) => Number(r[m.key] ?? 0)))]));
    const cells = rows.flatMap((row, y) => MATRIX_MEASURES.map((m, x) => [x, y, Math.round((100 * Number(row[m.key] ?? 0)) / max[m.key as string]), row[m.key]]));
    return {
        grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
        tooltip: {
            formatter: (p: { value: [number, number, number, number | null] }) => {
                const measure = MATRIX_MEASURES[p.value[0]];
                const raw = p.value[3];
                const shown = raw === null ? '—' : measure.money ? `${currency.value} ${compact(Number(raw), 2)}` : measure.key === 'win_rate' ? `${raw}%` : raw;
                return `${rows[p.value[1]].name}<br/>${measure.label}: <b>${shown}</b> (${p.value[2]}% of best)`;
            },
        },
        xAxis: categoryAxis(MATRIX_MEASURES.map((m) => m.label), { position: 'top' }),
        yAxis: categoryAxis(rows.map((r) => r.name), { inverse: true, axisLabel: { width: 110, overflow: 'truncate', color: isDark() ? '#cbd5e1' : '#334155' } }),
        visualMap: { show: false, min: 0, max: 100, inRange: { color: isDark() ? ['#0b1324', '#155e75', '#06b6d4', '#34d399'] : ['#f1f5f9', '#bae6fd', '#38bdf8', '#059669'] } },
        series: [{
            type: 'heatmap', data: cells,
            label: { show: true, color: isDark() ? '#e2e8f0' : '#0f172a', fontSize: 11, formatter: (p: { value: [number, number, number, number | null] }) => { const m = MATRIX_MEASURES[p.value[0]]; const raw = p.value[3]; return raw === null ? '—' : m.money ? compact(Number(raw)) : m.key === 'win_rate' ? `${raw}%` : String(raw); } },
            itemStyle: { borderRadius: 4, borderColor: isDark() ? '#060b18' : '#fff', borderWidth: 2 },
        }],
    };
});

const agenciesOption = computed<ChartOption>(() => {
    const list = data.value?.agencies ?? [];
    return {
        legend: legend({ top: 0, right: 0 }),
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 12, top: 34, bottom: 8, containLabel: true },
        xAxis: categoryAxis(list.map((a) => a.name), { axisLabel: { interval: 0, rotate: list.length > 5 ? 25 : 0, width: 90, overflow: 'truncate', color: isDark() ? '#94a3b8' : '#475569' } }),
        yAxis: [valueAxis({ axisLabel: { formatter: (v: number) => compact(v) } }), valueAxis({ splitLine: { show: false } })],
        series: [
            { name: `Revenue (${currency.value})`, type: 'bar', data: list.map((a) => a.revenue), barMaxWidth: 26, itemStyle: { borderRadius: [6, 6, 0, 0], color: glow(PALETTE.cyan, 0.95, 0.35) } },
            { name: 'Leads', type: 'line', yAxisIndex: 1, smooth: true, data: list.map((a) => a.leads), lineStyle: { color: PALETTE.violet, width: 2 }, itemStyle: { color: PALETTE.violet } },
        ],
    };
});

const winGaugeOption = computed<ChartOption>(() => ({
    series: [{
        type: 'gauge', startAngle: 220, endAngle: -40, min: 0, max: 100, radius: '92%', center: ['50%', '58%'],
        progress: { show: true, width: 12, roundCap: true, itemStyle: { color: glow(PALETTE.emerald, 1, 0.6), shadowBlur: 16, shadowColor: hexToRgba(PALETTE.emerald, 0.6) } },
        axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, isDark() ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.15)']] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        title: { offsetCenter: [0, '38%'], color: isDark() ? '#94a3b8' : '#475569', fontSize: 12 },
        detail: { valueAnimation: true, offsetCenter: [0, '-2%'], formatter: '{value}%', color: isDark() ? '#e2e8f0' : '#0f172a', fontSize: 30, fontWeight: 600 },
        data: [{ value: kpi('win_rate').value, name: 'Win rate' }],
    }],
}));

const earningsOption = computed<ChartOption>(() => {
    const monthly = data.value?.earnings.monthly ?? [];
    return {
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${currency.value} ${compact(v, 2)}` },
        grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
        xAxis: categoryAxis(monthly.map((m) => shortBucket(m.month))),
        yAxis: valueAxis({ minInterval: 1, axisLabel: { formatter: (v: number) => compact(v) } }),
        series: [{ name: 'Commission paid', type: 'bar', data: monthly.map((m) => m.paid), barMaxWidth: 22, itemStyle: { borderRadius: [6, 6, 0, 0], color: glow(PALETTE.emerald, 0.95, 0.35) } }],
    };
});

/* ---------------- 3D galaxy ---------------- */
const galaxyNodes = computed(() => {
    const d = data.value;
    if (!d) return [];
    const rate = (won: number, lost: number) => (won + lost ? Math.round((100 * won) / (won + lost)) : null);
    if (d.scope.level === 'global') {
        return d.agencies.map((agency) => {
            const people = d.leaderboard.filter((p) => p.agency === agency.name);
            const won = people.reduce((s, p) => s + p.won, 0);
            const lost = people.reduce((s, p) => s + p.lost, 0);
            return {
                id: agency.id, name: agency.name, kind: 'agency' as const, value: agency.revenue || agency.leads, rate: rate(won, lost),
                children: people.map((p) => ({ id: p.user_id, name: p.name, kind: 'agent' as const, value: p.revenue || p.leads, rate: p.win_rate })),
            };
        });
    }
    return d.leaderboard.map((p) => ({ id: p.user_id, name: p.name, kind: 'agent' as const, value: p.revenue || p.leads, rate: p.win_rate }));
});

function onGalaxySelect(node: { id: number; kind: 'agency' | 'agent' }) {
    if (node.kind === 'agency' && canDrillAgencies.value) openAgency(node.id);
    else if (node.kind === 'agent' && level.value !== 'agent') filters.agent_user_id = node.id;
}

const maxRevenue = computed(() => Math.max(1, ...(data.value?.leaderboard ?? []).map((p) => p.revenue)));
</script>

<template>
    <Head title="Performance" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-5 p-4 md:p-6">
            <!-- Command bar -->
            <div class="reveal flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div class="min-w-0">
                    <p class="hud-label flex items-center gap-2"><span class="live-dot" /> {{ PERSONAS[viewer.persona] ?? 'Performance' }}</p>
                    <h1 class="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
                        <span class="shimmer-text">Performance</span> command center
                    </h1>
                    <nav class="mt-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Drill-down">
                        <template v-for="(item, index) in trail" :key="index">
                            <ChevronRight v-if="index" class="size-3.5" />
                            <button type="button" class="rounded px-1 hover:text-foreground" :class="index === trail.length - 1 ? 'font-medium text-foreground' : ''" @click="item.action()">{{ item.label }}</button>
                        </template>
                        <span v-if="!trail.length" class="font-medium text-foreground">{{ data?.scope.label ?? viewer.name }}</span>
                    </nav>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <select
                        v-if="canDrillAgencies"
                        :value="filters.agency_id ?? ''"
                        class="h-9 max-w-[12rem] rounded-lg border border-input bg-background/60 px-2 text-sm"
                        aria-label="Agency"
                        @change="selectAgency(($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">All agencies</option>
                        <option v-for="agency in data?.directory.agencies" :key="agency.id" :value="agency.id">{{ agency.name }}</option>
                    </select>
                    <select
                        v-if="agents.length"
                        :value="filters.agent_user_id ?? ''"
                        class="h-9 max-w-[12rem] rounded-lg border border-input bg-background/60 px-2 text-sm"
                        aria-label="Agent"
                        @change="filters.agent_user_id = Number(($event.target as HTMLSelectElement).value) || null"
                    >
                        <option value="">Whole team</option>
                        <option v-for="agent in agents" :key="agent.user_id" :value="agent.user_id">{{ agent.name }}</option>
                    </select>
                    <div class="flex rounded-lg border border-input bg-background/60 p-0.5" role="radiogroup" aria-label="Period">
                        <button
                            v-for="period in PERIODS"
                            :key="period.key"
                            type="button"
                            role="radio"
                            :aria-checked="filters.period === period.key"
                            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                            :class="filters.period === period.key ? 'bg-primary text-primary-foreground shadow-[0_0_16px_-2px_hsl(var(--primary)/0.7)]' : 'text-muted-foreground hover:text-foreground'"
                            @click="filters.period = period.key"
                        >
                            {{ period.label }}
                        </button>
                    </div>
                    <button type="button" class="grid size-9 place-items-center rounded-lg border border-input bg-background/60 text-muted-foreground hover:text-foreground" :disabled="loading" aria-label="Refresh" @click="load">
                        <LoaderCircle v-if="loading" class="size-4 animate-spin" /><RefreshCw v-else class="size-4" />
                    </button>
                </div>
            </div>

            <div v-if="data?.demo" class="reveal rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 dark:text-amber-100" role="status">
                <strong>Demo data.</strong> {{ data.note }}
                <span v-if="viewer.kind === 'executive'"> Connect the CRM database on the Connections page to see real figures.</span>
            </div>
            <div v-if="data?.currency.mixed" class="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-2 text-xs text-muted-foreground">
                Deals here are in {{ data.currency.all.join(', ') }}. Totals add them without conversion, as the CRM does; open one agency for single-currency figures.
            </div>
            <div v-if="error" class="flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-200" role="alert">
                <CircleAlert class="size-4 shrink-0" /> {{ error }}
            </div>

            <div v-if="!data && loading" class="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div v-for="n in 8" :key="n" class="h-28 animate-pulse rounded-2xl bg-muted/40" />
            </div>

            <template v-if="data">
                <!-- KPIs -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiTile class="reveal" style="--i: 1" label="Won revenue" format="money" :currency="currency" :value="kpi('won_revenue').value" :change-pct="kpi('won_revenue').change_pct" :icon="BadgeDollarSign" tone="cyan" :trend="data.revenue_trend.map((t) => t.won)" />
                    <KpiTile class="reveal" style="--i: 2" label="Deals closed" :value="kpi('deals_closed').value" :change-pct="kpi('deals_closed').change_pct" :icon="Handshake" tone="violet" :trend="data.revenue_trend.map((t) => t.deals)" />
                    <KpiTile class="reveal" style="--i: 3" label="Commission paid" format="money" :currency="currency" :value="kpi('commission_paid').value" :change-pct="kpi('commission_paid').change_pct" :icon="Wallet" tone="emerald" :hint="`${currency} ${compact(kpi('commission_awaiting').value)} awaiting`" />
                    <KpiTile class="reveal" style="--i: 4" label="Lost revenue" format="money" :currency="currency" :value="kpi('lost_revenue').value" :change-pct="kpi('lost_revenue').change_pct" invert :icon="TrendingDown" tone="rose" :trend="data.revenue_trend.map((t) => t.lost)" />
                    <KpiTile class="reveal" style="--i: 5" label="New leads" :value="kpi('leads').value" :change-pct="kpi('leads').change_pct" :icon="Users" tone="cyan" :trend="data.lead_trend.map((t) => t.created)" />
                    <KpiTile class="reveal" style="--i: 6" label="Conversion" format="percent" :value="kpi('conversion_rate').value" :icon="Target" tone="violet" :hint="data.definitions.conversion_rate" />
                    <KpiTile class="reveal" style="--i: 7" label="Win rate" format="percent" :value="kpi('win_rate').value" :icon="Percent" tone="emerald" :hint="`${kpi('won_leads').value} won · ${kpi('lost_leads').value} lost`" />
                    <KpiTile class="reveal" style="--i: 8" label="Active listings" :value="kpi('active_listings').value" :icon="Home" tone="amber" :hint="`${compact(kpi('enquiries').value)} enquiries in period`" />
                </div>

                <!-- Revenue pulse + galaxy / earnings -->
                <div class="grid grid-cols-1 gap-4 xl:grid-cols-5">
                    <Card class="edge-glow reveal min-w-0 p-4 xl:col-span-3" style="--i: 9">
                        <p class="hud-label">Revenue pulse</p>
                        <p class="text-sm text-muted-foreground">Won and lost deal value with deals closed per {{ data.period.bucket }}.</p>
                        <div class="mt-2 h-72"><EChart :option="revenueOption" label="Won and lost revenue over time" /></div>
                    </Card>

                    <Card v-if="level !== 'agent' && galaxyNodes.length" class="edge-glow reveal min-w-0 xl:col-span-2" style="--i: 10">
                        <PerformanceGalaxy :nodes="galaxyNodes" :core-label="data.scope.label" :currency="currency" class="h-[22rem]" @select="onGalaxySelect" />
                    </Card>

                    <Card v-else class="edge-glow reveal min-w-0 p-4 xl:col-span-2" style="--i: 10">
                        <p class="hud-label">Earned vs lost</p>
                        <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div class="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                                <p class="text-xs text-muted-foreground">Commission paid (all time)</p>
                                <p class="metric-value text-xl text-emerald-300">{{ currency }} {{ compact(data.earnings.paid, 2) }}</p>
                            </div>
                            <div class="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                                <p class="text-xs text-muted-foreground">Awaiting payment</p>
                                <p class="metric-value text-xl text-cyan-300">{{ currency }} {{ compact(data.earnings.approved + data.earnings.pending_review, 2) }}</p>
                            </div>
                            <div class="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3">
                                <p class="text-xs text-muted-foreground">Cancelled deals (period)</p>
                                <p class="metric-value text-xl text-rose-300">{{ currency }} {{ compact(kpi('lost_revenue').value, 2) }}</p>
                            </div>
                            <div class="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
                                <p class="text-xs text-muted-foreground">Lost leads' value (period)</p>
                                <p class="metric-value text-xl text-amber-300">{{ currency }} {{ compact(kpi('lost_lead_value').value, 2) }}</p>
                            </div>
                        </div>
                        <div class="mt-3 h-36">
                            <EChart v-if="data.earnings.monthly.length" :option="earningsOption" label="Commission paid per month" />
                            <p v-else class="grid h-full place-items-center text-sm text-muted-foreground">No commission has been paid yet.</p>
                        </div>
                    </Card>
                </div>

                <!-- Pipeline -->
                <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <Card class="edge-glow reveal min-w-0 p-4" style="--i: 11">
                        <p class="hud-label">Pipeline funnel</p>
                        <p class="text-sm text-muted-foreground">Leads created this period, by their current stage.</p>
                        <div class="mt-2 h-64">
                            <EChart v-if="data.funnel.some((f) => f.count > 0)" :option="funnelOption" label="Lead pipeline funnel" />
                            <p v-else class="grid h-full place-items-center text-sm text-muted-foreground">No new leads in this period.</p>
                        </div>
                    </Card>
                    <Card class="edge-glow reveal min-w-0 p-4" style="--i: 12">
                        <p class="hud-label">Where leads come from</p>
                        <p class="text-sm text-muted-foreground">Share of new leads; hover for wins and revenue.</p>
                        <div class="mt-2 h-64">
                            <EChart v-if="data.sources.some((s) => s.leads > 0)" :option="sourceOption" label="Lead sources" />
                            <p v-else class="grid h-full place-items-center text-sm text-muted-foreground">No new leads in this period.</p>
                        </div>
                    </Card>
                    <Card class="edge-glow reveal min-w-0 p-4" style="--i: 13">
                        <p class="hud-label">Why deals are lost</p>
                        <p class="text-sm text-muted-foreground">Lost leads this period by reason.</p>
                        <div class="mt-2 h-64">
                            <EChart v-if="data.lost_reasons.length" :option="lostOption" label="Lost reasons" />
                            <p v-else class="grid h-full place-items-center text-sm text-muted-foreground">No lost leads in this period.</p>
                        </div>
                    </Card>
                </div>

                <!-- Activity -->
                <div class="grid grid-cols-1 gap-4 xl:grid-cols-4">
                    <Card class="edge-glow reveal min-w-0 p-4 xl:col-span-2" style="--i: 14">
                        <p class="hud-label">When leads arrive</p>
                        <p class="text-sm text-muted-foreground">New leads by weekday and hour: staff the busy hours.</p>
                        <div class="mt-2 h-64"><EChart :option="heatmapOption" label="Lead arrival heatmap by weekday and hour" /></div>
                    </Card>
                    <Card class="edge-glow reveal min-w-0 p-4" style="--i: 15">
                        <p class="hud-label">Lead flow</p>
                        <div class="mt-2 h-64"><EChart :option="leadTrendOption" label="New, won and lost leads over time" /></div>
                    </Card>
                    <Card class="edge-glow reveal min-w-0 p-4" style="--i: 16">
                        <p class="hud-label">Closing strength</p>
                        <div class="h-52"><EChart :option="winGaugeOption" label="Win rate gauge" /></div>
                        <p class="text-center text-xs text-muted-foreground">{{ data.definitions.win_rate }}</p>
                    </Card>
                </div>

                <!-- Team -->
                <Card v-if="matrixRows.length" class="edge-glow reveal min-w-0 p-4" style="--i: 17">
                    <div class="flex flex-wrap items-end justify-between gap-2">
                        <div>
                            <p class="hud-label">Agent performance matrix</p>
                            <p class="text-sm text-muted-foreground">Each column is scaled to the best performer. Brighter is stronger; click an agent in the table below to open their view.</p>
                        </div>
                    </div>
                    <div class="mt-3" :style="{ height: `${Math.max(220, matrixRows.length * 34 + 50)}px` }"><EChart :option="matrixOption" label="Agent performance matrix" /></div>
                </Card>

                <div class="grid grid-cols-1 gap-4" :class="data.agencies.length ? 'xl:grid-cols-5' : ''">
                    <Card v-if="data.leaderboard.length" class="edge-glow reveal min-w-0 overflow-hidden p-0" :class="data.agencies.length ? 'xl:col-span-3' : ''" style="--i: 18">
                        <div class="p-4 pb-2"><p class="hud-label">Leaderboard</p></div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead>
                                    <tr class="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                                        <th class="px-4 py-2 font-medium">#</th>
                                        <th class="py-2 pr-3 font-medium">Agent</th>
                                        <th class="py-2 pr-3 font-medium">Revenue</th>
                                        <th class="py-2 pr-3 text-right font-medium">Deals</th>
                                        <th class="py-2 pr-3 text-right font-medium">Leads</th>
                                        <th class="py-2 pr-3 text-right font-medium">Win rate</th>
                                        <th class="py-2 pr-4 text-right font-medium">Commission</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="(row, index) in data.leaderboard.slice(0, 12)"
                                        :key="row.user_id"
                                        class="cursor-pointer border-b border-border/40 transition-colors hover:bg-cyan-400/5"
                                        tabindex="0"
                                        @click="openAgent(row)"
                                        @keydown.enter="openAgent(row)"
                                    >
                                        <td class="px-4 py-2.5 tabular-nums text-muted-foreground">
                                            <span :class="index < 3 ? 'font-semibold text-cyan-300' : ''">{{ index + 1 }}</span>
                                        </td>
                                        <td class="max-w-[12rem] py-2.5 pr-3">
                                            <p class="truncate font-medium">{{ row.name }}</p>
                                            <p v-if="row.agency && level === 'global'" class="truncate text-xs text-muted-foreground">{{ row.agency }}</p>
                                        </td>
                                        <td class="min-w-[9rem] py-2.5 pr-3">
                                            <div class="flex items-center gap-2">
                                                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                                    <div class="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" :style="{ width: `${(100 * row.revenue) / maxRevenue}%` }" />
                                                </div>
                                                <span class="w-16 text-right tabular-nums">{{ compact(row.revenue) }}</span>
                                            </div>
                                        </td>
                                        <td class="py-2.5 pr-3 text-right tabular-nums">{{ row.deals }}</td>
                                        <td class="py-2.5 pr-3 text-right tabular-nums">{{ row.leads }}</td>
                                        <td class="py-2.5 pr-3 text-right tabular-nums" :class="row.win_rate === null ? 'text-muted-foreground' : row.win_rate >= 60 ? 'text-emerald-400' : row.win_rate >= 30 ? 'text-amber-300' : 'text-rose-400'">
                                            {{ row.win_rate === null ? '—' : `${row.win_rate}%` }}
                                        </td>
                                        <td class="py-2.5 pr-4 text-right tabular-nums">{{ compact(row.commission) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Card>
                    <Card v-if="data.agencies.length" class="edge-glow reveal min-w-0 p-4 xl:col-span-2" style="--i: 19">
                        <p class="hud-label flex items-center gap-1.5"><Building2 class="size-3.5" /> Agencies</p>
                        <p class="text-sm text-muted-foreground">Revenue and lead volume. Click a bar to open the agency.</p>
                        <div class="mt-2 h-72"><EChart :option="agenciesOption" label="Agency comparison" @select="(p: any) => openAgency(data!.agencies[p.dataIndex].id)" /></div>
                    </Card>
                </div>

                <p class="flex flex-wrap items-center gap-2 pb-2 text-xs text-muted-foreground">
                    <MessageSquareText class="size-3.5" /> Ask the assistant: "How did my agents do this month?" ·
                    <span v-if="loadedAt">Updated {{ loadedAt.toLocaleTimeString() }}</span>
                    <span v-if="!crmConnected && viewer.kind === 'executive'">· CRM database not connected</span>
                </p>
            </template>
        </div>
    </AppLayout>
</template>

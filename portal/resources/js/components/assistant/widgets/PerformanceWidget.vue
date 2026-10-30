<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue';
import Sparkline from '@/components/Sparkline.vue';
import { compact } from '@/lib/numbers';
import type { PerformanceSection } from '@/types/assistant';
import { computed } from 'vue';

const props = defineProps<{ section: PerformanceSection }>();

const kpi = (key: string) => props.section.kpis[key]?.value ?? 0;
const change = computed(() => props.section.kpis.won_revenue?.change_pct ?? null);
const topRevenue = computed(() => Math.max(1, ...props.section.top_agents.map((a) => a.revenue)));
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <div class="flex shrink-0 items-end justify-between gap-2">
            <div class="min-w-0">
                <p class="text-[10px] text-slate-400">Won revenue · 30 days · {{ section.scope }}</p>
                <p class="truncate text-xl font-semibold tabular-nums text-emerald-100 [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
                    <span class="text-xs font-normal text-slate-400">{{ section.currency }}</span> {{ compact(kpi('won_revenue'), 2) }}
                </p>
                <p v-if="change !== null" class="text-[10px]" :class="change >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                    {{ change >= 0 ? '▲' : '▼' }} {{ Math.abs(change) }}% vs previous
                </p>
            </div>
            <Sparkline v-if="section.trend.length > 1" :values="section.trend" :width="92" :height="30" tone="green" label="Won revenue trend" />
        </div>

        <div class="grid shrink-0 grid-cols-3 gap-1.5 text-center">
            <div class="rounded-lg bg-white/[0.04] py-1"><AnimatedNumber :value="kpi('deals_closed')" class="block text-sm font-semibold text-slate-100" /><span class="text-[9px] text-slate-400">Deals</span></div>
            <div class="rounded-lg bg-white/[0.04] py-1"><AnimatedNumber :value="kpi('leads')" class="block text-sm font-semibold text-slate-100" /><span class="text-[9px] text-slate-400">New leads</span></div>
            <div class="rounded-lg bg-white/[0.04] py-1"><span class="block text-sm font-semibold tabular-nums text-emerald-300">{{ kpi('win_rate') }}%</span><span class="text-[9px] text-slate-400">Win rate</span></div>
        </div>

        <ul class="lw-list min-h-0 flex-1 space-y-1 overflow-y-auto">
            <li v-for="agent in section.top_agents" :key="agent.user_id" class="text-[11px]">
                <div class="flex justify-between gap-2">
                    <span class="min-w-0 truncate text-slate-300">{{ agent.name }}</span>
                    <span class="tabular-nums text-slate-400">{{ compact(agent.revenue) }}</span>
                </div>
                <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-white/5">
                    <div class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-[width] duration-700" :style="{ width: `${(100 * agent.revenue) / topRevenue}%` }" />
                </div>
            </li>
        </ul>
        <p v-if="section.currency_mixed" class="shrink-0 text-[10px] text-amber-200/80">Mixed currencies, added without conversion.</p>
    </div>
</template>

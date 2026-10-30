<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue';
import Sparkline from '@/components/Sparkline.vue';
import type { MonitoringSection } from '@/types/assistant';

defineProps<{ section: MonitoringSection }>();

function shortName(name: string) {
    return name.replace(/^production-/, '');
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <p v-if="!section.available" class="text-[11px] text-slate-400">{{ section.note ?? 'Monitoring is unavailable.' }}</p>
        <template v-else>
            <div class="grid shrink-0 grid-cols-3 gap-1.5">
                <div class="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-2 py-1.5">
                    <AnimatedNumber :value="section.counts?.ALARM ?? 0" class="block text-lg font-semibold leading-tight text-rose-300" />
                    <span class="text-[10px] text-slate-400">In alarm</span>
                </div>
                <div class="rounded-lg border border-rose-300/15 bg-white/[0.03] px-2 py-1.5">
                    <AnimatedNumber :value="section.counts?.critical ?? 0" class="block text-lg font-semibold leading-tight text-rose-200" />
                    <span class="text-[10px] text-slate-400">Critical</span>
                </div>
                <div class="rounded-lg border border-emerald-400/15 bg-white/[0.03] px-2 py-1.5">
                    <AnimatedNumber :value="section.counts?.OK ?? 0" class="block text-lg font-semibold leading-tight text-emerald-300" />
                    <span class="text-[10px] text-slate-400">OK</span>
                </div>
            </div>

            <ul class="lw-list min-h-0 flex-1 space-y-1 overflow-y-auto">
                <li v-for="alarm in section.alarms" :key="alarm.name" class="flex items-center gap-2 rounded-md px-1 py-0.5" :title="alarm.description">
                    <span
                        class="size-1.5 shrink-0 rounded-full"
                        :class="alarm.state === 'ALARM' ? (alarm.severity === 'critical' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.9)]' : 'bg-amber-400') : 'bg-emerald-400/70'"
                        aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1 truncate text-[11px] text-slate-300">{{ shortName(alarm.name) }}</span>
                    <Sparkline v-if="alarm.series.length > 1" :values="alarm.series" :width="54" :height="16" :tone="alarm.state === 'ALARM' ? 'red' : 'green'" :label="`${alarm.name} trend`" />
                </li>
            </ul>

            <p v-for="forecast in section.forecasts?.slice(0, 1)" :key="forecast.resource" class="shrink-0 truncate text-[10px] text-amber-200/80">
                Forecast: {{ forecast.label }} full in {{ forecast.days ?? '?' }} days
            </p>
        </template>
    </div>
</template>

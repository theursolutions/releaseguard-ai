<script setup lang="ts">
import type { ActivitySection } from '@/types/assistant';

defineProps<{ section: ActivitySection }>();

const TONE: Record<string, string> = { good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-rose-400', info: 'bg-sky-400' };

function ago(at: string | null) {
    if (!at) return '';
    const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <ul class="lw-list min-h-0 flex-1 space-y-1 overflow-y-auto">
            <li v-if="!section.events.length" class="text-[11px] text-slate-500">No recent platform events.</li>
            <li v-for="(event, index) in section.events" :key="`${event.kind}-${index}-${event.at}`" class="flex items-center gap-2 text-[11px]">
                <span class="size-1.5 shrink-0 rounded-full" :class="TONE[event.tone]" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-slate-300">{{ event.label }}</span>
                <span v-if="event.demo" class="shrink-0 text-[9px] uppercase text-amber-200/80">demo</span>
                <span class="w-7 shrink-0 text-right tabular-nums text-slate-500">{{ ago(event.at) }}</span>
            </li>
        </ul>
        <div v-if="section.team?.authorised && section.team.people?.length" class="shrink-0 border-t border-white/5 pt-1.5">
            <p class="text-[9px] uppercase tracking-wider text-slate-500">Team · {{ section.team.period_days }} days</p>
            <p v-for="person in section.team.people.slice(0, 3)" :key="person.name" class="flex justify-between gap-2 text-[11px]">
                <span class="truncate text-slate-300">{{ person.name }}</span>
                <span class="shrink-0 tabular-nums text-slate-500">{{ person.prd_reviews }} PRD · {{ person.alarm_diagnoses }} diag.</span>
            </p>
        </div>
    </div>
</template>

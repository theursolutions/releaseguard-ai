<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue';
import type { PrdSection } from '@/types/assistant';
import { Workflow } from 'lucide-vue-next';
import { computed } from 'vue';

const props = defineProps<{ section: PrdSection }>();
defineEmits<{ openFlows: [reviewId: number, title: string] }>();

const radius = 20;
const circumference = 2 * Math.PI * radius;
const offset = computed(() => circumference * (1 - Math.min(100, props.section.average_score_last_20) / 100));
const ready = computed(() => props.section.average_score_last_20 >= props.section.ready_threshold);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <div class="flex shrink-0 items-center gap-3">
            <div class="relative size-14 shrink-0">
                <svg viewBox="0 0 48 48" class="size-full -rotate-90" role="img" :aria-label="`Average readiness ${section.average_score_last_20} out of 100`">
                    <circle cx="24" cy="24" :r="radius" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4" />
                    <circle
                        cx="24" cy="24" :r="radius" fill="none" stroke-width="4" stroke-linecap="round"
                        :stroke="ready ? '#34d399' : '#fbbf24'" :stroke-dasharray="circumference" :stroke-dashoffset="offset"
                        class="transition-[stroke-dashoffset] duration-1000 [filter:drop-shadow(0_0_4px_currentColor)]"
                    />
                </svg>
                <span class="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums text-slate-100">{{ section.average_score_last_20 || '–' }}</span>
            </div>
            <div class="grid flex-1 grid-cols-3 gap-1 text-center">
                <div><AnimatedNumber :value="section.reviewed" class="block text-base font-semibold text-slate-100" /><span class="text-[9px] text-slate-400">Reviewed</span></div>
                <div><AnimatedNumber :value="section.ready_for_sprint" class="block text-base font-semibold text-emerald-300" /><span class="text-[9px] text-slate-400">Ready</span></div>
                <div><AnimatedNumber :value="section.not_ready" class="block text-base font-semibold text-amber-300" /><span class="text-[9px] text-slate-400">Not ready</span></div>
            </div>
        </div>

        <p v-if="!section.recent.length" class="text-[11px] text-slate-500">No PRD reviews in this scope yet.</p>
        <ul class="lw-list min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            <li v-for="review in section.recent" :key="review.id" class="group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-white/5">
                <span class="min-w-0 flex-1 truncate text-[11px] text-slate-300">{{ review.title }}</span>
                <span class="shrink-0 text-[11px] tabular-nums" :class="review.score === null ? 'text-slate-500' : review.score >= section.ready_threshold ? 'text-emerald-300' : 'text-amber-300'">
                    {{ review.score ?? review.status }}
                </span>
                <button
                    v-if="review.status === 'completed'"
                    type="button"
                    class="grid size-5 shrink-0 place-items-center rounded text-cyan-300/70 hover:bg-cyan-400/15 hover:text-cyan-200"
                    :aria-label="`Show the flows of ${review.title}`"
                    title="Show flows"
                    @click="$emit('openFlows', review.id, review.title)"
                >
                    <Workflow class="size-3.5" />
                </button>
            </li>
        </ul>
    </div>
</template>

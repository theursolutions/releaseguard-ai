<script setup lang="ts">
/** A slowly scrolling strip of recent real events (the scrolling is ambient; the items are data). */
import type { LiveEvent } from '@/types/assistant';
import { computed } from 'vue';

const props = defineProps<{ events: LiveEvent[] }>();

const TONE: Record<string, string> = { good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-rose-300', info: 'text-sky-300' };
// Long enough to scroll seamlessly: the list is rendered twice and shifted by half.
const duration = computed(() => `${Math.max(30, props.events.length * 7)}s`);
</script>

<template>
    <div class="ticker relative flex h-8 shrink-0 items-center overflow-hidden border-t border-cyan-300/10 bg-slate-950/60 text-[11px]" aria-label="Recent events">
        <span class="relative z-10 flex h-full shrink-0 items-center gap-1.5 bg-slate-950 px-3 font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
            <span class="size-1.5 rounded-full bg-cyan-400 motion-safe:animate-pulse" aria-hidden="true" />Live feed
        </span>
        <p v-if="!events.length" class="px-3 text-slate-500">No recent events.</p>
        <div v-else class="ticker-mask min-w-0 flex-1 overflow-hidden">
            <ul class="ticker-track flex w-max gap-8 whitespace-nowrap" :style="{ animationDuration: duration }">
                <li v-for="(event, index) in [...events, ...events]" :key="index" class="flex items-center gap-1.5" :aria-hidden="index >= events.length">
                    <span :class="TONE[event.tone]">◆</span>
                    <span class="text-slate-300">{{ event.label }}</span>
                    <span v-if="event.demo" class="text-[9px] uppercase text-amber-200/70">demo</span>
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.ticker-mask {
    mask-image: linear-gradient(90deg, transparent, black 4%, black 96%, transparent);
}
.ticker-track {
    animation: ticker linear infinite;
}
.ticker:hover .ticker-track {
    animation-play-state: paused;
}
@keyframes ticker {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
    .ticker-track { animation: none; }
}
</style>

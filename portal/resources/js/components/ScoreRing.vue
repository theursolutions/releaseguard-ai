<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ score: number; readyScore?: number; size?: number }>(), { readyScore: 70, size: 128 });

const radius = 52;
const circumference = 2 * Math.PI * radius;
const offset = computed(() => circumference * (1 - Math.min(100, Math.max(0, props.score)) / 100));
const ready = computed(() => props.score >= props.readyScore);
</script>

<template>
    <div class="relative inline-flex items-center justify-center" :style="{ width: `${size}px`, height: `${size}px` }">
        <svg viewBox="0 0 120 120" class="size-full -rotate-90" role="img" :aria-label="`Readiness score ${score} out of 100`">
            <circle cx="60" cy="60" :r="radius" fill="none" stroke-width="10" class="stroke-muted" />
            <circle
                cx="60"
                cy="60"
                :r="radius"
                fill="none"
                stroke-width="10"
                stroke-linecap="round"
                :stroke-dasharray="circumference"
                :stroke-dashoffset="offset"
                :class="ready ? 'stroke-emerald-500' : score >= 40 ? 'stroke-amber-500' : 'stroke-red-500'"
                class="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
            />
        </svg>
        <div class="absolute flex flex-col items-center">
            <span class="text-3xl font-semibold tabular-nums">{{ score }}</span>
            <span class="text-xs text-muted-foreground">of 100</span>
        </div>
    </div>
</template>

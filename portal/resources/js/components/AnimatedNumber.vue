<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ value: number; duration?: number; decimals?: number }>(), { duration: 900, decimals: 0 });

const shown = ref(0);
let frame = 0;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts from the previous value to the new one with an ease-out curve.
function animate(from: number, to: number) {
    cancelAnimationFrame(frame);
    if (reducedMotion) {
        shown.value = to;
        return;
    }
    const start = performance.now();
    const step = (now: number) => {
        const progress = Math.min(1, (now - start) / props.duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        shown.value = from + (to - from) * eased;
        if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
}

watch(() => props.value, (to, from) => animate(from ?? 0, to ?? 0), { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
    <span class="tabular-nums">{{ shown.toFixed(decimals) }}</span>
</template>

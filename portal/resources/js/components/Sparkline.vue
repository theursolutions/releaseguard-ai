<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ values: number[]; tone?: 'blue' | 'red' | 'amber' | 'green'; width?: number; height?: number; label?: string }>(), {
    tone: 'blue',
    width: 120,
    height: 36,
});

const strokes = { blue: '#2563eb', red: '#dc2626', amber: '#d97706', green: '#059669' };
const gradientId = `spark-${Math.random().toString(36).slice(2)}`;
const drawKey = ref(0);

const points = computed(() => {
    const values = props.values.length ? props.values : [0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = props.width / Math.max(1, values.length - 1);
    return values.map((v, i) => [i * stepX, props.height - 3 - ((v - min) / span) * (props.height - 6)] as const);
});

const line = computed(() => points.value.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
const area = computed(() => `${line.value} L${props.width},${props.height} L0,${props.height} Z`);
const last = computed(() => points.value[points.value.length - 1]);

// Re-run the "drawing" animation each time new data arrives.
watch(() => props.values.join(','), () => drawKey.value++);
</script>

<template>
    <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="overflow-visible" role="img" :aria-label="label ?? 'Trend over the last hour'">
        <defs>
            <linearGradient :id="gradientId" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" :stop-color="strokes[tone]" stop-opacity="0.28" />
                <stop offset="100%" :stop-color="strokes[tone]" stop-opacity="0" />
            </linearGradient>
        </defs>
        <path :d="area" :fill="`url(#${gradientId})`" />
        <path
            :key="drawKey"
            :d="line"
            fill="none"
            :stroke="strokes[tone]"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            pathLength="1"
            class="[animation:spark-draw_1.1s_cubic-bezier(0.22,1,0.36,1)_both] [stroke-dasharray:1] motion-reduce:[animation:none]"
        />
        <circle v-if="values.length" :cx="last[0]" :cy="last[1]" r="2.6" :fill="strokes[tone]" />
        <circle v-if="values.length" :cx="last[0]" :cy="last[1]" r="2.6" :fill="strokes[tone]" class="origin-center [animation:rg-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] [transform-box:fill-box]" />
    </svg>
</template>

<style>
@keyframes spark-draw {
    from {
        stroke-dashoffset: 1;
    }
    to {
        stroke-dashoffset: 0;
    }
}
</style>

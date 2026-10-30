<script setup lang="ts">
/**
 * Thin ECharts wrapper: sizes itself to its box, follows the light/dark theme, disposes cleanly and
 * turns animation off for people who prefer reduced motion. `label` is the accessible name.
 */
import { baseOption, echarts, type ChartOption } from '@/lib/charts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ option: ChartOption; label: string }>();
const emit = defineEmits<{ (e: 'select', params: unknown): void }>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function render(replace = false) {
    if (!chart) return;
    chart.setOption({ ...baseOption(), ...(reducedMotion ? { animation: false } : {}), ...props.option }, { notMerge: replace, lazyUpdate: true });
}

function create() {
    if (!el.value || chart) return;
    chart = echarts.init(el.value, undefined, { renderer: 'canvas' });
    chart.on('click', (params) => emit('select', params));
    render(true);
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(el.value);
    // Re-theme when the user switches light/dark.
    themeObserver = new MutationObserver(() => render(true));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

let visibilityObserver: IntersectionObserver | null = null;
onMounted(() => {
    if (!el.value) return;
    // Dashboards hold many charts: each one starts only when it comes near the screen, so the page
    // does not build all of them in one long burst.
    visibilityObserver = new IntersectionObserver(
        (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                visibilityObserver?.disconnect();
                create();
            }
        },
        { rootMargin: '200px' },
    );
    visibilityObserver.observe(el.value);
});

watch(() => props.option, () => render(true), { deep: false });

onBeforeUnmount(() => {
    visibilityObserver?.disconnect();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    chart?.dispose();
    chart = null;
});
</script>

<template>
    <div ref="el" role="img" :aria-label="label" class="h-full w-full min-w-0" />
</template>

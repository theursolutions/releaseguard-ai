<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue';
import Sparkline from '@/components/Sparkline.vue';
import { Card } from '@/components/ui/card';
import { ArrowDownRight, ArrowUpRight } from 'lucide-vue-next';
import { computed, type Component } from 'vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: number;
        format?: 'money' | 'number' | 'percent';
        currency?: string;
        changePct?: number | null;
        /** For "lost" figures a rise is bad. */
        invert?: boolean;
        icon?: Component;
        tone?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose';
        trend?: number[];
        hint?: string;
    }>(),
    { format: 'number', currency: '', changePct: null, invert: false, tone: 'cyan', trend: () => [] },
);

const TONES = {
    cyan: { text: 'text-cyan-300', ring: 'from-cyan-400/25', icon: 'bg-cyan-400/10 text-cyan-300', spark: 'blue' as const },
    violet: { text: 'text-violet-300', ring: 'from-violet-400/25', icon: 'bg-violet-400/10 text-violet-300', spark: 'blue' as const },
    emerald: { text: 'text-emerald-300', ring: 'from-emerald-400/25', icon: 'bg-emerald-400/10 text-emerald-300', spark: 'green' as const },
    amber: { text: 'text-amber-300', ring: 'from-amber-400/25', icon: 'bg-amber-400/10 text-amber-300', spark: 'amber' as const },
    rose: { text: 'text-rose-300', ring: 'from-rose-400/25', icon: 'bg-rose-400/10 text-rose-300', spark: 'red' as const },
};

// Large amounts are shown in thousands / millions so the readout stays short.
const scaled = computed(() => {
    if (props.format !== 'money') return { value: props.value, suffix: props.format === 'percent' ? '%' : '', decimals: props.format === 'percent' ? 1 : 0 };
    const abs = Math.abs(props.value);
    if (abs >= 1e6) return { value: props.value / 1e6, suffix: 'M', decimals: 2 };
    if (abs >= 1e3) return { value: props.value / 1e3, suffix: 'K', decimals: 1 };
    return { value: props.value, suffix: '', decimals: 0 };
});

const good = computed(() => (props.changePct ?? 0) >= 0 !== props.invert);
</script>

<template>
    <Card v-tilt class="edge-glow group relative overflow-hidden p-4">
        <span class="tilt-glare" />
        <div class="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-gradient-to-br to-transparent blur-2xl" :class="TONES[tone].ring" />
        <div class="flex items-start justify-between gap-2">
            <p class="hud-label">{{ label }}</p>
            <span v-if="icon" class="grid size-7 place-items-center rounded-lg" :class="TONES[tone].icon"><component :is="icon" class="size-3.5" /></span>
        </div>
        <p class="metric-value metric-glow mt-2 text-2xl md:text-[1.7rem]">
            <span v-if="format === 'money' && currency" class="mr-1 text-sm font-medium text-muted-foreground">{{ currency }}</span>
            <AnimatedNumber :value="scaled.value" :decimals="scaled.decimals" /><span class="text-lg">{{ scaled.suffix }}</span>
        </p>
        <div class="mt-2 flex items-end justify-between gap-2">
            <p v-if="changePct !== null && changePct !== undefined" class="flex items-center gap-1 text-xs font-medium" :class="good ? 'text-emerald-400' : 'text-rose-400'">
                <ArrowUpRight v-if="changePct >= 0" class="size-3.5" /><ArrowDownRight v-else class="size-3.5" />
                {{ Math.abs(changePct).toFixed(1) }}% <span class="font-normal text-muted-foreground">vs previous</span>
            </p>
            <p v-else-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
            <span v-else />
            <Sparkline v-if="trend.length > 1" :values="trend" :tone="TONES[tone].spark" :width="84" :height="26" :label="`${label} trend`" />
        </div>
    </Card>
</template>

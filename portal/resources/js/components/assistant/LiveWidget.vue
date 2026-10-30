<script lang="ts">
export type WidgetSize = 'normal' | 'expanded' | 'collapsed';
</script>

<script setup lang="ts">
/**
 * Frame for one command-centre widget. The live dot and "updated" label come from the last real
 * refresh; the brief flash plays only when new data arrived (`stamp` changed). The scan line along
 * the top edge is ambient decoration and carries no meaning. The person can expand a widget (taller,
 * and its side column wider) or collapse it to its title bar.
 */
import { Link } from '@inertiajs/vue3';
import { ArrowUpRight, ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-vue-next';
import { computed, ref, watch, type Component } from 'vue';

const props = defineProps<{
    title: string;
    icon: Component;
    secondsAgo: number | null;
    stale: boolean;
    stamp: string | null | undefined;
    error?: string | null;
    demo?: boolean;
    href?: string;
    accent?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';
    size?: WidgetSize;
}>();
const emit = defineEmits<{ resize: [size: WidgetSize] }>();

const collapsed = computed(() => props.size === 'collapsed');
const expanded = computed(() => props.size === 'expanded');

const flash = ref(0);
watch(
    () => props.stamp,
    (value, previous) => {
        if (value && previous && value !== previous) flash.value++;
    },
);

const freshness = computed(() => {
    if (props.error) return { dot: 'bg-rose-400', label: 'Error' };
    if (props.secondsAgo === null) return { dot: 'bg-slate-500', label: 'Loading' };
    if (props.stale) return { dot: 'bg-amber-400', label: `Stale · ${props.secondsAgo}s` };
    return { dot: 'bg-emerald-400 lw-live', label: props.secondsAgo < 2 ? 'Live' : `${props.secondsAgo}s ago` };
});
</script>

<template>
    <section
        class="lw relative flex min-h-0 flex-col overflow-hidden rounded-2xl"
        :class="[`lw-${accent ?? 'cyan'}`, { 'lw-expanded': expanded }]"
        :data-size="size ?? 'normal'"
        :aria-label="title"
    >
        <span class="lw-scan" aria-hidden="true" />
        <span :key="flash" class="lw-flash" :class="{ 'lw-flash-on': flash > 0 }" aria-hidden="true" />

        <header class="relative flex shrink-0 items-center gap-2 px-3" :class="collapsed ? 'py-2' : 'pb-1.5 pt-2.5'">
            <span class="lw-icon grid size-6 place-items-center rounded-md"><component :is="icon" class="size-3.5" /></span>
            <h2 class="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200">{{ title }}</h2>
            <span v-if="demo" class="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-200" title="Simulated figures, not production data">Demo</span>
            <span class="flex items-center gap-1 text-[10px] tabular-nums text-slate-500" :title="error ?? undefined">
                <span class="size-1.5 rounded-full" :class="freshness.dot" aria-hidden="true" />{{ freshness.label }}
            </span>
            <span class="flex shrink-0 items-center">
                <Link v-if="href" :href="href" class="lw-btn" :aria-label="`Open ${title}`" :title="`Open ${title}`"><ArrowUpRight class="size-3.5" /></Link>
                <button
                    v-if="!collapsed"
                    type="button"
                    class="lw-btn"
                    :aria-pressed="expanded"
                    :aria-label="expanded ? `Shrink ${title}` : `Expand ${title}`"
                    :title="expanded ? 'Shrink' : 'Expand'"
                    @click="emit('resize', expanded ? 'normal' : 'expanded')"
                >
                    <Minimize2 v-if="expanded" class="size-3.5" /><Maximize2 v-else class="size-3.5" />
                </button>
                <button
                    type="button"
                    class="lw-btn"
                    :aria-expanded="!collapsed"
                    :aria-label="collapsed ? `Show ${title}` : `Collapse ${title}`"
                    :title="collapsed ? 'Show' : 'Collapse'"
                    @click="emit('resize', collapsed ? 'normal' : 'collapsed')"
                >
                    <ChevronDown v-if="collapsed" class="size-3.5" /><ChevronUp v-else class="size-3.5" />
                </button>
            </span>
        </header>

        <div v-if="!collapsed" class="relative min-h-0 flex-1 px-3 pb-2.5">
            <p v-if="error" class="rounded-lg border border-rose-400/20 bg-rose-400/10 px-2.5 py-2 text-[11px] text-rose-200">{{ error }}</p>
            <slot v-else />
        </div>
    </section>
</template>

<style scoped>
.lw {
    --lw-rgb: 34, 211, 238;
    border: 1px solid rgba(var(--lw-rgb), 0.14);
    background:
        linear-gradient(180deg, rgba(var(--lw-rgb), 0.06), transparent 40%),
        rgba(8, 14, 28, 0.62);
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.02) inset,
        0 18px 40px -24px rgba(var(--lw-rgb), 0.45);
}
.lw-violet { --lw-rgb: 167, 139, 250; }
.lw-emerald { --lw-rgb: 52, 211, 153; }
.lw-amber { --lw-rgb: 251, 191, 36; }
.lw-rose { --lw-rgb: 251, 113, 133; }
.lw-sky { --lw-rgb: 56, 189, 248; }
.lw-icon {
    color: rgb(var(--lw-rgb));
    background: rgba(var(--lw-rgb), 0.12);
    box-shadow: 0 0 14px rgba(var(--lw-rgb), 0.25);
}
.lw-expanded {
    border-color: rgba(var(--lw-rgb), 0.32);
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.03) inset,
        0 24px 50px -22px rgba(var(--lw-rgb), 0.6);
}
.lw-btn {
    display: grid;
    place-items: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.4rem;
    color: rgb(100 116 139);
    transition: background-color 0.15s, color 0.15s;
}
.lw-btn:hover,
.lw-btn[aria-pressed='true'] {
    background: rgba(var(--lw-rgb), 0.12);
    color: rgb(var(--lw-rgb));
}
.lw-btn:focus-visible {
    outline: 2px solid rgba(var(--lw-rgb), 0.6);
    outline-offset: 1px;
}
.lw-scan {
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(var(--lw-rgb), 0.9), transparent);
    background-size: 40% 100%;
    background-repeat: no-repeat;
    animation: lw-scan 5.5s linear infinite;
    pointer-events: none;
}
.lw-flash {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
}
.lw-flash-on {
    animation: lw-flash 1.2s ease-out;
}
.lw-live {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6);
    animation: lw-ping 2s ease-out infinite;
}
@keyframes lw-scan {
    from { background-position: -40% 0; }
    to { background-position: 140% 0; }
}
@keyframes lw-flash {
    0% { opacity: 1; box-shadow: inset 0 0 0 1px rgba(var(--lw-rgb), 0.7), inset 0 0 28px rgba(var(--lw-rgb), 0.18); }
    100% { opacity: 0; box-shadow: inset 0 0 0 1px rgba(var(--lw-rgb), 0), inset 0 0 28px rgba(var(--lw-rgb), 0); }
}
@keyframes lw-ping {
    0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.55); }
    100% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
}
@media (prefers-reduced-motion: reduce) {
    .lw-scan, .lw-live, .lw-flash-on { animation: none; }
}
</style>

<style>
/* Lists inside a widget scroll on their own; the page itself never scrolls. */
.lw-list {
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.2) transparent;
}
</style>

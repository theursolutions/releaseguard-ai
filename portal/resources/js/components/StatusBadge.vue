<script setup lang="ts">
import { cn } from '@/lib/utils';
import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-vue-next';
import { computed } from 'vue';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const props = defineProps<{ status: string; label?: string }>();

// Every status pairs a colour with an icon and a word, so meaning never depends on colour alone.
const map: Record<string, { tone: Tone; label: string; icon: unknown; spin?: boolean }> = {
    completed: { tone: 'success', label: 'Completed', icon: CircleCheck },
    connected: { tone: 'success', label: 'Connected', icon: CircleCheck },
    online: { tone: 'success', label: 'Online', icon: CircleCheck },
    OK: { tone: 'success', label: 'OK', icon: CircleCheck },
    ready: { tone: 'success', label: 'Ready', icon: CircleCheck },
    queued: { tone: 'info', label: 'Queued', icon: CircleDashed },
    running: { tone: 'info', label: 'Running', icon: LoaderCircle, spin: true },
    untested: { tone: 'warning', label: 'Not tested', icon: CircleHelp },
    warning: { tone: 'warning', label: 'Warning', icon: TriangleAlert },
    not_ready: { tone: 'warning', label: 'Not ready', icon: TriangleAlert },
    INSUFFICIENT_DATA: { tone: 'neutral', label: 'No data', icon: CircleHelp },
    failed: { tone: 'danger', label: 'Failed', icon: CircleAlert },
    offline: { tone: 'danger', label: 'Offline', icon: CircleAlert },
    critical: { tone: 'danger', label: 'Critical', icon: CircleAlert },
    ALARM: { tone: 'danger', label: 'In alarm', icon: CircleAlert },
    not_configured: { tone: 'neutral', label: 'Not set up', icon: CircleDashed },
};

const tones: Record<Tone, string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
    danger: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
    info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300',
    neutral: 'border-border bg-muted text-muted-foreground',
};

const config = computed(() => map[props.status] ?? { tone: 'neutral' as Tone, label: props.status, icon: CircleHelp });
</script>

<template>
    <span :class="cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', tones[config.tone])">
        <component :is="config.icon" :class="cn('size-3.5', config.spin && 'animate-spin')" aria-hidden="true" />
        {{ label ?? config.label }}
    </span>
</template>

<script setup lang="ts">
import type { ToolkitSection } from '@/types/assistant';
import { computed } from 'vue';

const props = defineProps<{ section: ToolkitSection }>();

const counts = computed(() => [
    { label: 'Commands', value: props.section.skills?.length ?? 0 },
    { label: 'Agents', value: props.section.agents?.length ?? 0 },
    { label: 'Rules', value: props.section.rules?.length ?? 0 },
    { label: 'Hooks', value: props.section.hooks?.length ?? 0 },
]);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <p v-if="!section.available" class="text-[11px] text-slate-400">{{ section.note }}</p>
        <template v-else>
            <div class="grid shrink-0 grid-cols-4 gap-1.5">
                <div v-for="item in counts" :key="item.label" class="rounded-lg border border-violet-300/15 bg-violet-400/[0.06] px-1.5 py-1 text-center">
                    <span class="block text-base font-semibold tabular-nums leading-tight text-violet-100">{{ item.value }}</span>
                    <span class="text-[9px] uppercase tracking-wider text-slate-400">{{ item.label }}</span>
                </div>
            </div>
            <div class="lw-list min-h-0 flex-1 overflow-y-auto">
                <p class="flex flex-wrap gap-1">
                    <span v-for="skill in section.skills" :key="skill" class="rounded border border-white/10 bg-white/[0.04] px-1.5 py-px font-mono text-[10px] text-slate-300">/{{ skill }}</span>
                </p>
                <ul class="mt-1.5 space-y-0.5">
                    <li v-for="doc in section.docs" :key="doc.file" class="truncate text-[10px] text-slate-400">▸ {{ doc.title }}</li>
                </ul>
            </div>
        </template>
    </div>
</template>

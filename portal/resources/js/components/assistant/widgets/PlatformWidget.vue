<script setup lang="ts">
import type { PlatformSection } from '@/types/assistant';
import { computed } from 'vue';

const props = defineProps<{ section: PlatformSection }>();

const connected = computed(() => (props.section.connections ?? []).filter((c) => c.status === 'connected').length);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2">
        <div class="flex shrink-0 items-baseline justify-between">
            <p class="text-lg font-semibold tabular-nums text-sky-100">
                {{ section.online }}<span class="text-sm text-slate-500">/{{ section.services.length }}</span>
                <span class="ml-1 text-[10px] font-normal text-slate-400">services online</span>
            </p>
        </div>
        <div class="lw-list min-h-0 flex-1 overflow-y-auto">
            <ul class="space-y-1">
                <li v-for="service in section.services" :key="service.name" class="flex items-center gap-2 text-[11px]">
                    <span class="relative flex size-2 shrink-0" aria-hidden="true">
                        <span v-if="service.online" class="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
                        <span class="relative size-2 rounded-full" :class="service.online ? 'bg-emerald-400' : 'bg-rose-400'" />
                    </span>
                    <span class="min-w-0 flex-1 truncate text-slate-300">{{ service.title }}</span>
                    <span class="tabular-nums text-slate-500">{{ service.online ? `v${service.version ?? '?'}` : service.error ?? 'offline' }}</span>
                </li>
            </ul>
            <div class="mt-1.5 space-y-0.5 border-t border-white/5 pt-1.5 text-[10px]">
                <p class="truncate" :class="section.ai_provider.configured ? 'text-slate-300' : 'text-amber-200'" :title="section.ai_provider.note">
                    AI provider: {{ section.ai_provider.configured ? `${section.ai_provider.label} (configured)` : 'not set up' }}
                </p>
                <p v-if="section.connections" class="text-slate-500">{{ connected }} of {{ section.connections.length }} connections connected</p>
            </div>
        </div>
    </div>
</template>

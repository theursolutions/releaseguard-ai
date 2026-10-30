<script setup lang="ts">
import { SidebarInset } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

interface Props {
    variant?: 'header' | 'sidebar';
    class?: string;
}

const props = defineProps<Props>();
// The content panel is translucent so the animated backdrop shows through softly.
const className = computed(() => cn('bg-white/45 backdrop-blur-2xl dark:bg-transparent dark:backdrop-blur-none', props.class));
</script>

<template>
    <SidebarInset v-if="props.variant === 'sidebar'" :class="className">
        <slot />
    </SidebarInset>
    <main v-else class="mx-auto flex h-full w-full max-w-7xl flex-1 flex-col gap-4 rounded-xl" :class="props.class">
        <slot />
    </main>
</template>

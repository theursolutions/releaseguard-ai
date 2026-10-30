<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{
    class?: HTMLAttributes['class'];
}>();
</script>

<template>
    <!-- Frosted glass: white in light mode, translucent navy with an edge glow in dark mode (see .glass in app.css). -->
    <div :class="cn('glass relative rounded-2xl text-card-foreground', props.class)">
        <slot />
    </div>
</template>

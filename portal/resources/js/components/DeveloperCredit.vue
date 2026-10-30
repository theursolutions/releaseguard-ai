<script setup lang="ts">
/** "Developed by" credit: the developer's photo in a circle with a slowly turning colour ring. */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>

<template>
    <div class="flex items-center gap-2.5" :class="compact ? 'text-[11px]' : 'text-xs'">
        <span class="dc-ring relative grid shrink-0 place-items-center rounded-full" :class="compact ? 'size-6' : 'size-9'" aria-hidden="true">
            <img src="/images/team/muhammad-umer.jpg" alt="" class="relative size-full rounded-full border-2 border-background object-cover" />
        </span>
        <p class="leading-tight text-muted-foreground">
            Developed by <span class="font-semibold text-foreground">Muhammad Umer</span>
            <template v-if="!compact"><br /><span>Senior Full Stack Developer · Ziba Property</span></template>
        </p>
    </div>
</template>

<style scoped>
.dc-ring {
    padding: 2px;
    isolation: isolate;
}
.dc-ring::before,
.dc-ring::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    background: conic-gradient(from 0deg, #22d3ee, #818cf8, #e879f9, #fb7185, #fbbf24, #34d399, #22d3ee);
    animation: dc-spin 4s linear infinite;
    z-index: -1;
}
/* A soft glow of the same colours. */
.dc-ring::after {
    inset: -3px;
    filter: blur(6px);
    opacity: 0.55;
}
@keyframes dc-spin {
    to {
        transform: rotate(360deg);
    }
}
@media (prefers-reduced-motion: reduce) {
    .dc-ring::before,
    .dc-ring::after {
        animation: none;
    }
}
</style>

<script setup lang="ts">
defineProps<{
    title: string;
    description?: string;
}>();
</script>

<template>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0 space-y-1">
            <h1 class="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{{ title }}</h1>
            <!-- Long links (a Confluence page address) wrap instead of widening the page on phones. -->
            <p v-if="description" class="max-w-2xl text-sm text-muted-foreground [overflow-wrap:anywhere]">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
            <slot name="actions" />
        </div>
    </div>
</template>

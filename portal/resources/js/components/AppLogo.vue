<script setup lang="ts">
import { ShieldCheck } from 'lucide-vue-next';
</script>

<template>
    <div class="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <ShieldCheck class="size-5" aria-hidden="true" />
    </div>
    <div class="ml-1 grid flex-1 text-left text-sm">
        <span class="mb-0.5 truncate font-semibold leading-none">ReleaseGuard AI</span>
        <span class="truncate text-xs text-muted-foreground">Delivery platform</span>
    </div>
</template>

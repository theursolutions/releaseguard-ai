<script setup lang="ts">
import { type SharedData } from '@/types';
import { usePage } from '@inertiajs/vue3';
import { CircleAlert, CircleCheck, X } from 'lucide-vue-next';
import { ref, watch } from 'vue';

const page = usePage<SharedData>();
const visible = ref(true);

// Show again whenever the server sends a new message.
watch(
    () => [page.props.flash?.success, page.props.flash?.error],
    () => (visible.value = true),
);
</script>

<template>
    <div v-if="visible && (page.props.flash?.success || page.props.flash?.error)" class="px-4 pt-4" role="status" aria-live="polite">
        <div
            :class="[
                'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
                page.props.flash.error
                    ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100',
            ]"
        >
            <CircleAlert v-if="page.props.flash.error" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <CircleCheck v-else class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p class="flex-1">{{ page.props.flash.error ?? page.props.flash.success }}</p>
            <button type="button" class="rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Dismiss" @click="visible = false">
                <X class="size-4" />
            </button>
        </div>
    </div>
</template>

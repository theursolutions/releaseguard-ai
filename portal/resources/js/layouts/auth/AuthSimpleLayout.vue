<script setup lang="ts">
import AppBackground from '@/components/AppBackground.vue';
import DeveloperCredit from '@/components/DeveloperCredit.vue';
import { Link } from '@inertiajs/vue3';
import { ShieldCheck } from 'lucide-vue-next';

defineProps<{
    title?: string;
    description?: string;
}>();
</script>

<template>
    <div class="relative flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AppBackground />
        <div class="w-full max-w-sm">
            <div v-tilt="{ max: 4, scale: 1 }" class="glass reveal relative flex flex-col gap-8 rounded-3xl p-8">
                <span class="tilt-glare" />
                <div class="flex flex-col items-center gap-4">
                    <Link :href="route('home')" class="flex flex-col items-center gap-2 font-medium">
                        <div
                            class="mb-1 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/30 [animation:rg-float_5s_ease-in-out_infinite]"
                        >
                            <ShieldCheck class="size-7" aria-hidden="true" />
                        </div>
                        <span class="sr-only">ReleaseGuard AI</span>
                    </Link>
                    <div class="space-y-2 text-center">
                        <p class="shimmer-text text-sm font-semibold uppercase tracking-[0.2em]">ReleaseGuard AI</p>
                        <h1 class="text-xl font-semibold">{{ title }}</h1>
                        <p class="text-center text-sm text-muted-foreground">{{ description }}</p>
                    </div>
                </div>
                <slot />
            </div>
        </div>
        <DeveloperCredit class="relative" />
    </div>
</template>

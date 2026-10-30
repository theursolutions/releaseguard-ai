<script setup lang="ts">
import AppBackground from '@/components/AppBackground.vue';
import AppContent from '@/components/AppContent.vue';
import AppShell from '@/components/AppShell.vue';
import AppSidebar from '@/components/AppSidebar.vue';
import AppSidebarHeader from '@/components/AppSidebarHeader.vue';
import DeveloperCredit from '@/components/DeveloperCredit.vue';
import FlashMessages from '@/components/FlashMessages.vue';
import type { BreadcrumbItemType } from '@/types';

interface Props {
    breadcrumbs?: BreadcrumbItemType[];
}

withDefaults(defineProps<Props>(), {
    breadcrumbs: () => [],
});
</script>

<template>
    <AppShell variant="sidebar">
        <AppBackground />
        <AppSidebar />
        <AppContent variant="sidebar">
            <AppSidebarHeader :breadcrumbs="breadcrumbs" />
            <FlashMessages />
            <slot />
            <footer class="mt-auto flex justify-end px-4 pb-4 pt-2 md:px-6">
                <DeveloperCredit />
            </footer>
        </AppContent>
    </AppShell>
</template>

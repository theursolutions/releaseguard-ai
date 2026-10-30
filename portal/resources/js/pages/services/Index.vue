<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AppLayout from '@/layouts/AppLayout.vue';
import { type BreadcrumbItem } from '@/types';
import { Head, router } from '@inertiajs/vue3';
import { Boxes, RefreshCw } from 'lucide-vue-next';

interface ServiceStatus {
    name: string;
    title: string;
    url: string;
    token_configured: boolean;
    online: boolean;
    version?: string;
    description?: string;
    capabilities?: string[];
    requires?: string[];
    optional?: string[];
    error?: string | null;
}

defineProps<{
    services: ServiceStatus[];
    connected: Record<string, boolean>;
    labels: Record<string, string>;
}>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Services', href: '/services' }];
</script>

<template>
    <Head title="Services" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader
                title="Services"
                description="Each ReleaseGuard tool runs as its own microservice. The portal is the only caller, and each service receives only the connections it needs."
            >
                <template #actions>
                    <Button variant="outline" size="sm" @click="router.reload()"><RefreshCw class="size-4" /> Refresh</Button>
                </template>
            </PageHeader>

            <div class="grid gap-4 lg:grid-cols-2">
                <Card v-for="(service, i) in services" :key="service.name" v-tilt="{ max: 4 }" class="reveal" :style="{ '--i': i + 1 }"><span class="tilt-glare" />
                    <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
                        <div class="space-y-1">
                            <CardTitle class="flex items-center gap-2 text-base">
                                <Boxes class="size-4" aria-hidden="true" /> {{ service.title }}
                                <span v-if="service.version" class="text-xs font-normal text-muted-foreground">v{{ service.version }}</span>
                            </CardTitle>
                            <CardDescription>{{ service.description ?? service.url }}</CardDescription>
                        </div>
                        <StatusBadge :status="service.online ? 'online' : 'offline'" />
                    </CardHeader>
                    <CardContent class="space-y-4 text-sm">
                        <dl class="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
                            <dt class="text-muted-foreground">Address</dt>
                            <dd class="truncate font-mono text-xs">{{ service.url }}</dd>
                            <dt class="text-muted-foreground">Access token</dt>
                            <dd>{{ service.token_configured ? 'Configured' : 'Missing (set it in the portal .env)' }}</dd>
                            <template v-if="service.error">
                                <dt class="text-muted-foreground">Problem</dt>
                                <dd class="text-red-700 dark:text-red-400">{{ service.error }}</dd>
                            </template>
                        </dl>

                        <div v-if="service.requires?.length || service.optional?.length" class="space-y-2">
                            <p class="font-medium">Connections it uses</p>
                            <ul class="flex flex-wrap gap-2">
                                <li v-for="type in [...(service.requires ?? []), ...(service.optional ?? [])]" :key="type" class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                                    {{ labels[type] ?? type }}
                                    <span v-if="service.requires?.includes(type)" class="text-muted-foreground">(required)</span>
                                    <StatusBadge :status="connected[type] ? 'connected' : 'not_configured'" />
                                </li>
                            </ul>
                        </div>

                        <div v-if="service.capabilities?.length" class="space-y-2">
                            <p class="font-medium">Capabilities</p>
                            <ul class="flex flex-wrap gap-1.5">
                                <li v-for="capability in service.capabilities" :key="capability" class="rounded bg-muted px-2 py-0.5 font-mono text-xs">{{ capability }}</li>
                            </ul>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

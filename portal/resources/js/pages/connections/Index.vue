<script setup lang="ts">
import InputError from '@/components/InputError.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/AppLayout.vue';
import { timeAgo } from '@/lib/format';
import { type BreadcrumbItem } from '@/types';
import { Head, router, useForm } from '@inertiajs/vue3';
import { LoaderCircle, LockKeyhole } from 'lucide-vue-next';
import { ref } from 'vue';

interface Field {
    label: string;
    secret: boolean;
    placeholder: string;
    help?: string;
    type?: 'select';
    options?: Record<string, string>;
    show_when?: Record<string, string>;
    value: string;
    is_set: boolean;
    hint: string | null;
}

interface ConnectionView {
    type: string;
    label: string;
    description: string;
    fields: Record<string, Field>;
    configured: boolean;
    status: string;
    last_tested_at: string | null;
    last_error: string | null;
}

const props = defineProps<{ connections: ConnectionView[] }>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Connections', href: '/connections' }];

// One form per connection. Secret inputs start empty: leaving them empty keeps the saved value.
const forms = Object.fromEntries(
    props.connections.map((connection) => [
        connection.type,
        useForm(
            Object.fromEntries(
                Object.entries(connection.fields).map(([key, field]) => [
                    key,
                    // Dropdowns default to their first option (for Claude: company API key).
                    field.secret ? '' : field.value || (field.type === 'select' ? Object.keys(field.options ?? {})[0] : ''),
                ]),
            ),
        ),
    ]),
);

// Fields with show_when only appear when the form matches, e.g. the Bedrock region only for the Bedrock method.
const visible = (type: string, field: Field) =>
    !field.show_when || Object.entries(field.show_when).every(([key, value]) => forms[type][key] === value);

const testing = ref<string | null>(null);

function save(type: string) {
    forms[type].put(route('connections.update', { type }), {
        preserveScroll: true,
        onSuccess: () => {
            const connection = props.connections.find((c) => c.type === type);
            Object.entries(connection?.fields ?? {}).forEach(([key, field]) => {
                if (field.secret) forms[type][key] = '';
            });
        },
    });
}

function test(type: string) {
    testing.value = type;
    router.post(route('connections.test', { type }), {}, { preserveScroll: true, onFinish: () => (testing.value = null) });
}
</script>

<template>
    <Head title="Connections" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader
                title="Connections"
                description="Connect the tools ReleaseGuard works with. Keys are encrypted, never shown again after saving, and sent only to the service that needs them."
            />

            <div class="grid gap-4 xl:grid-cols-2">
                <Card v-for="(connection, index) in connections" :key="connection.type" class="reveal flex flex-col" :style="{ '--i': index + 1 }">
                    <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
                        <div class="space-y-1">
                            <CardTitle class="text-base">{{ connection.label }}</CardTitle>
                            <CardDescription>{{ connection.description }}</CardDescription>
                        </div>
                        <StatusBadge :status="connection.configured ? connection.status : 'not_configured'" />
                    </CardHeader>

                    <form class="flex flex-1 flex-col" @submit.prevent="save(connection.type)">
                        <CardContent class="flex-1 space-y-4">
                            <template v-for="(field, key) in connection.fields" :key="key">
                            <div v-if="visible(connection.type, field)" class="grid gap-1.5">
                                <Label :for="`${connection.type}-${key}`" class="flex items-center gap-1.5">
                                    {{ field.label }}
                                    <LockKeyhole v-if="field.secret" class="size-3 text-muted-foreground" aria-label="Secret" />
                                </Label>
                                <select
                                    v-if="field.type === 'select'"
                                    :id="`${connection.type}-${key}`"
                                    v-model="forms[connection.type][key]"
                                    class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <option v-for="(optionLabel, optionValue) in field.options" :key="optionValue" :value="optionValue">{{ optionLabel }}</option>
                                </select>
                                <Input
                                    v-else
                                    :id="`${connection.type}-${key}`"
                                    v-model="forms[connection.type][key]"
                                    :type="field.secret ? 'password' : 'text'"
                                    :placeholder="field.secret && field.is_set ? `Saved (${field.hint}). Leave empty to keep it.` : field.placeholder"
                                    autocomplete="off"
                                    spellcheck="false"
                                />
                                <p v-if="field.help" class="text-xs text-muted-foreground">{{ field.help }}</p>
                                <InputError :message="forms[connection.type].errors[key]" />
                            </div>
                            </template>
                            <p v-if="connection.last_error" class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
                                Last test failed: {{ connection.last_error }}
                            </p>
                        </CardContent>

                        <CardFooter class="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                            <span class="text-xs text-muted-foreground">
                                {{ connection.last_tested_at ? `Tested ${timeAgo(connection.last_tested_at)}` : 'Not tested yet' }}
                            </span>
                            <div class="flex gap-2">
                                <Button type="button" variant="outline" size="sm" :disabled="!connection.configured || testing !== null" @click="test(connection.type)">
                                    <LoaderCircle v-if="testing === connection.type" class="size-4 animate-spin" />
                                    Test connection
                                </Button>
                                <Button type="submit" size="sm" :disabled="forms[connection.type].processing">
                                    <LoaderCircle v-if="forms[connection.type].processing" class="size-4 animate-spin" />
                                    Save
                                </Button>
                            </div>
                        </CardFooter>
                    </form>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

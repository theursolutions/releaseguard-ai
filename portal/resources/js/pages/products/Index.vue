<script setup lang="ts">
import InputError from '@/components/InputError.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/AppLayout.vue';
import { type BreadcrumbItem, type Role } from '@/types';
import { Head, router, useForm } from '@inertiajs/vue3';
import { LoaderCircle, Pencil, Trash2 } from 'lucide-vue-next';
import { computed } from 'vue';

interface Product {
    id: number;
    name: string;
    description: string | null;
    alarm_prefix: string | null;
    user_ids: number[];
}

const props = defineProps<{ products: Product[]; users: { id: number; name: string; email: string; role: Role }[] }>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Products', href: '/products' }];

const form = useForm<{ id: number | null; name: string; description: string; alarm_prefix: string; user_ids: number[] }>({
    id: null,
    name: '',
    description: '',
    alarm_prefix: '',
    user_ids: [],
});
const members = computed(() => props.users.filter((user) => user.role !== 'admin'));

function edit(product: Product) {
    form.clearErrors();
    form.id = product.id;
    form.name = product.name;
    form.description = product.description ?? '';
    form.alarm_prefix = product.alarm_prefix ?? '';
    form.user_ids = [...product.user_ids];
}

function cancel() {
    form.reset();
    form.clearErrors();
}

function save() {
    const options = { preserveScroll: true, onSuccess: () => form.reset() };
    if (form.id) form.put(route('products.update', { product: form.id }), options);
    else form.post(route('products.store'), options);
}

function remove(product: Product) {
    if (confirm(`Remove ${product.name}? Its PRD reviews are kept without a product.`)) {
        router.delete(route('products.destroy', { product: product.id }), { preserveScroll: true });
    }
}

function names(ids: number[]) {
    const list = props.users.filter((user) => ids.includes(user.id)).map((user) => user.name);
    return list.length ? list.join(', ') : 'No members assigned';
}
</script>

<template>
    <Head title="Products" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader
                title="Products"
                description="Products scope what people see in the assistant. Admins see every product; members only the products they are assigned to."
            />

            <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <Card class="reveal min-w-0 xl:col-span-2">
                    <CardHeader><CardTitle class="text-base">Company products</CardTitle></CardHeader>
                    <CardContent>
                        <p v-if="!products.length" class="text-sm text-muted-foreground">No products yet. Add one to scope PRD reviews and alarms.</p>
                        <ul class="divide-y">
                            <li v-for="product in products" :key="product.id" class="flex items-start gap-3 py-3">
                                <div class="min-w-0 flex-1">
                                    <p class="font-medium">{{ product.name }}</p>
                                    <p v-if="product.description" class="text-sm text-muted-foreground">{{ product.description }}</p>
                                    <p class="mt-1 text-xs text-muted-foreground">
                                        Alarms: <code class="rounded bg-muted px-1">{{ product.alarm_prefix || 'none linked' }}</code>
                                    </p>
                                    <p class="mt-0.5 truncate text-xs text-muted-foreground">Members: {{ names(product.user_ids) }}</p>
                                </div>
                                <Button variant="ghost" size="icon" :aria-label="`Edit ${product.name}`" @click="edit(product)"><Pencil class="size-4" /></Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="text-red-700 hover:text-red-800 dark:text-red-400"
                                    :aria-label="`Remove ${product.name}`"
                                    @click="remove(product)"
                                >
                                    <Trash2 class="size-4" />
                                </Button>
                            </li>
                        </ul>
                    </CardContent>
                </Card>

                <Card class="reveal min-w-0">
                    <CardHeader>
                        <CardTitle class="text-base">{{ form.id ? 'Edit product' : 'Add a product' }}</CardTitle>
                        <CardDescription>The alarm prefix links CloudWatch alarms to the product, e.g. <code>production-crm-</code>.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form class="space-y-4" @submit.prevent="save">
                            <div class="grid gap-1.5">
                                <Label for="name">Name</Label>
                                <Input id="name" v-model="form.name" required maxlength="100" autocomplete="off" />
                                <InputError :message="form.errors.name" />
                            </div>
                            <div class="grid gap-1.5">
                                <Label for="description">Description <span class="font-normal text-muted-foreground">(optional)</span></Label>
                                <Input id="description" v-model="form.description" maxlength="255" autocomplete="off" />
                                <InputError :message="form.errors.description" />
                            </div>
                            <div class="grid gap-1.5">
                                <Label for="alarm_prefix">Alarm prefix <span class="font-normal text-muted-foreground">(optional)</span></Label>
                                <Input id="alarm_prefix" v-model="form.alarm_prefix" maxlength="100" autocomplete="off" />
                                <InputError :message="form.errors.alarm_prefix" />
                            </div>
                            <fieldset class="grid gap-1.5">
                                <legend class="mb-1 text-sm font-medium">Members with access</legend>
                                <p v-if="!members.length" class="text-xs text-muted-foreground">No members yet. Admins already see every product.</p>
                                <label v-for="user in members" :key="user.id" class="flex items-center gap-2 text-sm">
                                    <input v-model="form.user_ids" type="checkbox" :value="user.id" class="rounded border-input" />
                                    <span class="truncate">{{ user.name }}</span>
                                </label>
                                <InputError :message="form.errors.user_ids" />
                            </fieldset>
                            <div class="flex gap-2">
                                <Button type="submit" class="flex-1" :disabled="form.processing">
                                    <LoaderCircle v-if="form.processing" class="size-4 animate-spin" />
                                    {{ form.id ? 'Save changes' : 'Add product' }}
                                </Button>
                                <Button v-if="form.id" type="button" variant="outline" @click="cancel">Cancel</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

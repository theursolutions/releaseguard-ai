<script setup lang="ts">
import InputError from '@/components/InputError.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/AppLayout.vue';
import { type BreadcrumbItem, type Role, type SharedData } from '@/types';
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { LoaderCircle, Trash2 } from 'lucide-vue-next';

defineProps<{ users: { id: number; name: string; email: string; role: Role; created_at: string }[] }>();

const page = usePage<SharedData>();
const breadcrumbs: BreadcrumbItem[] = [{ title: 'Users', href: '/users' }];

const form = useForm({ name: '', email: '', role: 'member' as Role, password: '' });

function create() {
    form.post(route('users.store'), { preserveScroll: true, onSuccess: () => form.reset() });
}

function changeRole(id: number, role: string) {
    router.patch(route('users.update', { user: id }), { role }, { preserveScroll: true });
}

function remove(id: number, name: string) {
    if (confirm(`Remove ${name}? Their PRD reviews are removed too.`)) {
        router.delete(route('users.destroy', { user: id }), { preserveScroll: true });
    }
}

const selectClass =
    'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
</script>

<template>
    <Head title="Users" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader title="Users" description="Admins manage connections, services and users. Members use the tools." />

            <div class="grid gap-6 xl:grid-cols-3">
                <Card class="reveal xl:col-span-2">
                    <CardHeader><CardTitle class="text-base">Team</CardTitle></CardHeader>
                    <CardContent class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <th class="py-2 pr-3 font-medium">Name</th>
                                    <th class="py-2 pr-3 font-medium">Role</th>
                                    <th class="py-2"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y">
                                <tr v-for="user in users" :key="user.id">
                                    <td class="py-3 pr-3">
                                        <p class="font-medium">{{ user.name }} <span v-if="user.id === page.props.auth.user.id" class="text-xs text-muted-foreground">(you)</span></p>
                                        <p class="text-xs text-muted-foreground">{{ user.email }}</p>
                                    </td>
                                    <td class="py-3 pr-3">
                                        <label :for="`role-${user.id}`" class="sr-only">Role for {{ user.name }}</label>
                                        <select
                                            :id="`role-${user.id}`"
                                            :value="user.role"
                                            :class="selectClass"
                                            @change="changeRole(user.id, ($event.target as HTMLSelectElement).value)"
                                        >
                                            <option value="member">Member</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>
                                    <td class="py-3 text-right">
                                        <Button
                                            v-if="user.id !== page.props.auth.user.id"
                                            variant="ghost"
                                            size="icon"
                                            class="text-red-700 hover:text-red-800 dark:text-red-400"
                                            :aria-label="`Remove ${user.name}`"
                                            @click="remove(user.id, user.name)"
                                        >
                                            <Trash2 class="size-4" />
                                        </Button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </CardContent>
                </Card>

                <Card class="reveal">
                    <CardHeader>
                        <CardTitle class="text-base">Add a user</CardTitle>
                        <CardDescription>Share the temporary password privately. They can change it under Settings.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form class="space-y-4" @submit.prevent="create">
                            <div class="grid gap-1.5">
                                <Label for="name">Name</Label>
                                <Input id="name" v-model="form.name" required autocomplete="off" />
                                <InputError :message="form.errors.name" />
                            </div>
                            <div class="grid gap-1.5">
                                <Label for="email">Email</Label>
                                <Input id="email" v-model="form.email" type="email" required autocomplete="off" />
                                <InputError :message="form.errors.email" />
                            </div>
                            <div class="grid gap-1.5">
                                <Label for="role">Role</Label>
                                <select id="role" v-model="form.role" :class="selectClass">
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                </select>
                                <InputError :message="form.errors.role" />
                            </div>
                            <div class="grid gap-1.5">
                                <Label for="password">Temporary password</Label>
                                <Input id="password" v-model="form.password" type="password" required autocomplete="new-password" />
                                <InputError :message="form.errors.password" />
                            </div>
                            <Button type="submit" class="w-full" :disabled="form.processing">
                                <LoaderCircle v-if="form.processing" class="size-4 animate-spin" />
                                Add user
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

<script setup lang="ts">
import InputError from '@/components/InputError.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/AppLayout.vue';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type BreadcrumbItem, type Paginated, type PrdAnalysis, type SharedData } from '@/types';
import { Head, Link, useForm, usePage } from '@inertiajs/vue3';
import { ClipboardPaste, FileUp, Link2, LoaderCircle, UploadCloud } from 'lucide-vue-next';
import { computed, ref } from 'vue';

const props = defineProps<{
    analyses: Paginated<PrdAnalysis>;
    aiConnected: boolean;
    confluenceConnected: boolean;
    readyScore: number;
    products: { id: number; name: string }[];
}>();

const page = usePage<SharedData>();
const breadcrumbs: BreadcrumbItem[] = [{ title: 'PRD Checker', href: '/prd' }];

type Source = 'upload' | 'confluence' | 'text';
const sources: { value: Source; label: string; icon: unknown }[] = [
    { value: 'upload', label: 'Upload file', icon: FileUp },
    { value: 'confluence', label: 'Confluence', icon: Link2 },
    { value: 'text', label: 'Paste text', icon: ClipboardPaste },
];

const form = useForm<{ source_type: Source; product_id: number | ''; title: string; file: File | null; url: string; text: string }>({
    source_type: 'upload',
    product_id: '',
    title: '',
    file: null,
    url: '',
    text: '',
});

const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function pickFile(files: FileList | null | undefined) {
    form.file = files?.[0] ?? null;
}

function submit() {
    form.post(route('prd.store'), { forceFormData: true });
}

const canSubmit = computed(() => {
    if (!props.aiConnected || form.processing) return false;
    if (form.source_type === 'upload') return !!form.file;
    if (form.source_type === 'confluence') return props.confluenceConnected && form.url.length > 10;
    return form.text.trim().length >= 50;
});

const fileSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);
</script>

<template>
    <Head title="PRD Checker" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageHeader
                title="PRD Checker"
                :description="`Upload a PRD to get its actors and flows, Given/When/Then criteria, questions for the PM, flow diagrams and a readiness score. Stories need ${readyScore}+ to enter a sprint.`"
            />

            <div class="grid gap-6 xl:grid-cols-5">
                <Card class="reveal xl:col-span-2">
                    <CardHeader>
                        <CardTitle class="text-base">New review</CardTitle>
                        <CardDescription>PDF, Word (.docx), Markdown or text, up to 20 MB.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div v-if="!aiConnected" class="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                            No AI provider is connected yet.
                            <Link v-if="page.props.auth.isAdmin" :href="route('connections.index')" class="font-medium underline">Connect it</Link>
                            <span v-else>Ask an admin to connect it.</span>
                        </div>

                        <form class="space-y-4" @submit.prevent="submit">
                            <div role="tablist" aria-label="PRD source" class="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                                <button
                                    v-for="source in sources"
                                    :key="source.value"
                                    type="button"
                                    role="tab"
                                    :aria-selected="form.source_type === source.value"
                                    :class="
                                        cn(
                                            'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
                                            form.source_type === source.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                                        )
                                    "
                                    @click="form.source_type = source.value"
                                >
                                    <component :is="source.icon" class="size-4" aria-hidden="true" />
                                    {{ source.label }}
                                </button>
                            </div>

                            <div v-if="products.length" class="grid gap-1.5">
                                <Label for="product">Product <span class="font-normal text-muted-foreground">(optional)</span></Label>
                                <select
                                    id="product"
                                    v-model="form.product_id"
                                    class="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <option value="">No product</option>
                                    <option v-for="product in products" :key="product.id" :value="product.id">{{ product.name }}</option>
                                </select>
                                <InputError :message="form.errors.product_id" />
                            </div>

                            <div class="grid gap-1.5">
                                <Label for="title">Title <span class="font-normal text-muted-foreground">(optional)</span></Label>
                                <Input id="title" v-model="form.title" placeholder="e.g. Agent invitations v2" maxlength="255" />
                                <InputError :message="form.errors.title" />
                            </div>

                            <div v-if="form.source_type === 'upload'" class="grid gap-1.5">
                                <Label for="file">PRD file</Label>
                                <label
                                    for="file"
                                    :class="
                                        cn(
                                            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-ring',
                                            dragging ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/60 hover:bg-muted/50',
                                        )
                                    "
                                    @dragover.prevent="dragging = true"
                                    @dragleave.prevent="dragging = false"
                                    @drop.prevent="
                                        dragging = false;
                                        pickFile($event.dataTransfer?.files);
                                    "
                                >
                                    <UploadCloud class="size-8 text-muted-foreground" aria-hidden="true" />
                                    <span v-if="form.file" class="text-sm font-medium">{{ form.file.name }} · {{ fileSize(form.file.size) }}</span>
                                    <span v-else class="text-sm"><span class="font-medium text-primary">Choose a file</span> or drag it here</span>
                                    <span class="text-xs text-muted-foreground">.pdf, .docx, .md, .txt</span>
                                    <input id="file" ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx,.md,.txt" @change="pickFile(($event.target as HTMLInputElement).files)" />
                                </label>
                                <InputError :message="form.errors.file" />
                            </div>

                            <div v-else-if="form.source_type === 'confluence'" class="grid gap-1.5">
                                <Label for="url">Confluence page link</Label>
                                <Input id="url" v-model="form.url" type="url" placeholder="https://your-company.atlassian.net/wiki/spaces/…/pages/123456/…" :disabled="!confluenceConnected" />
                                <p v-if="!confluenceConnected" class="text-xs text-muted-foreground">Jira & Confluence is not connected. Upload the PRD as a file instead.</p>
                                <InputError :message="form.errors.url" />
                            </div>

                            <div v-else class="grid gap-1.5">
                                <Label for="text">PRD text</Label>
                                <textarea
                                    id="text"
                                    v-model="form.text"
                                    rows="10"
                                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    placeholder="Paste the requirements here…"
                                />
                                <InputError :message="form.errors.text" />
                            </div>

                            <InputError :message="form.errors.source_type" />

                            <Button type="submit" class="w-full" :disabled="!canSubmit">
                                <LoaderCircle v-if="form.processing" class="size-4 animate-spin" />
                                Review PRD
                            </Button>
                            <p class="text-center text-xs text-muted-foreground">A review usually takes 1–3 minutes. You can leave this page.</p>
                        </form>
                    </CardContent>
                </Card>

                <Card class="reveal xl:col-span-3">
                    <CardHeader>
                        <CardTitle class="text-base">Reviews</CardTitle>
                        <CardDescription>{{ analyses.total }} so far, shared with the whole team.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div v-if="analyses.data.length" class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead>
                                    <tr class="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th class="py-2 pr-3 font-medium">PRD</th>
                                        <th class="py-2 pr-3 font-medium">Score</th>
                                        <th class="hidden py-2 pr-3 font-medium md:table-cell">By</th>
                                        <th class="py-2 font-medium">When</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y">
                                    <tr v-for="analysis in analyses.data" :key="analysis.id" class="hover:bg-muted/50">
                                        <td class="max-w-[16rem] py-3 pr-3">
                                            <Link :href="route('prd.show', { analysis: analysis.id })" class="block truncate font-medium hover:text-primary">{{ analysis.title }}</Link>
                                            <span class="text-xs capitalize text-muted-foreground">{{ analysis.source_type }}</span>
                                        </td>
                                        <td class="py-3 pr-3">
                                            <span v-if="analysis.status === 'completed' && analysis.score !== null" class="flex items-center gap-2">
                                                <span class="font-semibold tabular-nums">{{ analysis.score }}</span>
                                                <StatusBadge :status="analysis.score >= readyScore ? 'ready' : 'not_ready'" />
                                            </span>
                                            <StatusBadge v-else :status="analysis.status" />
                                        </td>
                                        <td class="hidden py-3 pr-3 text-muted-foreground md:table-cell">{{ analysis.user?.name }}</td>
                                        <td class="whitespace-nowrap py-3 text-muted-foreground">{{ timeAgo(analysis.created_at) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <div v-if="analyses.last_page > 1" class="mt-4 flex items-center justify-between text-sm">
                                <span class="text-muted-foreground">Page {{ analyses.current_page }} of {{ analyses.last_page }}</span>
                                <div class="flex gap-2">
                                    <Button as-child variant="outline" size="sm" :disabled="!analyses.prev_page_url">
                                        <Link :href="analyses.prev_page_url ?? '#'" preserve-scroll>Previous</Link>
                                    </Button>
                                    <Button as-child variant="outline" size="sm" :disabled="!analyses.next_page_url">
                                        <Link :href="analyses.next_page_url ?? '#'" preserve-scroll>Next</Link>
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <p v-else class="py-10 text-center text-sm text-muted-foreground">No reviews yet. Your first one will appear here.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    </AppLayout>
</template>

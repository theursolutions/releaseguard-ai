<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AppLayout from '@/layouts/AppLayout.vue';
import { type BreadcrumbItem } from '@/types';
import { Head, Link } from '@inertiajs/vue3';
import {
    ArrowDown,
    Bot,
    Check,
    ClipboardCheck,
    Copy,
    Download,
    Eye,
    FileText,
    ShieldCheck,
    Sparkles,
    SquareTerminal,
    Users,
    Workflow,
} from 'lucide-vue-next';
import { computed, ref } from 'vue';

interface Catalog {
    available: boolean;
    note?: string;
    plugin?: string;
    version?: string;
    commands?: { name: string; description: string; arguments: string | null }[];
    agents?: { name: string; description: string; read_only: boolean }[];
    rules?: { name: string; title: string }[];
    hooks?: { name: string; description: string }[];
    atlassian_mcp?: boolean;
    docs?: { file: string; title: string }[];
}

const props = defineProps<{
    catalog: Catalog;
    folder: string;
    repoUrl: string | null;
}>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Toolkit', href: '/toolkit' }];

type Source = 'zip' | 'git';
const source = ref<Source>('zip');

const getCommand = computed(() =>
    source.value === 'git' && props.repoUrl ? `git clone ${props.repoUrl} ${props.folder}` : `# Unzip ${props.folder}.zip next to your projects`,
);

const plugin = computed(() => props.catalog.plugin ?? 'devcrew');

const pipeline = ['Router', 'Plan + baseline', 'Developers', 'QA', 'Regression', 'Review'];

// The office's default address; each developer runs their own copy locally.
const officeUrl = 'http://localhost:4317';

// Screenshots of a scripted demo run in the office (public/images/toolkit).
const shots = [
    {
        id: 'work',
        label: 'At work',
        src: '/images/toolkit/office-work.jpg',
        alt: 'The 3D office during a demo run: agents working at their desks while the rest of the crew waits in the lounge',
    },
    {
        id: 'lounge',
        label: 'In the lounge',
        src: '/images/toolkit/office-lounge.jpg',
        alt: 'The 3D office with no work: the whole crew sitting in the Done lounge, talking',
    },
] as const;
const shot = ref<(typeof shots)[number]['id']>('work');

const benefits = [
    {
        icon: Sparkles,
        title: 'One command, whole crew',
        text: 'Type /fix or /task. It picks the agents, plans, builds, tests and reviews by itself.',
    },
    { icon: Workflow, title: 'Same standards for all', text: 'Every agent follows the team rules: Definition of Done, security and testing.' },
    { icon: ShieldCheck, title: 'Safe by default', text: 'Secrets, protected files and risky commands are blocked. It never commits.' },
    { icon: Eye, title: 'Watch it live', text: 'See who works on what in a 3D office. It runs only on your computer.' },
];

// Where each step is typed: a normal terminal, or the Claude Code chat inside the project.
type Where = 'terminal' | 'claude';

const project = 'path/to/your-project';
const installer = computed(() => `node ${props.folder}/install.js ${project}`);

const steps = computed<{ title: string; where: Where; code: string; hint: string }[]>(() => [
    { title: 'Get the toolkit', where: 'terminal', code: getCommand.value, hint: 'Once per computer. Needs Node.js and Claude Code.' },
    {
        title: 'Install it in your project',
        where: 'terminal',
        code: `${installer.value} --dry-run\n${installer.value}`,
        hint: "Once per project, in the folder you open in Claude Code. --dry-run only shows what will happen. Nothing is added to the project's code, dependencies or git.",
    },
    {
        title: 'Open the project in Claude Code',
        where: 'claude',
        code: `/${plugin.value}:office\n/mcp`,
        hint: 'Start a new session. The first command opens your 3D office, /mcp signs you in to Jira and Confluence.',
    },
    {
        title: 'Give the crew work',
        where: 'claude',
        code: `/${plugin.value}:task <what you want>\n/${plugin.value}:fix <JIRA-KEY>`,
        hint: 'Watch the office while it works. The crew never commits: read its report and git diff when it finishes.',
    },
]);

const extras = computed(() => [
    {
        id: 'guard',
        title: 'Check the safety guard',
        where: 'claude' as Where,
        code: 'show me the contents of .env',
        hint: 'Should answer "Blocked by devcrew".',
    },
    {
        id: 'trial',
        title: 'First run on a trial branch',
        where: 'terminal' as Where,
        code: `git checkout -b ${plugin.value}-trial`,
        hint: 'Review everything before keeping it.',
    },
    {
        id: 'demo',
        title: 'See a demo, no AI usage',
        where: 'terminal' as Where,
        code: `node ${props.folder}/plugin/office/demo.js`,
        hint: `Then open ${officeUrl}.`,
    },
    {
        id: 'remove',
        title: 'Remove it any time',
        where: 'terminal' as Where,
        code: `${installer.value} --uninstall`,
        hint: 'Your project files are not touched.',
    },
]);

const whereLabel: Record<Where, string> = { terminal: 'Terminal', claude: 'Claude Code' };

// QA test cycles: testers need no project or code, only an empty folder to install devcrew into.
const qaUrl = `${officeUrl}/qa`;
const qaSteps = computed(() => [
    { title: 'Install devcrew into an empty folder', code: `node ${props.folder}/install.js path/to/qa-workspace` },
    { title: 'Open that folder in Claude Code', code: `/${plugin.value}:office`, hint: `Then open ${qaUrl} in your browser.` },
    { title: 'Add the app and a test account', hint: 'Its web address per environment, or pick the ready-made ReleaseGuard portal.' },
    { title: 'Paste your test cases and run', hint: 'One per line, in plain English. Watch real browsers test them live, then read the report.' },
]);

const copied = ref<number | string | null>(null);

async function copy(index: number | string, text: string) {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = index;
        setTimeout(() => (copied.value = copied.value === index ? null : copied.value), 1500);
    } catch {
        // Clipboard access can be blocked (e.g. plain http on another host); the text stays selectable.
    }
}
</script>

<template>
    <Head title="Toolkit" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-8 p-4 md:p-6">
            <Card v-if="!catalog.available">
                <CardContent class="pt-6 text-sm text-muted-foreground">{{ catalog.note }}</CardContent>
            </Card>

            <template v-else>
                <!-- Hero: what it is, and what you will see -->
                <section
                    class="reveal relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-cyan-500/10 p-5 md:p-8"
                    style="--i: 0"
                >
                    <div class="grid items-center gap-8 lg:grid-cols-5">
                        <div class="space-y-5 lg:col-span-2">
                            <span class="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium">
                                <Bot class="size-3.5 text-primary" aria-hidden="true" /> Claude Code plugin · {{ plugin }}
                                <span v-if="catalog.version" class="text-muted-foreground">v{{ catalog.version }}</span>
                            </span>
                            <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
                                Your AI dev crew, <span class="shimmer-text">working in a 3D office</span>
                            </h1>
                            <p class="text-muted-foreground">
                                One command sends your task through planning, development, QA, regression and review. Watch each agent walk to its
                                room and work, live on your own computer.
                            </p>
                            <ol class="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Crew pipeline">
                                <li v-for="(stage, i) in pipeline" :key="stage" class="flex items-center gap-1.5">
                                    <span class="rounded-md border bg-background/80 px-2 py-1">{{ stage }}</span>
                                    <span v-if="i < pipeline.length - 1" class="text-muted-foreground" aria-hidden="true">→</span>
                                </li>
                            </ol>
                            <div class="flex flex-wrap gap-2">
                                <Button as-child>
                                    <a href="/toolkit/download" download><Download class="size-4" /> Download toolkit</a>
                                </Button>
                                <Button as-child variant="outline">
                                    <a href="#install"><ArrowDown class="size-4" /> How to install</a>
                                </Button>
                            </div>
                        </div>

                        <figure class="lg:col-span-3">
                            <div class="overflow-hidden rounded-xl border bg-background shadow-2xl shadow-primary/10">
                                <div class="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
                                    <span class="flex gap-1.5" aria-hidden="true">
                                        <span class="size-2.5 rounded-full bg-red-400" />
                                        <span class="size-2.5 rounded-full bg-amber-400" />
                                        <span class="size-2.5 rounded-full bg-emerald-400" />
                                    </span>
                                    <span
                                        class="flex-1 truncate rounded-md bg-background px-3 py-0.5 text-center font-mono text-[11px] text-muted-foreground"
                                    >
                                        {{ officeUrl }}
                                    </span>
                                    <div
                                        class="inline-flex rounded-md border bg-background p-0.5 text-[11px]"
                                        role="tablist"
                                        aria-label="Office view"
                                    >
                                        <button
                                            v-for="item in shots"
                                            :key="item.id"
                                            type="button"
                                            role="tab"
                                            :aria-selected="shot === item.id"
                                            class="rounded px-2 py-0.5 font-medium transition-colors"
                                            :class="
                                                shot === item.id
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            "
                                            @click="shot = item.id"
                                        >
                                            {{ item.label }}
                                        </button>
                                    </div>
                                </div>
                                <div class="relative aspect-[1440/860] bg-muted">
                                    <img
                                        v-for="item in shots"
                                        v-show="shot === item.id"
                                        :key="item.id"
                                        :src="item.src"
                                        :alt="item.alt"
                                        width="1440"
                                        height="860"
                                        class="absolute inset-0 size-full object-cover"
                                        :loading="item.id === 'work' ? 'eager' : 'lazy'"
                                    />
                                </div>
                            </div>
                            <figcaption class="mt-2 text-center text-xs text-muted-foreground">
                                Demo run. Agents work at their desks; with no work, the crew relaxes in the lounge.
                            </figcaption>
                        </figure>
                    </div>
                </section>

                <!-- Why it helps -->
                <section class="reveal grid gap-3 sm:grid-cols-2 xl:grid-cols-4" style="--i: 1" aria-label="Why it helps">
                    <div v-for="benefit in benefits" :key="benefit.title" class="rounded-xl border bg-card p-4">
                        <span class="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <component :is="benefit.icon" class="size-5" aria-hidden="true" />
                        </span>
                        <p class="font-medium">{{ benefit.title }}</p>
                        <p class="mt-1 text-sm text-muted-foreground">{{ benefit.text }}</p>
                    </div>
                </section>

                <!-- Install -->
                <section id="install" class="reveal scroll-mt-6 space-y-4" style="--i: 2">
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 class="text-xl font-semibold">Install in 4 steps</h2>
                            <p class="text-sm text-muted-foreground">
                                About two minutes. Replace <span class="font-mono">{{ project }}</span> with your project folder.
                            </p>
                        </div>
                        <div v-if="repoUrl" class="inline-flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="How to get the toolkit">
                            <button
                                v-for="option in [
                                    { value: 'zip', label: 'Download' },
                                    { value: 'git', label: 'Git clone' },
                                ] as const"
                                :key="option.value"
                                type="button"
                                role="tab"
                                :aria-selected="source === option.value"
                                class="rounded px-3 py-1 font-medium transition-colors"
                                :class="
                                    source === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                "
                                @click="source = option.value"
                            >
                                {{ option.label }}
                            </button>
                        </div>
                    </div>

                    <ol class="grid gap-4 md:grid-cols-2">
                        <li v-for="(step, i) in steps" :key="i" class="relative flex gap-4 rounded-xl border bg-card p-4">
                            <span
                                class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30"
                                >{{ i + 1 }}</span
                            >
                            <div class="min-w-0 flex-1 space-y-2">
                                <p class="flex flex-wrap items-center justify-between gap-2">
                                    <span class="font-medium">{{ step.title }}</span>
                                    <span
                                        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                                        :class="step.where === 'claude' ? 'border-primary/30 text-primary' : 'text-muted-foreground'"
                                    >
                                        <Bot v-if="step.where === 'claude'" class="size-3" aria-hidden="true" />
                                        <SquareTerminal v-else class="size-3" aria-hidden="true" />
                                        {{ whereLabel[step.where] }}
                                    </span>
                                </p>
                                <div class="relative">
                                    <pre
                                        class="overflow-x-auto rounded-lg bg-zinc-950 py-2.5 pl-3 pr-10 font-mono text-xs leading-relaxed text-zinc-100 dark:border"
                                    ><span class="select-none text-emerald-400">{{ step.where === 'claude' ? '› ' : '$ ' }}</span>{{ step.code }}</pre>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="absolute right-1 top-1 size-7 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                                        :aria-label="copied === i ? 'Copied' : `Copy step ${i + 1}`"
                                        @click="copy(i, step.code)"
                                    >
                                        <Check v-if="copied === i" class="size-3.5 text-emerald-400" />
                                        <Copy v-else class="size-3.5" />
                                    </Button>
                                </div>
                                <p class="text-xs text-muted-foreground">{{ step.hint }}</p>
                            </div>
                        </li>
                    </ol>

                    <div class="rounded-xl border border-dashed p-4">
                        <p class="mb-3 text-sm font-medium">Good to know</p>
                        <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <li v-for="extra in extras" :key="extra.id" class="space-y-1.5">
                                <p class="flex items-center gap-1.5 text-xs font-medium">
                                    <Bot v-if="extra.where === 'claude'" class="size-3 text-primary" aria-hidden="true" />
                                    <SquareTerminal v-else class="size-3 text-muted-foreground" aria-hidden="true" />
                                    {{ extra.title }}
                                </p>
                                <button
                                    type="button"
                                    class="group flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left font-mono text-[11px] hover:bg-muted"
                                    :aria-label="`Copy: ${extra.code}`"
                                    @click="copy(extra.id, extra.code)"
                                >
                                    <span class="min-w-0 flex-1 truncate">{{ extra.code }}</span>
                                    <Check v-if="copied === extra.id" class="size-3 shrink-0 text-emerald-600" />
                                    <Copy v-else class="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                                </button>
                                <p class="text-[11px] text-muted-foreground">{{ extra.hint }}</p>
                            </li>
                        </ul>
                    </div>
                </section>

                <!-- QA test cycles -->
                <section class="reveal space-y-4" style="--i: 3" aria-labelledby="qa-cycles">
                    <div>
                        <h2 id="qa-cycles" class="flex items-center gap-2 text-xl font-semibold">
                            <ClipboardCheck class="size-5" aria-hidden="true" /> QA test cycles
                        </h2>
                        <p class="text-sm text-muted-foreground">
                            For QA, no code needed: describe what to check in plain English and devcrew tests it in real browsers. Developers link
                            their project with <span class="font-mono">/{{ plugin }}:qa-link</span>, so the crew runs these cases on the local app
                            after a fix.
                            <Link href="/qa-testing" class="font-medium text-primary underline-offset-4 hover:underline"
                                >Read the QA testing guide</Link
                            >.
                        </p>
                    </div>
                    <div class="grid items-start gap-6 lg:grid-cols-5">
                        <ol class="space-y-3 lg:col-span-2">
                            <li v-for="(step, i) in qaSteps" :key="step.title" class="flex gap-3 rounded-xl border bg-card p-3">
                                <span
                                    class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                                    >{{ i + 1 }}</span
                                >
                                <div class="min-w-0 flex-1 space-y-1.5">
                                    <p class="text-sm font-medium">{{ step.title }}</p>
                                    <button
                                        v-if="step.code"
                                        type="button"
                                        class="group flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left font-mono text-[11px] hover:bg-muted"
                                        :aria-label="`Copy: ${step.code}`"
                                        @click="copy(`qa-${i}`, step.code)"
                                    >
                                        <span class="min-w-0 flex-1 truncate">{{ step.code }}</span>
                                        <Check v-if="copied === `qa-${i}`" class="size-3 shrink-0 text-emerald-600" />
                                        <Copy v-else class="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                                    </button>
                                    <p v-if="step.hint" class="text-xs text-muted-foreground">{{ step.hint }}</p>
                                </div>
                            </li>
                        </ol>
                        <figure class="lg:col-span-3">
                            <div class="overflow-hidden rounded-xl border bg-background shadow-xl shadow-primary/10">
                                <div class="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
                                    <span class="flex gap-1.5" aria-hidden="true">
                                        <span class="size-2.5 rounded-full bg-red-400" />
                                        <span class="size-2.5 rounded-full bg-amber-400" />
                                        <span class="size-2.5 rounded-full bg-emerald-400" />
                                    </span>
                                    <span
                                        class="flex-1 truncate rounded-md bg-background px-3 py-0.5 text-center font-mono text-[11px] text-muted-foreground"
                                        >{{ qaUrl }}</span
                                    >
                                </div>
                                <img
                                    src="/images/toolkit/qa-live.jpg"
                                    alt="The QA page during a test cycle: progress steps, two live browser windows logged in as Admin, and a feed of what is happening"
                                    width="1440"
                                    height="900"
                                    class="block h-auto w-full"
                                    loading="lazy"
                                />
                            </div>
                            <figcaption class="mt-2 text-center text-xs text-muted-foreground">
                                A real test cycle of the ReleaseGuard portal. The report adds the root cause and steps to reproduce for each failure.
                            </figcaption>
                        </figure>
                    </div>
                </section>

                <!-- Commands -->
                <section class="reveal space-y-3" style="--i: 3">
                    <h2 class="flex items-center gap-2 text-lg font-semibold"><SquareTerminal class="size-5" aria-hidden="true" /> Commands</h2>
                    <p class="text-sm text-muted-foreground">
                        Type these in Claude Code. The short form (<span class="font-mono">/fix</span>) also works when no other command uses that
                        name.
                    </p>
                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Card v-for="command in catalog.commands" :key="command.name" class="p-4">
                            <p class="font-mono text-sm font-semibold">
                                /{{ plugin }}:{{ command.name }}
                                <span v-if="command.arguments" class="font-normal text-muted-foreground">{{ command.arguments }}</span>
                            </p>
                            <p class="mt-1.5 text-sm text-muted-foreground">{{ command.description }}</p>
                        </Card>
                    </div>
                </section>

                <!-- Agents -->
                <section class="reveal space-y-3" style="--i: 4">
                    <h2 class="flex items-center gap-2 text-lg font-semibold"><Users class="size-5" aria-hidden="true" /> The crew</h2>
                    <p class="text-sm text-muted-foreground">
                        The router hands work to these specialists. You can also ask for one by name, e.g. "use the {{ plugin }}:frontend-developer
                        agent to…".
                    </p>
                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Card v-for="agent in catalog.agents" :key="agent.name" class="p-4">
                            <p class="flex items-center justify-between gap-2">
                                <span class="font-mono text-sm font-semibold">{{ agent.name }}</span>
                                <span v-if="agent.read_only" class="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                                    >Read-only</span
                                >
                            </p>
                            <p class="mt-1.5 text-sm text-muted-foreground">{{ agent.description }}</p>
                        </Card>
                    </div>
                </section>

                <!-- Guardrails and docs -->
                <div class="reveal grid gap-4 lg:grid-cols-3" style="--i: 5">
                    <Card>
                        <CardHeader>
                            <CardTitle class="flex items-center gap-2 text-base"
                                ><ShieldCheck class="size-4" aria-hidden="true" /> Automatic guards</CardTitle
                            >
                            <CardDescription>Hooks that run on every action. No setup needed.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul class="space-y-2.5 text-sm">
                                <li v-for="hook in catalog.hooks" :key="hook.name">
                                    <span class="font-mono text-xs font-semibold">{{ hook.name }}</span>
                                    <p class="text-muted-foreground">{{ hook.description }}</p>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle class="flex items-center gap-2 text-base"><Workflow class="size-4" aria-hidden="true" /> Team rules</CardTitle>
                            <CardDescription>Standards Claude always follows in the project.</CardDescription>
                        </CardHeader>
                        <CardContent class="space-y-4 text-sm">
                            <ul class="flex flex-wrap gap-1.5">
                                <li v-for="rule in catalog.rules" :key="rule.name" class="rounded-md border px-2 py-1" :title="rule.title">
                                    {{ rule.name }}
                                </li>
                            </ul>
                            <p v-if="catalog.atlassian_mcp" class="text-muted-foreground">
                                Includes the <span class="font-medium text-foreground">Atlassian</span> connection, so Claude reads Jira tickets and
                                Confluence PRDs directly. On first start, approve it, then type <span class="font-mono">/mcp</span> and sign in with
                                your own account.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle class="flex items-center gap-2 text-base"
                                ><FileText class="size-4" aria-hidden="true" /> Guides in the download</CardTitle
                            >
                            <CardDescription>Inside the <span class="font-mono">docs/</span> folder.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul class="space-y-2 text-sm">
                                <li v-for="doc in catalog.docs" :key="doc.file" class="flex items-baseline justify-between gap-3">
                                    <span>{{ doc.title }}</span>
                                    <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ doc.file }}</span>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            </template>
        </div>
    </AppLayout>
</template>

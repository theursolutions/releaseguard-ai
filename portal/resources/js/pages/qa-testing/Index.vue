<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import AppLayout from '@/layouts/AppLayout.vue';
import { type BreadcrumbItem } from '@/types';
import { Head, Link } from '@inertiajs/vue3';
import {
    ArrowDown,
    ArrowRight,
    Ban,
    Bot,
    Bug,
    Check,
    ChevronDown,
    ClipboardCheck,
    Code2,
    Copy,
    Download,
    Gauge,
    GitCompareArrows,
    Globe,
    Hourglass,
    Layers,
    Lock,
    MonitorPlay,
    PenLine,
    Repeat,
    ShieldCheck,
    SquareTerminal,
    TrendingUp,
    Users,
    Zap,
} from 'lucide-vue-next';
import { computed, ref } from 'vue';

const props = defineProps<{
    toolkit: { available: boolean; note?: string; plugin?: string; version?: string };
    folder: string;
    repoUrl: string | null;
}>();

const breadcrumbs: BreadcrumbItem[] = [{ title: 'QA Testing', href: '/qa-testing' }];

const plugin = computed(() => props.toolkit.plugin ?? 'devcrew');

// Each person runs their own QA page; the portal only explains it.
const qaUrl = 'http://localhost:4317/qa';

// Screenshots of real test cycles of the ReleaseGuard portal (public/images).
const shots = [
    {
        id: 'live',
        label: 'Live testing',
        src: '/images/toolkit/qa-live.jpg',
        alt: 'The QA page during a test cycle on Ziba Property staging: the phases, passed and failed counts, live browser windows and a feed of each step',
        caption: 'Watch every browser while it tests, with a live feed of each step.',
    },
    {
        id: 'report',
        label: 'Report',
        src: '/images/qa/report.jpg',
        alt: 'A test cycle report: passed and failed cases, the comparison with the previous run (newly failing, fixed, still failing), and the list of cases',
        caption: 'Every report compares the run with the previous one: newly failing, fixed and still failing.',
    },
    {
        id: 'cause',
        label: 'Root cause',
        src: '/images/qa/root-cause.jpg',
        alt: 'A failed case: the root cause found by Claude Code with its evidence and what to do, and numbered steps to reproduce with a Copy bug report button',
        caption: 'A failed case explained: the likely root cause, and steps to reproduce ready to copy into Jira.',
    },
    {
        id: 'load',
        label: 'Load test',
        src: '/images/qa/stress.jpg',
        alt: 'A stress test report: broke at 4 users, request totals and response times, and second-by-second charts',
        caption: 'A stress test of Ziba Property staging: it held up to 3 users and broke at 4.',
    },
] as const;
const shot = ref<(typeof shots)[number]['id']>('live');
const activeShot = computed(() => shots.find((item) => item.id === shot.value) ?? shots[0]);

const benefits = [
    { icon: PenLine, title: 'No code for QA', text: 'Write what to check in plain English, one case per line. No scripts and no source code.' },
    {
        icon: Repeat,
        title: 'Learned once, replayed without AI',
        text: 'Claude Code learns each new case once. After that it replays in seconds, with no AI.',
    },
    { icon: MonitorPlay, title: 'Real browsers, watched live', text: 'Up to 6 browsers test at the same time, and you see each one working.' },
    {
        icon: GitCompareArrows,
        title: 'Compared after every fix',
        text: 'Each report shows what is newly failing, what was fixed and what is still failing.',
    },
    {
        icon: Bug,
        title: 'Bug reports, ready for Jira',
        text: 'Failures come with a likely root cause and steps to reproduce. Copy the bug report in one click.',
    },
    {
        icon: Gauge,
        title: 'Speed and smoke check',
        text: "Each cycle also walks the app's pages for broken links, server errors, console errors and page speed.",
    },
];

type Source = 'zip' | 'git';
const source = ref<Source>('zip');
const getCommand = computed(() =>
    source.value === 'git' && props.repoUrl
        ? `git clone ${props.repoUrl} ${props.folder}`
        : `# Unzip ${props.folder}.zip into a folder of your choice`,
);

// Where each step happens: a normal terminal, the Claude Code chat, or the QA page in a browser.
type Where = 'terminal' | 'claude' | 'browser';
const whereLabel: Record<Where, string> = { terminal: 'Terminal', claude: 'Claude Code', browser: 'Browser' };

const workspace = 'path/to/qa-workspace';

const qaSteps = computed<{ title: string; where: Where; code?: string; hint: string }[]>(() => [
    {
        title: 'Get the toolkit',
        where: 'terminal',
        code: getCommand.value,
        hint: 'Once per computer. Needs Node.js and Claude Code, signed in with your own seat.',
    },
    {
        title: 'Install devcrew into an empty folder',
        where: 'terminal',
        code: `node ${props.folder}/install.js ${workspace}`,
        hint: 'Create the folder first. You need no project and no source code.',
    },
    {
        title: 'Open that folder in Claude Code',
        where: 'claude',
        code: `/${plugin.value}:office`,
        hint: 'Starts the office and its QA page, on your computer only.',
    },
    { title: 'Open the QA page', where: 'browser', code: qaUrl, hint: 'Bookmark it. This is where you will work from now on.' },
    {
        title: 'Add the app and a test account',
        where: 'browser',
        hint: 'Click Add app: its web address for each environment (local, staging, UAT). Or pick Use a ready-made app → ReleaseGuard portal.',
    },
    {
        title: 'Paste your cases and run',
        where: 'browser',
        code: 'Admin opens the Users page and sees the admin user in the list',
        hint: 'One case per line, like this example. Press Run test cycle. The first run installs the test browser once (about 700 MB on disk, a few minutes).',
    },
]);

const phases = [
    { title: 'Setting up', text: 'Gets the test browser ready. Only the first run installs it.' },
    { title: 'Preparing cases', text: 'Claude Code learns each new or edited case once and saves it as a test.' },
    { title: 'Testing', text: 'Saved tests replay in real browsers with no AI, plus the smoke check and page speed.' },
    { title: 'Report', text: 'Pass or fail with screenshots and videos, the comparison with the last run, and root causes.' },
];

const devSteps = computed<{ title: string; code: string; hint: string }[]>(() => [
    {
        title: 'Link your project to QA’s app',
        code: `/${plugin.value}:qa-link <app-id>`,
        hint: 'Once, inside your project. Without an id it lists the apps. The app needs a Local environment, so the crew tests what runs on your computer.',
    },
    {
        title: 'Fix or build as usual',
        code: `/${plugin.value}:fix <JIRA-KEY>\n/${plugin.value}:feature <JIRA-KEY>`,
        hint: 'After the regression check, the crew runs QA’s cases on your local app. Keep your local server running.',
    },
    {
        title: 'Or run the cycle yourself',
        code: `/${plugin.value}:qa-run`,
        hint: 'Any time. It only tests and reports, with the root cause and steps to reproduce of each failure. It never changes code.',
    },
]);

const crewOutcomes = [
    { tone: 'red', label: 'Newly failing', text: 'Go back to the developer with their root cause and steps to reproduce, to be fixed.' },
    { tone: 'amber', label: 'Still failing', text: 'Failed before the change too. They are reported, not fixed.' },
    {
        tone: 'muted',
        label: 'Skipped',
        text: 'For example nothing is linked or the app is not running: one line in the crew report. It never blocks the crew.',
    },
] as const;

const loadKinds = [
    {
        icon: Users,
        title: 'Load test',
        text: 'A set number of virtual users visit the pages you choose for a set time, pausing between pages. Shows requests per second, response times and errors, live.',
    },
    {
        icon: TrendingUp,
        title: 'Stress test',
        text: 'Starts with a few users and adds more every step, until too many requests fail or get too slow. Reports the breaking point, or "held up to N users".',
    },
];

const loadLimits = [
    { icon: Ban, text: 'Never on production. Use local, staging or UAT.' },
    { icon: Users, text: 'At most 50 virtual users.' },
    { icon: Hourglass, text: 'From 10 seconds to 5 minutes.' },
    { icon: Layers, text: 'One test at a time on a computer.' },
    { icon: Globe, text: "Read-only page requests (GET), only to the app's own address." },
];

const safety = [
    {
        icon: Lock,
        title: 'Passwords stay on your computer',
        text: 'Kept in your own ~/.devcrew folder. They never reach Claude, AI prompts, tests, logs or reports: Claude only sees labels like "Admin".',
    },
    {
        icon: ShieldCheck,
        title: 'Claude Code is boxed in',
        text: 'When it prepares a case it has no file, shell or web tools, only three QA tools: explore, try and save.',
    },
    { icon: Check, title: 'AI-written tests are checked', text: 'Every test is checked for unsafe code before it is saved.' },
    {
        icon: Ban,
        title: 'Production is off by default',
        text: 'It runs only when "allow production" is ticked, and then only cases tagged readonly. The smoke check never submits forms.',
    },
    {
        icon: Zap,
        title: 'Your own seat, only when needed',
        text: 'AI is used only to learn a case or analyse a failure, with your own Claude Code seat.',
    },
    { icon: SquareTerminal, title: 'Local only', text: 'Apps, cases and reports live on your computer. Only your own computer can use the QA page.' },
];

const faqs = [
    {
        q: 'Do I need the source code?',
        a: "No. QA needs only the app's web address and a test account. Developers link their project only so the crew can test their local app.",
    },
    {
        q: 'Does it change our project?',
        a: "No. Nothing is added to the project's code, dependencies or git. QA data lives in ~/.devcrew on each person's computer, and qa-run only tests and reports.",
    },
    {
        q: 'What does it cost in AI usage?',
        a: 'Claude Code is used once per new or edited case, and to analyse failures (at most 6 per run). Replays, the smoke check and load tests use no AI.',
    },
    {
        q: 'What if the app changes?',
        a: 'Edit the case, or press Re-learn, and it is learned again on the next run. When a test fails because the app changed on purpose, the root cause says "Test needs updating".',
    },
    {
        q: 'Which browsers does it test in?',
        a: 'Chromium, the engine behind Chrome and Edge, installed once for QA. Your own browser is only for watching and reading the reports.',
    },
];

const copied = ref<string | null>(null);

async function copy(key: string, text: string) {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = key;
        setTimeout(() => (copied.value = copied.value === key ? null : copied.value), 1500);
    } catch {
        // Clipboard access can be blocked (e.g. plain http on another host); the text stays selectable.
    }
}

const toneClass: Record<(typeof crewOutcomes)[number]['tone'], string> = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    muted: 'bg-muted-foreground/50',
};
</script>

<template>
    <Head title="QA Testing" />

    <AppLayout :breadcrumbs="breadcrumbs">
        <div class="flex flex-1 flex-col gap-10 p-4 md:p-6">
            <Card v-if="!toolkit.available">
                <CardContent class="pt-6 text-sm text-muted-foreground">{{ toolkit.note }}</CardContent>
            </Card>

            <!-- Hero: what it is, and what you will see -->
            <section
                class="reveal relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-cyan-500/10 p-5 md:p-8"
                style="--i: 0"
            >
                <div class="grid grid-cols-1 items-center gap-8 lg:grid-cols-5">
                    <div class="space-y-5 lg:col-span-2">
                        <span class="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium">
                            <ClipboardCheck class="size-3.5 text-primary" aria-hidden="true" /> Part of the {{ plugin }} toolkit
                            <span v-if="toolkit.version" class="text-muted-foreground">v{{ toolkit.version }}</span>
                        </span>
                        <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
                            Automated QA testing, <span class="shimmer-text">in plain English</span>
                        </h1>
                        <p class="text-muted-foreground">
                            Write your test cases once, the way you would explain them to a colleague, and press Run. Real browsers test the app while
                            you watch, and the report gives each failure a root cause and steps to reproduce.
                        </p>
                        <div class="flex flex-wrap gap-2">
                            <Button v-if="toolkit.available" as-child>
                                <a href="/toolkit/download" download><Download class="size-4" /> Download toolkit</a>
                            </Button>
                            <Button as-child variant="outline">
                                <a href="#setup"><ArrowDown class="size-4" /> How to set it up</a>
                            </Button>
                        </div>
                    </div>

                    <figure class="lg:col-span-3">
                        <div class="overflow-hidden rounded-xl border bg-background shadow-2xl shadow-primary/10">
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/60 px-3 py-2">
                                <span class="flex gap-1.5" aria-hidden="true">
                                    <span class="size-2.5 rounded-full bg-red-400" />
                                    <span class="size-2.5 rounded-full bg-amber-400" />
                                    <span class="size-2.5 rounded-full bg-emerald-400" />
                                </span>
                                <span
                                    class="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-0.5 text-center font-mono text-[11px] text-muted-foreground"
                                >
                                    {{ qaUrl }}
                                </span>
                                <div
                                    class="flex w-full rounded-md border bg-background p-0.5 text-[11px] sm:inline-flex sm:w-auto"
                                    role="tablist"
                                    aria-label="QA page view"
                                >
                                    <button
                                        v-for="item in shots"
                                        :id="`qa-shot-tab-${item.id}`"
                                        :key="item.id"
                                        type="button"
                                        role="tab"
                                        aria-controls="qa-shot-panel"
                                        :aria-selected="shot === item.id"
                                        class="flex-1 whitespace-nowrap rounded px-2 py-1 font-medium transition-colors sm:py-0.5"
                                        :class="
                                            shot === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                        "
                                        @click="shot = item.id"
                                    >
                                        {{ item.label }}
                                    </button>
                                </div>
                            </div>
                            <div
                                id="qa-shot-panel"
                                role="tabpanel"
                                :aria-labelledby="`qa-shot-tab-${shot}`"
                                class="relative aspect-[1440/900] bg-muted"
                            >
                                <img
                                    v-for="item in shots"
                                    v-show="shot === item.id"
                                    :key="item.id"
                                    :src="item.src"
                                    :alt="item.alt"
                                    width="1440"
                                    height="900"
                                    class="absolute inset-0 size-full object-cover object-top"
                                    :loading="item.id === 'live' ? 'eager' : 'lazy'"
                                />
                            </div>
                        </div>
                        <figcaption class="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
                            {{ activeShot.caption }}
                        </figcaption>
                    </figure>
                </div>
            </section>

            <!-- Why it helps -->
            <section class="reveal grid gap-3 sm:grid-cols-2 xl:grid-cols-3" style="--i: 1" aria-label="Why it helps">
                <div v-for="benefit in benefits" :key="benefit.title" class="rounded-xl border bg-card p-4">
                    <span class="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <component :is="benefit.icon" class="size-5" aria-hidden="true" />
                    </span>
                    <p class="font-medium">{{ benefit.title }}</p>
                    <p class="mt-1 text-sm text-muted-foreground">{{ benefit.text }}</p>
                </div>
            </section>

            <!-- For QA: set it up once -->
            <section id="setup" class="reveal scroll-mt-6 space-y-4" style="--i: 2" aria-labelledby="qa-setup">
                <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 id="qa-setup" class="text-xl font-semibold">For QA: set it up once</h2>
                        <p class="text-sm text-muted-foreground">About ten minutes. Tests run on your own computer, against the app's web address.</p>
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
                            :class="source === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
                            @click="source = option.value"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                </div>

                <ol class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <li v-for="(step, i) in qaSteps" :key="step.title" class="flex gap-4 rounded-xl border bg-card p-4">
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
                                    <Globe v-else-if="step.where === 'browser'" class="size-3" aria-hidden="true" />
                                    <SquareTerminal v-else class="size-3" aria-hidden="true" />
                                    {{ whereLabel[step.where] }}
                                </span>
                            </p>
                            <div v-if="step.code" class="relative">
                                <pre
                                    class="overflow-x-auto rounded-lg bg-zinc-950 py-2.5 pl-3 pr-10 font-mono text-xs leading-relaxed text-zinc-100 dark:border"
                                ><span v-if="step.where !== 'browser'" class="select-none text-emerald-400">{{ step.where === 'claude' ? '› ' : '$ ' }}</span>{{ step.code }}</pre>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="absolute right-1 top-1 size-7 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                                    :aria-label="copied === `qa-${i}` ? 'Copied' : `Copy step ${i + 1}`"
                                    @click="copy(`qa-${i}`, step.code)"
                                >
                                    <Check v-if="copied === `qa-${i}`" class="size-3.5 text-emerald-400" />
                                    <Copy v-else class="size-3.5" />
                                </Button>
                            </div>
                            <p class="text-xs text-muted-foreground">{{ step.hint }}</p>
                        </div>
                    </li>
                </ol>
            </section>

            <!-- What a test cycle does -->
            <section class="reveal space-y-4" style="--i: 3" aria-labelledby="qa-cycle">
                <div>
                    <h2 id="qa-cycle" class="text-xl font-semibold">What a test cycle does</h2>
                    <p class="text-sm text-muted-foreground">Four phases, shown live on the QA page from start to report.</p>
                </div>
                <ol class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <li v-for="(phase, i) in phases" :key="phase.title" class="relative rounded-xl border bg-card p-4">
                        <p class="flex items-center gap-2 font-medium">
                            <span
                                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                                >{{ i + 1 }}</span
                            >
                            {{ phase.title }}
                        </p>
                        <p class="mt-2 text-sm text-muted-foreground">{{ phase.text }}</p>
                        <ArrowRight
                            v-if="i < phases.length - 1"
                            class="absolute -right-2.5 top-1/2 hidden size-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground xl:block"
                            aria-hidden="true"
                        />
                    </li>
                </ol>
            </section>

            <!-- For developers -->
            <section class="reveal space-y-4" style="--i: 4" aria-labelledby="qa-developers">
                <div>
                    <h2 id="qa-developers" class="flex items-center gap-2 text-xl font-semibold">
                        <Code2 class="size-5" aria-hidden="true" /> For developers: connect your project
                    </h2>
                    <p class="text-sm text-muted-foreground">
                        Link once, and QA's cases check your fix on your local app before code review. You can also link it on the QA page, under
                        Project folders on this computer.
                    </p>
                </div>
                <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
                    <ol class="space-y-3 lg:col-span-3">
                        <li v-for="(step, i) in devSteps" :key="step.title" class="flex gap-3 rounded-xl border bg-card p-4">
                            <span
                                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                                >{{ i + 1 }}</span
                            >
                            <div class="min-w-0 flex-1 space-y-2">
                                <p class="flex flex-wrap items-center justify-between gap-2">
                                    <span class="text-sm font-medium">{{ step.title }}</span>
                                    <span
                                        class="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] text-primary"
                                    >
                                        <Bot class="size-3" aria-hidden="true" /> Claude Code
                                    </span>
                                </p>
                                <div class="relative">
                                    <pre
                                        class="overflow-x-auto rounded-lg bg-zinc-950 py-2.5 pl-3 pr-10 font-mono text-xs leading-relaxed text-zinc-100 dark:border"
                                    ><span class="select-none text-emerald-400">› </span>{{ step.code }}</pre>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="absolute right-1 top-1 size-7 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                                        :aria-label="copied === `dev-${i}` ? 'Copied' : `Copy: ${step.title}`"
                                        @click="copy(`dev-${i}`, step.code)"
                                    >
                                        <Check v-if="copied === `dev-${i}`" class="size-3.5 text-emerald-400" />
                                        <Copy v-else class="size-3.5" />
                                    </Button>
                                </div>
                                <p class="text-xs text-muted-foreground">{{ step.hint }}</p>
                            </div>
                        </li>
                    </ol>
                    <div class="rounded-xl border border-dashed p-4 lg:col-span-2">
                        <p class="text-sm font-medium">What the crew does with the result</p>
                        <p class="mt-1 text-xs text-muted-foreground">
                            In <span class="font-mono">/{{ plugin }}:fix</span>, <span class="font-mono">/{{ plugin }}:feature</span> and
                            <span class="font-mono">/{{ plugin }}:task</span>, after the regression check:
                        </p>
                        <ul class="mt-3 space-y-3">
                            <li v-for="outcome in crewOutcomes" :key="outcome.label" class="flex gap-2.5 text-sm">
                                <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="toneClass[outcome.tone]" aria-hidden="true" />
                                <span>
                                    <span class="font-medium">{{ outcome.label }}:</span>
                                    <span class="text-muted-foreground">{{ ` ${outcome.text}` }}</span>
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>
            </section>

            <!-- Load and stress testing -->
            <section class="reveal space-y-4" style="--i: 5" aria-labelledby="qa-load">
                <div>
                    <h2 id="qa-load" class="flex items-center gap-2 text-xl font-semibold">
                        <Gauge class="size-5" aria-hidden="true" /> Load and stress testing
                    </h2>
                    <p class="text-sm text-muted-foreground">
                        On the QA page, the Load &amp; stress test card checks how the app copes with many users at once. No browser and no AI.
                    </p>
                </div>
                <div class="grid gap-4 lg:grid-cols-3">
                    <div v-for="kind in loadKinds" :key="kind.title" class="rounded-xl border bg-card p-4">
                        <span class="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <component :is="kind.icon" class="size-5" aria-hidden="true" />
                        </span>
                        <p class="font-medium">{{ kind.title }}</p>
                        <p class="mt-1 text-sm text-muted-foreground">{{ kind.text }}</p>
                    </div>
                    <div class="rounded-xl border border-dashed p-4">
                        <p class="text-sm font-medium">Safe limits, always enforced</p>
                        <ul class="mt-3 space-y-2">
                            <li v-for="limit in loadLimits" :key="limit.text" class="flex items-start gap-2 text-sm text-muted-foreground">
                                <component :is="limit.icon" class="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
                                {{ limit.text }}
                            </li>
                        </ul>
                    </div>
                </div>
            </section>

            <!-- Safety and privacy -->
            <section class="reveal space-y-4" style="--i: 6" aria-labelledby="qa-safety">
                <h2 id="qa-safety" class="flex items-center gap-2 text-xl font-semibold">
                    <ShieldCheck class="size-5" aria-hidden="true" /> Safety and privacy
                </h2>
                <ul class="grid gap-x-6 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2 md:p-5 xl:grid-cols-3">
                    <li v-for="item in safety" :key="item.title" class="flex gap-3">
                        <component :is="item.icon" class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <div>
                            <p class="text-sm font-medium">{{ item.title }}</p>
                            <p class="mt-0.5 text-sm text-muted-foreground">{{ item.text }}</p>
                        </div>
                    </li>
                </ul>
            </section>

            <!-- FAQ -->
            <section class="reveal space-y-4" style="--i: 7" aria-labelledby="qa-faq">
                <h2 id="qa-faq" class="text-xl font-semibold">Questions</h2>
                <div class="divide-y rounded-xl border bg-card">
                    <details v-for="faq in faqs" :key="faq.q" class="group">
                        <summary
                            class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                        >
                            {{ faq.q }}
                            <ChevronDown
                                class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                                aria-hidden="true"
                            />
                        </summary>
                        <p class="px-4 pb-4 text-sm text-muted-foreground">{{ faq.a }}</p>
                    </details>
                </div>
                <p class="text-sm text-muted-foreground">
                    The full toolkit, with the crew commands and the 3D office, is on the
                    <Link href="/toolkit" class="font-medium text-primary underline-offset-4 hover:underline">Toolkit page</Link>.
                </p>
            </section>
        </div>
    </AppLayout>
</template>

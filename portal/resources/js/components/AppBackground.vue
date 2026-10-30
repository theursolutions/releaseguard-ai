<script setup lang="ts">
// Decorative animated backdrop, pure CSS (no JS work per frame), hidden from screen readers and
// frozen under reduced motion. Light: soft colour fields. Dark (command center): navy depth, a
// perspective grid, cyan/violet light fields and a slow scan line.
</script>

<template>
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <!-- Light theme -->
        <div class="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/60 to-violet-50/70 dark:hidden">
            <div class="absolute -left-[10%] -top-[15%] h-[55vmax] w-[55vmax] rounded-full bg-blue-300/30 blur-3xl [animation:rg-blob_22s_ease-in-out_infinite]" />
            <div class="absolute -right-[12%] top-[10%] h-[45vmax] w-[45vmax] rounded-full bg-violet-300/25 blur-3xl [animation:rg-blob_28s_ease-in-out_infinite_reverse]" />
            <div class="absolute -bottom-[20%] left-[25%] h-[50vmax] w-[50vmax] rounded-full bg-cyan-200/30 blur-3xl [animation:rg-blob_34s_ease-in-out_infinite]" />
            <div
                class="absolute inset-0 opacity-[0.35]"
                style="
                    background-image: radial-gradient(rgb(30 64 175 / 0.18) 1px, transparent 1px);
                    background-size: 22px 22px;
                    mask-image: radial-gradient(ellipse at 50% 30%, black 20%, transparent 75%);
                "
            />
        </div>

        <!-- Dark command-center theme -->
        <div class="absolute inset-0 hidden dark:block" style="background: radial-gradient(120% 90% at 50% -10%, #0c1a35 0%, #060b18 50%, #03060d 100%)">
            <div class="absolute -left-[15%] -top-[20%] h-[60vmax] w-[60vmax] rounded-full bg-cyan-500/[0.07] blur-[110px] [animation:rg-blob_30s_ease-in-out_infinite]" />
            <div class="absolute -right-[15%] top-[20%] h-[50vmax] w-[50vmax] rounded-full bg-indigo-500/[0.08] blur-[110px] [animation:rg-blob_36s_ease-in-out_infinite_reverse]" />
            <div class="absolute -bottom-[25%] left-[30%] h-[45vmax] w-[45vmax] rounded-full bg-sky-400/[0.05] blur-[100px] [animation:rg-blob_42s_ease-in-out_infinite]" />
            <div
                class="absolute inset-0"
                style="
                    background-image:
                        linear-gradient(rgb(56 189 248 / 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgb(56 189 248 / 0.05) 1px, transparent 1px);
                    background-size: 56px 56px;
                    mask-image: radial-gradient(ellipse 80% 70% at 50% 20%, black, transparent 80%);
                "
            />
            <div class="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-transparent via-cyan-400/[0.035] to-transparent [animation:rg-scan_14s_linear_infinite]" />
        </div>
    </div>
</template>

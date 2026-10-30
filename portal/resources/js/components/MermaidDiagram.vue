<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

const props = defineProps<{ code: string; id: string }>();

const svg = ref('');
const failed = ref(false);

async function render() {
    try {
        // Loaded only on pages that show diagrams, to keep the main bundle small.
        const mermaid = (await import('mermaid')).default;
        const dark = document.documentElement.classList.contains('dark');
        // securityLevel "strict" sanitises labels, because the diagram text comes from an AI model.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'inherit' });
        const result = await mermaid.render(`diagram-${props.id}`, props.code);
        svg.value = result.svg;
        failed.value = false;
    } catch {
        failed.value = true;
    }
}

onMounted(render);
watch(() => props.code, render);
</script>

<template>
    <div class="overflow-x-auto rounded-lg border bg-background p-4">
        <!-- eslint-disable-next-line vue/no-v-html -- SVG produced by mermaid in strict mode -->
        <div v-if="!failed && svg" class="flex justify-center [&_svg]:max-w-full" v-html="svg" />
        <div v-else-if="failed" class="space-y-2">
            <p class="text-sm text-muted-foreground">This diagram could not be drawn. Here is its source:</p>
            <pre class="overflow-x-auto rounded bg-muted p-3 text-xs"><code>{{ code }}</code></pre>
        </div>
        <div v-else class="h-32 animate-pulse rounded bg-muted" aria-label="Drawing diagram" />
    </div>
</template>

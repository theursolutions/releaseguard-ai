/**
 * Plays a PRD flow step by step across its swimlanes. This is a walkthrough of the documented flow:
 * no code is executed and nothing is tested. With narration on, each step is read aloud and the next
 * one starts when the speech ends; otherwise the walkthrough moves on at the chosen pace. At a decision
 * it waits for the person to pick a branch.
 */
import type { FlowLayout, LaidOutEdge, LaidOutNode } from '@/lib/flowLayout';
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

const BASE_STEP_MS = 1700;
const MAX_VISITS = 3; // a loop is followed at most this many times

export function useFlowWalkthrough(layout: Ref<FlowLayout | null>, options: { narrate: Ref<boolean>; lang: () => string; rate: () => number }) {
    const path = ref<string[]>([]);
    const edgePath = ref<string[]>([]);
    const playing = ref(false);
    const speed = ref(1);
    const note = ref('');

    let timer = 0;
    let utterance: SpeechSynthesisUtterance | null = null;

    const current = computed<LaidOutNode | null>(() => layout.value?.nodes.find((n) => n.id === path.value[path.value.length - 1]) ?? null);
    const outgoing = computed<LaidOutEdge[]>(() => (current.value ? layout.value!.edges.filter((e) => e.from === current.value!.id) : []));
    const choices = computed(() => (outgoing.value.length > 1 ? outgoing.value : []));
    const finished = computed(() => Boolean(current.value) && outgoing.value.length === 0);
    const started = computed(() => path.value.length > 0);
    const activeEdge = computed(() => edgePath.value[edgePath.value.length - 1] ?? null);
    const visited = computed(() => new Set(path.value));
    const visitedEdges = computed(() => new Set(edgePath.value));

    function clearPending() {
        window.clearTimeout(timer);
        if (utterance) {
            utterance.onend = null;
            utterance = null;
            window.speechSynthesis?.cancel();
        }
    }

    /** What happens once a step is shown: narrate it, or wait the step time, then move on if still playing. */
    function scheduleAdvance() {
        clearPending();
        if (!playing.value || !current.value) return;
        if (choices.value.length || finished.value) {
            if (finished.value) playing.value = false;
            if (options.narrate.value) narrate(current.value, () => undefined);
            return;
        }
        if (options.narrate.value && 'speechSynthesis' in window) narrate(current.value, () => playing.value && advance());
        else timer = window.setTimeout(() => playing.value && advance(), BASE_STEP_MS / speed.value);
    }

    function narrate(node: LaidOutNode, onEnd: () => void) {
        utterance = new SpeechSynthesisUtterance(`${node.lane}. ${node.label}`);
        utterance.lang = options.lang();
        utterance.rate = options.rate() * speed.value;
        utterance.onend = onEnd;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }

    function follow(edge: LaidOutEdge) {
        if (path.value.filter((id) => id === edge.to).length >= MAX_VISITS) {
            note.value = 'This loop was followed several times; the walkthrough stopped here.';
            pause();
            return;
        }
        edgePath.value = [...edgePath.value, edge.id];
        path.value = [...path.value, edge.to];
        scheduleAdvance();
    }

    function advance() {
        if (!current.value || outgoing.value.length !== 1) return;
        follow(outgoing.value[0]);
    }

    function play() {
        if (!layout.value?.root) return;
        note.value = '';
        if (!started.value || finished.value) {
            path.value = [layout.value.root];
            edgePath.value = [];
        }
        playing.value = true;
        scheduleAdvance();
    }

    function pause() {
        playing.value = false;
        clearPending();
    }

    function next() {
        if (!started.value) {
            if (layout.value?.root) path.value = [layout.value.root];
            return;
        }
        clearPending();
        advance();
    }

    function back() {
        if (path.value.length < 2) return;
        pause();
        path.value = path.value.slice(0, -1);
        edgePath.value = edgePath.value.slice(0, -1);
    }

    function choose(edge: LaidOutEdge) {
        clearPending();
        follow(edge);
    }

    function reset() {
        pause();
        path.value = [];
        edgePath.value = [];
        note.value = '';
    }

    watch(layout, reset);
    watch(speed, () => playing.value && scheduleAdvance());
    onBeforeUnmount(reset);

    return { current, choices, finished, started, playing, speed, note, activeEdge, visited, visitedEdges, play, pause, next, back, choose, reset };
}

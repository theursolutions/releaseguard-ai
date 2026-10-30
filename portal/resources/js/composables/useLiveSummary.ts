/**
 * Keeps the command-centre widgets current: fetches /assistant/live every `intervalSeconds` while the
 * page is visible, pauses while it is hidden, and refreshes at once when it becomes visible again.
 * Values change only when the server returned new data; `stale` means the last refresh failed or is old.
 * The last response is kept for this browser tab (per user and product), so a reload shows it at once,
 * labelled with its real age, until the fresh response arrives. `sections` limits the request to some
 * widgets, so a slow source can be fetched on its own; `enabled: false` never fetches.
 */
import type { LiveSummary } from '@/types/assistant';
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

export function useLiveSummary(options: { productId: Ref<number | null>; intervalSeconds: number; userId: number; sections: string; enabled?: boolean }) {
    const enabled = options.enabled ?? true;
    const snapshotKey = () => `releaseguard.live.${options.userId}.${options.productId.value ?? 'all'}.${options.sections}`;
    function readSnapshot(): { data: LiveSummary; at: number } | null {
        try {
            return JSON.parse(sessionStorage.getItem(snapshotKey()) ?? 'null');
        } catch {
            return null;
        }
    }
    function writeSnapshot(value: LiveSummary, at: number) {
        try {
            sessionStorage.setItem(snapshotKey(), JSON.stringify({ data: value, at }));
        } catch {
            /* storage unavailable or full: the next reload just waits for the server */
        }
    }

    const snapshot = readSnapshot();
    const data = ref<LiveSummary | null>(snapshot?.data ?? null);
    const loading = ref(false);
    const error = ref('');
    const updatedAt = ref<number | null>(snapshot?.at ?? null);
    const now = ref(Date.now());

    let pollTimer = 0;
    let clockTimer = 0;
    let controller: AbortController | null = null;

    async function refresh() {
        if (!enabled) return;
        controller?.abort();
        controller = new AbortController();
        loading.value = true;
        try {
            const query = new URLSearchParams({ sections: options.sections });
            if (options.productId.value) query.set('product_id', String(options.productId.value));
            const response = await fetch(`/assistant/live?${query}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
            if (!response.ok) throw new Error(response.status === 429 ? 'Refreshing too often; the next refresh will catch up.' : `The live data could not be loaded (HTTP ${response.status}).`);
            data.value = await response.json();
            updatedAt.value = Date.now();
            writeSnapshot(data.value!, updatedAt.value);
            error.value = '';
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return;
            error.value = e instanceof Error ? e.message : 'The live data could not be loaded.';
        } finally {
            loading.value = false;
        }
    }

    function schedule() {
        window.clearInterval(pollTimer);
        if (enabled && !document.hidden) pollTimer = window.setInterval(refresh, options.intervalSeconds * 1000);
    }

    function onVisibility() {
        schedule();
        if (!document.hidden) void refresh();
    }

    const secondsAgo = computed(() => (updatedAt.value ? Math.max(0, Math.round((now.value - updatedAt.value) / 1000)) : null));
    const stale = computed(() => Boolean(error.value) || (secondsAgo.value !== null && secondsAgo.value > options.intervalSeconds * 3));

    watch(options.productId, () => {
        const saved = readSnapshot();
        data.value = saved?.data ?? null;
        updatedAt.value = saved?.at ?? null;
        void refresh();
    });

    onMounted(() => {
        void refresh();
        schedule();
        // Only the "updated Xs ago" label uses this clock; it never changes a value.
        clockTimer = window.setInterval(() => (now.value = Date.now()), 1000);
        document.addEventListener('visibilitychange', onVisibility);
    });

    onBeforeUnmount(() => {
        controller?.abort();
        window.clearInterval(pollTimer);
        window.clearInterval(clockTimer);
        document.removeEventListener('visibilitychange', onVisibility);
    });

    return { data, loading, error, secondsAgo, stale, refresh };
}

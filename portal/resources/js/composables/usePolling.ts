import { router } from '@inertiajs/vue3';
import { onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * Reloads the given props every few seconds while `active` is true (e.g. while an AI job runs, or
 * for the live monitoring view). Uses partial reloads, so only those props are fetched, and skips
 * ticks while the browser tab is hidden. Returns `refreshNow` for manual refreshes.
 */
export function usePolling(active: Ref<boolean>, only: string[], intervalMs = 3000, onReloaded?: () => void) {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const refreshNow = () => {
        if (inFlight) return;
        inFlight = true;
        router.reload({ only, onFinish: () => ((inFlight = false), onReloaded?.()) });
    };

    const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
    };

    watch(
        active,
        (isActive) => {
            stop();
            if (isActive) {
                timer = setInterval(() => {
                    if (!document.hidden) refreshNow();
                }, intervalMs);
            }
        },
        { immediate: true },
    );

    onBeforeUnmount(stop);

    return { refreshNow };
}

/** Loads performance figures for the signed-in person. What they may see is decided on the server. */
import { reactive, ref, watch } from 'vue';

export type Period = '7d' | '30d' | '90d' | '12m' | 'all';

export interface Kpi {
    value: number;
    previous?: number;
    change_pct?: number | null;
}
export interface LeaderboardRow {
    user_id: number;
    name: string;
    agency: string | null;
    revenue: number;
    deals: number;
    leads: number;
    won: number;
    lost: number;
    win_rate: number | null;
    commission: number;
    listings: number;
}
export interface PerformanceOverview {
    demo: boolean;
    note?: string;
    scope: { level: 'global' | 'agency' | 'agent'; label: string; agency_id: number | null; agency_name: string | null; agent_user_id?: number };
    period: { key: Period; from: string | null; to: string; bucket: 'day' | 'week' | 'month' };
    currency: { primary: string; mixed: boolean; all: string[] };
    kpis: Record<string, Kpi>;
    earnings: { paid: number; approved: number; pending_review: number; cancelled: number; monthly: { month: string; paid: number }[] };
    revenue_trend: { bucket: string; won: number; lost: number; deals: number }[];
    lead_trend: { bucket: string; created: number; won: number; lost: number }[];
    funnel: { code: string; stage: string; count: number }[];
    sources: { source: string; leads: number; won: number; revenue: number }[];
    heatmap: { days: string[]; hours: number[]; cells: [number, number, number][]; max: number };
    lost_reasons: { reason: string; count: number; value: number }[];
    leaderboard: LeaderboardRow[];
    agencies: { id: number; name: string; agents: number; listings: number; revenue: number; deals: number; leads: number }[];
    directory: { agencies?: { id: number; name: string }[]; agents?: { user_id: number; name: string }[] };
    definitions: Record<string, string>;
}

export function usePerformance() {
    const filters = reactive<{ period: Period; agency_id: number | null; agent_user_id: number | null }>({ period: '30d', agency_id: null, agent_user_id: null });
    const data = ref<PerformanceOverview | null>(null);
    const loading = ref(false);
    const error = ref('');
    const loadedAt = ref<Date | null>(null);
    let controller: AbortController | null = null;

    async function load() {
        controller?.abort();
        controller = new AbortController();
        loading.value = true;
        error.value = '';
        const query = new URLSearchParams({ period: filters.period });
        if (filters.agency_id) query.set('agency_id', String(filters.agency_id));
        if (filters.agent_user_id) query.set('agent_user_id', String(filters.agent_user_id));
        try {
            const response = await fetch(`/performance/data?${query}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? `The performance data could not be loaded (HTTP ${response.status}).`);
            data.value = body;
            loadedAt.value = new Date();
        } catch (failure) {
            if ((failure as Error).name === 'AbortError') return;
            error.value = (failure as Error).message;
        } finally {
            loading.value = false;
        }
    }

    watch(filters, load);

    return { filters, data, loading, error, loadedAt, load };
}

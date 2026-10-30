/** Shapes returned by /assistant/live and the PRD flow endpoints. */

export interface SectionError {
    error: string;
}

export interface MonitoringSection {
    available: boolean;
    demo_data?: boolean;
    note?: string | null;
    counts?: { ALARM: number; critical: number; OK: number; INSUFFICIENT_DATA: number };
    as_of?: string | null;
    alarms?: { name: string; state: string; severity?: string; resource?: string; description?: string; series: number[] }[];
    forecasts?: { resource: string; label: string; days: number | null }[];
}

export interface PlatformSection {
    services: { name: string; title: string; online: boolean; version?: string | null; error?: string | null }[];
    online: number;
    ai_provider: { configured: boolean; label?: string; note?: string };
    connections: { type: string; label: string; status: string }[] | null;
}

export interface ToolkitSection {
    available: boolean;
    note?: string;
    rules?: string[];
    skills?: string[];
    agents?: string[];
    hooks?: string[];
    atlassian_mcp?: boolean;
    docs?: { file: string; title: string }[];
}

export interface PrdSection {
    reviewed: number;
    ready_for_sprint: number;
    not_ready: number;
    average_score_last_20: number;
    ready_threshold: number;
    recent: { id: number; title: string; product: string | null; status: string; score: number | null; author: string | null }[];
}

export interface PerformanceSection {
    demo: boolean;
    note?: string | null;
    scope: string | null;
    currency: string | null;
    currency_mixed: boolean;
    kpis: Record<string, { value: number; change_pct?: number | null }>;
    trend: number[];
    top_agents: { user_id: number; name: string; revenue: number; deals: number; win_rate: number | null }[];
    earnings: { paid: number; approved: number; pending_review: number } | null;
}

export interface LiveEvent {
    kind: 'prd' | 'diagnosis' | 'alarm';
    tone: 'good' | 'warn' | 'bad' | 'info';
    label: string;
    at: string | null;
    demo: boolean;
}

export interface ActivitySection {
    events: LiveEvent[];
    team: { authorised: boolean; period_days?: number; note?: string; people?: { name: string; prd_reviews: number; average_readiness: number | null; alarm_diagnoses: number }[] } | null;
}

type Section<T> = T | SectionError | null | undefined;

export interface LiveSummary {
    generated_at: string;
    sections: {
        performance?: Section<PerformanceSection>;
        monitoring?: Section<MonitoringSection>;
        platform?: Section<PlatformSection>;
        toolkit?: Section<ToolkitSection>;
        prd?: Section<PrdSection>;
        activity?: Section<ActivitySection>;
    };
}

export function sectionError(section: unknown): string | null {
    return section && typeof section === 'object' && 'error' in section ? String((section as SectionError).error) : null;
}

/* ---------------- PRD flows ---------------- */

export type FlowNodeKind = 'start' | 'action' | 'decision' | 'system' | 'end';

export interface FlowGraph {
    lanes: string[];
    nodes: { id: string; lane: string; kind: FlowNodeKind; label: string }[];
    edges: { from: string; to: string; label: string }[];
}

export interface PrdFlow {
    id: string;
    module?: string | null;
    actor: string | null;
    name: string;
    steps?: string[];
    business_rules?: string[];
    edge_cases?: string[];
    acceptance_criteria?: { given: string; when: string; then: string }[];
    missing?: string[];
    graph: FlowGraph;
}

/** A flow as the PRD review page draws it: its latest version and where its graph came from. */
export interface ReviewFlow extends PrdFlow {
    version: number;
    graph_source: 'ai' | 'steps';
}

export interface FlowVersion {
    version: number;
    change_summary: string;
    instruction: string | null;
    restored_from_version: number | null;
    user: string | null;
    created_at: string | null;
}

export interface FlowDetail {
    review: { id: number; title: string };
    flow: PrdFlow;
    graph_source: 'ai' | 'steps';
    version: number;
    versions: FlowVersion[];
    can_correct: boolean;
}

export interface FlowSummary {
    id: string;
    name: string;
    actor: string | null;
    lanes: string[];
    version: number;
}

export interface PrdReviewOption {
    id: number;
    title: string;
    score: number | null;
    product: string | null;
    flows: number;
}

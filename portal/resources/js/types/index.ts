import type { LucideIcon } from 'lucide-vue-next';

export interface Auth {
    user: User;
    isAdmin: boolean;
    isCrmUser: boolean;
    canSeePerformance: boolean;
    crm: { crm_persona: string; crm_agency_name: string | null } | null;
}

export interface BreadcrumbItem {
    title: string;
    href: string;
}

export interface NavItem {
    title: string;
    href: string;
    icon?: LucideIcon;
    isActive?: boolean;
}

export interface SharedData {
    [key: string]: unknown;
    name: string;
    quote: { message: string; author: string };
    auth: Auth;
    flash: { success: string | null; error: string | null };
    ziggy: {
        location: string;
        url: string;
        port: null | number;
        defaults: Record<string, unknown>;
        routes: Record<string, string>;
    };
}

export type Role = 'admin' | 'member';

export interface User {
    id: number;
    name: string;
    email: string;
    role: Role;
    avatar?: string;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
}

export type BreadcrumbItemType = BreadcrumbItem;

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Paginated<T> {
    data: T[];
    current_page: number;
    last_page: number;
    total: number;
    prev_page_url: string | null;
    next_page_url: string | null;
}

export interface ScoreArea {
    area: string;
    label: string;
    points: number;
    max: number;
    reason: string;
}

export interface PrdResult {
    summary: string;
    actors: { name: string; description: string; permissions: string[] }[];
    /** PRD modules (major sections); missing on reviews made before flows were grouped by module. */
    modules?: { name: string; description: string }[];
    flows: {
        id: string;
        module?: string;
        actor: string;
        name: string;
        steps: string[];
        business_rules: string[];
        edge_cases: string[];
        acceptance_criteria: { given: string; when: string; then: string }[];
        missing: string[];
    }[];
    dependencies: { name: string; type: string; owner: string; needed_by: string }[];
    questions: { flow_id: string; question: string; why_it_matters: string; blocking: boolean }[];
    contradictions: { description: string; quote_a: string; quote_b: string }[];
    out_of_scope: string[];
    score_breakdown: ScoreArea[];
    diagrams: { actor: string; mermaid: string }[];
}

export interface PrdAnalysis {
    id: number;
    title: string;
    source_type: 'upload' | 'confluence' | 'text';
    source_name: string | null;
    status: JobStatus;
    score: number | null;
    result: PrdResult | null;
    error: string | null;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    created_at: string;
    completed_at: string | null;
    user?: { id: number; name: string };
}

export interface AlarmSummary {
    name: string;
    state: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
    severity: 'critical' | 'warning';
    reason: string;
    updated_at: string;
    description: string;
    resource: string;
    metric: string;
    runbook: string | null;
    series?: number[];
}

export interface MonitoringOverview {
    demo: boolean;
    alarms: AlarmSummary[];
    forecasts: { resource: string; label: string; days: number | null }[];
    counts: { ALARM: number; OK: number; INSUFFICIENT_DATA: number; critical: number };
    generated_at?: string;
}

export interface Diagnosis {
    summary: string;
    probable_cause: string;
    impact: string;
    evidence: string[];
    next_steps: string[];
    confidence: 'low' | 'medium' | 'high';
    is_likely_false_alarm: boolean;
    canned?: boolean;
}

export interface AlarmDiagnosis {
    id: number;
    alarm_name: string;
    alarm: Partial<AlarmSummary>;
    is_demo: boolean;
    status: JobStatus;
    result: Diagnosis | null;
    error: string | null;
    model: string | null;
    created_at: string;
    completed_at: string | null;
    user?: { id: number; name: string };
}

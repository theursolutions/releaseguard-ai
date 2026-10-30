<script setup lang="ts">
/**
 * A PRD flow drawn as actor swimlanes (SVG). It draws itself in step order when a flow (or a new
 * version) arrives; the walkthrough's current step, visited steps and active connection are highlighted.
 * Labels are rendered as text, never as HTML.
 */
import { LANE_HEIGHT, LANE_LABEL_WIDTH, NODE_HEIGHT, NODE_WIDTH, labelWidth, type FlowLayout } from '@/lib/flowLayout';

defineProps<{
    layout: FlowLayout;
    current: string | null;
    visited: Set<string>;
    visitedEdges: Set<string>;
    activeEdge: string | null;
    zoom: number;
}>();

const markerId = `fl-arrow-${Math.random().toString(36).slice(2)}`;
const KIND_LABEL = { start: 'Start', action: 'Action', decision: 'Decision', system: 'System', end: 'End' } as const;
</script>

<template>
    <svg
        :width="layout.width * zoom"
        :height="layout.height * zoom"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        class="fl-svg block"
        role="img"
        :aria-label="`Flow with ${layout.nodes.length} steps across ${layout.lanes.length} actors`"
    >
        <defs>
            <marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" class="fl-arrow" />
            </marker>
            <linearGradient id="fl-lane-glow" x1="0" x2="1">
                <stop offset="0%" stop-color="rgba(34,211,238,0.10)" />
                <stop offset="100%" stop-color="rgba(34,211,238,0)" />
            </linearGradient>
        </defs>

        <!-- Lanes -->
        <g v-for="(lane, index) in layout.lanes" :key="lane.name">
            <rect x="0" :y="lane.y" :width="layout.width" :height="LANE_HEIGHT" :class="index % 2 ? 'fl-lane-odd' : 'fl-lane-even'" />
            <rect x="0" :y="lane.y" :width="LANE_LABEL_WIDTH" :height="LANE_HEIGHT" fill="url(#fl-lane-glow)" />
            <line x1="0" :x2="layout.width" :y1="lane.y + LANE_HEIGHT" :y2="lane.y + LANE_HEIGHT" class="fl-lane-line" />
            <foreignObject x="10" :y="lane.y" :width="LANE_LABEL_WIDTH - 20" :height="LANE_HEIGHT">
                <div class="flex h-full flex-col justify-center">
                    <span class="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/60">Actor</span>
                    <span class="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-100" :title="lane.name">{{ lane.name }}</span>
                </div>
            </foreignObject>
        </g>
        <line :x1="LANE_LABEL_WIDTH" :x2="LANE_LABEL_WIDTH" y1="0" :y2="layout.height" class="fl-lane-line" />

        <!-- Connections -->
        <g fill="none">
            <path
                v-for="edge in layout.edges"
                :key="edge.id"
                :d="edge.path"
                pathLength="1"
                class="fl-edge"
                :class="{ 'fl-edge-back': edge.back, 'fl-edge-visited': visitedEdges.has(edge.id), 'fl-edge-active': activeEdge === edge.id }"
                :style="{ animationDelay: `${0.25 + edge.order * 0.07}s` }"
                :marker-end="`url(#${markerId})`"
            />
        </g>
        <g v-for="edge in layout.edges.filter((e) => e.label)" :key="`label-${edge.id}`" class="fl-node-in" :style="{ animationDelay: `${0.35 + edge.order * 0.07}s` }">
            <rect :x="edge.labelX - labelWidth(edge.label) / 2" :y="edge.labelY - 9" :width="labelWidth(edge.label)" height="18" rx="9" class="fl-edge-label-bg" />
            <text :x="edge.labelX" :y="edge.labelY + 3.5" text-anchor="middle" class="fl-edge-label">{{ edge.label }}</text>
        </g>

        <!-- Steps -->
        <g v-for="node in layout.nodes" :key="node.id" :transform="`translate(${node.x}, ${node.y})`">
        <g
            class="fl-node fl-node-in"
            :class="[`fl-${node.kind}`, { 'fl-visited': visited.has(node.id), 'fl-current': current === node.id }]"
            :style="{ animationDelay: `${node.order * 0.07}s` }"
        >
            <title>{{ KIND_LABEL[node.kind] }} · {{ node.lane }}: {{ node.label }}</title>
            <rect v-if="current === node.id" x="-7" y="-7" :width="NODE_WIDTH + 14" :height="NODE_HEIGHT + 14" rx="16" class="fl-halo" />
            <polygon
                v-if="node.kind === 'decision'"
                :points="`${NODE_WIDTH / 2},0 ${NODE_WIDTH},${NODE_HEIGHT / 2} ${NODE_WIDTH / 2},${NODE_HEIGHT} 0,${NODE_HEIGHT / 2}`"
                class="fl-shape"
            />
            <rect
                v-else
                :width="NODE_WIDTH"
                :height="NODE_HEIGHT"
                :rx="node.kind === 'start' || node.kind === 'end' ? NODE_HEIGHT / 2 : node.kind === 'system' ? 4 : 11"
                class="fl-shape"
            />
            <foreignObject :x="node.kind === 'decision' ? NODE_WIDTH * 0.18 : 8" y="4" :width="node.kind === 'decision' ? NODE_WIDTH * 0.64 : NODE_WIDTH - 16" :height="NODE_HEIGHT - 8">
                <div class="flex h-full flex-col items-center justify-center text-center">
                    <span v-if="node.kind !== 'decision'" class="fl-kind text-[9px] font-semibold uppercase tracking-[0.16em]">{{ KIND_LABEL[node.kind] }}</span>
                    <span class="line-clamp-2 font-medium leading-tight text-slate-50" :class="node.kind === 'decision' ? 'text-[11px]' : 'text-[12.5px]'">{{ node.label }}</span>
                </div>
            </foreignObject>
        </g>
        </g>
    </svg>
</template>

<style scoped>
.fl-svg {
    font-family: inherit;
}
.fl-lane-even { fill: rgba(255, 255, 255, 0.018); }
.fl-lane-odd { fill: rgba(56, 189, 248, 0.035); }
.fl-lane-line { stroke: rgba(148, 163, 184, 0.12); stroke-width: 1; }
.fl-arrow { fill: rgba(125, 211, 252, 0.75); }

.fl-edge {
    stroke: rgba(125, 211, 252, 0.45);
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: fl-draw 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.fl-edge-back { stroke: rgba(251, 191, 36, 0.5); stroke-dasharray: 0.02 0.015; }
.fl-edge-visited { stroke: rgba(103, 232, 249, 0.85); stroke-width: 2; }
.fl-edge-active {
    stroke: rgb(165, 243, 252);
    stroke-width: 2.6;
    stroke-dasharray: 0.04 0.03;
    filter: drop-shadow(0 0 5px rgba(34, 211, 238, 0.9));
    animation: fl-flow 0.9s linear infinite;
}
.fl-edge-label-bg { fill: rgba(8, 14, 28, 0.95); stroke: rgba(251, 191, 36, 0.4); }
.fl-edge-label { fill: rgb(253, 230, 138); font-size: 10px; font-weight: 600; }

.fl-node-in {
    opacity: 0;
    animation: fl-pop 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.fl-shape {
    stroke-width: 1.4;
    transition: fill 0.3s, stroke 0.3s;
}
.fl-start .fl-shape, .fl-end .fl-shape { fill: rgba(16, 185, 129, 0.14); stroke: rgba(52, 211, 153, 0.7); }
.fl-action .fl-shape { fill: rgba(14, 165, 233, 0.12); stroke: rgba(56, 189, 248, 0.6); }
.fl-system .fl-shape { fill: rgba(139, 92, 246, 0.14); stroke: rgba(167, 139, 250, 0.65); stroke-dasharray: 5 3; }
.fl-decision .fl-shape { fill: rgba(245, 158, 11, 0.12); stroke: rgba(251, 191, 36, 0.7); }
.fl-start .fl-kind, .fl-end .fl-kind { color: rgb(110, 231, 183); }
.fl-action .fl-kind { color: rgb(125, 211, 252); }
.fl-system .fl-kind { color: rgb(196, 181, 253); }

.fl-visited .fl-shape { stroke-width: 2; filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.45)); }
.fl-current .fl-shape { stroke: rgb(165, 243, 252); stroke-width: 2.4; fill: rgba(34, 211, 238, 0.22); filter: drop-shadow(0 0 10px rgba(34, 211, 238, 0.85)); }
.fl-halo {
    fill: none;
    stroke: rgba(34, 211, 238, 0.5);
    stroke-width: 1.5;
    transform-box: fill-box;
    transform-origin: center;
    animation: fl-halo 1.4s ease-out infinite;
}

@keyframes fl-draw { to { stroke-dashoffset: 0; } }
@keyframes fl-flow { to { stroke-dashoffset: -0.07; } }
@keyframes fl-pop {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
}
@keyframes fl-halo {
    from { opacity: 0.9; transform: scale(0.96); }
    to { opacity: 0; transform: scale(1.08); }
}
@media (prefers-reduced-motion: reduce) {
    .fl-edge, .fl-node-in { animation: none; opacity: 1; stroke-dashoffset: 0; }
    .fl-edge-active, .fl-halo { animation: none; }
}
</style>

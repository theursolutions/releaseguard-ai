/**
 * Lays out a PRD flow as swimlanes: one row per actor, steps placed left to right in the order they
 * happen (longest path from the start), never two steps in the same cell. Connections that go back
 * to an earlier step (loops, "try again") are routed underneath the lane instead of across it.
 */
import type { FlowGraph, FlowNodeKind } from '@/types/assistant';

export const LANE_LABEL_WIDTH = 132;
const PAD = 28;
const COLUMN_WIDTH = 184;
export const NODE_WIDTH = 146;
export const NODE_HEIGHT = 58;
export const LANE_HEIGHT = 112;
const CHANNEL_OFFSET = 14; // the gap above a lane's steps that long connections run along

/** Width of an edge label's pill, as FlowSwimlanes draws it. */
export const labelWidth = (label: string) => (label ? label.length * 6.2 + 8 : 0);

export interface LaidOutNode {
    id: string;
    lane: string;
    kind: FlowNodeKind;
    label: string;
    x: number;
    y: number;
    order: number;
}

export interface LaidOutEdge {
    id: string;
    from: string;
    to: string;
    label: string;
    path: string;
    labelX: number;
    labelY: number;
    back: boolean;
    order: number;
}

export interface FlowLayout {
    lanes: { name: string; y: number }[];
    nodes: LaidOutNode[];
    edges: LaidOutEdge[];
    width: number;
    height: number;
    /** Where a walkthrough starts: the start step, else the first step nothing leads to. */
    root: string | null;
}

export function layoutFlow(graph: FlowGraph): FlowLayout {
    const lanes = [...graph.lanes];
    for (const node of graph.nodes) if (!lanes.includes(node.lane)) lanes.push(node.lane);

    const ids = new Set(graph.nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const outgoing = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
    const incoming = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
    for (const e of edges) {
        outgoing.get(e.from)!.push(e.to);
        incoming.set(e.to, incoming.get(e.to)! + 1);
    }

    const roots = [
        ...graph.nodes.filter((n) => n.kind === 'start'),
        ...graph.nodes.filter((n) => n.kind !== 'start' && incoming.get(n.id) === 0),
        ...graph.nodes,
    ].map((n) => n.id);

    // Depth-first from the roots: an edge to a step still on the stack goes back in time.
    const backEdges = new Set<string>();
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string) => {
        state.set(id, 'open');
        for (const next of outgoing.get(id)!) {
            if (state.get(next) === 'open') backEdges.add(`${id}>${next}`);
            else if (!state.has(next)) visit(next);
        }
        state.set(id, 'done');
    };
    for (const id of roots) if (!state.has(id)) visit(id);

    // Topological order over forward edges, then the earliest free column after every predecessor.
    const forward = edges.filter((e) => !backEdges.has(`${e.from}>${e.to}`));
    const pending = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
    for (const e of forward) pending.set(e.to, pending.get(e.to)! + 1);
    const queue = roots.filter((id, i) => roots.indexOf(id) === i && pending.get(id) === 0);
    const column = new Map<string, number>();
    const occupied = new Set<string>();
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const order: string[] = [];
    while (queue.length) {
        const id = queue.shift()!;
        if (column.has(id)) continue;
        const preds = forward.filter((e) => e.to === id).map((e) => column.get(e.from) ?? -1);
        let col = preds.length ? Math.max(...preds) + 1 : 0;
        while (occupied.has(`${byId.get(id)!.lane}:${col}`)) col++;
        occupied.add(`${byId.get(id)!.lane}:${col}`);
        column.set(id, col);
        order.push(id);
        for (const e of forward.filter((f) => f.from === id)) {
            pending.set(e.to, pending.get(e.to)! - 1);
            if (pending.get(e.to) === 0) queue.push(e.to);
        }
    }

    const laneY = (lane: string) => lanes.indexOf(lane) * LANE_HEIGHT;
    const nodes: LaidOutNode[] = order.map((id, index) => {
        const node = byId.get(id)!;
        return {
            ...node,
            x: LANE_LABEL_WIDTH + PAD + column.get(id)! * COLUMN_WIDTH,
            y: laneY(node.lane) + (LANE_HEIGHT - NODE_HEIGHT) / 2,
            order: index,
        };
    });
    const placed = new Map(nodes.map((n) => [n.id, n]));

    const laidOutEdges: LaidOutEdge[] = edges.map((e, index) => {
        const a = placed.get(e.from)!;
        const b = placed.get(e.to)!;
        const back = backEdges.has(`${e.from}>${e.to}`);
        let path: string;
        let labelX: number;
        let labelY: number;
        if (back) {
            const ax = a.x + NODE_WIDTH / 2;
            const bx = b.x + NODE_WIDTH / 2;
            const below = Math.max(a.y, b.y) + NODE_HEIGHT + 20;
            path = `M${ax},${a.y + NODE_HEIGHT} V${below} H${bx} V${b.y + NODE_HEIGHT + 6}`;
            labelX = (ax + bx) / 2;
            labelY = below;
        } else if (b.x - a.x > COLUMN_WIDTH + 1 || (a.y === b.y && labelWidth(e.label) > COLUMN_WIDTH - NODE_WIDTH - 8)) {
            // Skips columns (a straight line would cross the steps in between), or its label is wider
            // than the gap between neighbours: leave the source, run along the gap above the target
            // lane's steps, where the label has room, and drop into the target from above.
            const sx = a.x + NODE_WIDTH;
            const sy = a.y + NODE_HEIGHT / 2;
            const mid = sx + (COLUMN_WIDTH - NODE_WIDTH) / 2;
            const channel = b.y - CHANNEL_OFFSET;
            const bx = b.x + NODE_WIDTH / 2;
            path = `M${sx},${sy} H${mid} V${channel} H${bx} V${b.y - 6}`;
            labelX = (mid + bx) / 2;
            labelY = channel;
        } else {
            const sx = a.x + NODE_WIDTH;
            const sy = a.y + NODE_HEIGHT / 2;
            const tx = b.x - 6;
            const ty = b.y + NODE_HEIGHT / 2;
            const mid = sx + Math.max(18, (b.x - sx) / 2);
            path = Math.abs(sy - ty) < 1 ? `M${sx},${sy} H${tx}` : `M${sx},${sy} H${mid} V${ty} H${tx}`;
            labelX = Math.abs(sy - ty) < 1 ? (sx + tx) / 2 : mid;
            labelY = Math.abs(sy - ty) < 1 ? sy : (sy + ty) / 2;
        }
        return { id: `${e.from}>${e.to}#${index}`, from: e.from, to: e.to, label: e.label, path, labelX, labelY, back, order: index };
    });

    const columns = Math.max(0, ...column.values()) + 1;
    return {
        lanes: lanes.map((name) => ({ name, y: laneY(name) })),
        nodes,
        edges: laidOutEdges,
        width: LANE_LABEL_WIDTH + PAD * 2 + columns * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH),
        height: Math.max(1, lanes.length) * LANE_HEIGHT,
        root: order[0] ?? null,
    };
}

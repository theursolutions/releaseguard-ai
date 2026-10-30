// Shared knowledge about the crew: which room each agent type works in, its name and its colour.
// The server sends its own map (lib/stages.js) in /api/state and useCrew() adopts it, so new agents
// need adding only there; the copy below is the fallback until the first state arrives.

export const DEFAULT_ROOMS = [
  { id: 'triage', label: 'Reception', hint: 'The router reads the request and picks the crew' },
  { id: 'plan', label: 'Planning room', hint: 'Requirements and the implementation plan' },
  { id: 'build', label: 'Dev floor', hint: 'Backend, frontend and 3D developers' },
  { id: 'qa', label: 'QA lab', hint: 'Unit, feature and end-to-end tests' },
  { id: 'regression', label: 'Regression bay', hint: 'Full test suite against the starting point' },
  { id: 'review', label: 'Review desk', hint: 'Code review before hand-back' },
];

let AGENTS = {
  router: { stage: 'triage', label: 'Router' },
  planner: { stage: 'plan', label: 'Planner' },
  'prd-analyst': { stage: 'plan', label: 'PRD Analyst' },
  Plan: { stage: 'plan', label: 'Planner' },
  Explore: { stage: 'plan', label: 'Explorer' },
  developer: { stage: 'build', label: 'Developer' },
  'frontend-developer': { stage: 'build', label: 'Frontend Dev' },
  'frontend-3d-developer': { stage: 'build', label: '3D Dev' },
  'test-engineer': { stage: 'qa', label: 'Test Engineer' },
  'qa-automation': { stage: 'qa', label: 'QA Automation' },
  'regression-tester': { stage: 'regression', label: 'Regression' },
  'code-reviewer': { stage: 'review', label: 'Reviewer' },
};

// Chosen to stay distinguishable from each other and readable as a dot on both light and dark panels.
const TYPE_COLORS = {
  router: '#f2a516',
  planner: '#8b5cf6',
  Plan: '#8b5cf6',
  'prd-analyst': '#b05be0',
  Explore: '#14b8a6',
  developer: '#3b82f6',
  'frontend-developer': '#06b6d4',
  'frontend-3d-developer': '#ec4899',
  'test-engineer': '#22c55e',
  'qa-automation': '#84cc16',
  'regression-tester': '#f97316',
  'code-reviewer': '#ef4444',
};
const SPARE_COLORS = ['#0ea5e9', '#a855f7', '#10b981', '#e11d48', '#d97706', '#6366f1', '#65a30d', '#db2777'];

/** Adopts the server's agent map: { type: { stage, label } }. Ignores anything malformed. */
export function useCrew(map) {
  if (!map || typeof map !== 'object') return;
  const valid = Object.entries(map).filter(([, agent]) => typeof agent?.stage === 'string' && typeof agent?.label === 'string');
  if (valid.length) AGENTS = Object.fromEntries(valid);
}

// Real people the developer chose to show for some agent types (~/.devcrew/crew.json), by agent type.
let PEOPLE = {};

/** Adopts the server's people map: { type: { name, title, photo } }. Only same-origin photo paths are kept. */
export function usePeople(map) {
  if (!map || typeof map !== 'object') return;
  const valid = Object.entries(map).filter(([, person]) => typeof person?.name === 'string' && person.name);
  PEOPLE = Object.fromEntries(
    valid.map(([type, person]) => [
      type,
      { name: person.name, title: typeof person.title === 'string' ? person.title : '', photo: /^\/people\/[\w-]+$/.test(person.photo || '') ? person.photo : null },
    ]),
  );
}

export function personFor(type) {
  return PEOPLE[baseType(type)] || null;
}

/** An agent as the page shows it: the person's name as its label, its role kept alongside. */
export function withPerson(agent) {
  const person = personFor(agent?.type);
  return person ? { ...agent, label: person.name, role: agent.label, person } : agent;
}

/** Photo and "AI" tag for an agent shown as a real person; empty for other agents. */
export function personMarks(agent, photoClass) {
  if (!agent?.person) return { photo: null, tag: null };
  let photo = null;
  if (agent.person.photo) {
    photo = document.createElement('img');
    photo.className = photoClass;
    photo.src = agent.person.photo;
    photo.alt = '';
  }
  const tag = document.createElement('span');
  tag.className = 'ai-tag';
  tag.textContent = 'AI';
  tag.title = `AI ${agent.role || 'agent'}, shown as ${agent.person.name}`;
  return { photo, tag };
}

export function baseType(type) {
  const value = String(type || '');
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
}

export function stageFor(type) {
  return AGENTS[baseType(type)]?.stage || 'build';
}

/** The role's name, e.g. "Developer", whoever is shown in it. */
export function roleLabel(type) {
  const base = baseType(type);
  if (AGENTS[base]) return AGENTS[base].label;
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Agent';
}

// The crew that relaxes in the Done lounge while nothing is being worked on, in seating order.
export const LOUNGE_CREW = [
  'router',
  'planner',
  'prd-analyst',
  'developer',
  'frontend-developer',
  'frontend-3d-developer',
  'test-engineer',
  'qa-automation',
  'regression-tester',
  'code-reviewer',
];

export function labelFor(type) {
  return PEOPLE[baseType(type)]?.name || roleLabel(type);
}

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** A stable colour per agent type, so the same role always looks the same. */
export function colorFor(type) {
  const base = baseType(type);
  return TYPE_COLORS[base] || SPARE_COLORS[hashString(base) % SPARE_COLORS.length];
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function formatClock(ts, withSeconds = false) {
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const options = { hour: '2-digit', minute: '2-digit' };
  if (withSeconds) options.second = '2-digit';
  const time = date.toLocaleTimeString([], options);
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

const lowerFirst = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : '');

/**
 * A readable timeline line for an event: { who, text }. `who` is the agent's name (or null),
 * `text` continues the sentence. Everything here is inserted with textContent by the caller.
 */
export function describeEvent(event, agentOf) {
  const agent = agentOf(event);
  const who = agent?.label || (event.agentId === 'main' ? 'Router' : labelFor(event.agentType));
  switch (event.kind) {
    case 'session.start':
      return { who: null, text: `Session started in ${event.project || 'a project'}` };
    case 'request':
      return { who, text: event.text && event.text !== 'New request' ? `received a request: ${event.text}` : 'received a new request' };
    case 'handoff':
      return { who, text: `handed off to ${labelFor(event.target)}${event.text ? `: ${event.text}` : ''}` };
    case 'agent.start':
      return { who, text: agent?.task ? `started: ${agent.task}` : 'started' };
    case 'tool':
      return { who, text: lowerFirst(event.text) || `used ${event.tool || 'a tool'}` };
    case 'agent.stop':
      return { who, text: 'finished' };
    case 'session.idle':
      return { who, text: 'is waiting for you' };
    case 'session.end':
      return { who: null, text: 'Session ended' };
    default:
      return { who, text: event.kind };
  }
}

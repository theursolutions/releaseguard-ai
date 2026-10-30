// The office's memory: sessions, the agents in them and the latest events. Kept in memory only.
const { stageFor, labelFor } = require('./stages');

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_AGENTS_PER_SESSION = 60;

class OfficeState {
  constructor({ maxEvents = 500 } = {}) {
    this.maxEvents = maxEvents;
    this.sessions = new Map();
    this.agents = new Map();
    this.events = [];
    // Hand-off descriptions waiting for their agent to start, per session and agent type. The Agent tool
    // call carries the description, but the SubagentStart hook that follows only carries the agent id.
    this.pending = new Map();
    this.sequence = 0;
  }

  /** Applies one sanitized event and returns what changed, for broadcasting to open pages. */
  apply(event) {
    const stored = { id: ++this.sequence, ...event };
    this.events.push(stored);
    if (this.events.length > this.maxEvents) this.events.shift();

    const session = this.touchSession(stored);
    let agent = null;

    switch (stored.kind) {
      case 'session.start':
        agent = this.updateAgent(stored, 'main', { status: 'idle', text: 'Waiting for a request' });
        break;
      case 'request':
        session.status = 'active';
        agent = this.updateAgent(stored, 'main', { status: 'working', text: `Reading ${stored.text}` });
        break;
      case 'handoff': {
        const key = `${stored.session}:${stored.target}`;
        this.pending.set(key, [...(this.pending.get(key) || []), stored.text || '']);
        agent = this.updateAgent(stored, stored.agentId, { status: 'working', text: `Handing off to ${labelFor(stored.target)}` });
        break;
      }
      case 'agent.start': {
        const queue = this.pending.get(`${stored.session}:${stored.agentType}`) || [];
        agent = this.updateAgent(stored, stored.agentId, { status: 'working', text: 'Starting', task: queue.shift() || null, startedAt: stored.ts, endedAt: null });
        break;
      }
      case 'tool': {
        const current = this.agents.get(`${stored.session}:${stored.agentId}`);
        agent = this.updateAgent(stored, stored.agentId, { status: 'working', text: stored.text, tools: (current?.tools || 0) + 1 });
        break;
      }
      case 'agent.stop':
        agent = this.updateAgent(stored, stored.agentId, { status: 'done', text: 'Finished', endedAt: stored.ts });
        break;
      case 'session.idle':
        session.status = 'idle';
        agent = this.updateAgent(stored, 'main', { status: 'idle', text: 'Waiting for you' });
        break;
      case 'session.end':
        session.status = 'ended';
        for (const other of this.agents.values()) {
          if (other.session === stored.session && other.status !== 'done') Object.assign(other, { status: 'done', endedAt: stored.ts });
        }
        break;
    }

    this.prune(stored.ts);
    return { event: stored, agent, session };
  }

  touchSession(event) {
    let session = this.sessions.get(event.session);
    if (!session) {
      session = { id: event.session, project: event.project, status: 'active', startedAt: event.ts, demo: Boolean(event.demo) };
      this.sessions.set(event.session, session);
    }
    session.lastTs = event.ts;
    return session;
  }

  updateAgent(event, agentId, changes) {
    const key = `${event.session}:${agentId}`;
    let agent = this.agents.get(key);
    if (!agent) {
      const type = agentId === 'main' ? 'router' : event.agentType;
      agent = { key, id: agentId, session: event.session, type, label: labelFor(type), stage: stageFor(type), tools: 0, task: null, startedAt: event.ts, endedAt: null, demo: Boolean(event.demo) };
      this.agents.set(key, agent);
    }
    Object.assign(agent, changes, { lastTs: event.ts });
    return agent;
  }

  prune(now) {
    for (const [id, session] of this.sessions) {
      if (now - session.lastTs > SESSION_TTL_MS) {
        this.sessions.delete(id);
        for (const [key, agent] of this.agents) if (agent.session === id) this.agents.delete(key);
        for (const key of this.pending.keys()) if (key.startsWith(`${id}:`)) this.pending.delete(key);
      }
    }

    // Long sessions keep their newest agents; finished helpers from hours ago are dropped first.
    const perSession = new Map();
    for (const agent of this.agents.values()) perSession.set(agent.session, [...(perSession.get(agent.session) || []), agent]);
    for (const agents of perSession.values()) {
      if (agents.length <= MAX_AGENTS_PER_SESSION) continue;
      agents
        .filter((agent) => agent.status === 'done')
        .sort((a, b) => a.lastTs - b.lastTs)
        .slice(0, agents.length - MAX_AGENTS_PER_SESSION)
        .forEach((agent) => this.agents.delete(agent.key));
    }
  }

  snapshot() {
    return {
      sessions: [...this.sessions.values()],
      agents: [...this.agents.values()],
      events: this.events,
    };
  }
}

module.exports = { OfficeState };

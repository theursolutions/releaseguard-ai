// devcrew office: loads the office state, follows the live stream and drives the side panel plus
// either the 3D office (scene3d.js, loaded on demand) or the 2D board (board2d.js).
import { DEFAULT_ROOMS, colorFor, describeEvent, formatClock, formatElapsed, personMarks, useCrew, usePeople, withPerson } from './crew.js';
import { createBoard } from './board2d.js';

const MAX_EVENTS = 500;
const MAX_TIMELINE_ROWS = 80;
const MODE_KEY = 'devcrew-office:mode';

const $ = (id) => document.getElementById(id);
const els = {
  conn: $('conn'),
  connText: $('conn-text'),
  view3d: $('view-3d'),
  view2d: $('view-2d'),
  poster: $('poster'),
  ribbon: $('demo-ribbon'),
  sceneEmpty: $('scene-empty'),
  notice: $('notice'),
  btnMode: $('btn-mode'),
  camControls: $('cam-controls'),
  btnRotLeft: $('btn-rot-left'),
  btnRotRight: $('btn-rot-right'),
  btnZoomIn: $('btn-zoom-in'),
  btnZoomOut: $('btn-zoom-out'),
  btnReset: $('btn-reset'),
  select: $('session-select'),
  sessionDemo: $('session-demo'),
  sessionMeta: $('session-meta'),
  panelToggle: $('panel-toggle'),
  panelBody: $('panel-body'),
  empty: $('empty'),
  pipeline: $('pipeline'),
  working: $('working'),
  workingCount: $('working-count'),
  workingEmpty: $('working-empty'),
  timeline: $('timeline'),
  timelineEmpty: $('timeline-empty'),
  foot: $('foot'),
};

const store = {
  version: '',
  rooms: DEFAULT_ROOMS,
  sessions: new Map(),
  agents: new Map(),
  events: [],
  lastEventId: 0,
};

let selectedId = null;
let userPicked = false;
let sessionSignature = '';

// ---------------------------------------------------------------------------------------------
// Data: snapshot + live stream
// ---------------------------------------------------------------------------------------------

let loading = null;
let reloadQueued = false;
let buffered = [];

/** Fetches a fresh snapshot. Stream updates that arrive meanwhile are buffered and replayed on top. */
function loadState() {
  if (loading) {
    // A snapshot already in flight may predate the stream connection, so fetch once more after it.
    reloadQueued = true;
    return loading;
  }
  loading = (async () => {
    const previous = selectedId;
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      replaceState(await response.json());
      const pending = buffered;
      buffered = [];
      for (const update of pending) applyUpdate(update);
      hideNotice('server');
    } catch {
      showNotice('Can’t reach the office server. Retrying…', 'server');
    } finally {
      loading = null;
      selectDefaultSession();
      renderAll({ resetView: previous !== selectedId });
    }
    if (reloadQueued) {
      reloadQueued = false;
      loadState();
    }
  })();
  return loading;
}

function replaceState(snapshot) {
  store.version = String(snapshot.version || '');
  if (Array.isArray(snapshot.rooms) && snapshot.rooms.length) store.rooms = snapshot.rooms;
  useCrew(snapshot.crew);
  usePeople(snapshot.people);
  store.sessions = new Map((snapshot.sessions || []).map((session) => [session.id, session]));
  store.agents = new Map((snapshot.agents || []).map((agent) => [agent.key, withPerson(agent)]));
  store.events = (snapshot.events || []).slice().sort((a, b) => a.id - b.id).slice(-MAX_EVENTS);
  store.lastEventId = store.events.length ? store.events[store.events.length - 1].id : 0;
}

/** Applies one stream update. Returns true when it was new. */
function applyUpdate(update) {
  const event = update?.event;
  if (!event || !Number.isFinite(event.id) || event.id <= store.lastEventId) return false;
  store.events.push(event);
  if (store.events.length > MAX_EVENTS) store.events.shift();
  store.lastEventId = event.id;
  if (update.session?.id) store.sessions.set(update.session.id, update.session);
  if (update.agent?.key) store.agents.set(update.agent.key, withPerson(update.agent));
  if (event.kind === 'session.end') {
    // The server marks every agent of an ended session done, but only sends the event.
    for (const [key, agent] of store.agents) {
      if (agent.session === event.session && agent.status !== 'done') store.agents.set(key, { ...agent, status: 'done', endedAt: event.ts });
    }
  }
  return true;
}

let stream = null;
let retryTimer = null;
let retryDelay = 2000;

function connect() {
  clearTimeout(retryTimer);
  if (stream) stream.close();
  setConnection(stream ? 'reconnecting' : 'connecting');
  stream = new EventSource('/api/stream');

  stream.onopen = () => {
    setConnection('live');
    retryDelay = 2000;
    // Anything that happened while we were away arrives through a fresh snapshot.
    loadState();
  };

  stream.onmessage = (message) => {
    let update;
    try {
      update = JSON.parse(message.data);
    } catch {
      return;
    }
    if (loading) {
      buffered.push(update);
      return;
    }
    onUpdate(update);
  };

  stream.onerror = () => {
    setConnection('reconnecting');
    // The browser retries by itself unless the connection was refused outright.
    if (stream.readyState === EventSource.CLOSED) {
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  };
}

function onUpdate(update) {
  if (!applyUpdate(update)) return;
  const event = update.event;
  const isNewSession = event.kind === 'session.start' && event.session !== selectedId;
  if (isNewSession && (!userPicked || !store.sessions.has(selectedId))) {
    selectSession(event.session, false);
    return;
  }
  if (!selectedId) {
    selectDefaultSession();
    renderAll({ resetView: true });
    return;
  }
  if (event.session === selectedId) {
    if (event.kind === 'handoff') view?.handoff?.(event);
    scheduleRender();
  } else {
    scheduleRender({ panelOnly: true });
  }
}

function setConnection(state) {
  els.conn.dataset.state = state;
  els.connText.textContent = state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
}

// ---------------------------------------------------------------------------------------------
// Session selection
// ---------------------------------------------------------------------------------------------

function sessionsByRecent() {
  return [...store.sessions.values()].sort((a, b) => (b.lastTs || b.startedAt || 0) - (a.lastTs || a.startedAt || 0));
}

/** Keeps the current session while it exists; otherwise picks the most recently active one. */
function selectDefaultSession() {
  if (selectedId && store.sessions.has(selectedId)) return;
  const newest = sessionsByRecent()[0];
  selectedId = newest ? newest.id : null;
  if (!newest) userPicked = false;
}

function selectSession(id, byUser) {
  if (!store.sessions.has(id)) return;
  selectedId = id;
  if (byUser) userPicked = true;
  renderAll({ resetView: true });
}

function selectedAgents() {
  if (!selectedId) return [];
  return [...store.agents.values()].filter((agent) => agent.session === selectedId);
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

let renderQueued = false;
let queuedPanelOnly = true;

function scheduleRender({ panelOnly = false } = {}) {
  queuedPanelOnly = queuedPanelOnly && panelOnly;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const panelOnlyNow = queuedPanelOnly;
    queuedPanelOnly = true;
    renderAll({ panelOnly: panelOnlyNow });
  });
}

function renderAll({ resetView = false, panelOnly = false } = {}) {
  const session = selectedId ? store.sessions.get(selectedId) : null;
  const agents = selectedAgents();

  renderSessionPicker(session);
  renderPipeline(agents);
  renderWorking(agents);
  renderTimeline();

  const hasSessions = store.sessions.size > 0;
  els.empty.hidden = hasSessions;
  els.sceneEmpty.hidden = hasSessions;
  els.ribbon.hidden = !session?.demo;
  els.foot.textContent = store.version ? `devcrew office ${store.version}` : 'devcrew office';

  if (!panelOnly || resetView) view?.sync(agents, { reset: resetView });
}

function renderSessionPicker(session) {
  const sessions = sessionsByRecent();
  const signature = sessions.map((s) => `${s.id}|${s.status}|${s.project}|${s.demo}`).join(';');
  if (signature !== sessionSignature) {
    sessionSignature = signature;
    els.select.replaceChildren();
    if (!sessions.length) {
      els.select.append(new Option('No sessions yet', ''));
    }
    for (const item of sessions) {
      const text = `${item.project || 'project'} · ${item.status} · ${formatClock(item.startedAt)}${item.demo ? ' · Demo' : ''}`;
      els.select.append(new Option(text, item.id));
    }
  }
  els.select.disabled = sessions.length === 0;
  if (session && els.select.value !== session.id) els.select.value = session.id;

  els.sessionDemo.hidden = !session?.demo;
  if (session) {
    const started = formatClock(session.startedAt);
    els.sessionMeta.textContent = `${session.project || 'project'} · ${statusWord(session.status)} · started ${started}`;
  } else {
    els.sessionMeta.textContent = '';
  }
}

function statusWord(status) {
  return { active: 'active', idle: 'waiting for you', ended: 'ended' }[status] || String(status || '');
}

function stageState(stageId, agents) {
  const here = agents.filter((agent) => agent.stage === stageId);
  const working = here.filter((agent) => agent.status === 'working').length;
  const done = here.filter((agent) => agent.status === 'done').length;
  if (working) return { state: 'progress', text: working === 1 ? 'In progress' : `In progress · ${working} working` };
  if (done) return { state: 'done', text: done === 1 ? 'Done' : `Done · ${done} finished` };
  return { state: 'waiting', text: 'Waiting' };
}

function renderPipeline(agents) {
  const items = store.rooms.map((room, index) => {
    const { state, text } = stageState(room.id, agents);
    const li = document.createElement('li');
    li.className = 'step';
    li.dataset.state = state;
    if (state === 'progress') li.setAttribute('aria-current', 'step');

    const marker = document.createElement('span');
    marker.className = 'step-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = state === 'done' ? '✓' : String(index + 1);

    const body = document.createElement('span');
    body.className = 'step-body';
    const name = document.createElement('span');
    name.className = 'step-name';
    name.textContent = room.label;
    const status = document.createElement('span');
    status.className = 'step-status';
    status.textContent = text;
    body.append(name, status);

    li.append(marker, body);
    if (room.hint) li.title = room.hint;
    return li;
  });
  els.pipeline.replaceChildren(...items);
}

function renderWorking(agents) {
  const working = agents.filter((agent) => agent.status === 'working').sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  els.workingCount.textContent = working.length ? `(${working.length})` : '';
  els.workingEmpty.hidden = working.length > 0;
  els.working.replaceChildren(
    ...working.map((agent) => {
      const li = document.createElement('li');
      li.className = 'worker';
      li.style.setProperty('--agent', colorFor(agent.type));

      const top = document.createElement('div');
      top.className = 'worker-top';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.textContent = agent.label || 'Agent';
      const room = document.createElement('span');
      room.className = 'worker-room';
      const roomLabel = store.rooms.find((r) => r.id === agent.stage)?.label || '';
      room.textContent = agent.role ? `${agent.role} · ${roomLabel}` : roomLabel;
      const elapsed = document.createElement('span');
      elapsed.className = 'elapsed';
      elapsed.dataset.since = String(agent.startedAt || Date.now());
      elapsed.textContent = formatElapsed(Date.now() - (agent.startedAt || Date.now()));
      elapsed.title = 'Time since this agent started';
      const { photo, tag } = personMarks(agent, 'worker-photo');
      top.append(photo || dot, name, ...(tag ? [tag] : []), room, elapsed);
      li.append(top);

      if (agent.task) {
        const task = document.createElement('p');
        task.className = 'worker-task';
        task.textContent = agent.task;
        li.append(task);
      }
      const action = document.createElement('p');
      action.className = 'worker-action';
      action.textContent = agent.text || 'Working';
      li.append(action);
      return li;
    }),
  );
}

function agentOf(event) {
  return store.agents.get(`${event.session}:${event.agentId}`);
}

function renderTimeline() {
  const rows = [];
  if (selectedId) {
    for (let i = store.events.length - 1; i >= 0 && rows.length < MAX_TIMELINE_ROWS; i--) {
      const event = store.events[i];
      if (event.session === selectedId) rows.push(event);
    }
  }
  els.timelineEmpty.hidden = rows.length > 0;
  els.timeline.replaceChildren(
    ...rows.map((event) => {
      const { who, text } = describeEvent(event, agentOf);
      const li = document.createElement('li');
      li.className = `tl tl-${event.kind.replace('.', '-')}`;
      const time = document.createElement('time');
      time.dateTime = new Date(event.ts).toISOString();
      time.textContent = formatClock(event.ts, true);
      const line = document.createElement('span');
      line.className = 'tl-text';
      if (who) {
        const agent = agentOf(event);
        const name = document.createElement('strong');
        name.style.setProperty('--agent', colorFor(agent?.type || event.agentType));
        name.textContent = who;
        line.append(name, ` ${text}`);
      } else {
        line.textContent = text;
      }
      li.append(time, line);
      return li;
    }),
  );
}

function tickElapsed() {
  const now = Date.now();
  for (const span of els.working.querySelectorAll('[data-since]')) {
    span.textContent = formatElapsed(now - Number(span.dataset.since));
  }
}

// ---------------------------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------------------------

const notices = new Map();
function showNotice(text, key) {
  notices.set(key, text);
  els.notice.textContent = [...notices.values()].join(' ');
  els.notice.hidden = false;
}
function hideNotice(key) {
  notices.delete(key);
  els.notice.textContent = [...notices.values()].join(' ');
  els.notice.hidden = notices.size === 0;
}

// ---------------------------------------------------------------------------------------------
// 3D / 2D views
// ---------------------------------------------------------------------------------------------

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
const webgl2 = hasWebGL2();
let view = null;
let mode = null;
let modeToken = 0;

function hasWebGL2() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function isLowPower() {
  const memory = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency;
  return (Number.isFinite(memory) && memory < 2) || (Number.isFinite(cores) && cores <= 2);
}

function readModePreference() {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === '3d' || value === '2d' ? value : null;
  } catch {
    return null;
  }
}

function writeModePreference(value) {
  try {
    localStorage.setItem(MODE_KEY, value);
  } catch {
    /* Private windows can refuse storage; the toggle still works for this visit. */
  }
}

function defaultMode() {
  if (!webgl2) return '2d';
  const preferred = readModePreference();
  if (preferred) return preferred;
  return reducedMotion.matches || isLowPower() ? '2d' : '3d';
}

async function setMode(next, { fromUser = false } = {}) {
  if (next === '3d' && !webgl2) next = '2d';
  if (fromUser) writeModePreference(next);
  const token = ++modeToken;
  mode = next;
  view?.dispose();
  view = null;

  els.btnMode.textContent = next === '3d' ? '2D board' : '3D office';
  els.btnMode.setAttribute('aria-label', next === '3d' ? 'Switch to the 2D board' : 'Switch to the 3D office');
  els.btnMode.setAttribute('aria-pressed', String(next === '2d'));
  els.camControls.hidden = next !== '3d';
  els.view2d.hidden = next !== '2d';
  els.view3d.hidden = next !== '3d';
  els.poster.hidden = next !== '3d';
  document.body.dataset.mode = next;

  if (next === '2d') {
    view = createBoard(els.view2d, { rooms: store.rooms, reducedMotion: reducedMotion.matches });
    view.sync(selectedAgents(), { reset: true });
    return;
  }

  try {
    const { createOffice } = await import('./scene3d.js');
    if (token !== modeToken) return;
    view = createOffice(els.view3d, {
      rooms: store.rooms,
      reducedMotion: reducedMotion.matches,
      dark: darkScheme.matches,
      onFail: (reason) => fallBackTo2d(reason),
    });
    view.sync(selectedAgents(), { reset: true });
  } catch (error) {
    if (token !== modeToken) return;
    console.warn('3D office unavailable:', error);
    fallBackTo2d('The 3D office could not start, so the 2D board is shown.');
    return;
  } finally {
    if (token === modeToken) els.poster.hidden = true;
  }
}

function fallBackTo2d(reason) {
  showNotice(reason || 'The 3D office stopped, so the 2D board is shown.', 'fallback');
  setTimeout(() => hideNotice('fallback'), 8000);
  setMode('2d');
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

function wire() {
  els.select.addEventListener('change', () => selectSession(els.select.value, true));

  els.btnMode.addEventListener('click', () => setMode(mode === '3d' ? '2d' : '3d', { fromUser: true }));
  els.btnRotLeft.addEventListener('click', () => view?.rotate?.(-1));
  els.btnRotRight.addEventListener('click', () => view?.rotate?.(1));
  els.btnZoomIn.addEventListener('click', () => view?.zoom?.(-1));
  els.btnZoomOut.addEventListener('click', () => view?.zoom?.(1));
  els.btnReset.addEventListener('click', () => view?.resetView?.());

  els.panelToggle.addEventListener('click', () => {
    const expanded = els.panelToggle.getAttribute('aria-expanded') === 'true';
    els.panelToggle.setAttribute('aria-expanded', String(!expanded));
    els.panelToggle.textContent = expanded ? 'Show details' : 'Hide details';
    els.panelBody.hidden = expanded;
  });

  darkScheme.addEventListener('change', () => view?.setDark?.(darkScheme.matches));
  reducedMotion.addEventListener('change', () => view?.setReducedMotion?.(reducedMotion.matches));

  if (!webgl2) {
    els.btnMode.disabled = true;
    els.btnMode.title = 'The 3D office needs WebGL 2, which this browser does not provide.';
    showNotice('3D needs WebGL 2, which is not available here. Showing the 2D board.', 'webgl');
    setTimeout(() => hideNotice('webgl'), 8000);
  }

  setInterval(tickElapsed, 1000);
}

wire();
setMode(defaultMode());
loadState();
connect();

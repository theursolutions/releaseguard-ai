// devcrew QA page: loads apps, cases and runs, follows the live QA stream and switches between the
// three views (set up → watch live → read the report) with short, motion-safe transitions.
import { api, connectStream, enc } from './qa-api.js';
import { createSetup } from './qa-setup.js';
import { createLive } from './qa-live.js';
import { createReport } from './qa-report.js';
import { createPrd } from './qa-prd.js';
import { $, animate, motionOK, readPref, toast, writePref } from './qa-ui.js';

const ACTIVE_STATUSES = new Set(['running', 'queued', 'starting']);

const state = {
  loaded: false,
  apps: [],
  appId: null,
  cases: [],
  casesFor: null,
  runs: [],
  activeRun: null, // { id, status, phase, message } of the run in progress, from the stream
};

const views = { setup: $('view-setup'), live: $('view-live'), report: $('view-report') };
let currentView = null;
let switching = Promise.resolve();
let openedWithHash = Boolean(location.hash && location.hash !== '#/' && location.hash !== '#');

// ---------------------------------------------------------------------------------------------
// Context shared with the view modules
// ---------------------------------------------------------------------------------------------

const ctx = {
  state,
  api,
  go: (path) => {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  },
  currentApp: () => state.apps.find((app) => app.id === state.appId) || null,
  appById: (id) => state.apps.find((app) => app.id === id) || null,
  appIdFromRun,
  selectApp,
  refreshApps,
  refreshCases,
  refreshRuns,
  startRun,
  startLoad,
  isActive: (status) => ACTIVE_STATUSES.has(String(status || '')),
};

const setup = createSetup(ctx);
const live = createLive(ctx);
const report = createReport(ctx);
const prd = createPrd(ctx);

/** Run ids look like `<appId>-<yyyymmdd-hhmmss>-<4 random>`. */
function appIdFromRun(runId) {
  const match = /^(.+)-\d{8}-\d{6}-[a-z0-9]{4}$/i.exec(String(runId || ''));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

async function refreshApps() {
  try {
    const apps = await api('GET', '/api/qa/apps');
    state.apps = Array.isArray(apps) ? apps : [];
  } catch (error) {
    toast(error.message, 'error');
  }
  state.loaded = true;
  if (!state.apps.some((app) => app.id === state.appId)) {
    const remembered = readPref('app');
    const fallback = state.apps.find((app) => app.id === remembered) || state.apps[0] || null;
    state.appId = fallback ? fallback.id : null;
  }
  setup.renderApp();
  return state.apps;
}

async function refreshCases() {
  const appId = state.appId;
  if (!appId) {
    state.cases = [];
    state.casesFor = null;
    setup.renderCases();
    prd.check();
    return;
  }
  try {
    const cases = await api('GET', `/api/qa/apps/${enc(appId)}/cases`);
    if (appId !== state.appId) return;
    state.cases = Array.isArray(cases) ? cases : [];
    state.casesFor = appId;
  } catch (error) {
    toast(error.message, 'error');
  }
  setup.renderCases();
  // Drafts can arrive from /devcrew:qa-from-prd at any time; the cases refresh is a natural moment to look.
  prd.check();
}

async function refreshRuns() {
  const appId = state.appId;
  if (!appId) {
    state.runs = [];
    setup.renderRuns();
    return;
  }
  try {
    const runs = await api('GET', `/api/qa/runs?app=${enc(appId)}`);
    if (appId !== state.appId) return;
    state.runs = Array.isArray(runs) ? runs : [];
  } catch {
    state.runs = [];
  }
  setup.renderRuns();
}

async function selectApp(id) {
  if (!state.apps.some((app) => app.id === id)) return;
  state.appId = id;
  writePref('app', id);
  state.cases = [];
  state.casesFor = null;
  state.runs = [];
  setup.renderApp();
  await Promise.all([refreshCases(), refreshRuns()]);
}

/** Starts a run, hands the live view what it knows up front, and switches to it. */
async function startRun(options, expectation) {
  const app = ctx.currentApp();
  if (!app) return;
  const result = await api('POST', `/api/qa/apps/${enc(app.id)}/runs`, options);
  const runId = result?.runId;
  if (!runId) throw new Error('The server did not return a run id.');
  const environment = (app.environments || []).find((env) => env.id === options.environment) || null;
  state.activeRun = { id: runId, status: 'running', phase: 'setup', message: '' };
  live.begin(runId, { app, environment, ...expectation });
  updateRunIndicators();
  ctx.go(`/live/${runId}`);
}

/** Starts a load or stress test and switches to its live view. */
async function startLoad(options) {
  const app = ctx.currentApp();
  if (!app) return;
  const result = await api('POST', `/api/qa/apps/${enc(app.id)}/load`, options);
  const runId = result?.runId;
  if (!runId) throw new Error('The server did not return a run id.');
  const environment = (app.environments || []).find((env) => env.id === options.environment) || null;
  state.activeRun = { id: runId, kind: options.mode, status: 'running', phase: 'setup', message: '' };
  live.begin(runId, { app, environment, kind: options.mode });
  updateRunIndicators();
  ctx.go(`/live/${runId}`);
}

// ---------------------------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------------------------

function onStreamEvent(event) {
  // The live view goes first: at the end of a run it asks for the final summary before the lists refresh.
  live.handle(event);
  if (event.type === 'run') onRunEvent(event.run || event);
  if (event.type === 'prep') setup.onPrep(event);
}

function onRunEvent(run) {
  if (!run || typeof run.id !== 'string') return;
  if (ctx.isActive(run.status)) {
    const isNew = state.activeRun?.id !== run.id;
    state.activeRun = { ...state.activeRun, ...run };
    updateRunIndicators();
    // Opening the page while a run is going: take QA straight to the live view.
    if (isNew && !openedWithHash && currentView === 'setup') ctx.go(`/live/${run.id}`);
    openedWithHash = true;
    return;
  }
  if (state.activeRun?.id === run.id) {
    state.activeRun = null;
    updateRunIndicators();
    refreshApps();
    refreshCases();
    refreshRuns();
  }
}

function updateRunIndicators() {
  const active = state.activeRun;
  const pill = $('run-pill');
  pill.hidden = !active || currentView === 'live';
  if (active) pill.href = `#/live/${active.id}`;
  setup.setActive(active);
}

function setConnection(value) {
  $('conn').dataset.state = value;
  $('conn-text').textContent = value === 'live' ? 'Live' : value === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
}

// ---------------------------------------------------------------------------------------------
// Views and routing: #/ (set up), #/live/<runId>, #/report/<runId>
// ---------------------------------------------------------------------------------------------

function parseHash() {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/');
  const runId = id ? decodeURIComponent(id) : '';
  if (view === 'live') return { view: 'live', runId: runId || state.activeRun?.id || '' };
  if (view === 'report' && runId) return { view: 'report', runId };
  return { view: 'setup', runId: '' };
}

function route() {
  const target = parseHash();
  if (target.view === 'live' && !target.runId) {
    ctx.go('/');
    return;
  }
  if (target.view === 'live') live.show(target.runId);
  if (target.view === 'report') report.show(target.runId);
  if (target.view === 'setup') setup.show();
  showView(target.view);
}

function showView(name) {
  if (name === currentView) return;
  const previous = currentView;
  currentView = name;
  updateRunIndicators();
  live.setVisible(name === 'live');
  document.body.dataset.view = name;

  switching = switching.then(async () => {
    const outgoing = previous ? views[previous] : null;
    const incoming = views[name];
    if (outgoing && !outgoing.hidden && motionOK()) {
      await animate(outgoing, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 140 });
    }
    for (const [key, el] of Object.entries(views)) el.hidden = key !== currentView;
    if (incoming !== views[currentView]) return;
    if (previous) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      const heading = incoming.querySelector('h2[tabindex]');
      heading?.focus({ preventScroll: true });
    }
    animate(incoming, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  });
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

window.addEventListener('hashchange', route);
setup.renderApp();
route();

refreshApps().then(() => Promise.all([refreshCases(), refreshRuns()]));
connectStream({ onEvent: onStreamEvent, onState: setConnection });

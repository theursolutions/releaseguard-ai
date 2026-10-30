// The QA HTTP API, mounted by office/server.js under /api/qa and /qa/events. The office server's Host
// allowlist and security headers apply first. Writes need the page token, which only same-origin pages can
// read; runner, fixture and MCP posts to /qa/events need the office token, like the hooks.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../office/lib/config');
const store = require('./lib/store');
const { runDir } = require('./lib/paths');
const { isInstalled, ensureRuntime, runtimeEnv } = require('./lib/runtime');
const { loginInChild } = require('./lib/login');
const { killTree } = require('./lib/spawn');
const { selectCases, totalsFor } = require('./runner');
const { runEvent } = require('./lib/events');
const { checkPlan, suggestedPaths } = require('./lib/load-plan');
const { prepReasonOf } = require('./lib/prep-reason');
const { LEARN_MODELS } = require('./prepare');
const prd = require('./lib/prd-cases');
const { generateCases } = require('./prd-import');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 768 * 1024;
const MAX_FRAME_CHARS = 700 * 1024;
const RUN_STATUSES = ['running', 'passed', 'failed', 'stopped', 'error'];
// Test cycles go setup → test (learned cases) → prepare (learn new ones) → retest (the newly learned ones) →
// analyse → report; load and stress tests go setup → load → report.
const PHASES = ['setup', 'prepare', 'test', 'retest', 'analyse', 'load', 'report'];
const ANALYSIS_STATUSES = ['investigating', 'done', 'failed', 'unavailable'];
const RUN_KINDS = ['cycle', 'load', 'stress'];
const KIND_NAMES = { cycle: 'test cycle', load: 'load test', stress: 'stress test' };
const MAX_LOAD_POINTS = 400;
// A stopped load test writes its own report; after this long it is stopped the hard way.
const LOAD_STOP_GRACE_MS = 5000;
// Playwright's test statuses, plus running (started) and notPrepared (the case could not be learned).
const CASE_STATUSES = ['running', 'passed', 'failed', 'timedOut', 'interrupted', 'skipped', 'notPrepared'];
const TILE = /^[\w-]{1,60}$/;
const STREAM_ID = /^[\w-]{1,80}$/;
const RUN_FILE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
// Only the report and the screenshots, videos and traces are served; settings and raw results are not.
const SERVED_FOLDERS = ['report', 'artifacts'];
// The Playwright HTML report needs inline scripts. Sandboxed, it runs in an opaque origin and cannot reach the office.
const REPORT_CSP = "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; frame-ancestors 'none'";

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const invalid = (message) => new store.QaError(422, message);
const bounded = (value, max) => {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : Math.min(max, Math.max(0, Math.round(number * 10) / 10));
};

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Keeps only the known fields of a runner/fixture/MCP event and clips every string. Null when it is not a QA event. */
function sanitizeQaEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const id = (value) => (STREAM_ID.test(String(value)) ? String(value) : null);
  const caseId = (value) => (store.ITEM_ID.test(String(value)) || value === 'smoke' ? value : null);
  switch (event.type) {
    case 'run': {
      const run = event.run || {};
      if (!store.isRunId(run.id) || !RUN_STATUSES.includes(run.status)) return null;
      const numbers = (value, keys) => Object.fromEntries(keys.map((key) => [key, Math.max(0, Number(value?.[key]) || 0)]));
      const environment = run.environment && typeof run.environment === 'object' ? { id: clip(run.environment.id, 40), name: clip(run.environment.name, 60), kind: clip(run.environment.kind, 20) } : null;
      return {
        type: 'run',
        run: {
          id: run.id,
          app: store.APP_ID.test(String(run.app)) ? run.app : null,
          environment,
          kind: RUN_KINDS.includes(run.kind) ? run.kind : 'cycle',
          status: run.status,
          phase: PHASES.includes(run.phase) ? run.phase : 'setup',
          message: clip(run.message, 200),
          startedAt: clip(run.startedAt, 40) || null,
          counts: numbers(run.counts, ['passed', 'failed', 'skipped', 'notPrepared']),
          totals: numbers(run.totals, ['toPrepare', 'toRun']),
        },
      };
    }
    case 'prep':
      if (!store.ITEM_ID.test(String(event.caseId)) || !['preparing', 'ready', 'failed'].includes(event.status)) return null;
      return { type: 'prep', runId: id(event.runId), appId: store.APP_ID.test(String(event.appId)) ? event.appId : null, caseId: event.caseId, tile: TILE.test(String(event.tile)) ? event.tile : null, status: event.status, message: clip(event.message, 160) };
    case 'analysis':
      // Progress of finding a failed case's root cause (analyse.js). The result itself is in the run summary.
      if (!id(event.runId) || !store.ITEM_ID.test(String(event.caseId)) || !ANALYSIS_STATUSES.includes(event.status)) return null;
      return { type: 'analysis', runId: event.runId, caseId: event.caseId, status: event.status, message: clip(event.message, 160) };
    case 'case':
      if (!id(event.runId) || !caseId(event.caseId) || !CASE_STATUSES.includes(event.status)) return null;
      return { type: 'case', runId: event.runId, caseId: event.caseId, title: clip(event.title, 120), status: event.status };
    case 'step':
      if (!id(event.runId) || !TILE.test(String(event.tile))) return null;
      return { type: 'step', runId: event.runId, tile: event.tile, caseId: caseId(event.caseId), caseTitle: clip(event.caseTitle, 120), step: clip(event.step, 160) };
    case 'frame':
      if (!id(event.runId) || !TILE.test(String(event.tile)) || typeof event.data !== 'string' || event.data.length > MAX_FRAME_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.data)) return null;
      return { type: 'frame', runId: event.runId, tile: event.tile, caseId: caseId(event.caseId), label: clip(event.label, 40), caseTitle: clip(event.caseTitle, 120), data: event.data };
    case 'tile.end':
      if (!id(event.runId) || !TILE.test(String(event.tile))) return null;
      return { type: 'tile.end', runId: event.runId, tile: event.tile, caseId: caseId(event.caseId), status: CASE_STATUSES.includes(event.status) && event.status !== 'running' ? event.status : 'failed' };
    case 'load':
      // One point per second of a load or stress test. requests and errors are totals so far.
      if (!id(event.runId) || bounded(event.t, 100000) === null) return null;
      return {
        type: 'load',
        runId: event.runId,
        t: Math.round(bounded(event.t, 100000)),
        users: Math.round(bounded(event.users, 1000) ?? 0),
        rps: bounded(event.rps, 1e7) ?? 0,
        p50: bounded(event.p50, 600000),
        p95: bounded(event.p95, 600000),
        errorRate: bounded(event.errorRate, 100) ?? 0,
        requests: Math.round(bounded(event.requests, 1e12) ?? 0),
        errors: Math.round(bounded(event.errors, 1e12) ?? 0),
      };
    default:
      return null;
  }
}

/** Starts the runner as its own process. Tests replace this to avoid real runs. */
function spawnRunner(runId, env) {
  return spawn(process.execPath, [path.join(__dirname, 'runner.js'), runId], { env, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
}

/** Starts a load or stress test as its own process, with an IPC channel for a clean stop. */
function spawnLoad(runId, env) {
  return spawn(process.execPath, [path.join(__dirname, 'load-runner.js'), runId], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, detached: process.platform !== 'win32' });
}

function createQaRoutes({ port, token, send, securityHeaders, officeEvent = () => {}, onActivity = () => {}, startRunner = spawnRunner, startLoad = spawnLoad, generatePrdCases = generateCases }) {
  const pageToken = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  let active = null;
  // PRD imports being read by Claude Code, by app id: { child } so a discard can stop it.
  const prdJobs = new Map();
  // What a page that connects mid-run needs to draw the current state. Frames are not kept: the next one
  // arrives within half a second.
  const live = { run: null, preps: new Map(), cases: new Map(), steps: new Map(), ends: new Map(), analyses: new Map(), loads: [] };

  const broadcast = (event) => {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(message);
  };

  const remember = (event) => {
    if (event.type === 'run') {
      if (live.run?.run.id !== event.run.id) {
        ['preps', 'cases', 'steps', 'ends', 'analyses'].forEach((key) => live[key].clear());
        live.loads = [];
      }
      live.run = event;
    } else if (event.type === 'load') {
      if (live.run?.run.id === event.runId && live.loads.length < MAX_LOAD_POINTS) live.loads.push(event);
    } else if (event.type === 'prep') live.preps.set(event.caseId, event);
    else if (event.type === 'case') live.cases.set(event.caseId, event);
    else if (event.type === 'analysis') live.analyses.set(event.caseId, event);
    else if (event.type === 'step') live.steps.set(event.tile, event);
    else if (event.type === 'frame') live.ends.delete(event.tile);
    else if (event.type === 'tile.end') live.ends.set(event.tile, event);
  };

  const publish = (event) => {
    remember(event);
    broadcast(event);
  };

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        tooLarge = tooLarge || size > limit;
        if (!tooLarge) chunks.push(chunk);
      });
      req.on('error', reject);
      req.on('end', () => {
        if (tooLarge) return reject(new store.QaError(413, 'request too large'));
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) return resolve({});
        try {
          const body = JSON.parse(raw);
          resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
        } catch {
          reject(new store.QaError(400, 'The request body must be JSON.'));
        }
      });
    });
  }

  // ---------- runs ----------

  // Only one test runs at a time: a test cycle, a load test or a stress test.
  const busy = () => new store.QaError(409, `A ${KIND_NAMES[active.kind] || 'test'} is already running. Stop it or wait for it to finish.`);

  function finishActive(status, message) {
    if (!active) return;
    const { runId, appId } = active;
    active = null;
    let summary;
    try {
      summary = { ...store.readSummary(runId), status, finishedAt: new Date().toISOString(), ...(status === 'error' ? { error: message } : {}) };
      store.writeSummary(summary);
    } catch {
      return;
    }
    // A case that was being prepared when the run stopped is prepared again next time.
    try {
      for (const item of store.listCases(appId)) if (item.status === 'preparing') store.setCase(appId, item.id, { status: 'pending' });
    } catch {
      // The app was deleted meanwhile; nothing to reset.
    }
    publish(sanitizeQaEvent(runEvent(summary, message)));
    officeEvent({ kind: 'session.end', session: runId, project: 'QA', agentId: 'main', agentType: 'router', ts: Date.now() });
  }

  /** Starts reading pasted PRD text into draft cases. The page polls the draft until it is ready or failed. */
  function startPrdImport(appId, body = {}) {
    store.getApp(appId);
    if (prdJobs.has(appId)) throw new store.QaError(409, 'A PRD is already being read for this app. Wait for it, or discard it.');
    const source = store.cleanPrdSource({ title: body.title, kind: body.kind === 'file' ? 'file' : 'text' });
    const text = String(body.text ?? '').trim();
    if (text.length < 40) throw invalid('Paste the PRD text, or choose a .txt or .md file.');
    if (text.length > prd.MAX_PRD_CHARS) throw invalid('The PRD is too long to read at once. Paste one feature or section at a time.');
    const job = { child: null, discarded: false };
    prdJobs.set(appId, job);
    const draft = prd.writeDraft(appId, { status: 'generating', source, cases: [], removed: [], error: null, createdAt: new Date().toISOString() });
    generatePrdCases({ title: source.title, text, onChild: (child) => (job.child = child) })
      .then((list) => {
        if (job.discarded) return;
        const { cases, removed } = prd.cleanDrafts(appId, list, source);
        prd.writeDraft(appId, { ...draft, status: 'ready', cases, removed });
      })
      .catch((error) => {
        if (job.discarded) return;
        try {
          prd.writeDraft(appId, { ...draft, status: 'failed', error: String(error.message || 'Reading the PRD failed.').slice(0, 300) });
        } catch {
          // The app was deleted meanwhile.
        }
      })
      .finally(() => prdJobs.delete(appId));
    return draft;
  }

  function prdDraft(appId) {
    const draft = prd.readDraft(appId);
    // A draft still marked as being read, with nothing reading it, was cut off by an office restart.
    if (draft?.status === 'generating' && !prdJobs.has(appId)) return prd.writeDraft(appId, { ...draft, status: 'failed', error: 'Reading the PRD was cut off because the office restarted. Try again.' });
    return draft;
  }

  function discardPrdDraft(appId) {
    store.getApp(appId);
    const job = prdJobs.get(appId);
    if (job) {
      job.discarded = true;
      killTree(job.child);
    }
    prd.clearDraft(appId);
    return { ok: true };
  }

  function startRun(appId, body) {
    const app = store.getApp(appId);
    const environment = store.getEnvironment(app, body.environment);
    if (active) throw busy();
    if (environment.kind === 'production' && !environment.allowProduction) throw invalid(`Test cycles on production are turned off for ${environment.name}. Edit the environment and allow production first.`);
    const tags = store.cleanTags(body.tags);
    const parallel = body.parallel === undefined ? 3 : Number(body.parallel);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 6) throw invalid('Parallel browsers must be a whole number from 1 to 6.');
    const learnParallel = body.learnParallel === undefined ? 4 : Number(body.learnParallel);
    if (!Number.isInteger(learnParallel) || learnParallel < 1 || learnParallel > 6) throw invalid('Cases learned at the same time must be a whole number from 1 to 6.');
    const learnModel = body.learnModel === undefined ? 'fast' : body.learnModel;
    if (!Object.hasOwn(LEARN_MODELS, learnModel)) throw invalid('Learning speed must be "fast" or "default".');
    const selected = selectCases(store.listCases(appId), environment, tags);
    if (selected.length === 0) {
      throw invalid(environment.kind === 'production' ? 'There are no cases tagged "readonly" to run on production.' : 'There are no test cases to run. Add some, or change the tag filter.');
    }
    if (store.accountsFor(appId, environment.id).length === 0) throw invalid(`Add a test account for ${environment.name} first.`);

    const runId = store.newRunId(appId);
    const options = { app: appId, environment: environment.id, tags, parallel, learnParallel, learnModel, smoke: body.smoke !== false, performance: body.performance !== false };
    store.writeJson(path.join(runDir(runId), 'run.json'), options);
    const summary = {
      id: runId,
      app: appId,
      environment: { id: environment.id, name: environment.name, kind: environment.kind },
      status: 'running',
      phase: 'setup',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      counts: { passed: 0, failed: 0, skipped: 0, notPrepared: 0 },
      cases: [],
      comparison: null,
      smoke: null,
      performance: [],
      htmlReport: `/api/qa/runs/${runId}/files/report/index.html`,
      options: { tags, parallel, learnParallel, learnModel, smoke: options.smoke, performance: options.performance },
      totals: totalsFor(appId, selected, options.smoke ? 1 : 0),
    };
    store.writeSummary(summary);

    launch(startRunner, summary, 'cycle');
    return { runId };
  }

  /** Starts the run's process and follows it until it ends. */
  function launch(starter, summary, kind) {
    const { id: runId, app: appId } = summary;
    const name = KIND_NAMES[kind];
    const child = starter(runId, { ...process.env, DEVCREW_HOME: config.dataDir(), DEVCREW_OFFICE_PORT: String(port), DEVCREW_QA_OFFICE_TOKEN: token });
    active = { runId, appId, child, kind };
    child.on('error', () => active?.runId === runId && finishActive('error', `The ${name} could not start.`));
    child.on('exit', () => {
      if (active?.runId !== runId) return;
      let status = 'running';
      try {
        status = store.readSummary(runId).status;
      } catch {
        // Treated as unexpected below.
      }
      if (status === 'running') finishActive('error', `The ${name} stopped unexpectedly.`);
      else active = null;
    });
    publish(sanitizeQaEvent(runEvent(summary, 'Starting')));
  }

  /** A load or stress test. The plan is checked here and again by the engine (limits, origin, never production). */
  function startLoadTest(appId, body) {
    const app = store.getApp(appId);
    const environment = store.getEnvironment(app, body.environment);
    if (active) throw busy();
    const plan = checkPlan(body, environment);
    let account = null;
    if (plan.account) {
      account = store.accountsFor(appId, environment.id).find((item) => item.id === plan.account);
      if (!account) throw invalid('Choose one of the test accounts for this environment, or test without logging in.');
    }

    const runId = store.newRunId(appId);
    store.writeJson(path.join(runDir(runId), 'run.json'), { app: appId, environment: environment.id, kind: plan.mode, plan });
    const { paths, users, durationSec, rampUpSec, thinkMs, stress } = plan;
    const summary = {
      id: runId,
      app: appId,
      environment: { id: environment.id, name: environment.name, kind: environment.kind },
      kind: plan.mode,
      status: 'running',
      phase: 'setup',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      counts: { passed: 0, failed: 0, skipped: 0, notPrepared: 0 },
      cases: [],
      comparison: null,
      smoke: null,
      performance: [],
      htmlReport: null,
      totals: { toPrepare: 0, toRun: 0 },
      load: { mode: plan.mode, plan: { paths, users, durationSec, rampUpSec, thinkMs, ...(stress ? { stress } : {}), account: account ? account.label : null } },
    };
    store.writeSummary(summary);
    launch(startLoad, summary, plan.mode);
    return { runId };
  }

  async function stopRun(runId) {
    const summary = store.readSummary(runId);
    if (!active || active.runId !== runId) throw new store.QaError(409, `This ${KIND_NAMES[summary.kind] || 'test cycle'} is not running (it is ${summary.status}).`);
    const { child, kind } = active;
    if (kind !== 'cycle' && child.connected && !active.stopping) {
      // A load test stops itself at once and writes the report of what ran; it gets a moment to do so.
      active.stopping = true;
      const exited = new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
      try {
        child.send({ type: 'stop' });
      } catch {
        // The channel just closed; the hard stop below takes over.
      }
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, LOAD_STOP_GRACE_MS))]);
    }
    if (active?.runId !== runId) return { ok: true };
    finishActive('stopped', 'Stopped');
    killTree(child);
    return { ok: true };
  }

  // ---------- accounts ----------

  async function testLogin(appId, body) {
    const app = store.getApp(appId);
    const environment = store.getEnvironment(app, body.environment);
    if (environment.kind === 'production' && !environment.allowProduction) throw invalid(`Logging in to production is turned off for ${environment.name}.`);
    const account = store.accountsFor(appId, environment.id).find((item) => item.id === body.account);
    if (!account) throw invalid('Choose one of the accounts for this environment.');
    if (!isInstalled()) {
      ensureRuntime().catch(() => {});
      return { ok: false, message: 'The test browser is being installed (first time only, a few minutes). Try again when it is ready.' };
    }
    const result = await loginInChild(account, environment, { env: runtimeEnv({ DEVCREW_HOME: config.dataDir() }) });
    return { ok: Boolean(result.ok), message: result.ok ? `Logged in as ${account.label}.` : result.message };
  }

  // ---------- files ----------

  function serveRunFile(res, runId, encodedPath) {
    const notFound = () => send(res, 404, { error: 'not found' });
    if (!store.isRunId(runId)) return notFound();
    let parts;
    try {
      parts = decodeURIComponent(encodedPath).split(/[\\/]/);
    } catch {
      return notFound();
    }
    if (!SERVED_FOLDERS.includes(parts[0]) || parts.some((part) => !part || part.startsWith('.'))) return notFound();
    const root = path.resolve(runDir(runId));
    const file = path.resolve(root, ...parts);
    const type = RUN_FILE_TYPES[path.extname(file).toLowerCase()];
    if (!file.startsWith(root + path.sep) || !type) return notFound();

    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) return notFound();
      const headers = { ...securityHeaders, 'Content-Type': type, 'Content-Length': stat.size };
      if (parts[0] === 'report') headers['Content-Security-Policy'] = REPORT_CSP;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    });
  }

  // ---------- events and stream ----------

  async function receiveEvent(req, res) {
    if (!sameSecret(req.headers['x-devcrew-token'], token)) return send(res, 401, { error: 'token required' });
    const event = sanitizeQaEvent(await readBody(req, MAX_EVENT_BYTES));
    if (!event) return send(res, 422, { error: 'not a QA event' });
    onActivity();
    publish(event);
    return send(res, 202, { ok: true });
  }

  function stream(req, res) {
    res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const replay = [live.run, ...live.preps.values(), ...live.cases.values(), ...live.steps.values(), ...live.ends.values(), ...live.analyses.values(), ...live.loads].filter(Boolean);
    for (const event of replay) res.write(`data: ${JSON.stringify(event)}\n\n`);
    clients.add(res);
    onActivity();
    req.on('close', () => clients.delete(res));
  }

  // ---------- routing ----------

  const param = (value) => decodeURIComponent(value);
  const routes = [
    ['GET', /^\/api\/qa\/session$/, () => ({ pageToken })],
    ['GET', /^\/api\/qa\/apps$/, () => store.appOverview()],
    ['POST', /^\/api\/qa\/apps$/, (match, body) => store.saveApp(body)],
    ['DELETE', /^\/api\/qa\/apps\/([^/]+)$/, ([, app]) => {
      if (active?.appId === param(app)) throw new store.QaError(409, `Stop the running ${KIND_NAMES[active.kind] || 'test'} of this app first.`);
      store.deleteApp(param(app));
      return { ok: true };
    }],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/accounts$/, ([, app], body) => store.addAccount(param(app), body)],
    ['DELETE', /^\/api\/qa\/apps\/([^/]+)\/accounts\/([^/]+)$/, ([, app, id]) => {
      store.deleteAccount(param(app), param(id));
      return { ok: true };
    }],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/test-login$/, ([, app], body) => testLogin(param(app), body)],
    ['GET', /^\/api\/qa\/apps\/([^/]+)\/cases$/, ([, app]) => {
      const results = store.lastResults(param(app));
      return store.listCases(param(app)).map((item) => ({
        ...item,
        // Cases that failed before reasons were stored get one from their message.
        prepReason: item.status === 'failed' ? item.prepReason || prepReasonOf(item.prepError) : null,
        lastResult: results[item.id] || null,
      }));
    }],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/relearn$/, ([, app], body) => store.relearnCases(param(app), body.ids)],
    // PRD → draft cases: read pasted text here, or receive ready-made drafts from /devcrew:qa-from-prd.
    ['GET', /^\/api\/qa\/apps\/([^/]+)\/prd-draft$/, ([, app]) => prdDraft(param(app))],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/prd-import$/, ([, app], body) => startPrdImport(param(app), body)],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/prd-draft$/, ([, app], body) => {
      if (prdJobs.has(param(app))) throw new store.QaError(409, 'A PRD is being read for this app on the QA page. Wait for it, or discard it there.');
      return prd.saveDrafts(param(app), body);
    }],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/prd-draft\/accept$/, ([, app], body) => prd.acceptDrafts(param(app), body)],
    ['DELETE', /^\/api\/qa\/apps\/([^/]+)\/prd-draft$/, ([, app]) => discardPrdDraft(param(app))],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/cases$/, ([, app], body) => store.addCases(param(app), body)],
    ['PUT', /^\/api\/qa\/apps\/([^/]+)\/cases\/([^/]+)$/, ([, app, id], body) => store.updateCase(param(app), param(id), body)],
    ['DELETE', /^\/api\/qa\/apps\/([^/]+)\/cases\/([^/]+)$/, ([, app, id]) => {
      store.deleteCase(param(app), param(id));
      return { ok: true };
    }],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/cases\/([^/]+)\/relearn$/, ([, app, id]) => store.relearnCase(param(app), param(id))],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/runs$/, ([, app], body) => startRun(param(app), body)],
    ['POST', /^\/api\/qa\/apps\/([^/]+)\/load$/, ([, app], body) => startLoadTest(param(app), body)],
    ['GET', /^\/api\/qa\/apps\/([^/]+)\/load-pages$/, ([, app], body, url) => suggestedPaths(param(app), url.searchParams.get('environment'))],
    ['POST', /^\/api\/qa\/runs\/([^/]+)\/stop$/, ([, id]) => stopRun(param(id))],
    ['GET', /^\/api\/qa\/runs$/, (match, body, url) => {
      const app = url.searchParams.get('app');
      if (app) store.getApp(app);
      return store.listRuns(app || undefined);
    }],
    ['GET', /^\/api\/qa\/runs\/([^/]+)$/, ([, id]) => store.readSummary(param(id))],
  ];

  async function handle(req, res, url) {
    const { pathname } = url;
    try {
      if (pathname === '/qa/events') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
        return await receiveEvent(req, res);
      }
      if (req.method === 'GET' && pathname === '/api/qa/stream') return stream(req, res);
      const file = pathname.match(/^\/api\/qa\/runs\/([^/]+)\/files\/(.+)$/);
      if (req.method === 'GET' && file) return serveRunFile(res, file[1], file[2]);

      const route = routes.find(([method, pattern]) => method === req.method && pattern.test(pathname));
      if (!route) {
        const known = routes.some(([, pattern]) => pattern.test(pathname));
        return send(res, known ? 405 : 404, { error: known ? 'method not allowed' : 'not found' });
      }

      let body = {};
      if (req.method !== 'GET') {
        // A custom header that only same-origin pages can send: other sites cannot write, even blind.
        if (!sameSecret(req.headers['x-devcrew-page'], pageToken)) return send(res, 403, { error: 'page token required' });
        body = await readBody(req, MAX_BODY_BYTES);
      }
      onActivity();
      const result = await route[2](pathname.match(route[1]), body, url);
      return send(res, 200, result);
    } catch (error) {
      if (error instanceof store.QaError) return send(res, error.status, { error: error.message });
      if (error instanceof URIError) return send(res, 404, { error: 'not found' });
      return send(res, 500, { error: 'Something went wrong on the QA server.' });
    }
  }

  return {
    handle,
    clients,
    sanitizeQaEvent,
    isBusy: () => clients.size > 0 || active !== null,
    activeRun: () => active?.runId || null,
    close() {
      for (const client of clients) client.end();
      if (active) {
        const { child } = active;
        finishActive('stopped', 'The office server stopped');
        killTree(child);
      }
    },
  };
}

module.exports = { createQaRoutes, sanitizeQaEvent };

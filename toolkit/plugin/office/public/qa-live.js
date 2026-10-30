// devcrew QA, live view: phase stepper, result counters, the browser wall (live screencast tiles that
// settle into a "Finished" tray), an enlarge viewer with a shared-element transition, and a step log.
// Load and stress tests use the same header, stepper and finish banner, with live charts instead of browsers.
import { enc } from './qa-api.js';
import { createLoadLive, formatSeconds, isLoadKind, modeLabel, stressLevels } from './qa-load.js';
import {
  $,
  SPRING,
  animate,
  confirmDialog,
  countTo,
  fadeIn,
  flipFrom,
  formatClockElapsed,
  formatWhen,
  h,
  icon,
  motionOK,
  plural,
  resultTone,
  swapText,
  toMs,
  toast,
} from './qa-ui.js';

// Learned cases are tested first, so their results show before the new cases are learned.
const CYCLE_PHASES = [
  { id: 'setup', label: 'Setting up' },
  { id: 'test', label: 'Testing learned' },
  { id: 'prepare', label: 'Learning new' },
  { id: 'retest', label: 'Testing new' },
  { id: 'report', label: 'Report' },
];
const loadPhases = (kind) => [
  { id: 'setup', label: 'Setting up' },
  { id: 'load', label: modeLabel(kind) },
  { id: 'report', label: 'Report' },
];
// Finding the root cause of failures (analyse) is shown on the Report step.
const PHASE_ALIASES = { install: 'setup', setup: 'setup', prepare: 'prepare', preparing: 'prepare', test: 'test', testing: 'test', retest: 'retest', analyse: 'report', load: 'load', report: 'report', done: 'report' };
const ANALYSIS_DONE = ['done', 'failed', 'unavailable'];
const MAX_LOG_ROWS = 150;
const MAX_TRAY = 24;
const SETTLE_MS = 1300;
const TO_TRAY_MS = 3200;
const FRAME_DATA = /^[A-Za-z0-9+/]+={0,2}$/;

export function createLive(ctx) {
  const els = {
    sub: $('live-sub'),
    title: $('h-live'),
    pill: $('live-pill'),
    pillText: $('live-pill-text'),
    elapsed: $('live-elapsed'),
    stop: $('btn-stop'),
    stepper: $('stepper'),
    stepperFill: $('stepper-fill'),
    phaseMsg: $('phase-msg'),
    statPass: $('stat-pass'),
    statFail: $('stat-fail'),
    statLeft: $('stat-left'),
    statLeftLabel: $('stat-left-label'),
    barPass: $('bar-pass'),
    barFail: $('bar-fail'),
    done: $('live-done'),
    doneIcon: $('live-done-icon'),
    doneTitle: $('live-done-title'),
    doneSub: $('live-done-sub'),
    doneReport: $('live-done-report'),
    wall: $('wall'),
    wallCount: $('wall-count'),
    wallEmpty: $('wall-empty'),
    wallEmptyText: $('wall-empty-text'),
    trayWrap: $('tray-wrap'),
    tray: $('tray'),
    trayCount: $('tray-count'),
    log: $('log'),
    logEmpty: $('log-empty'),
    viewer: $('dlg-viewer'),
    viewerAccount: $('viewer-account'),
    viewerStatus: $('viewer-status'),
    viewerTitle: $('viewer-title'),
    viewerImg: $('viewer-img'),
    viewerStep: $('viewer-step'),
    liveStats: $('live-stats'),
    resultBar: $('result-bar'),
    liveGrid: $('live-grid'),
    loadSection: $('load-live'),
  };

  let run = null;
  let visible = false;
  let viewerTile = null;
  let phases = CYCLE_PHASES;
  let stepItems = buildStepper();
  const loadLive = createLoadLive();

  // -------------------------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------------------------

  function freshRun(id, meta = {}) {
    return {
      id,
      kind: meta.kind || 'cycle',
      verdict: null,
      status: 'running',
      phase: 'setup',
      message: '',
      app: meta.app || null,
      environment: meta.environment || null,
      startedAt: Date.now(),
      finishedAt: null,
      expected: Number.isFinite(meta.expectedCases) ? meta.expectedCases : null,
      toLearn: Number.isFinite(meta.toLearn) ? meta.toLearn : null,
      caseTitles: meta.caseTitles instanceof Map ? meta.caseTitles : new Map(),
      tiles: new Map(),
      cases: new Map(),
      prep: new Map(),
      prepMessages: new Map(),
      firstPass: null,
      analysing: false,
      analyses: new Map(),
      analysisMessages: new Map(),
      tileSeq: 0,
      lastLog: '',
      metaLoaded: false,
    };
  }

  function reset(id, meta) {
    for (const tile of run?.tiles.values() || []) clearTimeout(tile.timer);
    if (viewerTile) closeViewer(true);
    run = freshRun(id, meta);
    els.wall.replaceChildren();
    els.tray.replaceChildren();
    els.log.replaceChildren();
    for (const el of [els.statPass, els.statFail, els.statLeft]) {
      el.dataset.value = '0';
      el.textContent = '0';
    }
    els.done.hidden = true;
    els.stop.hidden = false;
    els.stop.disabled = false;
    loadLive.reset();
    applyKind();
    renderAll();
    loadMeta();
  }

  /** Switches the view between a test cycle (browsers and log) and a load or stress test (charts). */
  function applyKind() {
    const load = isLoadKind(run.kind);
    const wanted = load ? loadPhases(run.kind) : CYCLE_PHASES;
    if (wanted.map((phase) => phase.label).join() !== phases.map((phase) => phase.label).join()) {
      phases = wanted;
      stepItems = buildStepper();
    }
    els.stepper.dataset.steps = String(phases.length);
    els.stepper.parentElement.dataset.steps = String(phases.length);
    els.liveStats.hidden = load;
    els.resultBar.hidden = load;
    els.liveGrid.hidden = load;
    els.loadSection.hidden = !load;
  }

  /** Fills in app, environment and start time from the run's summary (and catches up if it already ended). */
  async function loadMeta() {
    const id = run.id;
    try {
      const summary = await ctx.api('GET', `/api/qa/runs/${enc(id)}`);
      if (!run || run.id !== id || !summary) return;
      run.metaLoaded = true;
      if (isLoadKind(summary.kind) && run.kind !== summary.kind) {
        run.kind = summary.kind;
        applyKind();
      }
      if (isLoadKind(run.kind)) loadLive.setPlan(summary.load);
      const app = ctx.appById(summary.app) || run.app || (summary.app ? { id: summary.app, name: summary.app } : null);
      run.app = app;
      if (summary.environment && typeof summary.environment === 'object') run.environment = summary.environment;
      const started = toMs(summary.startedAt);
      if (started) run.startedAt = started;
      if (summary.phase) {
        run.phase = PHASE_ALIASES[summary.phase] || run.phase;
        run.analysing = summary.phase === 'analyse';
      }
      if (summary.status && !ctx.isActive(summary.status)) {
        run.status = summary.status;
        run.finishedAt = toMs(summary.finishedAt) || Date.now();
        if (isLoadKind(run.kind)) {
          run.verdict = summary.load?.verdict || (summary.error ? { tone: 'fail', headline: `The ${modeLabel(run.kind).toLowerCase()} couldn’t finish`, detail: summary.error } : null);
          loadLive.finish(summary.load);
        } else applyFinalCounts(summary.counts);
        finish();
      }
      renderAll();
    } catch {
      /* The summary may not exist yet at the very start; the stream fills in the rest. */
    }
  }

  function isMine(event) {
    if (!run) return false;
    return !event.runId || event.runId === run.id;
  }

  /** Called by qa.js for every stream event. */
  function handle(event) {
    switch (event.type) {
      case 'run':
        return onRun(event.run || event);
      case 'prep':
        if (run && !run.finishedAt) onPrep(event);
        return;
      case 'analysis':
        if (isMine(event) && !run.finishedAt) onAnalysis(event);
        return;
      case 'case':
        adoptRun(event.runId);
        if (isMine(event)) onCase(event);
        return;
      case 'step':
        adoptRun(event.runId);
        if (isMine(event)) onStep(event);
        return;
      case 'frame':
        adoptRun(event.runId);
        if (isMine(event)) onFrame(event);
        return;
      case 'tile.end':
        if (isMine(event)) onTileEnd(event);
        return;
      case 'load':
        adoptRun(event.runId, 'load');
        if (isMine(event) && !run.finishedAt) onLoadPoint(event);
        return;
      default:
    }
  }

  /** Activity for a run we haven't seen start (page opened mid-run): follow it. */
  function adoptRun(runId, kind) {
    if (!runId || run?.id === runId) return;
    if (!run || run.finishedAt) reset(runId, kind ? { kind } : {});
  }

  function onLoadPoint(event) {
    if (!isLoadKind(run.kind)) {
      run.kind = 'load';
      applyKind();
    }
    if (run.phase === 'setup') run.phase = 'load';
    loadLive.point(event);
    renderStepper();
  }

  function onRun(info) {
    if (!info?.id) return;
    const active = ctx.isActive(info.status);
    if (!run || run.id !== info.id) {
      // A finished run we weren't following doesn't replace the one on screen.
      if (!active && run) return;
      reset(info.id, { kind: info.kind });
    }
    if (isLoadKind(info.kind) && run.kind !== info.kind) {
      run.kind = info.kind;
      applyKind();
    }
    const phase = PHASE_ALIASES[info.phase] || run.phase;
    const changed = phase !== run.phase;
    run.phase = phase;
    if (info.phase) run.analysing = info.phase === 'analyse';
    if (info.status) run.status = info.status;
    if (typeof info.message === 'string') run.message = info.message;
    if (changed && phase === 'retest') endPrepTiles();
    // Cases tested before this phase: the "Testing new" step counts from here.
    if (changed && (phase === 'prepare' || phase === 'retest') && run.firstPass === null) run.firstPass = streamDone();
    if (run.message && run.message !== run.lastLog) {
      run.lastLog = run.message;
      log({ tone: 'info', text: run.message, who: phaseLabel(phase) });
    }
    // While a run is going, the stream's own counting is newer than the summary's counts.
    if (info.counts && !active && !isLoadKind(run.kind)) applyFinalCounts(info.counts);
    if (!active && !run.finishedAt) {
      run.finishedAt = Date.now();
      finish();
      // The final summary has the authoritative counts.
      loadMeta();
    }
    renderAll();
  }

  function caseTitle(caseId, fallback = '') {
    return run.caseTitles.get(caseId) || ctx.state.cases.find((item) => item.id === caseId)?.title || fallback || 'a test case';
  }

  function onPrep(event) {
    const caseId = event.caseId;
    if (!caseId) return;
    const title = caseTitle(caseId);
    const previous = run.prep.get(caseId);
    run.prep.set(caseId, event.status);
    if (run.phase === 'setup') run.phase = 'prepare';
    if (event.status === 'preparing') {
      const message = event.message || 'Exploring the app';
      if (run.prepMessages.get(caseId) !== message) {
        run.prepMessages.set(caseId, message);
        log({ tone: 'prep', who: `Learning · ${title}`, text: message });
      }
    } else if (event.status === 'ready' && previous !== 'ready') {
      log({ tone: 'pass', who: 'Learned, ready to replay', text: title, result: true });
      endPrepTilesFor(title, 'learned');
    } else if (event.status === 'failed' && previous !== 'failed') {
      log({ tone: 'warn', who: `Couldn’t learn · ${title}`, text: event.message || 'It will be skipped in this run.' });
      endPrepTilesFor(title, 'failed');
    }
    renderStepper();
  }

  /** Claude Code finding why a case failed: its progress goes to the log and the Report step. */
  function onAnalysis(event) {
    const caseId = event.caseId;
    if (!caseId) return;
    const title = run.cases.get(caseId)?.title || caseTitle(caseId);
    const previous = run.analyses.get(caseId);
    run.analyses.set(caseId, event.status);
    run.analysing = true;
    if (event.status === 'investigating') {
      const message = event.message && event.message !== 'Starting' ? event.message : 'Reading what the test saw';
      if (run.analysisMessages.get(caseId) !== message) {
        run.analysisMessages.set(caseId, message);
        log({ tone: 'prep', who: `Root cause · ${title}`, text: message });
      }
    } else if (event.status !== previous) {
      if (event.status === 'done') log({ tone: 'info', who: 'Root cause found', text: title });
      else if (event.status === 'unavailable') log({ tone: 'warn', who: `No root cause · ${title}`, text: event.message || 'Claude Code isn’t available on this computer.' });
      else log({ tone: 'warn', who: `Couldn’t find the root cause · ${title}`, text: event.message || 'The report still shows what happened.' });
    }
    renderStepper();
    renderWall();
  }

  function analysisCounts() {
    let finished = 0;
    for (const status of run.analyses.values()) if (ANALYSIS_DONE.includes(status)) finished++;
    return { finished, total: Math.max(run.analyses.size, run.analysing ? counts().failed : 0) };
  }

  function onCase(event) {
    const id = event.caseId || event.title;
    if (!id) return;
    const previous = run.cases.get(id);
    const status = String(event.status || 'running');
    run.cases.set(id, { title: event.title || previous?.title || caseTitle(id), status });
    // A page that opened mid-run may see a case before the run's phase. Later phases come from run events.
    if (run.phase === 'setup') run.phase = 'test';
    const { tone, label } = resultTone(status);
    if (previous?.status !== status) {
      if (tone === 'info') log({ tone: 'info', who: 'Started', text: event.title || caseTitle(id) });
      else log({ tone, who: label, text: event.title || caseTitle(id), result: true });
    }
    renderStats();
    renderStepper();
  }

  function onStep(event) {
    if (!event.tile) return;
    const tile = ensureTile(event.tile, { caseTitle: event.caseTitle });
    const step = String(event.step || '').trim();
    if (!step || step === tile.step) return;
    tile.step = step;
    swapText(tile.stepEl, step);
    if (viewerTile === tile) swapText(els.viewerStep, step);
    log({ tone: tile.prep ? 'prep' : 'step', who: [tile.label, tile.caseTitle].filter(Boolean).join(' · '), text: step });
  }

  function onFrame(event) {
    if (!event.tile || typeof event.data !== 'string' || !FRAME_DATA.test(event.data)) return;
    const tile = ensureTile(event.tile, { label: event.label, caseTitle: event.caseTitle });
    tile.frame = `data:image/jpeg;base64,${event.data}`;
    tile.frameSeq += 1;
    if (visible) paintFrame(tile);
    if (viewerTile === tile) els.viewerImg.src = tile.frame;
  }

  function onTileEnd(event) {
    const tile = run.tiles.get(event.tile);
    if (!tile || tile.ended) return;
    endTile(tile, String(event.status || 'passed'));
  }

  // -------------------------------------------------------------------------------------------
  // Tiles
  // -------------------------------------------------------------------------------------------

  function parseLabel(label, title) {
    const text = String(label || '');
    const prep = /^preparing\b/i.test(text);
    // Claude Code's browser while it checks why a case failed (tile "why-<case>").
    const why = /^investigating:?\s*/i.test(String(title || ''));
    return {
      prep,
      why,
      label: prep ? 'Learning' : text,
      caseTitle: why ? String(title).replace(/^investigating:?\s*/i, '') : title || (prep ? text.replace(/^preparing:?\s*/i, '') : ''),
    };
  }

  function ensureTile(id, { label, caseTitle: title } = {}) {
    let tile = run.tiles.get(id);
    const parsed = parseLabel(label, title);
    if (tile) {
      if (label && parsed.label !== tile.label) {
        tile.label = parsed.label;
        tile.accountEl.textContent = parsed.label;
      }
      if (parsed.caseTitle && parsed.caseTitle !== tile.caseTitle) {
        tile.caseTitle = parsed.caseTitle;
        tile.caseEl.textContent = parsed.caseTitle;
        tile.caseEl.title = parsed.caseTitle;
      }
      updateTileLabel(tile);
      return tile;
    }

    const n = ++run.tileSeq;
    tile = { id, n, label: parsed.label || `Browser ${n}`, caseTitle: parsed.caseTitle, prep: parsed.prep, why: parsed.why, step: '', frame: null, frameSeq: 0, paintedSeq: 0, decodingSeq: 0, status: 'running', ended: false, timer: null };

    tile.accountEl = h('span', { class: 'account-chip' }, tile.label);
    tile.imgEl = h('img', { class: 'tile-img', alt: '', decoding: 'async' });
    tile.badgeEl = h('span', { class: 'tile-badge', 'aria-hidden': 'true' });
    tile.caseEl = h('span', { class: 'tile-case', title: tile.caseTitle }, tile.caseTitle || 'Starting…');
    tile.stepEl = h('span', { class: 'tile-step' });
    swapText(tile.stepEl, tile.prep ? 'Exploring the app' : tile.why ? 'Checking why it failed' : 'Opening the browser');

    tile.button = h(
      'button',
      { type: 'button', class: 'tile-btn' },
      h(
        'span',
        { class: 'tile-chrome' },
        h('span', { class: 'tile-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        tile.accountEl,
        h('span', { class: 'tile-rec' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), tile.prep ? 'Learning' : tile.why ? 'Investigating' : 'Live'),
      ),
      h('span', { class: 'tile-screen' }, h('span', { class: 'tile-wait', 'aria-hidden': 'true' }), tile.imgEl, tile.badgeEl),
      h('span', { class: 'tile-meta' }, tile.caseEl, tile.stepEl),
    );
    tile.button.addEventListener('click', () => openViewer(tile));
    tile.el = h('li', { class: 'tile', dataset: { status: 'running', kind: tile.prep || tile.why ? 'prep' : 'test', id } }, tile.button);
    updateTileLabel(tile);

    run.tiles.set(id, tile);
    els.wall.append(tile.el);
    if (motionOK()) tile.el.classList.add('tile-enter');
    renderWall();
    return tile;
  }

  function updateTileLabel(tile) {
    const state = tile.ended ? `, ${tile.resultLabel || 'finished'}` : ', live';
    tile.button.setAttribute('aria-label', `${tile.label}: ${tile.caseTitle || 'browser'}${state}. Enlarge`);
  }

  /** Decodes the next frame off-screen first, so a tile never flashes empty between frames. */
  function paintFrame(tile) {
    const next = tile.frame;
    const seq = tile.frameSeq;
    if (!next || seq <= tile.paintedSeq || seq === tile.decodingSeq) return;
    tile.decodingSeq = seq;
    const probe = new Image();
    probe.src = next;
    probe.decode().then(
      () => {
        // Decodes can finish out of order; never step back to an older frame.
        if (seq <= tile.paintedSeq) return;
        tile.paintedSeq = seq;
        tile.imgEl.src = next;
        tile.el.classList.add('has-frame');
      },
      () => {},
    );
  }

  function endTile(tile, status) {
    tile.ended = true;
    let tone;
    let label;
    if (status === 'learned') {
      tone = 'pass';
      label = 'Learned';
    } else if (tile.prep && status === 'failed') {
      tone = 'warn';
      label = 'Couldn’t learn';
    } else if (tile.why) {
      tone = 'neutral';
      label = 'Checked';
    } else {
      ({ tone, label } = resultTone(status));
      if (tone === 'info' || status === 'finished') ({ tone, label } = { tone: 'neutral', label: 'Finished' });
    }
    tile.status = tone;
    tile.resultLabel = label;
    tile.el.dataset.status = tone;
    tile.badgeEl.replaceChildren(icon(tone === 'pass' ? 'check' : tone === 'fail' ? 'close' : tone === 'warn' ? 'alert' : 'minus'), h('span', {}, label));
    updateTileLabel(tile);
    if (viewerTile === tile) renderViewerStatus();
    renderWall();

    clearTimeout(tile.timer);
    tile.timer = setTimeout(() => {
      tile.el.dataset.settled = 'true';
      tile.timer = setTimeout(() => (tile.prep || tile.why ? removeTile(tile) : moveToTray(tile)), TO_TRAY_MS - SETTLE_MS);
    }, SETTLE_MS);
  }

  function endPrepTilesFor(title, status) {
    for (const tile of run.tiles.values()) {
      if (tile.prep && !tile.ended && tile.caseTitle === title) endTile(tile, status);
    }
  }

  function endPrepTiles() {
    for (const tile of run.tiles.values()) if (tile.prep && !tile.ended) endTile(tile, 'learned');
  }

  /** Moves a finished tile to the tray; the remaining tiles glide into their new places. */
  function moveToTray(tile) {
    if (!tile.el.isConnected || viewerTile === tile) {
      if (viewerTile === tile) tile.timer = setTimeout(() => moveToTray(tile), 1500);
      return;
    }
    glide(() => {
      tile.el.classList.remove('tile-enter');
      els.tray.prepend(tile.el);
      while (els.tray.children.length > MAX_TRAY) els.tray.lastElementChild.remove();
      renderWall();
    }, tile.el);
  }

  /** Runs a DOM change and lets every tile glide from where it was to where it lands (FLIP). */
  function glide(mutate, mover = null) {
    const tiles = [...els.wall.children, ...els.tray.children];
    const before = new Map(tiles.map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    for (const [el, rect] of before) {
      if (el.isConnected) flipFrom(el, rect, { scale: el === mover });
    }
  }

  function removeTile(tile) {
    if (viewerTile === tile) {
      tile.timer = setTimeout(() => removeTile(tile), 1500);
      return;
    }
    animate(tile.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 220, fill: 'forwards' }).then(() => {
      glide(() => {
        tile.el.remove();
        run?.tiles.delete(tile.id);
        renderWall();
      });
    });
  }

  function renderWall() {
    if (!run || isLoadKind(run.kind)) return;
    const live = [...run.tiles.values()].filter((tile) => !tile.ended).length;
    const onWall = els.wall.children.length;
    const finished = els.tray.children.length;
    els.wallEmpty.hidden = onWall > 0 || (Boolean(run.finishedAt) && finished > 0);
    els.wallCount.textContent = live ? `${live} working` : run.finishedAt ? 'All finished' : '';
    els.trayWrap.hidden = finished === 0;
    els.trayCount.textContent = finished ? String(finished) : '';
    els.wallEmptyText.textContent = run.finishedAt
      ? 'All browsers have finished.'
      : run.phase === 'setup'
        ? 'Getting the test browser ready…'
        : run.phase === 'prepare'
          ? 'Claude Code is learning the new cases. Its browser shows up here.'
          : run.phase === 'report' && run.analysing
            ? 'Claude Code is finding the root cause of each failure. Its browser shows up here when it checks a page.'
            : run.phase === 'report'
              ? 'Writing the report…'
            : 'The next browser opens in a moment…';
    els.wallEmpty.dataset.waiting = String(!run.finishedAt);
  }

  // -------------------------------------------------------------------------------------------
  // Stepper, counters, header
  // -------------------------------------------------------------------------------------------

  function buildStepper() {
    const items = phases.map((phase, index) => {
      const dot = h('span', { class: 'pstep-dot', 'aria-hidden': 'true' }, h('span', { class: 'pstep-num' }, String(index + 1)), icon('check', 'pstep-check'));
      const sub = h('span', { class: 'pstep-sub' });
      const state = h('span', { class: 'sr-only' });
      const li = h('li', { class: 'pstep', dataset: { state: 'todo' } }, dot, h('span', { class: 'pstep-label' }, phase.label, state), sub);
      return { li, sub, state };
    });
    els.stepper.replaceChildren(...items.map((item) => item.li));
    return items;
  }

  function phaseLabel(phase) {
    return phases.find((item) => item.id === phase)?.label || '';
  }

  function counts() {
    if (run.finalCounts) return run.finalCounts;
    let passed = 0;
    let failed = 0;
    let other = 0;
    let running = 0;
    for (const item of run.cases.values()) {
      const { tone } = resultTone(item.status);
      if (tone === 'pass') passed++;
      else if (tone === 'fail') failed++;
      else if (tone === 'info') running++;
      else other++;
    }
    return { passed, failed, other, running, done: passed + failed + other };
  }

  /** Cases the stream saw finish. Unlike counts(), never replaced by the summary, so passes can be told apart. */
  function streamDone() {
    let done = 0;
    for (const item of run.cases.values()) if (resultTone(item.status).tone !== 'info') done++;
    return done;
  }

  function prepCounts() {
    let learned = 0;
    let failed = 0;
    for (const status of run.prep.values()) {
      if (status === 'ready') learned++;
      else if (status === 'failed') failed++;
    }
    const total = Math.max(run.toLearn || 0, run.prep.size);
    return { learned, failed, total };
  }

  function renderStepper() {
    if (!run) return;
    const current = Math.max(0, phases.findIndex((phase) => phase.id === run.phase));
    const finished = Boolean(run.finishedAt);
    const outcome = run.status;
    const c = counts();
    const p = prepCounts();

    const loadPlan = loadLive.plan();
    const lastPoint = loadLive.lastPoint();
    phases.forEach((phase, index) => {
      const item = stepItems[index];
      let state = index < current ? 'done' : index === current ? 'current' : 'todo';
      if (finished) {
        if (outcome === 'passed' || outcome === 'failed') state = 'done';
        else if (index === current) state = outcome === 'error' ? 'error' : 'stopped';
      }
      item.li.dataset.state = state;
      if (state === 'current') item.li.setAttribute('aria-current', 'step');
      else item.li.removeAttribute('aria-current');
      item.state.textContent = { done: ' (done)', current: ' (in progress)', error: ' (problem)', stopped: ' (stopped)', todo: '' }[state];

      let sub = '';
      if (phase.id === 'setup') sub = state === 'current' ? (isLoadKind(run.kind) ? 'Getting ready' : 'Getting browsers ready') : state === 'done' ? 'Ready' : '';
      if (phase.id === 'load') {
        if (state === 'current' && loadPlan?.stress && lastPoint) {
          const levels = stressLevels(loadPlan.stress);
          sub = `Step ${Math.max(0, levels.indexOf(lastPoint.users)) + 1} of ${levels.length} · ${plural(lastPoint.users, 'user')}`;
        } else if (state === 'current' && loadPlan) sub = `${formatSeconds(lastPoint?.t || 0)} of ${formatSeconds(loadPlan.durationSec)}`;
        else if (state === 'current') sub = 'Starting the users';
        else if (state === 'done') sub = lastPoint ? `${formatSeconds(lastPoint.t)} measured` : 'Done';
      }
      const seen = streamDone();
      const first = run.firstPass ?? seen;
      if (phase.id === 'test') {
        if (state === 'current') sub = `${plural(seen, 'case')} done`;
        else if (state === 'done') sub = first ? `${plural(first, 'case')} run` : 'None learned yet';
      }
      if (phase.id === 'prepare') {
        if (state === 'current') sub = p.total ? `${p.learned + p.failed} of ${p.total} learned` : 'Checking for new cases';
        else if (state === 'done') sub = p.total ? `${plural(p.learned, 'case')} learned` : 'Nothing new';
      }
      if (phase.id === 'retest') {
        const newDone = Math.max(0, seen - first);
        if (state === 'current') sub = p.learned ? `${newDone} of ${p.learned} done` : `${newDone} done`;
        else if (state === 'done') sub = newDone ? `${plural(newDone, 'case')} run` : 'Nothing new';
      }
      if (phase.id === 'report') {
        const a = analysisCounts();
        if (state === 'current' && run.analysing && a.total) sub = a.finished ? `${a.finished} of ${a.total} investigated` : `Investigating ${plural(a.total, 'failure')}`;
        else sub = state === 'current' ? 'Writing the report' : state === 'done' ? 'Ready to read' : '';
      }
      if (state === 'stopped') sub = 'Stopped';
      if (state === 'error') sub = 'Something went wrong';
      if (item.sub.textContent !== sub) item.sub.textContent = sub;
    });

    let fraction = 0.35;
    if (run.phase === 'prepare' && p.total) fraction = (p.learned + p.failed) / p.total;
    // run.expected counts every case to run; the ones still to learn are tested in the last pass.
    if (run.phase === 'test' && run.expected) fraction = Math.min(1, streamDone() / Math.max(1, run.expected - (run.toLearn || 0)));
    if (run.phase === 'retest' && p.learned) fraction = Math.min(1, Math.max(0, streamDone() - (run.firstPass ?? 0)) / p.learned);
    if (run.phase === 'report' && run.analysing) {
      const a = analysisCounts();
      fraction = a.total ? 0.1 + (a.finished / a.total) * 0.8 : 0.1;
    }
    if (run.phase === 'load') fraction = loadLive.progress(lastPoint?.t || 0) ?? 0.05;
    const progress = finished && (outcome === 'passed' || outcome === 'failed') ? 1 : Math.min(1, (current + fraction * 0.9) / (phases.length - 1));
    els.stepperFill.style.transform = `scaleX(${progress.toFixed(3)})`;
    els.stepper.parentElement.dataset.outcome = finished ? outcome : 'running';
  }

  function renderStats() {
    if (!run || isLoadKind(run.kind)) return;
    const c = counts();
    if (run.expected !== null && c.done > run.expected) run.expected = c.done;
    countTo(els.statPass, c.passed);
    countTo(els.statFail, c.failed);
    if (run.expected !== null && !run.finishedAt) {
      els.statLeftLabel.textContent = 'Left';
      countTo(els.statLeft, Math.max(0, run.expected - c.done));
    } else if (run.finishedAt) {
      els.statLeftLabel.textContent = 'Other';
      countTo(els.statLeft, c.other);
    } else {
      els.statLeftLabel.textContent = 'Running now';
      countTo(els.statLeft, c.running);
    }
    const total = Math.max(run.expected || 0, c.done, 1);
    els.barPass.style.width = `${((c.passed / total) * 100).toFixed(2)}%`;
    els.barFail.style.width = `${((c.failed / total) * 100).toFixed(2)}%`;
  }

  /** The final summary's counts win over what the stream let us count. */
  function applyFinalCounts(final) {
    if (!final || typeof final !== 'object') return;
    const n = (value) => (Number.isFinite(value) ? value : 0);
    const passed = n(final.passed);
    const failed = n(final.failed);
    const other = n(final.skipped) + n(final.notPrepared);
    run.finalCounts = { passed, failed, other, running: 0, done: passed + failed + other };
    run.expected = null;
  }

  function renderHeader() {
    if (!run) return;
    const parts = [run.app?.name, run.environment?.name].filter(Boolean);
    parts.push(`started ${formatWhen(run.startedAt).replace(/^Today /, '')}`);
    els.sub.textContent = parts.join(' · ');
    const finished = Boolean(run.finishedAt);
    const load = isLoadKind(run.kind);
    const what = load ? modeLabel(run.kind) : 'Test cycle';
    if (load) els.title.textContent = run.app?.name ? `${run.app.name} ${what.toLowerCase()}` : what;
    else els.title.textContent = run.app?.name ? (finished ? `${run.app.name} test cycle` : `Testing ${run.app.name}`) : 'Test cycle';
    els.pill.dataset.state = finished ? run.status : 'live';
    els.pillText.textContent = finished ? { passed: 'Finished', failed: 'Finished', stopped: 'Stopped', error: 'Didn’t finish' }[run.status] || 'Finished' : 'Live';
    els.stop.hidden = finished;
    tickClock();
  }

  function renderPhaseMsg() {
    if (!run) return;
    const fallback = {
      setup: 'Getting the test browser ready…',
      prepare: 'Learning new and changed cases. This happens once per case.',
      test: 'Browsers are running the cases that are already learned.',
      retest: 'Browsers are running the newly learned cases.',
      load: 'Virtual users are visiting the pages.',
      report: run.analysing ? 'Claude Code is finding the root cause of each failure.' : 'Putting the report together…',
    }[run.phase];
    swapText(els.phaseMsg, run.message || fallback || 'Working…');
  }

  function tickClock() {
    if (!run) return;
    const end = run.finishedAt || Date.now();
    els.elapsed.textContent = formatClockElapsed(end - run.startedAt);
  }

  function renderAll() {
    renderHeader();
    renderStepper();
    renderStats();
    renderPhaseMsg();
    renderWall();
    els.logEmpty.hidden = els.log.children.length > 0;
  }

  function finish() {
    for (const tile of run.tiles.values()) {
      if (!tile.ended) endTile(tile, tile.prep ? 'learned' : 'finished');
    }
    if (isLoadKind(run.kind)) return finishLoad();
    const c = counts();
    // Cases that weren't learned or were skipped didn't run, so they don't count towards "all passed".
    const total = c.passed + c.failed;
    let title;
    let tone;
    if (run.status === 'passed') {
      tone = 'pass';
      if (total && c.other) title = `${plural(c.passed, 'test case')} passed, ${c.other} not run`;
      else title = total ? (total === 1 ? 'The test case passed' : `All ${total} test cases passed`) : 'Test cycle finished';
    } else if (run.status === 'failed') {
      tone = 'fail';
      title = c.failed ? `${c.failed} of ${total} test ${total === 1 ? 'case' : 'cases'} failed` : 'Some checks failed';
    } else if (run.status === 'stopped') {
      tone = 'neutral';
      title = 'Test cycle stopped';
    } else {
      tone = 'fail';
      title = 'The test cycle couldn’t finish';
    }
    els.done.dataset.tone = tone;
    els.doneIcon.replaceChildren(icon(tone === 'pass' ? 'check' : tone === 'fail' ? 'alert' : 'minus'));
    els.doneTitle.textContent = title;
    els.doneSub.textContent =
      run.status === 'error' && run.message
        ? run.message
        : tone === 'fail'
          ? 'The report shows what went wrong, the root cause and how to reproduce it, with a screenshot, video and trace for each failure.'
          : 'The report has the details, page speed and anything the smoke check found.';
    els.doneReport.href = `#/report/${encodeURIComponent(run.id)}`;
    const wasHidden = els.done.hidden;
    els.done.hidden = false;
    if (wasHidden) {
      fadeIn(els.done, { y: 12, duration: 320 });
      animate(els.doneIcon, [{ transform: 'scale(0)' }, { transform: 'none' }], { duration: 480, delay: 120, easing: SPRING, fill: 'backwards' });
    }
    renderAll();
  }

  /** The finish banner of a load or stress test: the verdict once the summary has it. */
  function finishLoad() {
    const label = modeLabel(run.kind);
    const verdict = run.verdict;
    let tone = verdict?.tone || (run.status === 'stopped' ? 'neutral' : run.status === 'passed' ? 'pass' : 'fail');
    if (tone === 'info') tone = 'neutral';
    let title = verdict?.headline || (run.status === 'passed' || run.status === 'failed' ? run.message : '');
    if (!title) title = run.status === 'stopped' ? `${label} stopped` : run.status === 'error' ? `The ${label.toLowerCase()} couldn’t finish` : `${label} finished`;
    els.done.dataset.tone = tone;
    els.doneIcon.replaceChildren(icon(tone === 'pass' ? 'check' : tone === 'fail' || tone === 'warn' ? 'alert' : 'minus'));
    els.doneTitle.textContent = title;
    els.doneSub.textContent = verdict?.detail || (run.status === 'error' && run.message ? run.message : 'The report has every number, the charts and each page.');
    els.doneReport.href = `#/report/${encodeURIComponent(run.id)}`;
    const wasHidden = els.done.hidden;
    els.done.hidden = false;
    if (wasHidden) {
      fadeIn(els.done, { y: 12, duration: 320 });
      animate(els.doneIcon, [{ transform: 'scale(0)' }, { transform: 'none' }], { duration: 480, delay: 120, easing: SPRING, fill: 'backwards' });
    }
    renderAll();
  }

  // -------------------------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------------------------

  function log({ tone, who, text, result = false }) {
    const key = `${who}|${text}`;
    if (key === run.lastLogKey) return;
    run.lastLogKey = key;
    const now = new Date();
    const time = h('time', { datetime: now.toISOString() }, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    const mark = h('span', { class: 'log-mark', 'aria-hidden': 'true' });
    if (result) mark.append(icon(tone === 'pass' ? 'check' : tone === 'fail' ? 'close' : 'minus'));
    const body = h('span', { class: 'log-body' }, h('span', { class: 'log-text' }, text), who ? h('span', { class: 'log-who' }, who) : null);
    const row = h('li', { class: 'log-row', dataset: { tone, result: String(result) } }, mark, body, time);
    els.log.prepend(row);
    if (motionOK() && visible) row.classList.add('log-enter');
    while (els.log.children.length > MAX_LOG_ROWS) els.log.lastElementChild.remove();
    els.logEmpty.hidden = true;
  }

  // -------------------------------------------------------------------------------------------
  // Viewer (enlarged tile)
  // -------------------------------------------------------------------------------------------

  function renderViewerStatus() {
    const tile = viewerTile;
    if (!tile) return;
    els.viewerStatus.dataset.tone = tile.ended ? tile.status : 'info';
    els.viewerStatus.textContent = tile.ended ? tile.resultLabel : tile.prep ? 'Learning' : 'Live';
  }

  function openViewer(tile) {
    viewerTile = tile;
    els.viewerAccount.textContent = tile.label;
    els.viewerTitle.textContent = tile.caseTitle || 'Browser';
    els.viewerStep.replaceChildren();
    swapText(els.viewerStep, tile.step || '');
    renderViewerStatus();
    if (tile.frame) els.viewerImg.src = tile.frame;
    else els.viewerImg.removeAttribute('src');
    const first = tile.button.getBoundingClientRect();
    els.viewer.showModal();
    els.viewer.classList.add('viewer-open');
    flipFrom(els.viewer, first);
    animate(els.viewer.querySelector('.viewer-head'), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, fill: 'backwards' });
  }

  async function closeViewer(immediate = false) {
    const tile = viewerTile;
    if (!tile || !els.viewer.open) {
      viewerTile = null;
      return;
    }
    if (!immediate && motionOK() && tile.el.isConnected) {
      const from = els.viewer.getBoundingClientRect();
      const to = tile.button.getBoundingClientRect();
      const onScreen = to.bottom > 0 && to.top < window.innerHeight && to.width > 0;
      els.viewer.classList.remove('viewer-open');
      if (onScreen) {
        await animate(
          els.viewer,
          [
            { transformOrigin: 'top left', transform: 'none', opacity: 1 },
            { transformOrigin: 'top left', transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0.6 },
          ],
          { duration: 280 },
        );
      } else {
        await animate(els.viewer, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 180 });
      }
    }
    els.viewer.classList.remove('viewer-open');
    viewerTile = null;
    els.viewer.close();
  }

  $('viewer-close').addEventListener('click', () => closeViewer());
  els.viewer.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  els.viewer.addEventListener('click', (event) => {
    if (event.target === els.viewer) closeViewer();
  });

  // -------------------------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------------------------

  els.stop.addEventListener('click', async () => {
    if (!run || run.finishedAt) return;
    const load = isLoadKind(run.kind);
    const what = load ? modeLabel(run.kind).toLowerCase() : 'test cycle';
    const yes = await confirmDialog({
      title: `Stop this ${what}?`,
      body: load ? 'Every virtual user stops now. The report shows what was measured until then.' : 'The browsers close now. The report shows the cases that already finished.',
      confirm: `Stop ${what}`,
    });
    if (!yes || !run || run.finishedAt) return;
    els.stop.disabled = true;
    try {
      await ctx.api('POST', `/api/qa/runs/${enc(run.id)}/stop`);
      swapText(els.phaseMsg, 'Stopping…');
    } catch (error) {
      els.stop.disabled = false;
      toast(error.message, 'error');
    }
  });

  setInterval(() => {
    if (visible && run && !run.finishedAt) tickClock();
  }, 1000);

  return {
    handle,
    begin(runId, meta) {
      reset(runId, meta);
    },
    kind: () => run?.kind || null,
    show(runId) {
      if (!run || run.id !== runId) reset(runId, {});
      else if (!run.metaLoaded) loadMeta();
      renderAll();
    },
    setVisible(value) {
      visible = value;
      if (visible && run) for (const tile of run.tiles.values()) paintFrame(tile);
      if (!visible && viewerTile) closeViewer(true);
    },
  };
}

// devcrew QA, load and stress tests: the set-up card, the live panel (counters and live charts) and the
// report. The server enforces every limit; this page shows them and checks the same rules up front so the
// Start button can say what is missing in plain words.
import { enc } from './qa-api.js';
import { createChartGroup, createTimeChart, formatClock } from './qa-chart.js';
import { $, SPRING, animate, fadeIn, formatDuration, formatWhen, h, icon, motionOK, pill, plural, readPref, toMs, toast, writePref } from './qa-ui.js';

export const LIMITS = { maxUsers: 50, minDuration: 10, maxDuration: 300, minStepEvery: 3, maxStepEvery: 60, maxPaths: 20, maxThink: 5000 };
const KIND_LABEL = { local: 'Local', staging: 'Staging', uat: 'UAT', production: 'Production' };
const EXPLAIN = {
  load: 'Many people use the app at the same time for a while. Shows how fast it stays.',
  stress: 'Adds people step by step until the app slows down or fails. Finds its limit.',
};

export const isLoadKind = (kind) => kind === 'load' || kind === 'stress';
export const modeLabel = (mode) => (mode === 'stress' ? 'Stress test' : 'Load test');

export function formatMs(value) {
  if (!Number.isFinite(value)) return '–';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} s`;
}
const tickMs = (value) => (value >= 1000 ? `${+(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`);
const formatPercent = (value) => `${Number.isFinite(value) ? +Number(value).toFixed(1) : 0}%`;
const formatCount = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '0');
const formatRate = (value) => (Number.isFinite(value) ? (value >= 100 ? Math.round(value).toLocaleString() : String(+Number(value).toFixed(1))) : '0');

export function formatSeconds(sec) {
  const total = Math.round(sec);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Users per stress step, the same way the server counts them. */
export function stressLevels({ startUsers, step, maxUsers }) {
  if (!(step > 0) || maxUsers < startUsers) return [];
  const steps = Math.ceil((maxUsers - startUsers) / step) + 1;
  return Array.from({ length: steps }, (_, index) => Math.min(maxUsers, startUsers + index * step));
}

const counters = new WeakMap();
/** Counts a number to `value` with the given formatter (decimals allowed). */
function tweenTo(el, value, format) {
  const target = Number.isFinite(value) ? value : 0;
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(target);
  cancelAnimationFrame(counters.get(el));
  if (!motionOK() || from === target) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 600);
    el.textContent = format(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) counters.set(el, requestAnimationFrame(step));
  };
  counters.set(el, requestAnimationFrame(step));
}

/** The four charts of a load or stress test, sharing one crosshair. */
function buildCharts(host, { durationSec, thresholds, stress, maxUsers, live }) {
  const group = createChartGroup();
  const charts = {
    rps: createTimeChart({ title: 'Requests per second', series: [{ key: 'rps', label: 'req/s', tone: 'rps' }], type: 'area', format: formatRate, height: 190, live }),
    time: createTimeChart({ title: 'Response time', series: [{ key: 'p50', label: 'p50', tone: 'p50' }, { key: 'p95', label: 'p95', tone: 'p95' }], type: 'lines', format: tickMs, height: 190, minTop: 100, live }),
    errors: createTimeChart({ title: 'Errors', series: [{ key: 'errorRate', label: 'of requests failed', tone: 'err' }], type: 'bars', format: formatPercent, height: 150, minTop: stress ? Math.min(100, thresholds.maxErrorRate * 1.2) : 5, cap: 100, live }),
    users: createTimeChart({ title: stress ? 'Users (one step at a time)' : 'Active users', series: [{ key: 'users', label: 'users', tone: 'users' }], type: 'step', format: (value) => String(Math.round(value)), height: 150, minTop: maxUsers, live }),
  };
  for (const chart of Object.values(charts)) {
    group.add(chart);
    chart.setDomain(durationSec);
  }
  if (stress) {
    charts.time.setLimit({ value: thresholds.maxP95Ms, label: `Limit p95 ${tickMs(thresholds.maxP95Ms)}` });
    charts.errors.setLimit({ value: thresholds.maxErrorRate, label: `Limit ${formatPercent(thresholds.maxErrorRate)}` });
  }
  host.replaceChildren(...Object.values(charts).map((chart) => chart.el));
  return charts;
}

function destroyCharts(charts) {
  for (const chart of Object.values(charts || {})) chart.destroy();
}

// =============================================================================================
// Set-up card
// =============================================================================================

export function createLoadSetup(ctx) {
  const { state, api } = ctx;
  const els = {
    card: $('card-load'),
    modeLoad: $('load-mode-load'),
    modeStress: $('load-mode-stress'),
    explain: $('load-explain'),
    env: $('load-env'),
    envHint: $('load-env-hint'),
    paths: $('load-paths'),
    pathForm: $('load-path-form'),
    pathInput: $('load-path-input'),
    pathError: $('load-path-error'),
    suggestWrap: $('load-suggest-wrap'),
    suggestHint: $('load-suggest-hint'),
    suggest: $('load-suggest'),
    fieldsLoad: $('load-fields-load'),
    fieldsStress: $('load-fields-stress'),
    users: $('load-users'),
    usersOut: $('load-users-out'),
    duration: $('load-duration'),
    durationOut: $('load-duration-out'),
    rampField: $('load-ramp-field'),
    ramp: $('load-ramp'),
    rampOut: $('load-ramp-out'),
    think: $('load-think'),
    thinkOut: $('load-think-out'),
    stressStart: $('stress-start'),
    stressStep: $('stress-step'),
    stressEvery: $('stress-every'),
    stressMax: $('stress-max'),
    stressErrors: $('stress-errors'),
    stressP95: $('stress-p95'),
    account: $('load-account'),
    readiness: $('load-readiness'),
    btn: $('btn-load'),
    btnText: $('btn-load-text'),
    summary: $('load-summary'),
  };

  let appId = null;
  let paths = ['/'];
  let busy = false;
  const suggestions = new Map(); // `${app}|${env}` → { paths, fromRun } | 'loading'

  const mode = () => (els.modeStress.checked ? 'stress' : 'load');
  const int = (input) => Number.parseInt(input.value, 10);

  // ---------- preferences (per app, per browser) ----------

  function savePrefs() {
    if (!appId) return;
    writePref(`load:${appId}`, {
      mode: mode(),
      environment: els.env.value,
      paths,
      users: int(els.users),
      durationSec: int(els.duration),
      rampUpSec: int(els.ramp),
      thinkMs: int(els.think),
      account: els.account.value,
      stress: { startUsers: int(els.stressStart), step: int(els.stressStep), stepEverySec: int(els.stressEvery), maxUsers: int(els.stressMax), maxErrorRate: Number(els.stressErrors.value), maxP95Ms: int(els.stressP95) },
    });
  }

  function applyPrefs() {
    const prefs = readPref(`load:${appId}`, {}) || {};
    (prefs.mode === 'stress' ? els.modeStress : els.modeLoad).checked = true;
    paths = Array.isArray(prefs.paths) && prefs.paths.length ? prefs.paths.filter((item) => typeof item === 'string').slice(0, LIMITS.maxPaths) : ['/'];
    const set = (input, value) => {
      if (Number.isFinite(value)) input.value = String(value);
    };
    set(els.users, prefs.users);
    set(els.duration, prefs.durationSec);
    set(els.ramp, prefs.rampUpSec);
    set(els.think, prefs.thinkMs);
    const stress = prefs.stress || {};
    set(els.stressStart, stress.startUsers);
    set(els.stressStep, stress.step);
    set(els.stressEvery, stress.stepEverySec);
    set(els.stressMax, stress.maxUsers);
    set(els.stressErrors, stress.maxErrorRate);
    set(els.stressP95, stress.maxP95Ms);
    return prefs;
  }

  // ---------- environment, accounts, suggestions ----------

  function renderEnvOptions(app, preferred) {
    const envs = app?.environments || [];
    const previous = els.env.value || preferred;
    els.env.replaceChildren(
      ...envs.map((env) => {
        const option = new Option(env.kind === 'production' ? `${env.name} (production, never load tested)` : env.name, env.id);
        option.disabled = env.kind === 'production';
        return option;
      }),
    );
    const usable = envs.filter((env) => env.kind !== 'production');
    const pick = usable.find((env) => env.id === previous) || usable[0];
    if (pick) els.env.value = pick.id;
    els.env.disabled = usable.length === 0;
  }

  function currentEnv() {
    const env = (ctx.currentApp()?.environments || []).find((item) => item.id === els.env.value);
    return env && env.kind !== 'production' ? env : null;
  }

  function renderAccounts(app, preferred) {
    const env = currentEnv();
    const accounts = (app?.accounts || []).filter((account) => !account.environment || account.environment === env?.id);
    const previous = els.account.value || preferred || '';
    els.account.replaceChildren(new Option('Not logged in (public pages)', ''), ...accounts.map((account) => new Option(account.label, account.id)));
    els.account.value = accounts.some((account) => account.id === previous) ? previous : '';
  }

  async function loadSuggestions() {
    const env = currentEnv();
    const app = ctx.currentApp();
    if (!env || !app) return renderSuggestions();
    const key = `${app.id}|${env.id}`;
    if (!suggestions.has(key)) {
      suggestions.set(key, 'loading');
      try {
        suggestions.set(key, await api('GET', `/api/qa/apps/${enc(app.id)}/load-pages?environment=${enc(env.id)}`));
      } catch {
        suggestions.set(key, { paths: ['/'], fromRun: null });
      }
    }
    renderSuggestions();
  }

  function renderSuggestions() {
    const env = currentEnv();
    const found = env ? suggestions.get(`${state.appId}|${env.id}`) : null;
    const offered = found && found !== 'loading' ? found.paths.filter((item) => !paths.includes(item)) : [];
    els.suggestWrap.hidden = offered.length === 0;
    els.suggestHint.textContent = found?.fromRun ? 'Pages the last smoke check found. Tap to add.' : 'Tap to add.';
    els.suggest.replaceChildren(
      ...offered.slice(0, 16).map((item) => {
        const button = h('button', { type: 'button', class: 'suggest-chip', 'aria-label': `Add ${item}` }, icon('plus'), h('span', { class: 'url' }, item));
        button.addEventListener('click', () => addPath(item, button));
        return button;
      }),
    );
  }

  // ---------- pages ----------

  /** Mirrors the server: a path on the app itself, never another site. */
  function cleanPath(raw) {
    const value = String(raw || '').trim();
    if (!value) return { error: 'Type a page of the app, for example /dashboard.' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return { error: 'Only pages of this app can be tested. Use the part after the address, for example /dashboard.' };
    const path = value.startsWith('/') ? value : `/${value}`;
    if (path.includes('\\') || /\s/.test(path) || path.length > 300) return { error: 'That doesn’t look like a page address. Use something like /dashboard.' };
    return { path: path.split('#')[0] };
  }

  function addPath(raw, from = null) {
    const { path, error } = cleanPath(raw);
    if (error) return showPathError(error);
    if (paths.includes(path)) return showPathError(`${path} is already in the list.`);
    if (paths.length >= LIMITS.maxPaths) return showPathError(`A load test can visit at most ${LIMITS.maxPaths} pages.`);
    els.pathError.hidden = true;
    paths = [...paths, path];
    savePrefs();
    renderPaths(path);
    renderSuggestions();
    renderForm();
    if (from) els.suggest.querySelector('button')?.focus();
    return true;
  }

  function showPathError(message) {
    els.pathError.textContent = message;
    els.pathError.hidden = false;
    fadeIn(els.pathError, { y: -4 });
    return false;
  }

  function removePath(path) {
    const index = paths.indexOf(path);
    const chip = els.paths.children[index];
    const done = () => {
      paths = paths.filter((item) => item !== path);
      savePrefs();
      renderPaths();
      renderSuggestions();
      renderForm();
      const next = els.paths.querySelectorAll('.page-chip-remove')[Math.min(index, paths.length - 1)];
      (next || els.pathInput).focus();
    };
    if (chip) animate(chip, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.85)' }], { duration: 160 }).then(done);
    else done();
  }

  function renderPaths(fresh = null) {
    els.paths.replaceChildren(
      ...paths.map((path) => {
        const remove = h('button', { type: 'button', class: 'page-chip-remove', 'aria-label': `Remove ${path}`, title: 'Remove' }, icon('close'));
        remove.addEventListener('click', () => removePath(path));
        const chip = h('li', { class: 'page-chip' }, h('span', { class: 'url' }, path), remove);
        if (path === fresh) animate(chip, [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SPRING });
        return chip;
      }),
    );
    if (!paths.length) els.paths.append(h('li', { class: 'page-chip-empty' }, 'No pages yet. Add at least one.'));
  }

  els.pathForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addPath(els.pathInput.value)) els.pathInput.value = '';
  });
  els.pathInput.addEventListener('input', () => (els.pathError.hidden = true));

  // ---------- numbers ----------

  for (const wrap of els.card.querySelectorAll('.num-step')) {
    const input = $(wrap.dataset.for);
    for (const button of wrap.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const min = Number(input.min);
        const max = Number(input.max);
        const next = Math.max(min, Math.min(max, (int(input) || min) + Number(button.dataset.step)));
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }

  // ---------- plan and form ----------

  function plan() {
    const app = ctx.currentApp();
    const env = currentEnv();
    const kind = mode();
    const problems = [];
    const allProduction = (app?.environments || []).length > 0 && !(app.environments || []).some((item) => item.kind !== 'production');
    if (!app?.environments?.length) problems.push({ text: 'Add an environment to this app' });
    else if (allProduction) problems.push({ text: 'Load tests never run on production. Add a local, staging or UAT environment.' });
    if (!paths.length) problems.push({ text: 'Add at least one page to visit', action: { label: 'Add a page', run: () => els.pathInput.focus() } });

    const body = { environment: env?.id, mode: kind, paths, thinkMs: int(els.think) };
    if (els.account.value) body.account = els.account.value;
    let levels = [];
    let durationSec;
    if (kind === 'load') {
      body.users = int(els.users);
      body.durationSec = int(els.duration);
      body.rampUpSec = Math.min(int(els.ramp), body.durationSec);
      durationSec = body.durationSec;
    } else {
      const stress = { startUsers: int(els.stressStart), step: int(els.stressStep), stepEverySec: int(els.stressEvery), maxUsers: int(els.stressMax), maxErrorRate: Number(els.stressErrors.value), maxP95Ms: int(els.stressP95) };
      body.stress = stress;
      const whole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
      if (!whole(stress.startUsers, 1, LIMITS.maxUsers)) problems.push({ text: `Start with 1 to ${LIMITS.maxUsers} users` });
      if (!whole(stress.step, 1, LIMITS.maxUsers)) problems.push({ text: `Add 1 to ${LIMITS.maxUsers} users each step` });
      if (!whole(stress.stepEverySec, LIMITS.minStepEvery, LIMITS.maxStepEvery)) problems.push({ text: `A step lasts ${LIMITS.minStepEvery} to ${LIMITS.maxStepEvery} seconds` });
      if (!whole(stress.maxUsers, 1, LIMITS.maxUsers)) problems.push({ text: `Go up to at most ${LIMITS.maxUsers} users` });
      else if (stress.maxUsers < stress.startUsers) problems.push({ text: '“Up to” must be at least the users you start with' });
      if (!(stress.maxErrorRate >= 0 && stress.maxErrorRate <= 100)) problems.push({ text: 'The error limit is a percentage from 0 to 100' });
      if (!whole(stress.maxP95Ms, 50, 10000)) problems.push({ text: 'The response time limit is 50 to 10000 ms' });
      levels = problems.length ? [] : stressLevels(stress);
      durationSec = levels.length * stress.stepEverySec;
      if (durationSec > LIMITS.maxDuration) problems.push({ text: `This would take ${formatSeconds(durationSec)}; the limit is 5 minutes. Add more users per step or shorten the steps.` });
    }
    return { app, env, kind, body, problems, levels, durationSec };
  }

  function renderOutputs() {
    els.usersOut.textContent = plural(int(els.users), 'user');
    els.durationOut.textContent = formatSeconds(int(els.duration));
    els.ramp.max = String(Math.min(60, int(els.duration)));
    els.rampOut.textContent = int(els.ramp) ? formatSeconds(int(els.ramp)) : 'All at once';
    els.thinkOut.textContent = int(els.think) ? formatDuration(int(els.think)) : 'No pause';
    for (const input of [els.users, els.duration, els.ramp, els.think]) {
      const fill = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min) || 1)) * 100;
      input.style.setProperty('--fill', `${fill.toFixed(1)}%`);
    }
  }

  function renderForm() {
    const kind = mode();
    els.fieldsLoad.hidden = kind !== 'load';
    els.fieldsStress.hidden = kind !== 'stress';
    els.rampField.hidden = kind !== 'load';
    if (els.explain.textContent !== EXPLAIN[kind]) els.explain.textContent = EXPLAIN[kind];
    renderOutputs();

    const env = currentEnv();
    if (env) {
      let host = env.baseUrl;
      try {
        host = new URL(env.baseUrl).host;
      } catch {
        /* keep the raw value */
      }
      els.envHint.textContent = `${KIND_LABEL[env.kind] || env.kind} · ${host}`;
    } else els.envHint.textContent = '';

    const current = plan();
    const running = Boolean(state.activeRun);
    const problems = running ? [{ text: 'Another test is running. Wait for it to finish, or stop it.' }, ...current.problems] : current.problems;
    els.readiness.hidden = problems.length === 0;
    els.readiness.replaceChildren(
      ...problems.map((item) => {
        const li = h('li', {}, h('span', { class: 'readiness-dot', 'aria-hidden': 'true' }), h('span', { class: 'readiness-text' }, item.text));
        if (item.action) {
          const button = h('button', { type: 'button', class: 'link-btn' }, item.action.label);
          button.addEventListener('click', item.action.run);
          li.append(button);
        }
        return li;
      }),
    );
    els.btn.disabled = problems.length > 0 || busy;
    els.btnText.textContent = busy ? 'Starting…' : kind === 'stress' ? 'Start stress test' : 'Start load test';

    if (current.problems.length) {
      els.summary.textContent = '';
      return;
    }
    const who = els.account.value ? `logged in as ${els.account.selectedOptions[0]?.textContent || 'the account'}` : 'not logged in';
    const pages = plural(paths.length, 'page');
    if (kind === 'load') {
      const { users, durationSec } = current.body;
      els.summary.textContent = `${plural(users, 'user')} visit ${pages} for ${formatSeconds(durationSec)}, ${who}. GET requests only, on this app only.`;
    } else {
      const { stress } = current.body;
      els.summary.textContent = `${stress.startUsers} → ${stress.maxUsers} users in ${plural(current.levels.length, 'step')} (up to ${formatSeconds(current.durationSec)}), ${who}. Stops early when more than ${formatPercent(stress.maxErrorRate)} fail or p95 passes ${tickMs(stress.maxP95Ms)}.`;
    }
  }

  for (const input of [els.users, els.duration, els.ramp, els.think, els.stressStart, els.stressStep, els.stressEvery, els.stressMax, els.stressErrors, els.stressP95]) {
    input.addEventListener('input', () => {
      renderForm();
      savePrefs();
    });
  }
  for (const input of [els.modeLoad, els.modeStress]) {
    input.addEventListener('change', () => {
      savePrefs();
      renderForm();
      const shown = mode() === 'stress' ? els.fieldsStress : els.fieldsLoad;
      fadeIn(shown, { y: 6, duration: 220 });
      fadeIn(els.explain, { y: 4, duration: 200 });
    });
  }
  els.env.addEventListener('change', () => {
    renderAccounts(ctx.currentApp());
    savePrefs();
    renderForm();
    loadSuggestions();
  });
  els.account.addEventListener('change', () => {
    savePrefs();
    renderForm();
  });

  els.btn.addEventListener('click', async () => {
    const current = plan();
    if (current.problems.length || busy || !current.env) return;
    busy = true;
    renderForm();
    savePrefs();
    try {
      await ctx.startLoad(current.body);
    } catch (error) {
      els.summary.textContent = '';
      toast(error.message, 'error');
    } finally {
      busy = false;
      renderForm();
    }
  });

  return {
    /** Called whenever the app (or its accounts and environments) may have changed. */
    render() {
      const app = ctx.currentApp();
      if (!app) return;
      let prefs = {};
      if (app.id !== appId) {
        appId = app.id;
        els.env.value = '';
        els.account.value = '';
        prefs = applyPrefs();
        renderPaths();
      }
      renderEnvOptions(app, prefs.environment);
      renderAccounts(app, prefs.account);
      renderForm();
      loadSuggestions();
    },
    renderForm,
  };
}

// =============================================================================================
// Live panel
// =============================================================================================

export function createLoadLive() {
  const els = {
    section: $('load-live'),
    charts: $('load-charts'),
    rps: $('kpi-rps'),
    rpsSub: $('kpi-rps-sub'),
    p95: $('kpi-p95'),
    p50: $('kpi-p50'),
    err: $('kpi-err'),
    errSub: $('kpi-err-sub'),
    errTile: $('kpi-errors-tile'),
    users: $('kpi-users'),
    usersSub: $('kpi-users-sub'),
    req: $('kpi-req'),
  };
  let charts = null;
  let plan = null;
  let points = [];
  let peak = 0;
  let thresholds = { maxErrorRate: 5, maxP95Ms: 2000 };

  function reset() {
    destroyCharts(charts);
    charts = null;
    plan = null;
    points = [];
    peak = 0;
    for (const el of [els.rps, els.err, els.users, els.req]) {
      el.dataset.value = '0';
      el.textContent = '0';
    }
    els.p95.textContent = '–';
    els.p95.parentElement.dataset.empty = 'true';
    els.p50.textContent = 'Waiting for answers';
    els.rpsSub.textContent = 'Waiting for the first answers';
    els.errSub.textContent = 'None failed';
    els.usersSub.textContent = '';
    els.errTile.dataset.tone = 'none';
    els.charts.replaceChildren(h('p', { class: 'charts-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'The charts start with the first second of traffic.'));
  }

  /** Called once the plan is known (from the run's summary). */
  function setPlan(load) {
    if (!load?.plan || plan) return;
    plan = { ...load.plan, mode: load.mode };
    thresholds = load.plan.stress ? { maxErrorRate: load.plan.stress.maxErrorRate, maxP95Ms: load.plan.stress.maxP95Ms } : thresholds;
    charts = buildCharts(els.charts, { durationSec: plan.durationSec, thresholds, stress: Boolean(plan.stress), maxUsers: plan.stress ? plan.stress.maxUsers : plan.users, live: true });
    if (points.length) for (const chart of Object.values(charts)) chart.setPoints(points);
    renderKpis(points.at(-1));
  }

  function renderKpis(last) {
    if (!last) return;
    peak = Math.max(peak, last.rps);
    tweenTo(els.rps, last.rps, formatRate);
    els.rpsSub.textContent = `Peak ${formatRate(peak)}`;
    tweenTo(els.p95, last.p95 ?? 0, (value) => (last.p95 === null ? '–' : formatCount(value)));
    els.p95.parentElement.dataset.empty = String(last.p95 === null);
    els.p50.textContent = last.p50 === null ? 'No answers this second' : `p50 ${formatCount(last.p50)} ms`;
    tweenTo(els.err, last.errorRate, (value) => String(+value.toFixed(1)));
    els.errSub.textContent = last.errors ? `${formatCount(last.errors)} failed in total` : 'None failed';
    els.errTile.dataset.tone = last.errorRate > thresholds.maxErrorRate ? 'fail' : last.errorRate > 0 ? 'warn' : 'none';
    tweenTo(els.users, last.users, formatCount);
    if (plan?.stress) {
      const levels = stressLevels(plan.stress);
      const index = Math.max(0, levels.indexOf(last.users));
      els.usersSub.textContent = `Step ${index + 1} of ${levels.length}`;
    } else if (plan) els.usersSub.textContent = `of ${plan.users}`;
    tweenTo(els.req, last.requests, formatCount);
  }

  /** One live point from the stream: { t, users, rps, p50, p95, errorRate, requests, errors }. */
  function point(event) {
    if (!Number.isFinite(event.t) || points.some((item) => item.t === event.t)) return;
    const entry = { t: event.t, users: event.users, rps: event.rps, p50: event.p50 ?? null, p95: event.p95 ?? null, errorRate: event.errorRate, requests: event.requests, errors: event.errors };
    points = [...points, entry].sort((a, b) => a.t - b.t);
    if (charts) {
      const latest = points.at(-1) === entry;
      for (const chart of Object.values(charts)) chart.setPoints(points, { animate: latest });
    }
    renderKpis(points.at(-1));
  }

  /** After the test: the stored timeline replaces what the stream delivered (it is complete). */
  function finish(load) {
    if (!load) return;
    setPlan(load);
    if (!charts) return;
    if (Array.isArray(load.timeline) && load.timeline.length >= points.length) {
      let total = 0;
      let errors = 0;
      points = load.timeline.map((item) => {
        total += item.rps;
        errors += item.errors || 0;
        return { ...item, requests: total, errors };
      });
      for (const chart of Object.values(charts)) chart.setPoints(points);
    }
    if (load.breakingPoint) {
      const step = (load.steps || []).find((item) => item.users === load.breakingPoint.users);
      for (const chart of Object.values(charts)) chart.setMarker({ t: step ? step.startT : points.at(-1)?.t || 0, label: chart === charts.users ? `Broke at ${load.breakingPoint.users}` : '' });
    }
    // Once it is over, the counters show the whole test instead of its last second.
    const { totals } = load;
    if (totals) {
      tweenTo(els.rps, totals.avgRps, formatRate);
      els.rpsSub.textContent = `Average over the test · peak ${formatRate(peak)}`;
      tweenTo(els.p95, totals.p95 ?? 0, (value) => (totals.p95 === null ? '–' : formatCount(value)));
      els.p95.parentElement.dataset.empty = String(totals.p95 === null);
      els.p50.textContent = totals.p50 === null ? 'No answers' : `p50 ${formatCount(totals.p50)} ms · whole test`;
      tweenTo(els.err, totals.errorRate, (value) => String(+value.toFixed(1)));
      els.errSub.textContent = totals.errors ? `${formatCount(totals.errors)} of ${formatCount(totals.requests)} failed` : 'None failed';
      els.errTile.dataset.tone = totals.errorRate > thresholds.maxErrorRate ? 'fail' : totals.errors ? 'warn' : 'none';
      tweenTo(els.users, totals.peakUsers, formatCount);
      els.usersSub.textContent = 'At the most';
      tweenTo(els.req, totals.requests, formatCount);
    }
  }

  return {
    reset,
    setPlan,
    point,
    finish,
    hasPlan: () => Boolean(plan),
    progress(elapsedSec) {
      if (!plan) return null;
      return Math.min(1, elapsedSec / plan.durationSec);
    },
    plan: () => plan,
    lastPoint: () => points.at(-1) || null,
  };
}

// =============================================================================================
// Report
// =============================================================================================

export function createLoadReport() {
  const els = {
    wrap: $('load-report'),
    icon: $('load-verdict-icon'),
    verdict: $('load-verdict'),
    kind: $('load-kind'),
    headline: $('load-headline'),
    detail: $('load-detail'),
    numbers: $('load-numbers'),
    meta: $('load-meta'),
    breaking: $('load-breaking'),
    breakingScale: $('load-breaking-scale'),
    breakingTitle: $('load-breaking-title'),
    breakingSub: $('load-breaking-sub'),
    session: $('load-session'),
    sessionText: $('load-session-text'),
    timeSub: $('load-time-sub'),
    charts: $('report-charts'),
    seconds: $('load-seconds').tBodies[0],
    stepsCard: $('load-steps-card'),
    steps: $('load-steps').tBodies[0],
    pages: $('load-pages').tBodies[0],
    errorKinds: $('load-error-kinds'),
  };
  let charts = null;

  const cell = (label, ...children) => h('td', { 'data-label': label }, ...children);
  const num = (value) => h('span', { class: 'num' }, value);

  function render(summary, ctx) {
    const load = summary.load || {};
    const planInfo = load.plan || {};
    const totals = load.totals || null;
    const verdict = load.verdict || (ctx.isActive(summary.status) ? { tone: 'info', headline: 'Still running', detail: '' } : { tone: summary.status === 'error' ? 'fail' : 'neutral', headline: summary.status === 'error' ? 'The test couldn’t finish' : 'No results', detail: summary.error || '' });
    const stress = load.mode === 'stress' || summary.kind === 'stress';

    els.verdict.dataset.tone = verdict.tone;
    els.icon.replaceChildren(icon(verdict.tone === 'pass' ? 'check' : verdict.tone === 'fail' ? 'alert' : verdict.tone === 'warn' ? 'alert' : 'minus'));
    animate(els.icon, [{ transform: 'scale(0)' }, { transform: 'none' }], { duration: 480, delay: 120, easing: SPRING, fill: 'backwards' });
    els.kind.textContent = stress
      ? `Stress test · ${planInfo.stress ? `${planInfo.stress.startUsers} → ${planInfo.stress.maxUsers} users, +${planInfo.stress.step} every ${planInfo.stress.stepEverySec} s` : ''}`
      : `Load test · ${planInfo.users ? `${plural(planInfo.users, 'user')} for ${formatSeconds(planInfo.durationSec)}` : ''}`;
    els.headline.textContent = verdict.headline;
    els.detail.textContent = summary.status === 'error' && summary.error && !load.verdict ? summary.error : verdict.detail || '';

    const item = (label, value, extra = {}) => [h('div', { class: 'num-tile', ...extra }, h('dt', {}, label), h('dd', {}, value))];
    els.numbers.replaceChildren(
      ...(totals
        ? [
            ...item('Requests', formatCount(totals.requests)),
            ...item('Errors', `${formatCount(totals.errors)} · ${formatPercent(totals.errorRate)}`, { dataset: { tone: totals.errorRate > (load.thresholds?.maxErrorRate ?? 5) ? 'fail' : totals.errors ? 'warn' : 'none' } }),
            ...item('Requests / s', formatRate(totals.avgRps)),
            ...item('p50', formatMs(totals.p50)),
            ...item('p95', formatMs(totals.p95)),
            ...item('p99', formatMs(totals.p99)),
            ...item('Fastest', formatMs(totals.min)),
            ...item('Slowest', formatMs(totals.max)),
            ...(totals.redirects ? item('Redirects', formatCount(totals.redirects)) : []),
          ]
        : []),
    );
    els.numbers.hidden = !totals;

    const env = summary.environment && typeof summary.environment === 'object' ? summary.environment : { name: String(summary.environment || '') };
    const kindLabel = KIND_LABEL[env.kind] || env.kind || '';
    const parts = [];
    if (env.name) parts.push(kindLabel && kindLabel.toLowerCase() !== env.name.toLowerCase() ? `${env.name} (${kindLabel})` : env.name);
    const started = toMs(summary.startedAt);
    if (Number.isFinite(load.durationSec)) parts.push(`ran ${formatSeconds(load.durationSec)}`);
    if (planInfo.paths) parts.push(plural(planInfo.paths.length, 'page'));
    parts.push(planInfo.account ? `logged in as ${planInfo.account}` : 'not logged in');
    if (started) parts.push(formatWhen(started));
    if (totals?.unfinished) parts.push(`${plural(totals.unfinished, 'request')} still waiting at the end (not counted)`);
    els.meta.replaceChildren(...parts.flatMap((part, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), part] : [part])));
    if (summary.status === 'stopped' || summary.status === 'error') els.meta.prepend(pill(summary.status === 'error' ? 'Didn’t finish' : 'Stopped', summary.status === 'error' ? 'fail' : 'neutral'), ' ');

    renderBreaking(load, stress);

    els.session.hidden = !totals?.loginRedirects;
    if (totals?.loginRedirects) {
      els.sessionText.replaceChildren(
        icon('login'),
        h(
          'span',
          {},
          h('strong', {}, planInfo.account ? 'The login session was lost. ' : 'These pages need a login. '),
          `${plural(totals.loginRedirects, 'request')} were sent to the login page instead of the page asked for${planInfo.account ? '' : '. Choose an account under “Logged in as” and run it again'}.`,
        ),
      );
    }

    const timeline = Array.isArray(load.timeline) ? load.timeline : [];
    els.timeSub.textContent = timeline.length ? `${plural(timeline.length, 'second')} · hover or use the arrow keys to read a second` : 'No complete second was measured.';
    destroyCharts(charts);
    charts = null;
    if (timeline.length && planInfo.durationSec) {
      const thresholds = load.thresholds || { maxErrorRate: 5, maxP95Ms: 2000 };
      charts = buildCharts(els.charts, { durationSec: Math.max(timeline.at(-1).t, Math.min(planInfo.durationSec, Math.ceil(load.durationSec || planInfo.durationSec))), thresholds, stress, maxUsers: stress ? planInfo.stress?.maxUsers || 1 : planInfo.users || 1, live: false });
      for (const chart of Object.values(charts)) chart.reveal(timeline);
      if (load.breakingPoint) {
        const step = (load.steps || []).find((entry) => entry.users === load.breakingPoint.users);
        if (step) for (const chart of Object.values(charts)) chart.setMarker({ t: step.startT, label: chart === charts.users ? `Broke at ${load.breakingPoint.users}` : '' });
      }
    } else {
      els.charts.replaceChildren();
    }
    els.seconds.replaceChildren(
      ...timeline.map((point) =>
        h('tr', {}, cell('Time', formatClock(point.t)), cell('Users', num(String(point.users))), cell('Requests/s', num(formatRate(point.rps))), cell('p50', num(formatMs(point.p50))), cell('p95', num(formatMs(point.p95))), cell('Errors', num(formatPercent(point.errorRate)))),
      ),
    );

    const steps = Array.isArray(load.steps) ? load.steps : [];
    els.stepsCard.hidden = !stress || steps.length === 0;
    els.steps.replaceChildren(
      ...steps.map((step) =>
        h(
          'tr',
          { dataset: { problem: String(Boolean(step.broke)) } },
          cell('Users', h('strong', {}, String(step.users))),
          cell('Requests', num(formatCount(step.requests))),
          cell('p95', num(formatMs(step.p95))),
          cell('Errors', num(formatPercent(step.errorRate))),
          cell('Result', step.broke ? pill(step.broke.condition === 'errorRate' ? 'Too many errors' : 'Too slow', 'fail') : pill('Held', 'pass')),
        ),
      ),
    );

    const pages = Array.isArray(load.pages) ? load.pages : [];
    els.pages.replaceChildren(
      ...pages.map((page) =>
        h(
          'tr',
          { dataset: { problem: String(page.errors > 0) } },
          cell('Page', h('span', { class: 'url' }, page.path)),
          cell('Requests', num(formatCount(page.requests))),
          cell('Errors', page.errors ? pill(`${formatCount(page.errors)} · ${formatPercent(page.errorRate)}`, 'fail') : h('span', { class: 'zero' }, '0')),
          cell('p50', num(formatMs(page.p50))),
          cell('p95', num(formatMs(page.p95))),
          cell('Slowest', num(formatMs(page.max))),
          cell('Redirects', page.redirects ? num(formatCount(page.redirects)) : h('span', { class: 'zero' }, '0')),
        ),
      ),
    );
    const kinds = Array.isArray(load.errorKinds) ? load.errorKinds : [];
    els.errorKinds.hidden = kinds.length === 0;
    els.errorKinds.replaceChildren(...kinds.map((entry) => h('li', {}, h('span', {}, entry.kind), h('strong', {}, formatCount(entry.count)))));
  }

  function renderBreaking(load, stress) {
    els.breaking.hidden = !stress || !load.verdict || load.stopped;
    if (els.breaking.hidden) return;
    const plan = load.plan?.stress;
    const levels = plan ? stressLevels(plan) : [];
    const point = load.breakingPoint;
    const judged = new Map((load.steps || []).map((step) => [step.users, step]));
    els.breaking.dataset.tone = point ? 'fail' : 'pass';
    els.breakingTitle.textContent = point ? `Breaking point: ${plural(point.users, 'user')}` : `Held up to ${plural(plan?.maxUsers || load.heldUpTo || 0, 'user')}`;
    els.breakingSub.textContent = point
      ? `${point.condition === 'errorRate' ? `${formatPercent(point.value)} of requests failed (limit ${formatPercent(point.limit)})` : `p95 was ${formatMs(point.value)} (limit ${formatMs(point.limit)})${point.waiting ? `, counting ${plural(point.waiting, 'request')} still waiting at the end of the step` : ''}`}. ${load.heldUpTo ? `Everything was fine up to ${plural(load.heldUpTo, 'user')}.` : 'It broke at the first step.'}`
      : 'No step passed the limits.';
    els.breakingScale.replaceChildren(
      ...levels.map((users, index) => {
        const step = judged.get(users);
        const tone = !step ? 'todo' : step.broke ? 'fail' : 'pass';
        const bar = h('span', { class: 'scale-step', dataset: { tone } }, h('span', { class: 'scale-bar' }), h('span', { class: 'scale-num' }, String(users)));
        bar.style.setProperty('--h', `${Math.round((users / (plan.maxUsers || 1)) * 100)}%`);
        animate(bar.firstChild, [{ transform: 'scaleY(0)' }, { transform: 'none' }], { duration: 420, delay: 80 + index * 60, fill: 'backwards' });
        return bar;
      }),
    );
  }

  return {
    render,
    show(visible) {
      els.wrap.hidden = !visible;
      if (!visible) {
        destroyCharts(charts);
        charts = null;
      }
    },
  };
}

/** The history line of a load or stress run. */
export function loadRunText(run) {
  const brief = run.load || {};
  if (run.kind === 'stress') {
    if (brief.breakingPoint) return `Stress test · broke at ${brief.breakingPoint} users`;
    if (brief.heldUpTo && run.status === 'passed') return `Stress test · held up to ${brief.heldUpTo} users`;
    return 'Stress test';
  }
  if (brief.users && Number.isFinite(brief.p95)) return `Load test · ${brief.users} users · p95 ${formatMs(brief.p95)}`;
  return 'Load test';
}

// Load and stress test plans: the limits QA enforces on the server (the routes check a plan before a run
// starts, and the engine checks it again before it sends a single request), and the pages to suggest.
// Load tests only ever send GET requests to the environment's own origin, and never to production.
const store = require('./store');

const LIMITS = {
  maxUsers: 50,
  minDurationSec: 10,
  maxDurationSec: 300,
  maxThinkMs: 10000,
  maxPaths: 20,
  maxPathLength: 300,
  minStepEverySec: 3,
  maxStepEverySec: 60,
  minP95Ms: 50,
  maxP95Ms: 10000,
  requestTimeoutMs: 10000,
};
const DEFAULTS = { thinkMs: 500, rampUpSec: 0, maxErrorRate: 5, maxP95Ms: 2000 };
const MODES = ['load', 'stress'];

const invalid = (message) => new store.QaError(422, message);

/** A whole number within limits; `fallback` is used only when the value is missing. */
function whole(value, fallback, min, max, message) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw invalid(message);
  return number;
}

/** A page of the environment: a path on its own origin. Absolute and protocol-relative URLs are refused. */
function cleanPath(value, baseUrl) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const shown = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) || String(value ?? '').slice(0, 60);
  const refuse = () => invalid(`"${shown}" is not a page of this app. Use a path on the app itself that starts with /, for example /dashboard.`);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.length > LIMITS.maxPathLength || /[\s\u0000-\u001f\u007f]/.test(raw)) throw refuse();
  const base = new URL(baseUrl);
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    throw refuse();
  }
  if (url.origin !== base.origin) throw refuse();
  return `${url.pathname}${url.search}`;
}

/**
 * Checks a load or stress plan against an environment and returns it cleaned. Throws a 422 QaError with a
 * plain-language message. Production is always refused, whatever the environment's allowProduction says.
 */
function checkPlan(input = {}, environment) {
  if (!environment || typeof environment !== 'object') throw invalid('Choose one of the app\'s environments.');
  if (environment.kind === 'production') {
    throw invalid(`Load and stress tests never run on production (${environment.name}). Choose a local, staging or UAT environment.`);
  }
  const mode = input.mode === undefined ? 'load' : input.mode;
  if (!MODES.includes(mode)) throw invalid('Choose a load test or a stress test.');

  const list = Array.isArray(input.paths) ? input.paths : [];
  if (list.length === 0) throw invalid('Add at least one page to test, for example /.');
  if (list.length > LIMITS.maxPaths) throw invalid(`A load test can visit at most ${LIMITS.maxPaths} pages.`);
  const paths = [...new Set(list.map((item) => cleanPath(item, environment.baseUrl)))];

  const thinkMs = whole(input.thinkMs, DEFAULTS.thinkMs, 0, LIMITS.maxThinkMs, `The pause between pages must be a whole number of milliseconds from 0 to ${LIMITS.maxThinkMs}.`);
  const account = typeof input.account === 'string' && input.account ? input.account : null;
  const usersMessage = (what) => `${what} must be a whole number from 1 to ${LIMITS.maxUsers}.`;

  if (mode === 'load') {
    const users = whole(input.users, undefined, 1, LIMITS.maxUsers, usersMessage('Virtual users'));
    const durationSec = whole(input.durationSec, undefined, LIMITS.minDurationSec, LIMITS.maxDurationSec, `The duration must be from ${LIMITS.minDurationSec} seconds to 5 minutes (${LIMITS.maxDurationSec} seconds).`);
    const rampUpSec = whole(input.rampUpSec, DEFAULTS.rampUpSec, 0, durationSec, 'The ramp-up must be a whole number of seconds, from 0 up to the duration.');
    return { mode, paths, users, durationSec, rampUpSec, thinkMs, account };
  }

  const stress = input.stress && typeof input.stress === 'object' ? input.stress : {};
  const startUsers = whole(stress.startUsers, undefined, 1, LIMITS.maxUsers, usersMessage('Start users'));
  const step = whole(stress.step, undefined, 1, LIMITS.maxUsers, usersMessage('The users added per step'));
  const stepEverySec = whole(stress.stepEverySec, undefined, LIMITS.minStepEverySec, LIMITS.maxStepEverySec, `A step must last from ${LIMITS.minStepEverySec} to ${LIMITS.maxStepEverySec} seconds.`);
  const maxUsers = whole(stress.maxUsers, undefined, startUsers, LIMITS.maxUsers, `Max users must be a whole number from the start users (${startUsers}) to ${LIMITS.maxUsers}.`);
  const maxErrorRate = stress.maxErrorRate === undefined || stress.maxErrorRate === null || stress.maxErrorRate === '' ? DEFAULTS.maxErrorRate : Number(stress.maxErrorRate);
  if (!Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate > 100) throw invalid('The error limit must be a percentage from 0 to 100.');
  const maxP95Ms = whole(stress.maxP95Ms, DEFAULTS.maxP95Ms, LIMITS.minP95Ms, LIMITS.maxP95Ms, `The response time limit must be a whole number of milliseconds from ${LIMITS.minP95Ms} to ${LIMITS.maxP95Ms}.`);

  const steps = Math.ceil((maxUsers - startUsers) / step) + 1;
  const durationSec = steps * stepEverySec;
  if (durationSec > LIMITS.maxDurationSec) {
    throw invalid(`This stress test would take ${durationSec} seconds (${steps} steps of ${stepEverySec} s). The limit is ${LIMITS.maxDurationSec} seconds: add more users per step, lower the max users or shorten the steps.`);
  }
  return { mode, paths, users: maxUsers, durationSec, rampUpSec: 0, thinkMs, account, stress: { startUsers, step, stepEverySec, maxUsers, maxErrorRate: Math.round(maxErrorRate * 10) / 10, maxP95Ms, steps } };
}

/** Users during each stress step: start, start + step, … capped at max. */
function stressSteps({ startUsers, step, maxUsers, steps }) {
  return Array.from({ length: steps }, (_, index) => Math.min(maxUsers, startUsers + index * step));
}

/**
 * Pages to suggest for a load test: "/" plus the pages the newest smoke check of this app and environment
 * visited (same origin only). `fromRun` is that test cycle, or null when there is none yet.
 */
function suggestedPaths(appId, envId) {
  const app = store.getApp(appId);
  const environment = store.getEnvironment(app, envId);
  const paths = ['/'];
  let fromRun = null;
  for (const run of store.listRuns(appId)) {
    if (run.kind !== 'cycle' || run.environment?.id !== envId || run.status === 'running') continue;
    const pages = store.readSummary(run.id).smoke?.pages;
    if (!Array.isArray(pages) || pages.length === 0) continue;
    fromRun = run.id;
    for (const page of pages) {
      try {
        const url = new URL(String(page.url));
        if (url.origin === new URL(environment.baseUrl).origin) paths.push(cleanPath(`${url.pathname}${url.search}`, environment.baseUrl));
      } catch {
        // Not a page of this app (or not a URL); not suggested.
      }
    }
    break;
  }
  return { paths: [...new Set(paths)].slice(0, 30), fromRun };
}

module.exports = { LIMITS, DEFAULTS, checkPlan, cleanPath, stressSteps, suggestedPaths };

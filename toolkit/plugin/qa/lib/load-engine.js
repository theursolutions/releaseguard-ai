// The load engine: virtual users that each loop over the chosen pages (round robin, with a pause between
// pages) and send plain GET requests over keep-alive connections. Node built-ins only.
//   load:   `users` users for `durationSec`, started evenly over `rampUpSec`
//   stress: start users, more users every step, until a stop condition holds for a whole step or max users
// Redirects are not followed (they are counted apart); a redirect to the login page means the session was
// lost. Every request times out after 10 s. Stopping aborts every request at once.
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const { LIMITS, checkPlan, stressSteps } = require('./load-plan');

const MAX_LATENCY_MS = LIMITS.requestTimeoutMs;
const round1 = (value) => Math.round(value * 10) / 10;

/** Response times to the millisecond (up to the 10 s timeout), so percentiles stay exact at any volume. */
class Histogram {
  constructor() {
    this.counts = new Uint32Array(MAX_LATENCY_MS + 1);
    this.n = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = 0;
  }

  add(ms) {
    const value = Math.max(0, Math.min(MAX_LATENCY_MS, Math.round(ms)));
    this.counts[value] += 1;
    this.n += 1;
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
  }

  /** Nearest-rank percentile, or null without samples. */
  percentile(p) {
    if (!this.n) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * this.n));
    let seen = 0;
    for (let ms = 0; ms < this.counts.length; ms += 1) {
      seen += this.counts[ms];
      if (seen >= rank) return ms;
    }
    return this.max;
  }

  summary() {
    return { p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99), min: this.n ? this.min : null, max: this.n ? this.max : null, avg: this.n ? Math.round(this.sum / this.n) : null };
  }
}

/** Nearest-rank percentile of a small list (one second, one step). */
function percentileOf(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);
}

/** The cookies of a logged-in browser that belong to the app's host, as name → value. */
function cookieJar(cookies, baseUrl) {
  const host = new URL(baseUrl).hostname.toLowerCase();
  const jar = new Map();
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue;
    const domain = String(cookie.domain || host).replace(/^\./, '').toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (Number(cookie.expires) > 0 && Number(cookie.expires) * 1000 < Date.now()) continue;
    jar.set(cookie.name, cookie.value);
  }
  return jar;
}

/** Keeps a virtual user's cookies current, as a browser would (apps often renew their session cookie). */
function applySetCookie(jar, headers) {
  for (const line of Array.isArray(headers) ? headers : []) {
    const [pair, ...attributes] = String(line).split(';');
    const equals = pair.indexOf('=');
    if (equals < 1) continue;
    const name = pair.slice(0, equals).trim();
    const expired = attributes.some((attribute) => {
      const [key, value = ''] = attribute.split('=').map((part) => part.trim());
      if (/^max-age$/i.test(key)) return Number(value) <= 0;
      if (/^expires$/i.test(key)) return Date.parse(value) < Date.now();
      return false;
    });
    if (expired) jar.delete(name);
    else jar.set(name, pair.slice(equals + 1).trim());
  }
}

function errorKind(error) {
  switch (error?.code) {
    case 'DEVCREW_TIMEOUT':
      return `Timed out after ${LIMITS.requestTimeoutMs / 1000} s`;
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'Connection dropped';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Server not found';
    default:
      return 'Network error';
  }
}

const pathOf = (value) => (value.replace(/\/+$/, '') || '/').toLowerCase();

/**
 * Runs one load or stress test and resolves its result. The plan is checked again here, so the limits hold
 * even if a caller skipped the route. onSecond(point) is called once per completed second; onStep(step) when a
 * stress step starts. Aborting `signal` stops everything at once and the result covers what ran so far.
 */
async function runLoad({ environment, plan: input, cookies = [], signal, onSecond = () => {}, onStep = () => {} }) {
  const plan = checkPlan(input, environment);

  const base = new URL(environment.baseUrl);
  const secure = base.protocol === 'https:';
  const lib = secure ? https : http;
  // Test environments often use self-signed certificates; production never gets here.
  const agent = new lib.Agent({ keepAlive: true, maxSockets: plan.users + 5, ...(secure ? { rejectUnauthorized: false } : {}) });
  const loginPath = pathOf(new URL(environment.loginPath || '/login', base).pathname);
  const seedJar = cookieJar(cookies, environment.baseUrl);
  const targets = plan.paths.map((item) => ({ path: item, url: new URL(item, base), histogram: new Histogram(), requests: 0, errors: 0, redirects: 0, statuses: new Map() }));

  const total = { histogram: new Histogram(), requests: 0, errors: 0, redirects: 0, loginRedirects: 0, kinds: new Map() };
  const seconds = new Map(); // second index → { requests, errors, latencies }
  const timeline = [];
  const users = [];
  const inFlight = new Map(); // request → start time
  const waits = new Set();
  const timers = new Set();
  let stepStats = { requests: 0, errors: 0, latencies: [] };
  const steps = [];
  let breakingPoint = null;
  let stopped = false;
  let finished = false;
  let emitted = 0;
  let unfinished = 0;
  // Running totals of the reported seconds, so each point's totals match the seconds shown up to it.
  const reported = { requests: 0, errors: 0 };
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  let resolveDone;
  const done = new Promise((resolve) => (resolveDone = resolve));

  const elapsed = () => performance.now() - t0;
  const activeUsers = () => users.filter((user) => user.active).length;
  const later = (ms, fn) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  const pause = (ms) =>
    new Promise((resolve) => {
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        waits.delete(entry);
        resolve();
      }, ms);
      waits.add(entry);
    });

  function record(target, outcome, startedMs) {
    if (finished) return;
    const latency = outcome.latency;
    const bucket = Math.floor((startedMs + latency) / 1000);
    if (!seconds.has(bucket)) seconds.set(bucket, { requests: 0, errors: 0, latencies: [] });
    const second = seconds.get(bucket);
    second.requests += 1;
    total.requests += 1;
    target.requests += 1;
    stepStats.requests += 1;
    if (outcome.status) target.statuses.set(outcome.status, (target.statuses.get(outcome.status) || 0) + 1);
    if (outcome.timedLatency) {
      total.histogram.add(latency);
      target.histogram.add(latency);
      second.latencies.push(latency);
      stepStats.latencies.push(latency);
    }
    if (outcome.error) {
      second.errors += 1;
      total.errors += 1;
      target.errors += 1;
      stepStats.errors += 1;
      total.kinds.set(outcome.error, (total.kinds.get(outcome.error) || 0) + 1);
    } else if (outcome.status >= 300 && outcome.status < 400) {
      total.redirects += 1;
      target.redirects += 1;
      if (outcome.toLogin) total.loginRedirects += 1;
    }
  }

  function request(user, target) {
    return new Promise((resolve) => {
      const startedMs = elapsed();
      const headers = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'User-Agent': 'devcrew-qa-load/1' };
      if (user.jar.size) headers.Cookie = [...user.jar].map(([name, value]) => `${name}=${value}`).join('; ');
      let settled = false;
      let timedOut = false;
      let timer = null;
      // Once the timeout fires, whatever error follows (request or response side) is reported as the timeout.
      const failed = (error) => {
        if (stopped) return { aborted: true };
        if (timedOut) return { error: errorKind({ code: 'DEVCREW_TIMEOUT' }), timedLatency: true };
        return { error: errorKind(error) };
      };
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inFlight.delete(req);
        if (!outcome.aborted) record(target, { ...outcome, latency: elapsed() - startedMs }, startedMs);
        resolve();
      };
      const req = lib.request(target.url, { method: 'GET', agent, headers }, (res) => {
        applySetCookie(user.jar, res.headers['set-cookie']);
        let toLogin = false;
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try {
            toLogin = pathOf(new URL(res.headers.location, target.url).pathname) === loginPath;
          } catch {
            toLogin = false;
          }
        }
        // The whole body is read: a response counts when it has fully arrived, as it would in a browser.
        res.on('data', () => {});
        res.on('end', () => settle({ status: res.statusCode, error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null, toLogin, timedLatency: true }));
        res.on('error', (error) => settle(failed(error)));
        res.on('aborted', () => settle(failed({ code: 'ECONNRESET' })));
      });
      req.on('error', (error) => settle(failed(error)));
      timer = setTimeout(() => {
        timedOut = true;
        req.destroy(new Error('timeout'));
      }, LIMITS.requestTimeoutMs);
      inFlight.set(req, startedMs);
      req.end();
    });
  }

  async function userLoop(user) {
    let index = user.index;
    while (user.active && !stopped) {
      await request(user, targets[index % targets.length]);
      index += 1;
      if (plan.thinkMs > 0 && user.active && !stopped) await pause(plan.thinkMs);
      // Without a pause, give the event loop a turn so timers (the per-second points) stay on time.
      else await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function addUsers(count) {
    for (let i = 0; i < count && !stopped; i += 1) {
      const user = { index: users.length, active: true, jar: new Map(seedJar), joinedMs: elapsed() };
      users.push(user);
      userLoop(user);
    }
  }

  function emitSecond(index) {
    const second = seconds.get(index) || { requests: 0, errors: 0, latencies: [] };
    seconds.delete(index);
    reported.requests += second.requests;
    reported.errors += second.errors;
    const end = (index + 1) * 1000;
    const point = {
      t: index + 1,
      users: users.filter((user) => user.joinedMs < end).length,
      rps: second.requests,
      p50: percentileOf(second.latencies, 50),
      p95: percentileOf(second.latencies, 95),
      errorRate: second.requests ? round1((second.errors / second.requests) * 100) : 0,
      errors: second.errors,
      requests: reported.requests,
      totalErrors: reported.errors,
    };
    timeline.push({ t: point.t, users: point.users, rps: point.rps, p50: point.p50, p95: point.p95, errorRate: point.errorRate, errors: point.errors });
    try {
      onSecond(point);
    } catch {
      // A listener problem never stops the test.
    }
  }

  function tick() {
    if (finished) return;
    const due = Math.floor(elapsed() / 1000);
    while (emitted < due && emitted < plan.durationSec) emitSecond(emitted++);
    later((emitted + 1) * 1000 - elapsed(), tick);
  }

  /** A stress step is judged on everything it measured, plus requests still waiting longer than the limit. */
  function judgeStep(users) {
    const limit = plan.stress;
    const now = elapsed();
    const slowWaiting = [...inFlight.values()].map((start) => now - start).filter((age) => age > limit.maxP95Ms);
    const latencies = [...stepStats.latencies, ...slowWaiting];
    const errorRate = stepStats.requests ? round1((stepStats.errors / stepStats.requests) * 100) : 0;
    const p95 = percentileOf(latencies, 95);
    const step = { users, requests: stepStats.requests, errors: stepStats.errors, errorRate, p95, p50: percentileOf(latencies, 50), waiting: slowWaiting.length, broke: null };
    if (stepStats.requests > 0 && errorRate > limit.maxErrorRate) step.broke = { condition: 'errorRate', value: errorRate, limit: limit.maxErrorRate };
    else if (p95 !== null && p95 > limit.maxP95Ms) step.broke = { condition: 'p95', value: p95, limit: limit.maxP95Ms };
    stepStats = { requests: 0, errors: 0, latencies: [] };
    return step;
  }

  function runStress() {
    const levels = stressSteps(plan.stress);
    const stepMs = plan.stress.stepEverySec * 1000;
    const startStep = (index) => {
      if (stopped) return;
      const wanted = levels[index];
      addUsers(wanted - activeUsers());
      try {
        onStep({ index, of: levels.length, users: wanted });
      } catch {
        // A listener problem never stops the test.
      }
      later((index + 1) * stepMs - elapsed(), () => {
        const step = { ...judgeStep(wanted), startT: index * plan.stress.stepEverySec, endT: (index + 1) * plan.stress.stepEverySec };
        steps.push(step);
        if (step.broke) {
          breakingPoint = { users: wanted, ...step.broke, waiting: step.waiting };
          return finish(false);
        }
        if (index + 1 >= levels.length) return finish(false);
        return startStep(index + 1);
      });
    };
    startStep(0);
  }

  function runSteadyLoad() {
    if (plan.rampUpSec > 0) {
      // Users join evenly over the ramp-up: the first at once, the last when the ramp-up ends.
      const gap = (plan.rampUpSec * 1000) / plan.users;
      for (let i = 0; i < plan.users; i += 1) later(i * gap, () => addUsers(1));
    } else {
      addUsers(plan.users);
    }
    later(plan.durationSec * 1000, () => finish(false));
  }

  function finish(byStop) {
    if (finished) return;
    // Complete seconds that have not been reported yet are reported first; a partial last second is not.
    const due = Math.min(Math.floor(elapsed() / 1000), plan.durationSec);
    while (emitted < due) emitSecond(emitted++);
    finished = true;
    stopped = true;
    // Requests still waiting now are aborted and not counted; the report says how many there were.
    unfinished = inFlight.size;
    for (const timer of timers) clearTimeout(timer);
    for (const entry of waits) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
    for (const user of users) user.active = false;
    for (const req of inFlight.keys()) req.destroy();
    agent.destroy();
    resolveDone({ byStop, elapsedMs: elapsed() });
  }

  const onAbort = () => finish(true);
  if (signal?.aborted) finish(true);
  else signal?.addEventListener('abort', onAbort, { once: true });
  if (!finished) {
    later(1000, tick);
    if (plan.mode === 'stress') runStress();
    else runSteadyLoad();
  }

  const { byStop, elapsedMs } = await done;
  signal?.removeEventListener('abort', onAbort);
  const durationSec = round1(elapsedMs / 1000);
  const latency = total.histogram.summary();
  const heldUpTo = plan.mode === 'stress' ? [...steps].reverse().find((step) => !step.broke)?.users ?? null : null;
  return {
    mode: plan.mode,
    plan,
    startedAt,
    stopped: byStop,
    durationSec,
    totals: {
      requests: total.requests,
      errors: total.errors,
      errorRate: total.requests ? round1((total.errors / total.requests) * 100) : 0,
      redirects: total.redirects,
      loginRedirects: total.loginRedirects,
      unfinished,
      avgRps: durationSec > 0 ? round1(total.requests / durationSec) : 0,
      peakUsers: users.length,
      ...latency,
    },
    pages: targets.map((target) => ({
      path: target.path,
      requests: target.requests,
      errors: target.errors,
      errorRate: target.requests ? round1((target.errors / target.requests) * 100) : 0,
      redirects: target.redirects,
      ...target.histogram.summary(),
      statuses: Object.fromEntries([...target.statuses].sort((a, b) => a[0] - b[0])),
    })),
    errorKinds: [...total.kinds].sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count })),
    timeline,
    steps,
    breakingPoint,
    heldUpTo,
  };
}

module.exports = { runLoad, Histogram, percentileOf, cookieJar, applySetCookie };

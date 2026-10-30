#!/usr/bin/env node
// One load or stress test, started by the office server as its own process:  node load-runner.js <runId>
// Phases: setup (logs in when an account is chosen) → load (virtual users, see lib/load-engine.js) → report.
// Progress goes to the QA page (/qa/events: run events, and one "load" point per second) and to the 3D
// office (/events, as the regression tester). The office stops a test with an IPC "stop" message: every
// request is aborted at once and the report covers what ran until then.
const path = require('path');
const config = require('../office/lib/config');
const store = require('./lib/store');
const { runDir } = require('./lib/paths');
const { ensureRuntime, runtimeEnv } = require('./lib/runtime');
const { loginInChild, redact } = require('./lib/login');
const { postOffice, postQa, runEvent } = require('./lib/events');
const { DEFAULTS, checkPlan } = require('./lib/load-plan');
const { runLoad } = require('./lib/load-engine');

const OFFICE_EVERY_SEC = 2;
const modeLabel = (mode) => (mode === 'stress' ? 'Stress test' : 'Load test');
const ms = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The plan as the report shows it: the account's label only. */
function publicPlan(plan, account) {
  const { paths, users, durationSec, rampUpSec, thinkMs, stress } = plan;
  return { paths, users, durationSec, rampUpSec, thinkMs, ...(stress ? { stress } : {}), account: account ? account.label : null };
}

/** A plain-language verdict: tone (pass, warn, fail, neutral), a headline and one or two sentences. */
function verdictOf(result, plan) {
  const { totals } = result;
  const users = totals.peakUsers;
  if (result.stopped) {
    return { tone: 'neutral', headline: `Stopped after ${Math.round(result.durationSec)} s`, detail: totals.requests ? `${plural(totals.requests, 'request')} were sent before it was stopped, with up to ${plural(users, 'user')}.` : 'It was stopped before any request was sent.' };
  }
  if (!totals.requests) {
    return { tone: 'fail', headline: 'No request got an answer', detail: 'Check that the app is running and that the environment\'s web address is right.' };
  }

  const loginShare = totals.loginRedirects / totals.requests;
  const sessionNote = totals.loginRedirects
    ? plan.account
      ? `${plural(totals.loginRedirects, 'request')} were sent to the login page: the login session was lost during the test.`
      : `${plural(totals.loginRedirects, 'request')} were sent to the login page: these pages need a login. Choose an account under "Logged in as".`
    : '';
  const withSession = (verdict) => {
    if (!sessionNote) return verdict;
    if (loginShare > 0.5) return { tone: 'fail', headline: plan.account ? 'The login session was lost' : 'These pages need a login', detail: sessionNote };
    return { tone: verdict.tone === 'pass' ? 'warn' : verdict.tone, headline: verdict.headline, detail: `${verdict.detail} ${sessionNote}` };
  };

  if (plan.mode === 'stress') {
    const limits = plan.stress;
    const point = result.breakingPoint;
    if (point) {
      const why = point.condition === 'errorRate'
        ? `${point.value}% of requests failed during that step (the limit is ${limits.maxErrorRate}%).`
        : `1 in 20 requests took longer than ${ms(point.value)} during that step (the limit is ${ms(limits.maxP95Ms)})${point.waiting ? `, counting ${plural(point.waiting, 'request')} still waiting for an answer when the step ended` : ''}.`;
      const held = result.heldUpTo ? ` It held up to ${plural(result.heldUpTo, 'user')}.` : ' It broke at the first step.';
      return withSession({ tone: 'fail', headline: `Broke at ${plural(point.users, 'user')}`, detail: `${why}${held}` });
    }
    return withSession({ tone: 'pass', headline: `Held up to ${plural(limits.maxUsers, 'user')}`, detail: `At every step, no more than ${limits.maxErrorRate}% of requests failed and 95% answered within ${ms(limits.maxP95Ms)}.` });
  }

  const common = result.errorKinds[0];
  if (totals.errorRate > DEFAULTS.maxErrorRate) {
    return withSession({ tone: 'fail', headline: `${totals.errorRate}% of requests failed`, detail: `With ${plural(users, 'user')}, ${totals.errors} of ${totals.requests} requests failed${common ? ` (most often: ${common.kind})` : ''}.` });
  }
  if (totals.p95 > DEFAULTS.maxP95Ms) {
    return withSession({ tone: 'warn', headline: 'Slow under load', detail: `With ${plural(users, 'user')}, 1 in 20 requests took longer than ${ms(totals.p95)}.` });
  }
  const errors = totals.errors ? `, ${plural(totals.errors, 'error')} (${totals.errorRate}%)` : ', no errors';
  return withSession({ tone: 'pass', headline: `Handled ${plural(users, 'user')} well`, detail: `${totals.avgRps} requests a second; 95% answered within ${ms(totals.p95)}${errors}.` });
}

/** The summary's `load` part, from the engine's result. */
function loadReport(result, plan, account) {
  const verdict = verdictOf(result, plan);
  const { totals } = result;
  return {
    mode: plan.mode,
    plan: publicPlan(plan, account),
    thresholds: plan.stress ? { maxErrorRate: plan.stress.maxErrorRate, maxP95Ms: plan.stress.maxP95Ms } : { maxErrorRate: DEFAULTS.maxErrorRate, maxP95Ms: DEFAULTS.maxP95Ms },
    stopped: result.stopped,
    durationSec: result.durationSec,
    totals,
    pages: result.pages,
    errorKinds: result.errorKinds,
    timeline: result.timeline,
    steps: result.steps,
    breakingPoint: result.breakingPoint,
    heldUpTo: result.heldUpTo,
    sessionLost: totals.loginRedirects > 0,
    verdict,
    brief: { mode: plan.mode, users: totals.peakUsers, rps: totals.avgRps, p95: totals.p95, errorRate: totals.errorRate, breakingPoint: result.breakingPoint?.users ?? null, heldUpTo: result.heldUpTo, tone: verdict.tone, headline: verdict.headline },
  };
}

function statusOf(result, verdict) {
  if (result.stopped) return 'stopped';
  return verdict.tone === 'pass' ? 'passed' : 'failed';
}

async function main(runId, controller) {
  const options = store.readJson(path.join(runDir(runId), 'run.json'), null);
  if (!options) throw new Error('The test settings are missing.');
  const app = store.getApp(options.app);
  const environment = store.getEnvironment(app, options.environment);
  const plan = checkPlan(options.plan, environment);
  const label = modeLabel(plan.mode);
  const project = `QA · ${app.name} · ${environment.name} · ${label}`;
  const office = (event) => postOffice({ session: runId, project, agentId: 'main', agentType: 'router', ...event });
  const tester = { agentId: 'load', agentType: 'regression-tester' };
  let summary = store.readSummary(runId);

  let account = null;
  if (plan.account) {
    account = store.accountsFor(app.id, environment.id).find((item) => item.id === plan.account) || null;
    if (!account) throw new Error('The chosen test account no longer exists. Choose another one.');
  }
  const clean = (message) => (account ? redact(message, account) : String(message));
  const update = async (changes, message = '') => {
    summary = { ...summary, ...changes };
    store.writeSummary(summary);
    await postQa(runEvent(summary, clean(message)));
  };

  await office({ kind: 'session.start' });
  await office({ kind: 'request', text: label });

  // 1. setup
  let cookies = [];
  await update({ phase: 'setup' }, account ? `Logging in as ${account.label}` : 'Getting ready');
  if (account) {
    await ensureRuntime((message) => update({ phase: 'setup' }, message));
    if (controller.signal.aborted) return finishStopped();
    const login = await loginInChild(account, environment, { env: runtimeEnv({ DEVCREW_HOME: config.dataDir() }) });
    if (!login.ok) throw new Error(clean(login.message || `Login failed for ${account.label}.`));
    cookies = login.storageState?.cookies || [];
  }
  if (controller.signal.aborted) return finishStopped();

  // 2. load
  const startMessage = plan.mode === 'stress'
    ? `Starting with ${plural(plan.stress.startUsers, 'user')}, up to ${plan.stress.maxUsers}`
    : `${plural(plan.users, 'user')} for ${plan.durationSec} s${plan.rampUpSec ? `, joining over ${plan.rampUpSec} s` : ''}`;
  await update({ phase: 'load' }, startMessage);
  await office({ kind: 'agent.start', ...tester });
  await office({ kind: 'tool', ...tester, tool: 'LoadTest', text: `${label}: ${startMessage}` });

  const result = await runLoad({
    environment,
    plan,
    cookies,
    signal: controller.signal,
    onSecond: (point) => {
      postQa({ type: 'load', runId, t: point.t, users: point.users, rps: point.rps, p50: point.p50, p95: point.p95, errorRate: point.errorRate, requests: point.requests, errors: point.totalErrors });
      if (point.t % OFFICE_EVERY_SEC === 0) {
        const speed = point.p95 === null ? 'waiting for answers' : `p95 ${point.p95} ms`;
        office({ kind: 'tool', ...tester, tool: 'LoadTest', text: `${label}: ${plural(point.users, 'user')} · ${point.rps} req/s · ${speed}` });
      }
    },
    onStep: (step) => {
      update({ phase: 'load' }, `Step ${step.index + 1} of ${step.of}: ${plural(step.users, 'user')}`);
    },
  });

  // 3. report
  const load = loadReport(result, plan, account);
  const status = statusOf(result, load.verdict);
  if (!result.stopped) await update({ phase: 'report' }, 'Writing the report');
  await update({ load, status, finishedAt: new Date().toISOString() }, load.verdict.headline);
  await office({ kind: 'agent.stop', ...tester });
  await office({ kind: 'session.end' });
  store.pruneRuns(app.id);

  async function finishStopped() {
    await update({ status: 'stopped', finishedAt: new Date().toISOString(), load: { ...summary.load, stopped: true, verdict: { tone: 'neutral', headline: 'Stopped before it started', detail: 'No request was sent.' } } }, 'Stopped');
    await office({ kind: 'session.end' });
  }
}

if (require.main === module) {
  const runId = process.argv[2];
  const controller = new AbortController();
  process.on('message', (message) => {
    if (message && message.type === 'stop') controller.abort();
  });
  main(runId, controller)
    .catch(async (error) => {
      try {
        const summary = { ...store.readSummary(runId), status: 'error', finishedAt: new Date().toISOString(), error: String(error.message).slice(0, 1000) };
        store.writeSummary(summary);
        await postQa(runEvent(summary, summary.error));
        await postOffice({ kind: 'session.end', session: runId, project: 'QA', agentId: 'main', agentType: 'router' });
      } catch {
        // Nothing more can be reported; the route marks the test as stopped unexpectedly.
      }
      process.exitCode = 1;
    })
    .finally(() => {
      // The IPC channel would keep this process alive.
      if (process.connected) process.disconnect();
    });
}

module.exports = { verdictOf, loadReport, publicPlan, statusOf };

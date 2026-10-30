#!/usr/bin/env node
// One QA test cycle, started by the office server as its own process:  node runner.js <runId>
// Phases: setup (runtime + fixture) → test (already learned cases, Playwright) → prepare (new/edited cases,
// by Claude Code) → retest (the newly learned cases) → analyse (the root cause of each failure, by Claude
// Code) → report. Learned cases go first so their results show in minutes, not after all the learning.
// Progress goes to the QA page (/qa/events) and the 3D office (/events). The route stops a run by killing
// this process tree and writes the "stopped" summary itself.
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const { runDir, casesDir, libDir } = require('./lib/paths');
const { ensureRuntime } = require('./lib/runtime');
const { compareRuns, isFailing } = require('./lib/compare');
const { postOffice, postQa, runEvent } = require('./lib/events');
const { installLib, testEnv, writeConfig, runPlaywright, resultsOf, stripAnsi, redactSecrets } = require('./lib/playwright-run');
const { buildDiagnosis } = require('./lib/diagnose');
const { prepareCase } = require('./prepare');
const { analyseCase, planAnalysis, MAX_CASES: MAX_ANALYSED, IN_PARALLEL: ANALYSE_IN_PARALLEL } = require('./analyse');

const DEFAULT_LEARN_PARALLEL = 4;

/** The cases a run includes: matching tags (any), and only "readonly" cases on production. */
function selectCases(cases, environment, tags = []) {
  return cases.filter((item) => {
    if (environment.kind === 'production' && !item.tags.includes('readonly')) return false;
    return tags.length === 0 || tags.some((tag) => item.tags.includes(tag));
  });
}

/** What a run expects to do: cases to prepare, and tests to run (cases that can be prepared, plus the smoke check). */
function totalsFor(appId, cases, smokeCount) {
  return {
    toPrepare: cases.filter((item) => store.needsPreparing(appId, item)).length,
    toRun: cases.filter((item) => item.status !== 'failed').length + smokeCount,
  };
}

/** Runs tasks with at most `limit` at the same time. */
async function inParallel(items, limit, task) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await task(queue.shift());
  });
  await Promise.all(workers);
}

const fileUrl = (runId, file) => {
  const relative = path.relative(runDir(runId), file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return `/api/qa/runs/${runId}/files/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
};

const attachmentJson = (result, name) => {
  const attachment = (result.attachments || []).find((item) => item.name === name && item.body);
  if (!attachment) return null;
  try {
    return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const attachmentText = (result, name) => {
  const attachment = (result?.attachments || []).find((item) => item.name === name && item.body);
  return attachment ? Buffer.from(attachment.body, 'base64').toString('utf8') : '';
};

/**
 * Turns Playwright's JSON report into the run summary's cases, smoke and performance parts. A failed case
 * gets a diagnosis (lib/diagnose.js). snapshots (case id → the page's accessibility snapshot at the failure)
 * are for the analysis only and are not saved in the summary.
 */
function readResults({ report, runId, selected, notPrepared, accounts, smoke, performance, environment, specOf = () => '' }) {
  // A cycle has up to two Playwright passes (learned cases, then newly learned ones).
  const results = [].concat(report || []).flatMap(resultsOf);
  const byCase = new Map(results.filter((entry) => entry.file.endsWith('.spec.ts')).map((entry) => [entry.file.replace(/\.spec\.ts$/, ''), entry.result]));
  const smokeResult = results.find((entry) => entry.file === 'smoke.spec.js')?.result;
  const clean = (text) => redactSecrets(stripAnsi(text), accounts).slice(0, 1500);
  const snapshots = new Map();
  const diagnosisOf = (id, result, specSource) => {
    if (!environment || !isFailing(result?.status)) return {};
    snapshots.set(id, attachmentText(result, 'devcrew-snapshot'));
    return { diagnosis: buildDiagnosis({ result, environment, accounts, specSource, diagnostics: attachmentJson(result, 'devcrew-diagnostics'), clean }) };
  };

  const cases = selected.map((item) => {
    if (notPrepared.has(item.id)) return { id: item.id, title: item.title, status: 'notPrepared', durationMs: 0, error: item.prepError || 'Not prepared', attachments: {} };
    const result = byCase.get(item.id);
    if (!result) return { id: item.id, title: item.title, status: 'skipped', durationMs: 0, error: 'Did not run', attachments: {} };
    const attachments = {};
    for (const name of ['screenshot', 'video', 'trace']) {
      const found = (result.attachments || []).find((attachment) => attachment.name === name && attachment.path);
      const url = found && fileUrl(runId, found.path);
      if (url) attachments[name] = url;
    }
    const status = result.status;
    return { id: item.id, title: item.title, status, durationMs: result.duration || 0, error: isFailing(status) ? clean(result.error?.message || `Test ${result.status}`) : null, attachments, ...diagnosisOf(item.id, result, specOf(item.id)) };
  });

  const smokeData = smoke && smokeResult ? attachmentJson(smokeResult, 'devcrew-smoke') : null;
  // The smoke check is reported like a case too, so it shows in the case list and the counts.
  if (smoke) {
    const status = smokeResult?.status || 'skipped';
    const attachments = {};
    for (const name of ['screenshot', 'video', 'trace']) {
      const found = (smokeResult?.attachments || []).find((attachment) => attachment.name === name && attachment.path);
      const url = found && fileUrl(runId, found.path);
      if (url) attachments[name] = url;
    }
    cases.push({ id: 'smoke', title: 'Smoke check', status, durationMs: smokeResult?.duration || 0, error: isFailing(status) ? clean(smokeResult.error?.message || `Test ${status}`) : smokeResult ? null : 'Did not run', attachments, ...diagnosisOf('smoke', smokeResult, '') });
  }
  const smokeSummary = smoke ? { pages: smokeData?.pages || [], ...(smokeResult && !smokeData ? { error: clean(smokeResult.error?.message || 'The smoke check did not finish') } : {}) } : null;

  let speed = [];
  if (performance) {
    const measured = [...results.filter((entry) => entry.file.endsWith('.spec.ts')).flatMap((entry) => attachmentJson(entry.result, 'devcrew-perf') || []), ...(smokeData?.performance || [])];
    const byUrl = new Map(measured.filter((entry) => entry && entry.url).map((entry) => [entry.url, entry]));
    speed = [...byUrl.values()].slice(0, 100).map(({ url, ttfb, fcp, lcp, cls, load }) => ({ url, ttfb, fcp, lcp, cls, load }));
  }
  return { cases, smoke: smokeSummary, performance: speed, snapshots };
}

function countsOf(cases) {
  const count = (status) => cases.filter((item) => item.status === status).length;
  return { passed: count('passed'), failed: cases.filter((item) => isFailing(item.status)).length, skipped: count('skipped'), notPrepared: count('notPrepared') };
}

async function main(runId) {
  const options = store.readJson(path.join(runDir(runId), 'run.json'), null);
  if (!options) throw new Error('The run settings are missing.');
  const app = store.getApp(options.app);
  const environment = store.getEnvironment(app, options.environment);
  const accounts = store.accountsFor(app.id, environment.id);
  const project = `QA · ${app.name} · ${environment.name}`;
  const office = (event) => postOffice({ session: runId, project, agentId: 'main', agentType: 'router', ...event });
  let summary = store.readSummary(runId);

  const update = async (changes, message = '') => {
    summary = { ...summary, ...changes };
    store.writeSummary(summary);
    await postQa(runEvent(summary, redactSecrets(message, accounts)));
  };

  await office({ kind: 'session.start' });
  await office({ kind: 'request', text: 'QA test cycle' });

  // 1. setup
  await update({ phase: 'setup' }, 'Getting the test browser ready');
  await ensureRuntime((message) => update({ phase: 'setup' }, message));
  installLib();

  const selected = selectCases(store.listCases(app.id), environment, options.tags || []);
  const toPrepare = selected.filter((item) => store.needsPreparing(app.id, item));
  const learned = selected.filter((item) => item.status === 'ready' && !toPrepare.includes(item));
  const smokeCount = options.smoke ? 1 : 0;
  summary.totals = totalsFor(app.id, selected, smokeCount);
  const reports = [];
  const specOf = (caseId) => {
    try {
      return fs.readFileSync(store.specFile(app.id, caseId), 'utf8');
    } catch {
      return '';
    }
  };

  /**
   * One Playwright pass. The first pass uses the run's main folders (the HTML report link points there); a
   * second pass gets its own, because Playwright empties its output folders when it starts.
   */
  async function testPass(items, withSmoke) {
    const projects = [];
    if (items.length) projects.push({ name: 'cases', testDir: casesDir(app.id), files: items.map((item) => `${item.id}.spec.ts`) });
    if (withSmoke) projects.push({ name: 'smoke', testDir: libDir(), files: ['smoke.spec.js'] });
    if (!projects.length) return;
    const dir = runDir(runId);
    const sub = reports.length === 0 ? [] : ['second-pass'];
    const resultsFile = path.join(dir, ...sub, 'results.json');
    const configFile = writeConfig(path.join(dir, ...sub), {
      projects,
      workers: options.parallel,
      outputDir: path.join(dir, 'artifacts', ...sub),
      reporter: [['json', { outputFile: resultsFile }], ['html', { outputFolder: path.join(dir, 'report', ...sub), open: 'never' }], [path.join(libDir(), 'devcrew-reporter.js')]],
    });
    const { done } = await runPlaywright(configFile, testEnv({ runId, app, environment, accounts, video: true }));
    const { output } = await done;
    const report = store.readJson(resultsFile, null);
    if (!report) throw new Error(`Playwright did not produce a report. It said: ${redactSecrets(stripAnsi(output), accounts).slice(-600)}`);
    reports.push(report);
  }

  // 2. test the cases that are already learned, and the smoke check
  if (learned.length || options.smoke) {
    await update({ phase: 'test' }, `Testing ${learned.length} learned case${learned.length === 1 ? '' : 's'}${options.smoke ? ' and the smoke check' : ''}`);
    await testPass(learned, Boolean(options.smoke));
    if (toPrepare.length) {
      // Saved now, so a run stopped while learning still reports these results.
      const { snapshots: _snapshots, ...firstResults } = readResults({ report: reports, runId, selected: learned, notPrepared: new Set(), accounts, smoke: Boolean(options.smoke), performance: options.performance !== false, environment, specOf });
      summary = { ...summary, ...firstResults, counts: countsOf(firstResults.cases) };
      store.writeSummary(summary);
    }
  }

  // 3. prepare: learn the new and edited cases
  if (toPrepare.length) {
    await update({ phase: 'prepare' }, `Learning ${toPrepare.length} new case${toPrepare.length === 1 ? '' : 's'}`);
    await inParallel(toPrepare, options.learnParallel || DEFAULT_LEARN_PARALLEL, async (item) => {
      const agent = { agentId: `prep-${item.id}`, agentType: 'qa-automation' };
      await office({ kind: 'agent.start', ...agent });
      await office({ kind: 'tool', ...agent, tool: 'Claude', text: `Preparing ${item.title}` });
      await prepareCase({
        appId: app.id,
        envId: environment.id,
        caseId: item.id,
        runId,
        model: options.learnModel || 'fast',
        onEvent: (event) => {
          postQa(event);
          if (event.status === 'preparing') office({ kind: 'tool', ...agent, tool: 'Claude', text: `${event.message}: ${item.title}` });
        },
      }).catch((error) => store.setCase(app.id, item.id, { status: 'failed', prepError: `Preparing failed: ${error.message}`, prepReason: 'setup' }));
      await office({ kind: 'agent.stop', ...agent });
    });
  }

  // 4. retest: the cases learned in this run
  const current = new Map(store.listCases(app.id).map((item) => [item.id, item]));
  const cases = selected.map((item) => current.get(item.id) || item);
  const isReady = (item) => item.status === 'ready' && fs.existsSync(store.specFile(app.id, item.id));
  const learnedNow = toPrepare.map((item) => current.get(item.id)).filter((item) => item && isReady(item));
  if (learnedNow.length) {
    await update({ phase: 'retest', totals: { toPrepare: toPrepare.length, toRun: learned.length + learnedNow.length + smokeCount } }, `Testing ${learnedNow.length} newly learned case${learnedNow.length === 1 ? '' : 's'}`);
    await testPass(learnedNow, false);
  }
  const ran = new Set([...learned, ...learnedNow].map((item) => item.id));
  const notPrepared = new Set(cases.filter((item) => !ran.has(item.id)).map((item) => item.id));

  const { snapshots, ...results } = readResults({ report: reports, runId, selected: cases, notPrepared, accounts, smoke: Boolean(options.smoke), performance: options.performance !== false, environment, specOf });
  const counts = countsOf(results.cases);
  const previous = store.previousRun(app.id, environment.id, runId);

  // 5. analyse: why each failure happened. The results are saved first, so stopping here keeps them.
  const plan = planAnalysis(results.cases);
  for (const entry of plan.smoke) Object.assign(entry.diagnosis, { analysisStatus: 'skipped', analysisError: 'The smoke check is not investigated by Claude Code. Its table shows each page it visited and what went wrong there.' });
  for (const entry of plan.tooMany) Object.assign(entry.diagnosis, { analysisStatus: 'skipped', analysisError: `Only the first ${MAX_ANALYSED} failures of a test cycle are investigated.` });
  if (plan.now.length) {
    for (const entry of plan.now) entry.diagnosis.analysisStatus = 'pending';
    await update({ phase: 'analyse', ...results, counts }, `Finding the root cause of ${plan.now.length} failure${plan.now.length === 1 ? '' : 's'}`);
    let unavailable = null;
    await inParallel(plan.now, ANALYSE_IN_PARALLEL, async (entry) => {
      // Without Claude Code the other failures are not tried: their deterministic diagnosis still shows.
      if (unavailable) {
        Object.assign(entry.diagnosis, unavailable);
        await postQa({ type: 'analysis', runId, caseId: entry.id, status: 'unavailable', message: unavailable.analysisError });
      } else {
        const agent = { agentId: `why-${entry.id}`, agentType: 'qa-automation' };
        await office({ kind: 'agent.start', ...agent });
        await office({ kind: 'tool', ...agent, tool: 'Claude', text: `Investigating ${entry.title}` });
        const outcome = await analyseCase({
          appId: app.id,
          envId: environment.id,
          runId,
          caseEntry: entry,
          snapshot: snapshots.get(entry.id) || '',
          previousStatus: previous?.cases?.find((item) => item.id === entry.id)?.status,
          onEvent: (event) => {
            postQa(event);
            if (event.status === 'investigating' && event.message !== 'Starting') office({ kind: 'tool', ...agent, tool: 'Claude', text: `${event.message}: ${entry.title}` });
          },
        }).catch((error) => ({ analysisStatus: 'failed', analysis: null, analysisError: redactSecrets(`Finding the root cause failed: ${error.message}`, accounts) }));
        if (outcome.analysisStatus === 'unavailable') unavailable = { analysisStatus: 'unavailable', analysis: null, analysisError: outcome.analysisError };
        Object.assign(entry.diagnosis, outcome);
        await office({ kind: 'agent.stop', ...agent });
      }
      summary = { ...summary, cases: results.cases };
      store.writeSummary(summary);
    });
  }

  // 6. report
  await update({ phase: 'report' }, 'Writing the report');
  const draft = { ...summary, ...results, counts };
  const comparison = compareRuns(previous, draft);
  // A run that verified nothing (every case unprepared) is not a pass.
  const status = counts.failed > 0 || counts.passed === 0 ? 'failed' : 'passed';
  const message = `${counts.passed} passed, ${counts.failed} failed${counts.notPrepared ? `, ${counts.notPrepared} not prepared` : ''}`;
  await update({ ...results, counts, comparison, status, finishedAt: new Date().toISOString() }, message);
  store.pruneRuns(app.id);
  await office({ kind: 'session.end' });
}

if (require.main === module) {
  const runId = process.argv[2];
  main(runId).catch(async (error) => {
    try {
      const summary = { ...store.readSummary(runId), status: 'error', finishedAt: new Date().toISOString(), error: String(error.message).slice(0, 1000) };
      store.writeSummary(summary);
      await postQa(runEvent(summary, summary.error));
      await postOffice({ kind: 'session.end', session: runId, project: 'QA', agentId: 'main', agentType: 'router' });
    } catch {
      // Nothing more can be reported; the route marks the run as stopped unexpectedly.
    }
    process.exitCode = 1;
  });
}

module.exports = { selectCases, readResults, countsOf, inParallel, totalsFor };

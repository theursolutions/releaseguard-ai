#!/usr/bin/env node
// The QA test cycle from a terminal, for /devcrew:qa-run, /devcrew:qa-link and the crew pipeline.
// It talks to the local office over HTTP like the QA page does (the same /api/qa endpoints and page token),
// so it never reads or writes QA files itself and never sees a password.
//
//   node cli.js status [--project <dir>]
//   node cli.js link <appId> [--project <dir>]
//   node cli.js unlink [--project <dir>]
//   node cli.js run [--project <dir>] [--env <id>] [--tag <tag>] [--wait <seconds>]
//   node cli.js wait <runId> [--wait <seconds>]
//   node cli.js prd-rules
//   node cli.js prd-drafts <appId> --file <drafts.json | ->
//
// The project folder defaults to CLAUDE_PROJECT_DIR, else the current folder.
// Exit codes: 0 done (no newly failing cases), 1 newly failing cases, 2 error (the run ended in error or was
// stopped, or the office could not be reached), 3 not ready to run (no linked app, no local environment, no
// cases or accounts, the app is not running), 4 another test is running, 5 still running after --wait.
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const config = require('../office/lib/config');
const { ensureServer, request } = require('../office/lib/client');
const { cleanProjectPath, projectKey } = require('./lib/store');
const { isFailing } = require('./lib/compare');
const { RULES: PRD_RULES, FORMAT: PRD_FORMAT, MAX_PRD_CHARS } = require('./lib/prd-cases');

const EXIT = { ok: 0, newlyFailing: 1, error: 2, notReady: 3, busy: 4, stillRunning: 5 };
const DEFAULT_WAIT_S = 480;
// Claude Code stops a Bash call after 10 minutes, so one call never waits longer than 9.
const MAX_WAIT_S = 540;
const POLL_MS = 3000;
const PHASE_TEXT = {
  setup: 'Getting the test browser ready',
  prepare: 'Learning new or changed cases (Claude Code writes each test once)',
  test: 'Testing the cases that are already learned',
  retest: 'Testing the newly learned cases',
  analyse: 'Finding the root cause of each failure',
  report: 'Writing the report',
};
const CATEGORY = { 'app-bug': 'App bug', 'test-outdated': 'Test needs updating', environment: 'Environment or data', flaky: 'Flaky' };
// Only a refused or unanswered connection means the app is down; any HTTP answer (even an error page) means it runs.
const DOWN_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT'];

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const cliPath = () => __filename;
const qaUrl = (hash = '') => `${config.officeUrl()}/qa${hash}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliError(EXIT.error, `${arg} needs a value.`);
    options[arg.slice(2)] = value;
    i += 1;
  }
  return { command: positional[0], args: positional.slice(1), options };
}

function waitSeconds(value) {
  if (value === undefined) return DEFAULT_WAIT_S;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) throw new CliError(EXIT.error, '--wait needs a number of seconds, for example --wait 300.');
  return Math.min(MAX_WAIT_S, Math.round(seconds));
}

function projectFolder(options) {
  return cleanProjectPath(path.resolve(options.project || process.env.CLAUDE_PROJECT_DIR || process.cwd()));
}

// ---------- the office API ----------

async function connect() {
  if (!(await ensureServer({ waitMs: 5000 }))) {
    throw new CliError(EXIT.error, `The devcrew office is not running and could not start on port ${config.port()}. Another program may be using that port.`);
  }
  let pageToken = null;
  const api = async (method, urlPath, body) => {
    const headers = { Accept: 'application/json' };
    let payload;
    if (method !== 'GET') {
      if (!pageToken) pageToken = (await api('GET', '/api/qa/session')).json?.pageToken;
      payload = JSON.stringify(body ?? {});
      Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Devcrew-Page': pageToken || '' });
    }
    const { status, data } = await request(method, urlPath, { body: payload, headers, timeoutMs: 15000 });
    let json = null;
    try {
      json = JSON.parse(data);
    } catch {
      // Not JSON; status says what happened.
    }
    return { status, json };
  };
  return api;
}

function apiError(response, what) {
  if (response.status === 0) return new CliError(EXIT.error, `The devcrew office did not answer while ${what}.`);
  const message = typeof response.json?.error === 'string' ? response.json.error : `HTTP ${response.status}`;
  if (response.status === 409) return new CliError(EXIT.busy, message);
  if (response.status === 422 || response.status === 404) return new CliError(EXIT.notReady, message);
  return new CliError(EXIT.error, `${what}: ${message}`);
}

async function listApps(api) {
  const response = await api('GET', '/api/qa/apps');
  if (response.status !== 200 || !Array.isArray(response.json)) throw apiError(response, 'reading the QA apps');
  return response.json;
}

const linkedApp = (apps, folder) => apps.find((app) => (app.projects || []).some((item) => projectKey(item) === projectKey(folder))) || null;

function howToLink(apps, folder) {
  const lines = [`No QA app is linked to ${folder}.`];
  lines.push(apps.length ? `QA apps on this computer: ${apps.map((app) => `${app.id} (${app.name})`).join(', ')}` : `There are no QA apps yet. A tester adds one on the QA page: ${qaUrl()}`);
  lines.push('Link one with /devcrew:qa-link <appId>,');
  lines.push(`or on the QA page (${qaUrl()}): edit the app and add this folder under "Project folders on this computer".`);
  return lines.join('\n');
}

/** Saves the app with a new project list. The office moves a folder that was linked to another app. */
async function saveProjects(api, app, projects) {
  const response = await api('POST', '/api/qa/apps', { id: app.id, name: app.name, environments: app.environments, projects });
  if (response.status !== 200) throw apiError(response, `saving ${app.name}`);
  return response.json;
}

/** Whether something answers at the app's address. */
function reachable(baseUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      return resolve(false);
    }
    let timedOut = false;
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      timedOut = true;
      req.destroy();
    });
    req.on('error', (error) => resolve(!timedOut && !DOWN_CODES.includes(error.code)));
    req.end();
  });
}

// ---------- the report ----------

const firstLine = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((line) => line.trim()) || '';

/** The finished run as compact Markdown: counts, the comparison, and every failed case with its diagnosis. */
function formatReport(summary, { appName, reportUrl }) {
  const env = summary.environment && typeof summary.environment === 'object' ? summary.environment : { name: String(summary.environment || '') };
  const counts = summary.counts || {};
  const cases = Array.isArray(summary.cases) ? summary.cases : [];
  const titleOf = new Map(cases.map((item) => [item.id, item.title || item.id]));
  const comparison = summary.comparison && summary.comparison.previousRunId ? summary.comparison : null;
  const newly = new Set(comparison?.newlyFailing || []);
  const still = new Set(comparison?.stillFailing || []);

  const out = [
    `## QA cycle: ${appName} · ${env.name}${env.kind ? ` (${env.kind})` : ''}: ${summary.status}`,
    '',
    `${counts.passed ?? 0} passed, ${counts.failed ?? 0} failed, ${counts.skipped ?? 0} skipped, ${counts.notPrepared ?? 0} not prepared · run ${summary.id}`,
  ];
  if (summary.error) out.push(`Error: ${summary.error}`);
  out.push('');
  if (comparison) {
    for (const [key, label] of [['newlyFailing', 'Newly failing'], ['fixed', 'Fixed'], ['stillFailing', 'Still failing']]) {
      const ids = comparison[key] || [];
      out.push(`- **${label} (${ids.length}):** ${ids.length ? ids.map((id) => titleOf.get(id) || id).join('; ') : 'none'}`);
    }
  } else {
    out.push('- No earlier test cycle of this environment to compare with, so no case counts as newly failing.');
  }

  for (const item of cases.filter((entry) => isFailing(entry.status))) {
    const diagnosis = item.diagnosis && typeof item.diagnosis === 'object' ? item.diagnosis : {};
    const tag = newly.has(item.id) ? 'newly failing' : still.has(item.id) ? 'still failing' : 'failed';
    out.push('', `### ${item.title || item.id} (${tag})`);
    if (diagnosis.failedStep) out.push(`- Failed step: ${diagnosis.failedStep}`);
    out.push(`- Expected: ${diagnosis.expected || 'the test finishes without an error'}`);
    out.push(`- Actual: ${diagnosis.actual || firstLine(item.error) || 'it failed'}`);
    if (diagnosis.url) out.push(`- Page: ${diagnosis.url}`);
    const analysis = diagnosis.analysisStatus === 'done' && diagnosis.analysis && typeof diagnosis.analysis === 'object' ? diagnosis.analysis : null;
    if (analysis) {
      out.push(`- Root cause (${CATEGORY[analysis.category] || analysis.category}, ${analysis.confidence} confidence): ${analysis.rootCause}`);
      if (analysis.suggestion) out.push(`- Suggestion: ${analysis.suggestion}`);
    } else {
      out.push(`- Root cause: not analysed${diagnosis.analysisError ? ` (${String(diagnosis.analysisError).replace(/\.$/, '')})` : ''}`);
    }
    const steps = Array.isArray(diagnosis.reproduce) ? diagnosis.reproduce.map(String) : [];
    if (steps.length) {
      out.push('- Steps to reproduce:');
      steps.forEach((step, index) => out.push(`  ${index + 1}. ${step}`));
    }
  }
  out.push('', `Report: ${reportUrl}`);
  return out.join('\n');
}

// ---------- commands ----------

async function status(api, options, print) {
  const folder = projectFolder(options);
  const apps = await listApps(api);
  const app = linkedApp(apps, folder);
  if (!app) {
    print(howToLink(apps, folder));
    return EXIT.notReady;
  }
  const local = app.environments.find((env) => env.kind === 'local');
  const envName = (id) => app.environments.find((env) => env.id === id)?.name || id;
  const counts = app.caseCounts || {};
  const lines = [`Project: ${folder}`, `Linked QA app: ${app.name} (${app.id})`, 'Environments:'];
  for (const env of app.environments) lines.push(`- ${env.id}: ${env.name} (${env.kind}) ${env.baseUrl}${env === local ? '  <- used by the crew' : ''}`);
  if (!local) lines.push('No local environment: the crew skips the QA cycle. Add one with the kind "Local" on the QA page, or pass --env <id> to run.');
  const accounts = app.accounts || [];
  lines.push(`Test accounts: ${accounts.length ? accounts.map((account) => (account.environment ? `${account.label} (${envName(account.environment)} only)` : account.label)).join(', ') : 'none yet (add one on the QA page)'}`);
  lines.push(`Test cases: ${counts.total ?? 0} (${counts.ready ?? 0} ready, ${counts.pending ?? 0} to learn, ${counts.failed ?? 0} could not be learned)`);
  if (app.lastRun) lines.push(`Last test: ${app.lastRun.status}, ${app.lastRun.passed} passed, ${app.lastRun.failed} failed${app.lastRun.finishedAt ? `, finished ${app.lastRun.finishedAt}` : ''}`);
  lines.push(`QA page: ${qaUrl()}`);
  print(lines.join('\n'));
  return EXIT.ok;
}

async function link(api, appId, options, print) {
  if (!appId) throw new CliError(EXIT.error, 'Say which app to link: node cli.js link <appId>. Run "node cli.js status" to list the apps.');
  const folder = projectFolder(options);
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new CliError(EXIT.error, `The folder ${folder} does not exist on this computer.`);
  const apps = await listApps(api);
  const app = apps.find((item) => item.id === appId);
  if (!app) throw new CliError(EXIT.notReady, `There is no QA app "${appId}". ${apps.length ? `QA apps on this computer: ${apps.map((item) => `${item.id} (${item.name})`).join(', ')}` : `Add one on the QA page first: ${qaUrl()}`}`);
  const before = linkedApp(apps, folder);
  if (before?.id === app.id) {
    print(`${folder} is already linked to ${app.name} (${app.id}).`);
    return EXIT.ok;
  }
  await saveProjects(api, app, [...(app.projects || []), folder]);
  print(`Linked ${folder} to ${app.name} (${app.id})${before ? `, instead of ${before.name} (${before.id})` : ''}. Run its QA cycle with /devcrew:qa-run.`);
  return EXIT.ok;
}

async function unlink(api, options, print) {
  const folder = projectFolder(options);
  const app = linkedApp(await listApps(api), folder);
  if (!app) {
    print(`${folder} is not linked to a QA app. Nothing to unlink.`);
    return EXIT.ok;
  }
  await saveProjects(api, app, app.projects.filter((item) => projectKey(item) !== projectKey(folder)));
  print(`Unlinked ${folder} from ${app.name} (${app.id}).`);
  return EXIT.ok;
}

async function run(api, options, print) {
  const folder = projectFolder(options);
  const seconds = waitSeconds(options.wait);
  const apps = await listApps(api);
  const app = linkedApp(apps, folder);
  if (!app) throw new CliError(EXIT.notReady, howToLink(apps, folder));

  let environment;
  if (options.env) {
    environment = app.environments.find((env) => env.id === options.env);
    if (!environment) throw new CliError(EXIT.notReady, `${app.name} has no environment "${options.env}". Its environments: ${app.environments.map((env) => env.id).join(', ')}.`);
  } else {
    environment = app.environments.find((env) => env.kind === 'local');
    if (!environment) {
      throw new CliError(EXIT.notReady, `no local environment: ${app.name} has no environment of the kind "Local". Add one on the QA page (${qaUrl()}), or pass --env <id> (${app.environments.map((env) => env.id).join(', ')}).`);
    }
  }
  if (!(app.caseCounts?.total > 0)) throw new CliError(EXIT.notReady, `${app.name} has no test cases yet. A tester adds them on the QA page: ${qaUrl()}`);
  if (!(await reachable(environment.baseUrl))) {
    throw new CliError(EXIT.notReady, `${app.name} is not running at ${environment.baseUrl}. The QA cycle tests the app as it runs there, so start it (for a local environment: the dev server) and try again.`);
  }

  const response = await api('POST', `/api/qa/apps/${encodeURIComponent(app.id)}/runs`, { environment: environment.id, tags: options.tag ? [options.tag] : [] });
  if (response.status !== 200 || !response.json?.runId) throw apiError(response, 'starting the test cycle');
  const { runId } = response.json;
  print(`Started the QA test cycle of ${app.name} on ${environment.name} (${environment.baseUrl}): ${runId}`);
  print(`Watch it live: ${qaUrl(`#/live/${runId}`)}`);
  return follow(api, runId, seconds, print, app.name);
}

/** Polls the run until it finishes or the wait is over, printing a line whenever its phase changes. */
async function follow(api, runId, seconds, print, appName) {
  const started = Date.now();
  const deadline = started + seconds * 1000;
  let lastPhase = null;
  let misses = 0;
  for (;;) {
    const response = await api('GET', `/api/qa/runs/${encodeURIComponent(runId)}`);
    if (response.status === 404) throw new CliError(EXIT.error, `There is no test cycle ${runId}.`);
    if (response.status === 200 && response.json) {
      misses = 0;
      const summary = response.json;
      if (summary.status !== 'running') return finish(api, summary, print, appName);
      if (summary.phase !== lastPhase) {
        lastPhase = summary.phase;
        const elapsed = Math.round((Date.now() - started) / 1000);
        const totals = summary.totals || {};
        const detail = summary.phase === 'prepare' ? `: ${plural(totals.toPrepare || 0, 'case')}` : '';
        print(`[${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}] ${PHASE_TEXT[summary.phase] || summary.phase}${detail}`);
      }
    } else if ((misses += 1) >= 5) {
      throw apiError(response, `following the test cycle ${runId}`);
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      print(`still running: node "${cliPath()}" wait ${runId}`);
      return EXIT.stillRunning;
    }
    await sleep(Math.min(POLL_MS, left));
  }
}

async function finish(api, summary, print, appName) {
  let name = appName;
  if (!name) name = (await listApps(api).catch(() => [])).find((app) => app.id === summary.app)?.name || summary.app;
  print('');
  print(formatReport(summary, { appName: name, reportUrl: qaUrl(`#/report/${summary.id}`) }));
  if (summary.status === 'error' || summary.status === 'stopped') return EXIT.error;
  return summary.comparison?.newlyFailing?.length ? EXIT.newlyFailing : EXIT.ok;
}

// ---------- PRD → draft cases (/devcrew:qa-from-prd) ----------

/** The rules for writing cases from a PRD, the same ones the QA page's import uses. */
function prdRules(print) {
  print(PRD_RULES);
  print('');
  print(PRD_FORMAT);
  print('');
  print('The drafts file also needs the source: {"source":{"title":"<PRD title>","url":"<https link or null>","kind":"confluence|file|text"},"cases":[...]}');
  return EXIT.ok;
}

/** Sends the drafts Claude wrote to the QA page, where QA reviews them before anything is added. */
async function prdDrafts(api, appId, options, print) {
  if (!appId) throw new CliError(EXIT.error, 'Say which app the cases are for: node cli.js prd-drafts <appId> --file <drafts.json>.');
  if (!options.file) throw new CliError(EXIT.error, 'Say where the drafts are: --file <drafts.json>.');
  let body;
  try {
    // "-" reads the drafts from stdin, so /devcrew:qa-from-prd needs no temporary file.
    const text = options.file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(options.file), 'utf8');
    if (text.length > MAX_PRD_CHARS) throw new Error('the file is too big');
    body = JSON.parse(text);
  } catch (error) {
    throw new CliError(EXIT.error, `Could not read the drafts file ${options.file}: ${error.message}`);
  }
  const apps = await listApps(api);
  const app = apps.find((item) => item.id === appId);
  if (!app) throw new CliError(EXIT.notReady, `There is no QA app "${appId}". ${apps.length ? `QA apps on this computer: ${apps.map((item) => `${item.id} (${item.name})`).join(', ')}` : `Add one on the QA page first: ${qaUrl()}`}`);
  const response = await api('POST', `/api/qa/apps/${encodeURIComponent(appId)}/prd-draft`, body);
  if (response.status !== 200) throw apiError(response, 'sending the drafts');
  const { cases = [], removed = [], source } = response.json || {};
  const already = cases.filter((item) => item.exists).length;
  const flagged = cases.filter((item) => item.needs && !item.exists).length;
  print(`Sent ${plural(cases.length, 'draft case')} from "${source?.title}" to the QA page for ${app.name}.`);
  if (already) print(`${already} of them are already cases, so they won't be added twice.`);
  if (flagged) print(`${flagged} need test data or a manual step; they start unticked.`);
  if (removed.length) print(`${plural(removed.length, 'case')} from an earlier import of this PRD ${removed.length === 1 ? 'is' : 'are'} no longer in it.`);
  print(`Review and add them on the QA page: ${qaUrl()}`);
  return EXIT.ok;
}

const USAGE = `Usage:
  node cli.js status [--project <dir>]
  node cli.js link <appId> [--project <dir>]
  node cli.js unlink [--project <dir>]
  node cli.js run [--project <dir>] [--env <id>] [--tag <tag>] [--wait <seconds, default ${DEFAULT_WAIT_S}, max ${MAX_WAIT_S}>]
  node cli.js wait <runId> [--wait <seconds>]
  node cli.js prd-rules
  node cli.js prd-drafts <appId> --file <drafts.json | - for stdin>`;

async function main(argv, print = (line) => console.log(line)) {
  try {
    const { command, args, options } = parseArgs(argv);
    if (!['status', 'link', 'unlink', 'run', 'wait', 'prd-rules', 'prd-drafts'].includes(command)) {
      print(USAGE);
      return EXIT.error;
    }
    if (command === 'wait' && !args[0]) throw new CliError(EXIT.error, 'Say which test cycle to wait for: node cli.js wait <runId>.');
    if (command === 'prd-rules') return prdRules(print);
    const seconds = waitSeconds(options.wait);
    const api = await connect();
    if (command === 'status') return await status(api, options, print);
    if (command === 'link') return await link(api, args[0], options, print);
    if (command === 'unlink') return await unlink(api, options, print);
    if (command === 'run') return await run(api, options, print);
    if (command === 'prd-drafts') return await prdDrafts(api, args[0], options, print);
    return await follow(api, args[0], seconds, print);
  } catch (error) {
    if (error instanceof CliError) {
      print(error.message);
      return error.code;
    }
    if (error?.status === 422) {
      // A project folder that is not a full path (from the store's check).
      print(error.message);
      return EXIT.error;
    }
    print(`Something went wrong: ${error.message}`);
    return EXIT.error;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, formatReport, EXIT };

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { TOKEN, call, freePort, tempHome } = require('./helpers');

const home = tempHome('devcrew-qa-cli-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');
const { formatReport } = require('../cli');

const CLI = path.join(__dirname, '..', 'cli.js');
const PASSWORD = 'Cli-Secret-Pass-9';

/** Runs cli.js as the skills do, against the test office. */
function cli(port, args) {
  return new Promise((resolve) => {
    const env = { ...process.env, DEVCREW_HOME: home, DEVCREW_OFFICE_PORT: String(port) };
    delete env.CLAUDE_PROJECT_DIR;
    const child = spawn(process.execPath, [CLI, ...args], { env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** A failed case as the runner saves it: a diagnosis with steps to reproduce and Claude Code's root cause. */
const failedCase = (id, title) => ({
  id,
  title,
  status: 'failed',
  durationMs: 1200,
  error: 'expect(locator).toBeVisible() failed',
  attachments: {},
  diagnosis: {
    steps: [{ title: 'Log in as Admin', status: 'passed', durationMs: 300 }, { title: 'Open the leads page', status: 'failed', durationMs: 900 }],
    failedStep: 'Open the leads page',
    expected: 'The heading "Leads" is visible',
    actual: 'The heading "Leads" was not found on the page after 5 s',
    url: 'http://localhost/leads',
    reproduce: ['Open Local (local) at http://localhost in a browser.', 'Log in as Admin (account: admin@cli.test).', 'Open the leads page', 'Expected: The heading "Leads" is visible / Actual: The heading "Leads" was not found on the page after 5 s'],
    evidence: { failedRequests: [], consoleErrors: [], pageErrors: [] },
    analysis: { category: 'app-bug', rootCause: 'The leads route returns a 500 because the controller reads a missing column.', evidence: [], reproduce: [], suggestion: 'Add the missing migration.', confidence: 'high' },
    analysisStatus: 'done',
  },
});

const passedCase = (id, title) => ({ id, title, status: 'passed', durationMs: 800, error: null, attachments: {} });

test('qa cli', async (t) => {
  // The app under test: anything that answers HTTP counts as running.
  const appServer = http.createServer((req, res) => res.end('ok'));
  const appPort = await freePort();
  await new Promise((resolve) => appServer.listen(appPort, '127.0.0.1', resolve));
  t.after(() => appServer.close());
  const downPort = await freePort();

  // A test office whose runner is replaced: each run finishes with the next outcome, or keeps running.
  const outcomes = [];
  const children = new Map();
  const port = await freePort();
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-qa-cli-public-'));
  const office = createOfficeServer({
    port,
    token: TOKEN,
    publicDir,
    startQaRunner: (runId) => {
      const child = new EventEmitter();
      child.exitCode = null;
      children.set(runId, child);
      const outcome = outcomes.shift();
      if (outcome) setTimeout(() => finishRun(runId, outcome(runId)), 300);
      return child;
    },
  });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());

  function finishRun(runId, changes) {
    store.writeSummary({ ...store.readSummary(runId), phase: 'report', finishedAt: new Date().toISOString(), ...changes });
    const child = children.get(runId);
    child.exitCode = 0;
    child.emit('exit', 0);
  }

  const { pageToken } = (await call(port, 'GET', '/api/qa/session')).json;
  const write = (method, url, body) => call(port, method, url, { body, headers: { 'X-Devcrew-Page': pageToken } });

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-qa-cli-project-'));
  const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-qa-cli-other-'));
  const local = { id: 'local', name: 'Local', kind: 'local', baseUrl: `http://127.0.0.1:${appPort}`, loginPath: '/login' };
  await write('POST', '/api/qa/apps', { id: 'crm', name: 'CRM', environments: [local, { name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test' }] });
  await write('POST', '/api/qa/apps/crm/accounts', { label: 'Admin', username: 'admin@cli.test', password: PASSWORD });
  const cases = (await write('POST', '/api/qa/apps/crm/cases', { text: 'Admin opens the leads page\nAdmin opens the dashboard' })).json;
  await write('POST', '/api/qa/apps', { id: 'shop', name: 'Shop', environments: [{ name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test' }] });

  const outputs = [];
  const run = async (...args) => {
    const result = await cli(port, args);
    outputs.push(result.output);
    return result;
  };

  await t.test('status without a link explains how to link (exit 3)', async () => {
    const { code, output } = await run('status', '--project', project);
    assert.equal(code, 3);
    assert.match(output, /No QA app is linked to/);
    assert.match(output, /crm \(CRM\), shop \(Shop\)/);
    assert.match(output, /\/devcrew:qa-link <appId>/);
    assert.match(output, /Project folders on this computer/);
  });

  await t.test('run without a link is refused with the same help (exit 3)', async () => {
    const { code, output } = await run('run', '--project', project);
    assert.equal(code, 3);
    assert.match(output, /No QA app is linked/);
  });

  await t.test('link, move and status', async () => {
    assert.equal((await run('link', 'nope', '--project', project)).code, 3);
    assert.equal((await run('link', 'crm', '--project', path.join(project, 'missing'))).code, 2);

    let result = await run('link', 'shop', '--project', project);
    assert.equal(result.code, 0);
    result = await run('link', 'crm', '--project', project);
    assert.equal(result.code, 0);
    assert.match(result.output, /instead of Shop \(shop\)/, 'linking elsewhere moves the folder');
    assert.deepEqual(store.getApp('shop').projects, []);
    assert.deepEqual(store.getApp('crm').projects, [store.cleanProjectPath(project)]);
    assert.match((await run('link', 'crm', '--project', project)).output, /already linked/);

    result = await run('status', '--project', `${project}${path.sep}`);
    assert.equal(result.code, 0);
    assert.match(result.output, /Linked QA app: CRM \(crm\)/);
    assert.match(result.output, /local: Local \(local\) http:\/\/127\.0\.0\.1:\d+ {2}<- used by the crew/);
    assert.match(result.output, /Test accounts: Admin/);
    assert.match(result.output, /Test cases: 2 \(0 ready, 2 to learn, 0 could not be learned\)/);
    assert.doesNotMatch(result.output, /admin@cli\.test/, 'status shows account labels only');
  });

  await t.test('no local environment, or the app not running, is a clear skip (exit 3)', async () => {
    await write('POST', '/api/qa/apps', { id: 'shop', name: 'Shop', environments: [{ id: 'staging', name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test' }], projects: [otherProject] });
    await write('POST', '/api/qa/apps/shop/cases', { text: 'A case' });
    let result = await run('run', '--project', otherProject);
    assert.equal(result.code, 3);
    assert.match(result.output, /^no local environment: Shop/);

    await write('POST', '/api/qa/apps', { id: 'shop', name: 'Shop', environments: [{ ...local, baseUrl: `http://127.0.0.1:${downPort}` }] });
    result = await run('run', '--project', otherProject);
    assert.equal(result.code, 3);
    assert.match(result.output, /Shop is not running at http:\/\/127\.0\.0\.1:\d+/);
    assert.match((await run('run', '--project', otherProject, '--env', 'nope')).output, /has no environment "nope"/);
  });

  await t.test('a finished run prints the Markdown report; newly failing cases exit 1', async () => {
    const [leads, dashboard] = cases;
    // The previous run passed both cases, so the failure now is newly failing.
    const previousId = 'crm-20260101-000000-prev';
    store.writeSummary({ id: previousId, app: 'crm', environment: { id: 'local', name: 'Local', kind: 'local' }, kind: 'cycle', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', counts: { passed: 2, failed: 0, skipped: 0, notPrepared: 0 }, cases: [passedCase(leads.id, leads.title), passedCase(dashboard.id, dashboard.title)] });
    outcomes.push(() => ({
      status: 'failed',
      counts: { passed: 1, failed: 1, skipped: 0, notPrepared: 0 },
      cases: [failedCase(leads.id, leads.title), passedCase(dashboard.id, dashboard.title)],
      comparison: { previousRunId: previousId, newlyFailing: [leads.id], fixed: [], stillFailing: [] },
    }));
    const { code, output } = await run('run', '--project', project, '--wait', '60');
    assert.equal(code, 1, output);
    const runId = /Started the QA test cycle of CRM on Local \(http:\/\/127\.0\.0\.1:\d+\): (\S+)/.exec(output)?.[1];
    assert.ok(store.isRunId(runId), output);
    assert.match(output, new RegExp(`Watch it live: http://localhost:${port}/qa#/live/${runId}`));
    assert.match(output, /## QA cycle: CRM · Local \(local\): failed/);
    assert.match(output, /1 passed, 1 failed, 0 skipped, 0 not prepared/);
    assert.match(output, /- \*\*Newly failing \(1\):\*\* Admin opens the leads page/);
    assert.match(output, /### Admin opens the leads page \(newly failing\)/);
    assert.match(output, /- Failed step: Open the leads page/);
    assert.match(output, /- Expected: The heading "Leads" is visible/);
    assert.match(output, /- Actual: The heading "Leads" was not found/);
    assert.match(output, /- Root cause \(App bug, high confidence\): The leads route returns a 500/);
    assert.match(output, /- Steps to reproduce:\n {2}1\. Open Local \(local\) at http:\/\/localhost in a browser\.\n {2}2\. Log in as Admin/);
    assert.match(output, new RegExp(`Report: http://localhost:${port}/qa#/report/${runId}`));
  });

  await t.test('no newly failing cases exit 0', async () => {
    const [leads, dashboard] = cases;
    outcomes.push(() => ({ status: 'passed', counts: { passed: 2, failed: 0, skipped: 0, notPrepared: 0 }, cases: [passedCase(leads.id, leads.title), passedCase(dashboard.id, dashboard.title)], comparison: { previousRunId: 'x', newlyFailing: [], fixed: [leads.id], stillFailing: [] } }));
    const { code, output } = await run('run', '--project', project, '--tag', 'smoke', '--wait', '60');
    assert.equal(code, 3, 'a tag without cases is refused by the office');
    assert.match(output, /no test cases to run/);
    outcomes.length = 0;
    outcomes.push(() => ({ status: 'passed', counts: { passed: 2, failed: 0, skipped: 0, notPrepared: 0 }, cases: [passedCase(leads.id, leads.title), passedCase(dashboard.id, dashboard.title)], comparison: { previousRunId: 'x', newlyFailing: [], fixed: [leads.id], stillFailing: [] } }));
    const passed = await run('run', '--project', project, '--wait', '60');
    assert.equal(passed.code, 0, passed.output);
    assert.match(passed.output, /- \*\*Fixed \(1\):\*\* Admin opens the leads page/);
  });

  await t.test('a long run: still running (exit 5), busy (exit 4), then wait', async () => {
    let result = await run('run', '--project', project, '--wait', '1');
    assert.equal(result.code, 5, result.output);
    const runId = /wait (\S+)\s*$/.exec(result.output)?.[1];
    assert.ok(store.isRunId(runId), result.output);
    assert.match(result.output, new RegExp(`still running: node "${CLI.replace(/[\\.]/g, '\\$&')}" wait ${runId}`));

    result = await run('run', '--project', project, '--wait', '1');
    assert.equal(result.code, 4);
    assert.match(result.output, /already running/);
    assert.equal((await run('wait', runId, '--wait', '0')).code, 5);

    setTimeout(() => finishRun(runId, { status: 'error', error: 'The test browser could not start.' }), 500);
    result = await run('wait', runId, '--wait', '30');
    assert.equal(result.code, 2, 'a run that ended in error');
    assert.match(result.output, /## QA cycle: CRM · Local \(local\): error/);
    assert.match(result.output, /Error: The test browser could not start\./);
    assert.equal((await run('wait', 'crm-20260101-000000-none')).code, 2);
  });

  await t.test('unlink, usage errors, and no password anywhere', async () => {
    assert.equal((await run('unlink', '--project', project)).code, 0);
    assert.deepEqual(store.getApp('crm').projects, []);
    assert.match((await run('unlink', '--project', project)).output, /not linked/);
    assert.equal((await run('status', '--project', project)).code, 3);
    assert.equal((await run('nonsense')).code, 2);
    assert.equal((await run('run', '--wait', 'soon')).code, 2);
    assert.equal((await run('wait')).code, 2);
    for (const output of outputs) assert.ok(!output.includes(PASSWORD));
  });
});

test('the report without an earlier run says nothing counts as newly failing', () => {
  const summary = { id: 'crm-20260101-000000-abcd', status: 'failed', environment: { id: 'local', name: 'Local', kind: 'local' }, counts: { passed: 0, failed: 1, skipped: 0, notPrepared: 0 }, cases: [{ ...failedCase('abcdefgh', 'A case'), diagnosis: { ...failedCase('a', 'b').diagnosis, analysis: null, analysisStatus: 'unavailable', analysisError: 'Claude Code is not installed.' } }], comparison: { previousRunId: null, newlyFailing: [], fixed: [], stillFailing: [] } };
  const report = formatReport(summary, { appName: 'CRM', reportUrl: 'http://localhost:4317/qa#/report/x' });
  assert.match(report, /No earlier test cycle of this environment to compare with/);
  assert.match(report, /### A case \(failed\)/);
  assert.match(report, /- Root cause: not analysed \(Claude Code is not installed\)/);
});

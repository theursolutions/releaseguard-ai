// A failed case explains itself: a test cycle against the fixture app where saving a product returns 500.
// The report must say what the test did step by step, where it failed, expected vs actual, what the browser
// saw, how a person reproduces it, and the root cause from the analysis. A fake `claude` on PATH stands in
// for Claude Code and records what it was given. Skipped when no Playwright runtime is installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TOKEN, call, freePort, tempHome, installedRuntimeHome, linkRuntime, allText } = require('./helpers');
const { startFixtureApp, USERNAME, PASSWORD } = require('./fixture-app');

const runtimeHome = installedRuntimeHome(process.env.DEVCREW_HOME);
const home = tempHome('devcrew-qa-diagnosis-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');
const { runDir } = require('../lib/paths');
const { validateSpec } = require('../lib/validate');

const FAILING = `import { test, expect } from '../../../lib/devcrew-qa';

test('Agent adds a product', async ({ as }) => {
  const page = await as('Agent');
  await test.step('Open the new product form', async () => {
    await page.goto('/products/create');
  });
  await test.step('Save the product', async () => {
    await page.getByLabel('Product name').fill('QA product');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product saved')).toBeVisible({ timeout: 3000 });
  });
  await test.step('See the product in the list', async () => {
    await page.goto('/products');
  });
});
`;

/** A `claude` command that runs fake-claude.js, first on PATH; folders holding the real one are left out. */
function fakeClaudeOnPath(dir) {
  const script = path.join(__dirname, 'fake-claude.js');
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const hasClaude = (folder) => ['claude', 'claude.exe', 'claude.cmd'].some((name) => fs.existsSync(path.join(folder, name)));
  const keep = (process.env.PATH || '').split(path.delimiter).filter((folder) => folder && !hasClaude(folder));
  return [dir, ...keep].join(path.delimiter);
}

test('a failed case gets its steps, expected vs actual, evidence, reproduce steps and a root cause', { skip: runtimeHome ? false : 'no Playwright runtime installed (run a QA cycle once, or set DEVCREW_QA_RUNTIME_HOME)', timeout: 5 * 60 * 1000 }, async (t) => {
  t.after(linkRuntime(runtimeHome, home));
  const fixtureApp = await startFixtureApp();
  t.after(() => fixtureApp.server.close());

  const bin = fs.mkdtempSync(path.join(home, 'bin-'));
  const log = path.join(home, 'fake-claude.log');
  const savedPath = process.env.PATH;
  process.env.PATH = fakeClaudeOnPath(bin);
  process.env.FAKE_CLAUDE_LOG = log;
  t.after(() => {
    process.env.PATH = savedPath;
  });

  const port = await freePort();
  process.env.DEVCREW_OFFICE_PORT = String(port);
  const office = createOfficeServer({ port, token: TOKEN });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());

  const { pageToken } = (await call(port, 'GET', '/api/qa/session')).json;
  const write = (method, url, body) => call(port, method, url, { body, headers: { 'X-Devcrew-Page': pageToken } });
  const app = (await write('POST', '/api/qa/apps', { name: 'Fixture Shop', environments: [{ name: 'Local', kind: 'local', baseUrl: fixtureApp.baseUrl, loginPath: '/login' }] })).json;
  const envId = app.environments[0].id;
  assert.equal((await write('POST', `/api/qa/apps/${app.id}/accounts`, { label: 'Agent', username: USERNAME, password: PASSWORD })).status, 200);
  const [item] = (await write('POST', `/api/qa/apps/${app.id}/cases`, { text: 'Agent adds a product' })).json;
  assert.deepEqual(validateSpec(FAILING), { ok: true, errors: [] });
  fs.writeFileSync(store.specFile(app.id, item.id), FAILING);
  store.setCase(app.id, item.id, { status: 'ready', preparedAt: new Date().toISOString() });

  const { runId } = (await write('POST', `/api/qa/apps/${app.id}/runs`, { environment: envId, parallel: 1, smoke: false, performance: false })).json;
  let summary;
  for (let waited = 0; waited < 4 * 60 * 1000; waited += 1000) {
    summary = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    if (summary.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(summary.status, 'failed', JSON.stringify(summary.error || summary));
  const failed = summary.cases.find((entry) => entry.id === item.id);
  assert.equal(failed.status, 'failed', 'the analysis never changes the result');
  const { diagnosis } = failed;
  assert.ok(diagnosis, JSON.stringify(failed));

  // What the test did, in order, with the failed step marked and the step it never reached.
  assert.deepEqual(diagnosis.steps.map(({ title, status }) => [title, status]), [
    ['Log in as Agent', 'passed'],
    ['Open the new product form', 'passed'],
    ['Save the product', 'failed'],
    ['See the product in the list', 'skipped'],
  ]);
  assert.ok(diagnosis.steps.every((step) => Number.isFinite(step.durationMs)));
  assert.equal(diagnosis.failedStep, 'Save the product');
  assert.equal(diagnosis.expected, 'The text "Product saved" is visible');
  assert.equal(diagnosis.actual, 'The text "Product saved" is on the page but not visible');
  assert.equal(diagnosis.url, `${fixtureApp.baseUrl}/products/create`);

  // What the browser saw.
  assert.ok(diagnosis.evidence.failedRequests.some((request) => request.method === 'POST' && request.url === `${fixtureApp.baseUrl}/api/products` && request.status === 500), JSON.stringify(diagnosis.evidence));
  assert.ok(diagnosis.evidence.consoleErrors.some((message) => message.includes('Saving the product failed with 500')), JSON.stringify(diagnosis.evidence));
  assert.deepEqual(diagnosis.evidence.pageErrors, []);

  // Steps a person can follow: where, who (username, never the password), what, and the result.
  assert.deepEqual(diagnosis.reproduce, [
    `Open Local at ${fixtureApp.baseUrl} in a browser.`,
    `Log in as Agent (account: ${USERNAME}).`,
    'Open the new product form',
    'Save the product',
    'The failure shows on /products/create.',
    'Expected: The text "Product saved" is visible / Actual: The text "Product saved" is on the page but not visible',
  ]);

  // The root cause from the (fake) Claude Code, given everything except the account's username and password.
  assert.equal(diagnosis.analysisStatus, 'done', diagnosis.analysisError);
  assert.equal(diagnosis.analysis.category, 'app-bug');
  assert.equal(diagnosis.analysis.confidence, 'high');
  assert.match(diagnosis.analysis.rootCause, /POST \/api\/products answers 500/);
  const [call1] = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  for (const flag of ['-p', '--no-session-persistence', '--strict-mcp-config']) assert.ok(call1.args.includes(flag), flag);
  assert.ok(!call1.args.includes('--bare'));
  assert.equal(call1.args[call1.args.indexOf('--allowedTools') + 1], 'mcp__devcrew_qa__qa_explore');
  assert.equal(call1.args[call1.args.indexOf('--tools') + 1], '');
  assert.match(call1.prompt, /Failed at step: Save the product/);
  assert.match(call1.prompt, /POST .*\/api\/products returned 500/);
  assert.match(call1.prompt, /Saving the product failed with 500/);
  assert.ok(!call1.prompt.includes(USERNAME), 'the username reached Claude');
  assert.ok(!call1.prompt.includes(PASSWORD), 'the password reached Claude');

  // The password is nowhere in the run's files.
  assert.ok(!allText(runDir(runId)).includes(PASSWORD), 'the password leaked');
});

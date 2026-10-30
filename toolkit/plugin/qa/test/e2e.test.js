// A whole QA test cycle against a local fixture web app, with hand-written specs standing in for what the
// case-preparing Claude would save. Skipped when no Playwright runtime is installed on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { TOKEN, call, freePort, tempHome, installedRuntimeHome, linkRuntime, allText } = require('./helpers');
const { startFixtureApp, USERNAME, PASSWORD } = require('./fixture-app');

const runtimeHome = installedRuntimeHome(process.env.DEVCREW_HOME);
const home = tempHome('devcrew-qa-e2e-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');
const { runDir } = require('../lib/paths');
const { validateSpec } = require('../lib/validate');

const PASSING = `import { test, expect } from '../../../lib/devcrew-qa';

test('Agent cannot save a lead without a phone number', async ({ as }) => {
  const page = await as('Agent');
  await test.step('Open the new lead form', async () => {
    await page.goto('/leads/create');
  });
  await test.step('Save without a phone number', async () => {
    await page.getByLabel('Name').fill('QA lead');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The phone field is required')).toBeVisible();
  });
});
`;

const FAILING = `import { test, expect } from '../../../lib/devcrew-qa';

test('Agent sees the lead export button', async ({ as }) => {
  const page = await as('Agent');
  await test.step('Open the leads list', async () => {
    await page.goto('/leads');
  });
  await test.step('Find the export button', async () => {
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 2000 });
  });
});
`;

/** Collects every event of the QA live stream. */
function listen(port) {
  const events = [];
  const req = http.get({ host: '127.0.0.1', port, path: '/api/qa/stream', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) if (part.startsWith('data: ')) events.push(JSON.parse(part.slice(6)));
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

test('a full test cycle: login, live frames, pass/fail, smoke check, speed, report', { skip: runtimeHome ? false : 'no Playwright runtime installed (run a QA cycle once, or set DEVCREW_QA_RUNTIME_HOME)', timeout: 6 * 60 * 1000 }, async (t) => {
  t.after(linkRuntime(runtimeHome, home));
  const fixtureApp = await startFixtureApp();
  t.after(() => fixtureApp.server.close());

  const port = await freePort();
  process.env.DEVCREW_OFFICE_PORT = String(port);
  const office = createOfficeServer({ port, token: TOKEN });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());
  const stream = listen(port);
  t.after(stream.close);

  const { pageToken } = (await call(port, 'GET', '/api/qa/session')).json;
  const write = (method, url, body) => call(port, method, url, { body, headers: { 'X-Devcrew-Page': pageToken } });

  const app = (await write('POST', '/api/qa/apps', { name: 'Fixture CRM', environments: [{ name: 'Local', kind: 'local', baseUrl: fixtureApp.baseUrl, loginPath: '/login' }] })).json;
  const envId = app.environments[0].id;
  const account = await write('POST', `/api/qa/apps/${app.id}/accounts`, { label: 'Agent', username: USERNAME, password: PASSWORD });
  assert.equal(account.status, 200);
  assert.ok(!account.data.includes(PASSWORD));

  const login = await write('POST', `/api/qa/apps/${app.id}/test-login`, { environment: envId, account: account.json.id });
  assert.deepEqual(login.json, { ok: true, message: 'Logged in as Agent.' });

  const created = (await write('POST', `/api/qa/apps/${app.id}/cases`, { text: '1. Agent cannot save a lead without a phone number\n2. Agent sees the lead export button' })).json;
  assert.equal(created.length, 2);
  for (const [item, spec] of [[created[0], PASSING], [created[1], FAILING]]) {
    assert.deepEqual(validateSpec(spec), { ok: true, errors: [] });
    fs.writeFileSync(store.specFile(app.id, item.id), spec);
    store.setCase(app.id, item.id, { status: 'ready', preparedAt: new Date().toISOString() });
  }

  const started = await write('POST', `/api/qa/apps/${app.id}/runs`, { environment: envId, parallel: 2, smoke: true, performance: true });
  assert.equal(started.status, 200);
  const { runId } = started.json;
  assert.equal((await write('POST', `/api/qa/apps/${app.id}/runs`, { environment: envId })).status, 409);

  let summary;
  for (let waited = 0; waited < 5 * 60 * 1000; waited += 1000) {
    summary = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    if (summary.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert.equal(summary.status, 'failed', JSON.stringify(summary.error || summary));
  // The smoke check counts like a case.
  assert.deepEqual(summary.counts, { passed: 2, failed: 1, skipped: 0, notPrepared: 0 });
  assert.deepEqual(summary.cases.find((item) => item.id === 'smoke')?.status, 'passed');
  const [passed, failed] = [created[0].id, created[1].id].map((id) => summary.cases.find((item) => item.id === id));
  assert.equal(passed.status, 'passed');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Export/);
  assert.ok(failed.attachments.screenshot, 'failed case has a screenshot');
  assert.ok(failed.attachments.video, 'failed case has a video');
  assert.ok(failed.attachments.trace, 'failed case has a trace');
  assert.equal((await call(port, 'GET', failed.attachments.screenshot)).headers['content-type'], 'image/png');
  assert.deepEqual(summary.comparison, { previousRunId: null, newlyFailing: [], fixed: [], stillFailing: [] });

  const pages = summary.smoke.pages;
  const reports = pages.find((item) => item.url.endsWith('/reports'));
  assert.equal(reports?.status, 500, JSON.stringify(pages));
  assert.ok(pages.some((item) => item.brokenLinks.some((link) => link.url.endsWith('/reports') && link.status === 500)), 'the 500 link is reported as broken');
  assert.ok(pages.some((item) => item.consoleErrors.some((message) => message.includes('Fixture console error'))), 'the console error is found');
  assert.ok(!pages.some((item) => item.url.includes('/logout')), 'logout is never visited');
  assert.ok(!pages.some((item) => item.url.startsWith('https://example.com')), 'other sites are never visited');

  assert.ok(summary.performance.length > 0);
  assert.ok(summary.performance.every((entry) => Number.isFinite(entry.ttfb) && Number.isFinite(entry.load)), JSON.stringify(summary.performance));
  assert.ok(summary.performance.some((entry) => Number.isFinite(entry.fcp)));

  const report = await call(port, 'GET', summary.htmlReport);
  assert.equal(report.status, 200);
  assert.match(report.headers['content-security-policy'], /^sandbox allow-scripts/);

  const types = new Set(stream.events.map((event) => event.type));
  for (const type of ['run', 'case', 'step', 'frame', 'tile.end']) assert.ok(types.has(type), `stream has ${type} events`);
  assert.ok(stream.events.some((event) => event.type === 'frame' && event.label === 'Agent' && event.data.length > 100));
  const lastRun = stream.events.filter((event) => event.type === 'run').at(-1).run;
  assert.equal(lastRun.status, 'failed');
  assert.equal(lastRun.app, app.id);
  assert.deepEqual(lastRun.environment, { id: envId, name: 'Local', kind: 'local' });
  assert.deepEqual(lastRun.totals, { toPrepare: 0, toRun: 3 });
  assert.ok(lastRun.startedAt);
  for (const type of ['frame', 'step', 'tile.end']) assert.ok(stream.events.filter((event) => event.type === type).every((event) => [created[0].id, created[1].id, 'smoke'].includes(event.caseId)), `${type} events carry the case id`);
  assert.ok(stream.events.some((event) => event.type === 'case' && event.caseId === 'smoke' && event.title === 'Smoke check'));

  const state = (await call(port, 'GET', '/api/state')).json;
  assert.equal(state.sessions.find((session) => session.id === runId)?.project, 'QA · Fixture CRM · Local');
  assert.ok(state.agents.some((agent) => agent.session === runId && agent.type === 'qa-automation'));

  const runs = (await call(port, 'GET', `/api/qa/runs?app=${app.id}`)).json;
  assert.equal(runs[0].id, runId);
  const cases = (await call(port, 'GET', `/api/qa/apps/${app.id}/cases`)).json;
  assert.deepEqual(cases.find((item) => item.id === created[1].id).lastResult, { status: 'failed', runId });

  // The test password is nowhere: run files (traces and the report's embedded data included), events, office state.
  const everywhere = [allText(runDir(runId)), JSON.stringify(stream.events), JSON.stringify(state), fs.readFileSync(path.join(home, 'qa', 'apps', app.id, 'cases', 'index.json'), 'utf8')].join('\n');
  assert.ok(everywhere.length > 1000);
  assert.ok(!everywhere.includes(PASSWORD), 'the password leaked');
});

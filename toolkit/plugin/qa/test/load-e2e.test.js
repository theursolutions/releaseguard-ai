// A logged-in load test against the local fixture web app: the account logs in through a real browser in a
// separate process, and the virtual users then send the session cookie. The password must appear nowhere.
// Skipped when no Playwright runtime is installed on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { TOKEN, call, freePort, tempHome, installedRuntimeHome, linkRuntime, allText } = require('./helpers');
const { startFixtureApp, USERNAME, PASSWORD } = require('./fixture-app');

const runtimeHome = installedRuntimeHome(process.env.DEVCREW_HOME);
const home = tempHome('devcrew-qa-load-e2e-');
const { createOfficeServer } = require('../../office/server');
const { runDir } = require('../lib/paths');

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

test('a logged-in load test sends the session cookie and never the password', { skip: runtimeHome ? false : 'no Playwright runtime installed (run a QA cycle once, or set DEVCREW_QA_RUNTIME_HOME)', timeout: 3 * 60 * 1000 }, async (t) => {
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
  const account = (await write('POST', `/api/qa/apps/${app.id}/accounts`, { label: 'Agent', username: USERNAME, password: PASSWORD })).json;

  const started = await write('POST', `/api/qa/apps/${app.id}/load`, { environment: 'local', mode: 'load', paths: ['/dashboard', '/leads'], users: 3, durationSec: 10, thinkMs: 100, account: account.id });
  assert.equal(started.status, 200, started.data);
  const { runId } = started.json;

  let summary;
  for (let waited = 0; waited < 120000; waited += 500) {
    summary = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    if (summary.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(summary.status, 'passed', JSON.stringify(summary.error || summary.load?.verdict));
  const { load } = summary;
  assert.equal(load.plan.account, 'Agent');
  assert.ok(load.totals.requests > 20);
  assert.equal(load.totals.loginRedirects, 0, 'the session was kept');
  for (const page of load.pages) assert.equal(page.statuses[200], page.requests, `${page.path} answered 200 every time: the session cookie was sent`);
  assert.equal(load.sessionLost, false);

  const runEvents = stream.events.filter((event) => event.type === 'run' && event.run.id === runId);
  assert.ok(runEvents.some((event) => event.run.message === 'Logging in as Agent'));
  assert.equal(stream.events.filter((event) => event.type === 'load' && event.runId === runId).length, 10);

  const state = (await call(port, 'GET', '/api/state')).json;
  const everywhere = [allText(runDir(runId)), JSON.stringify(stream.events), JSON.stringify(state)].join('\n');
  assert.ok(!everywhere.includes(PASSWORD), 'the password leaked');
});

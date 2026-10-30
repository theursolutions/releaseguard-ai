// Load and stress tests through the office server: limits enforced by the route, one test at a time across
// test cycles and load tests, per-second events on the QA stream, the 3D office, stopping, and the report.
// Load tests run as real child processes against a local fixture server; test cycles use a stand-in runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { TOKEN, call, freePort, tempHome } = require('./helpers');
const { startLoadFixture } = require('./load-fixture');

tempHome('devcrew-qa-load-routes-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');

function fakeRunner(started) {
  return (runId) => {
    started.push(runId);
    const child = new EventEmitter();
    child.exitCode = null;
    return child;
  };
}

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

async function until(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test('load and stress tests through the QA routes', { timeout: 120000 }, async (t) => {
  const fixture = await startLoadFixture();
  t.after(fixture.close);
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-qa-public-'));
  fs.writeFileSync(path.join(publicDir, 'qa.html'), '<!doctype html><title>QA</title>');
  const started = [];
  const port = await freePort();
  // The load child posts its events to this office.
  process.env.DEVCREW_OFFICE_PORT = String(port);
  const office = createOfficeServer({ port, token: TOKEN, publicDir, startQaRunner: fakeRunner(started) });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());
  const stream = listen(port);
  t.after(stream.close);
  const { pageToken } = (await call(port, 'GET', '/api/qa/session')).json;
  const write = (method, url, body, token = pageToken) => call(port, method, url, { body, headers: token ? { 'X-Devcrew-Page': token } : {} });

  const app = (
    await write('POST', '/api/qa/apps', {
      name: 'Fixture',
      environments: [
        { name: 'Local', kind: 'local', baseUrl: fixture.baseUrl, loginPath: '/login' },
        { name: 'Live', kind: 'production', baseUrl: fixture.baseUrl, loginPath: '/login', allowProduction: true },
      ],
    })
  ).json;
  assert.equal(app.environments[1].allowProduction, true);
  const account = (await write('POST', '/api/qa/apps/fixture/accounts', { label: 'Agent', username: 'agent@fixture.test', password: 'Load-Secret-9' })).json;
  const load = { environment: 'local', mode: 'load', paths: ['/', '/a'], users: 2, durationSec: 10, thinkMs: 100 };
  const startLoad = (body, token) => write('POST', '/api/qa/apps/fixture/load', body, token);

  await t.test('the route enforces the limits, with plain-language 422s', async () => {
    const refused = async (body, pattern) => {
      const response = await startLoad(body);
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.match(response.json.error, pattern);
    };
    assert.equal((await startLoad(load, null)).status, 403, 'writes need the page token');
    await refused({ ...load, users: 51 }, /1 to 50/);
    await refused({ ...load, durationSec: 301 }, /300 seconds/);
    await refused({ ...load, environment: 'live' }, /never run on production \(Live\)/);
    await refused({ ...load, paths: ['https://evil.example/steal'] }, /not a page of this app/);
    await refused({ ...load, paths: [`${fixture.baseUrl}/`] }, /not a page of this app/);
    await refused({ ...load, paths: ['//evil.example/x'] }, /not a page of this app/);
    await refused({ ...load, mode: 'stress', stress: { startUsers: 1, step: 1, stepEverySec: 10, maxUsers: 40 } }, /limit is 300 seconds/);
    await refused({ ...load, account: 'zzzzzzzz' }, /test accounts for this environment/);
    assert.equal((await startLoad({ ...load, environment: 'nope' })).status, 422);
    assert.equal((await write('POST', '/api/qa/apps/nope/load', load)).status, 404);
    assert.equal(started.length, 0);
    assert.equal(store.listRuns('fixture').length, 0, 'nothing was started');
  });

  await t.test('suggests "/" and the pages of the newest smoke check of that environment', async () => {
    const empty = await call(port, 'GET', '/api/qa/apps/fixture/load-pages?environment=local');
    assert.deepEqual(empty.json, { paths: ['/'], fromRun: null });
    const runId = 'fixture-20260101-000000-smok';
    store.writeSummary({ id: runId, app: 'fixture', environment: { id: 'local', name: 'Local', kind: 'local' }, status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', counts: {}, smoke: { pages: [{ url: `${fixture.baseUrl}/a?tab=2` }, { url: `${fixture.baseUrl}/` }, { url: 'https://elsewhere.example/x' }] } });
    const suggested = await call(port, 'GET', '/api/qa/apps/fixture/load-pages?environment=local');
    assert.deepEqual(suggested.json, { paths: ['/', '/a?tab=2'], fromRun: runId });
    assert.equal((await call(port, 'GET', '/api/qa/apps/fixture/load-pages?environment=nope')).status, 422);
  });

  await t.test('only one test at a time: a cycle blocks a load test and a load test blocks a cycle', async () => {
    await write('POST', '/api/qa/apps/fixture/cases', { text: 'Agent opens the dashboard' });
    const cycle = await write('POST', '/api/qa/apps/fixture/runs', { environment: 'local' });
    assert.equal(cycle.status, 200);
    const blocked = await startLoad(load);
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.error, /test cycle is already running/);
    assert.equal((await write('POST', `/api/qa/runs/${cycle.json.runId}/stop`)).status, 200);
  });

  await t.test('a load test runs: per-second points on the stream, the 3D office, then a report', async () => {
    const before = stream.events.length;
    const response = await startLoad(load);
    assert.equal(response.status, 200);
    const { runId } = response.json;
    const second = await startLoad(load);
    assert.equal(second.status, 409);
    assert.match(second.json.error, /load test is already running/);
    assert.match((await write('POST', '/api/qa/apps/fixture/runs', { environment: 'local' })).json.error, /load test is already running/);
    assert.equal((await write('DELETE', '/api/qa/apps/fixture')).status, 409);

    const summary = await until(async () => {
      const current = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
      return current.status !== 'running' && current;
    }, 40000, 'the load test to finish');
    assert.equal(summary.status, 'passed', JSON.stringify(summary.error || summary.load?.verdict));
    assert.equal(summary.kind, 'load');
    assert.equal(summary.phase, 'report');
    const { load: report } = summary;
    assert.equal(report.timeline.length, 10);
    assert.ok(report.totals.requests > 20);
    assert.equal(report.verdict.tone, 'pass');
    assert.match(report.verdict.headline, /Handled 2 users well/);
    assert.deepEqual(report.plan, { paths: ['/', '/a'], users: 2, durationSec: 10, rampUpSec: 0, thinkMs: 100, account: null });
    assert.deepEqual(report.pages.map((page) => page.path), ['/', '/a']);

    const events = stream.events.slice(before);
    const points = await until(() => {
      const found = stream.events.filter((event) => event.type === 'load' && event.runId === runId);
      return found.length >= 10 && found;
    }, 5000, 'ten load points');
    assert.deepEqual(points.map((point) => point.t), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(Object.keys(points[0]).sort(), ['errorRate', 'errors', 'p50', 'p95', 'requests', 'rps', 'runId', 't', 'type', 'users']);
    assert.ok(points.every((point) => point.users === 2 && point.rps > 0 && point.errors === 0));
    assert.equal(points.at(-1).requests, report.timeline.reduce((sum, point) => sum + point.rps, 0));
    const phases = [...new Set(events.filter((event) => event.type === 'run' && event.run.id === runId).map((event) => event.run.phase))];
    assert.deepEqual(phases, ['setup', 'load', 'report']);
    assert.ok(events.filter((event) => event.type === 'run' && event.run.id === runId).every((event) => event.run.kind === 'load'));

    const state = (await call(port, 'GET', '/api/state')).json;
    assert.equal(state.sessions.find((session) => session.id === runId)?.project, 'QA · Fixture · Local · Load test');
    assert.ok(state.agents.some((agent) => agent.session === runId && agent.type === 'regression-tester'), JSON.stringify(state.agents));

    const [listed] = (await call(port, 'GET', '/api/qa/runs?app=fixture')).json;
    assert.equal(listed.id, runId);
    assert.equal(listed.kind, 'load');
    assert.equal(listed.load.mode, 'load');
    assert.equal(listed.load.users, 2);
    assert.equal(fixture.seen.every((entry) => entry.method === 'GET'), true);
    assert.ok(!JSON.stringify(stream.events).includes('Load-Secret-9'));
    assert.ok(!fs.readFileSync(path.join(process.env.DEVCREW_HOME, 'qa', 'runs', runId, 'summary.json'), 'utf8').includes('Load-Secret-9'));
  });

  await t.test('a stress test stops at once with Stop and reports what ran', async () => {
    const response = await startLoad({ environment: 'local', mode: 'stress', paths: ['/'], thinkMs: 50, stress: { startUsers: 1, step: 1, stepEverySec: 30, maxUsers: 5 } });
    assert.equal(response.status, 200);
    const { runId } = response.json;
    await until(() => stream.events.filter((event) => event.type === 'load' && event.runId === runId).length >= 2, 10000, 'two load points');
    const stopAt = Date.now();
    assert.equal((await write('POST', `/api/qa/runs/${runId}/stop`)).status, 200);
    assert.ok(Date.now() - stopAt < 3000, 'stopped quickly');
    const summary = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.kind, 'stress');
    assert.equal(summary.load.stopped, true);
    assert.ok(summary.load.timeline.length >= 2);
    assert.match(summary.load.verdict.headline, /^Stopped after/);
    assert.equal((await write('POST', `/api/qa/runs/${runId}/stop`)).status, 409);
    assert.equal(office.qa.activeRun(), null);

    const requestsAfterStop = fixture.seen.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(fixture.seen.length, requestsAfterStop, 'no request is sent after Stop');
    assert.equal((await startLoad(load)).status, 200, 'a new test can start after a stop');
    await until(async () => (await call(port, 'GET', '/api/qa/runs?app=fixture')).json[0].status !== 'running', 40000, 'the last load test');
  });

  await t.test('test cycles still compare only with test cycles', async () => {
    // The newest finished runs are load tests (passed); the comparison skips them for the older test cycle.
    assert.equal(store.listRuns('fixture')[0].kind, 'load');
    assert.equal(store.previousRun('fixture', 'local', 'none')?.id, 'fixture-20260101-000000-smok');
    assert.ok(account.id);
  });
});

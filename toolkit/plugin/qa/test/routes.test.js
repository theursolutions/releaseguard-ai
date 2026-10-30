const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { TOKEN, call, freePort, tempHome } = require('./helpers');

const home = tempHome('devcrew-qa-routes-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');
const { runDir } = require('../lib/paths');

/** Stands in for the runner process: the run stays "running" until the test stops it. */
function fakeRunner(started) {
  return (runId, env) => {
    started.push({ runId, env });
    const child = new EventEmitter();
    child.exitCode = null;
    return child;
  };
}

async function startOffice(t) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-qa-public-'));
  fs.writeFileSync(path.join(publicDir, 'qa.html'), '<!doctype html><title>QA</title>');
  const started = [];
  const port = await freePort();
  const office = createOfficeServer({ port, token: TOKEN, publicDir, startQaRunner: fakeRunner(started) });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());
  const { pageToken } = (await call(port, 'GET', '/api/qa/session')).json;
  const write = (method, url, body, token = pageToken) => call(port, method, url, { body, headers: token ? { 'X-Devcrew-Page': token } : {} });
  return { port, write, pageToken, started, office };
}

const environment = { name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test', loginPath: '/login' };

test('QA routes', async (t) => {
  const { port, write, pageToken, started, office } = await startOffice(t);

  await t.test('serves the QA page and a page token', async () => {
    const page = await call(port, 'GET', '/qa');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(pageToken, /^[a-f0-9]{48}$/);
  });

  await t.test('refuses other host names (DNS rebinding)', async () => {
    for (const url of ['/api/qa/session', '/api/qa/apps', '/qa']) assert.equal((await call(port, 'GET', url, { headers: { Host: `evil.example:${port}` } })).status, 403, url);
  });

  await t.test('every write needs the page token', async () => {
    assert.equal((await write('POST', '/api/qa/apps', { name: 'X', environments: [environment] }, null)).status, 403);
    assert.equal((await write('POST', '/api/qa/apps', { name: 'X', environments: [environment] }, 'wrong')).status, 403);
    assert.equal((await write('DELETE', '/api/qa/apps/x', undefined, null)).status, 403);
    assert.equal(store.listAppIds().length, 0);
  });

  await t.test('creates apps, accounts and cases; passwords never come back', async () => {
    const app = await write('POST', '/api/qa/apps', { name: 'Shop', environments: [environment, { name: 'Live', kind: 'production', baseUrl: 'https://shop.example.test' }] });
    assert.equal(app.status, 200);
    assert.equal(app.json.id, 'shop');
    const account = await write('POST', '/api/qa/apps/shop/accounts', { label: 'Agent', username: 'a@shop.test', password: 'Secret-Pass-1' });
    assert.equal(account.status, 200);
    const cases = await write('POST', '/api/qa/apps/shop/cases', { text: '- Agent opens the cart\n- Agent pays', tags: ['cart'] });
    assert.equal(cases.json.length, 2);

    const apps = await call(port, 'GET', '/api/qa/apps');
    assert.deepEqual(apps.json[0].caseCounts, { total: 2, ready: 0, pending: 2, failed: 0 });
    assert.equal(apps.json[0].lastRun, null);
    for (const response of [account, apps, await call(port, 'GET', '/api/qa/apps/shop/cases')]) assert.ok(!response.data.includes('Secret-Pass-1'));
    assert.equal((await call(port, 'GET', '/api/qa/apps/shop/cases')).json[0].lastResult, null);

    // Saving an app again with its id updates it and keeps its cases and accounts.
    const updated = await write('POST', '/api/qa/apps', { id: 'shop', name: 'Shop 2', environments: [environment, { name: 'Live', kind: 'production', baseUrl: 'https://shop.example.test' }] });
    assert.equal(updated.json.name, 'Shop 2');
    assert.equal((await call(port, 'GET', '/api/qa/apps/shop/cases')).json.length, 2);
    assert.equal((await call(port, 'GET', '/api/qa/apps')).json.find((item) => item.id === 'shop').accounts.length, 1);

    const edited = await write('PUT', `/api/qa/apps/shop/cases/${cases.json[0].id}`, { text: 'Agent opens the cart page' });
    assert.equal(edited.json.title, 'Agent opens the cart page');
    assert.equal((await write('POST', `/api/qa/apps/shop/cases/${cases.json[0].id}/relearn`)).json.status, 'pending');
    assert.equal((await write('POST', `/api/qa/apps/shop/cases/${cases.json[1].id}/relearn`, {})).json.status, 'pending', 'an empty JSON body is fine');

    // A case that failed before reasons were stored gets one from its message; bulk re-learn clears it.
    store.setCase('shop', cases.json[0].id, { status: 'failed', prepError: 'No passing test was saved. Claude said: Staging has no leads.' });
    assert.equal((await call(port, 'GET', '/api/qa/apps/shop/cases')).json.find((item) => item.id === cases.json[0].id).prepReason, 'data');
    assert.equal((await write('POST', '/api/qa/apps/shop/relearn', { ids: [cases.json[0].id] })).json[0].status, 'pending');
    assert.equal((await write('POST', '/api/qa/apps/shop/relearn', { ids: ['zzzzzzzz'] })).status, 404);
    assert.equal((await call(port, 'POST', '/api/qa/apps/shop/relearn', { body: { ids: [cases.json[0].id] } })).status, 403, 'writes need the page token');
  });

  await t.test('plain-language 422s, 404s for unknown things, and size limits', async () => {
    const bad = await write('POST', '/api/qa/apps', { name: 'Y', environments: [{ ...environment, baseUrl: 'not a url' }] });
    assert.equal(bad.status, 422);
    assert.match(bad.json.error, /not a valid web address/);
    assert.equal((await call(port, 'GET', '/api/qa/apps/nope/cases')).status, 404);
    assert.equal((await write('PUT', '/api/qa/apps/shop/cases/zzzzzzzz', { text: 'x' })).status, 404);
    assert.equal((await write('DELETE', '/api/qa/apps/shop/accounts/zzzzzzzz')).status, 404);
    assert.equal((await call(port, 'GET', '/api/qa/runs/shop-20260101-000000-zzzz')).status, 404);
    assert.equal((await call(port, 'GET', '/api/qa/runs?app=nope')).status, 404);
    assert.equal((await call(port, 'GET', '/api/qa/nothing-here')).status, 404);
    assert.equal((await write('POST', '/api/qa/apps/shop/cases', 'not json')).status, 400);
    assert.equal((await write('POST', '/api/qa/apps/shop/cases', { text: 'x'.repeat(300 * 1024) })).status, 413);
  });

  await t.test('production is refused unless allowed, and then only readonly cases run', async () => {
    const refused = await write('POST', '/api/qa/apps/shop/runs', { environment: 'live' });
    assert.equal(refused.status, 422);
    assert.match(refused.json.error, /production are turned off/);
    assert.equal((await write('POST', '/api/qa/apps/shop/test-login', { environment: 'live', account: 'x' })).status, 422);

    store.saveApp({ ...store.getApp('shop'), environments: [environment, { id: 'live', name: 'Live', kind: 'production', baseUrl: 'https://shop.example.test', allowProduction: true }] });
    const noReadonly = await write('POST', '/api/qa/apps/shop/runs', { environment: 'live' });
    assert.equal(noReadonly.status, 422);
    assert.match(noReadonly.json.error, /readonly/);
    assert.equal(started.length, 0);
  });

  await t.test('a run needs cases and an account, and only one runs at a time', async () => {
    await write('POST', '/api/qa/apps', { id: 'empty', name: 'Empty', environments: [environment] });
    assert.match((await write('POST', '/api/qa/apps/empty/runs', { environment: 'staging' })).json.error, /no test cases/);
    await write('POST', '/api/qa/apps/empty/cases', { text: 'A case' });
    assert.match((await write('POST', '/api/qa/apps/empty/runs', { environment: 'staging' })).json.error, /Add a test account/);
    assert.match((await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging', parallel: 9 })).json.error, /1 to 6/);
    assert.match((await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging', learnParallel: 0 })).json.error, /learned at the same time/);
    assert.match((await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging', learnModel: 'opus; rm -rf' })).json.error, /Learning speed/);

    const run = await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging', parallel: 2 });
    assert.equal(run.status, 200);
    const { runId } = run.json;
    assert.ok(store.isRunId(runId));
    assert.equal(started[0].env.DEVCREW_QA_OFFICE_TOKEN, TOKEN);
    assert.equal(started[0].env.DEVCREW_HOME, home);
    assert.deepEqual(store.readJson(path.join(runDir(runId), 'run.json'), null), { app: 'shop', environment: 'staging', tags: [], parallel: 2, learnParallel: 4, learnModel: 'fast', smoke: true, performance: true });

    const second = await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging' });
    assert.equal(second.status, 409);
    assert.equal((await write('DELETE', '/api/qa/apps/shop')).status, 409, 'an app cannot be deleted mid-run');
    assert.equal((await call(port, 'GET', `/api/qa/runs/${runId}`)).json.status, 'running');
    assert.equal(office.qa.activeRun(), runId);

    const live = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    assert.deepEqual([live.status, live.phase, live.totals], ['running', 'setup', { toPrepare: 2, toRun: 3 }]);
    assert.equal((await write('POST', `/api/qa/runs/${runId}/stop`, {})).status, 200);
    assert.equal((await call(port, 'GET', `/api/qa/runs/${runId}`)).json.status, 'stopped');
    assert.equal((await write('POST', `/api/qa/runs/${runId}/stop`)).status, 409);
    assert.equal((await call(port, 'GET', '/api/qa/runs?app=shop')).json[0].id, runId);
    assert.equal((await write('POST', '/api/qa/apps/shop/runs', { environment: 'staging' })).status, 200, 'a new run can start after a stop');
    await write('POST', `/api/qa/runs/${started[1].runId}/stop`);

    const [extra] = (await write('POST', '/api/qa/apps/empty/cases', { text: 'Gone soon' })).json;
    assert.equal((await write('DELETE', `/api/qa/apps/empty/cases/${extra.id}`, {})).status, 200, 'DELETE with {}');
    assert.equal((await write('DELETE', '/api/qa/apps/empty')).status, 200, 'DELETE without a body');
  });

  await t.test('serves run files only from the report and artifacts folders', async () => {
    const runId = 'shop-20260101-000000-file';
    const dir = runDir(runId);
    fs.mkdirSync(path.join(dir, 'report', 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'report', 'index.html'), '<script>1</script>');
    fs.writeFileSync(path.join(dir, 'report', '.secret.html'), 'hidden');
    fs.writeFileSync(path.join(dir, 'report', 'tool.exe'), 'binary');
    fs.writeFileSync(path.join(dir, 'artifacts', 'shot.png'), 'png');
    fs.writeFileSync(path.join(dir, 'summary.json'), '{}');
    fs.writeFileSync(path.join(home, 'qa', 'outside.txt'), 'outside');

    const report = await call(port, 'GET', `/api/qa/runs/${runId}/files/report/index.html`);
    assert.equal(report.status, 200);
    assert.equal(report.headers['content-security-policy'], "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; frame-ancestors 'none'");
    const shot = await call(port, 'GET', `/api/qa/runs/${runId}/files/artifacts/shot.png`);
    assert.equal(shot.headers['content-type'], 'image/png');
    assert.match(shot.headers['content-security-policy'], /default-src 'self'; script-src 'self'/);

    for (const url of [
      `/api/qa/runs/${runId}/files/summary.json`,
      `/api/qa/runs/${runId}/files/run.json`,
      `/api/qa/runs/${runId}/files/report/.secret.html`,
      `/api/qa/runs/${runId}/files/report/tool.exe`,
      `/api/qa/runs/${runId}/files/report/..%2f..%2f..%2foutside.txt`,
      `/api/qa/runs/${runId}/files/report%5c..%5c..%5c..%5coutside.txt`,
      `/api/qa/runs/${runId}/files/report/%2e%2e/%2e%2e/%2e%2e/outside.txt`,
      `/api/qa/runs/${runId}/files/report/data`,
      `/api/qa/runs/..%2f..%2fqa/files/report/index.html`,
      `/api/qa/runs/${runId}/files/report/%E0%A4%A`,
    ]) {
      assert.equal((await call(port, 'GET', url)).status, 404, url);
    }
  });

  await t.test('runner events need the office token, are checked, and reach the QA stream (and replay)', async () => {
    const frame = { type: 'frame', runId: 'shop-20260101-000000-live', tile: 'w0-1', label: 'Agent', caseTitle: 'Agent pays', data: Buffer.from('jpeg').toString('base64') };
    const send = (event, token = TOKEN) => call(port, 'POST', '/qa/events', { body: event, headers: token ? { 'X-Devcrew-Token': token } : {} });
    assert.equal((await send(frame, null)).status, 401);
    assert.equal((await send(frame, 'wrong')).status, 401);
    assert.equal((await send({ ...frame, type: 'evil' })).status, 422);
    assert.equal((await send({ ...frame, data: '<script>' })).status, 422);
    assert.equal((await send({ ...frame, tile: '../x' })).status, 422);
    assert.equal((await send(frame)).status, 202);
    const step = { type: 'step', runId: frame.runId, tile: 'w0-1', caseId: 'smoke', caseTitle: 'Smoke check', step: 'Open the dashboard' };
    assert.equal((await send(step)).status, 202);

    // A page that connects now gets the latest run and each tile's latest step, then live events (frames included).
    const events = [];
    const connected = new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/qa/stream', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) if (part.startsWith('data: ')) events.push(JSON.parse(part.slice(6)));
          if (events.some((event) => event.type === 'frame')) {
            req.destroy();
            resolve();
          }
        });
        setTimeout(() => send({ ...frame, caseId: 'smoke' }), 100);
      });
    });
    await connected;
    assert.equal(events[0].type, 'run', 'the latest run event comes first');
    assert.deepEqual(events.find((event) => event.type === 'step'), step);
    assert.deepEqual(events.filter((event) => event.type === 'frame'), [{ ...frame, caseId: 'smoke' }], 'frames are not replayed, only sent live');
  });

  await t.test('the office stream and API keep working as before', async () => {
    assert.equal((await call(port, 'GET', '/api/state')).status, 200);
    assert.equal((await call(port, 'POST', '/events', { body: { kind: 'request', session: 's1', text: 'x' }, headers: { 'X-Devcrew-Token': TOKEN } })).status, 202);
  });
});

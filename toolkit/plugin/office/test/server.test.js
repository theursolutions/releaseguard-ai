const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { createOfficeServer } = require('../server');

const TOKEN = 'test-token-123';

function call(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const post = (port, event, token = TOKEN) => call(port, 'POST', '/events', { body: JSON.stringify(event), headers: { 'Content-Type': 'application/json', 'X-Devcrew-Token': token } });

/** A free local port: the server needs to know its port up front for the Host header check. */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('office server', async (t) => {
  const port = await freePort();
  const office = createOfficeServer({ port, token: TOKEN });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());

  await t.test('rejects events without the right token', async () => {
    assert.equal((await post(port, { kind: 'request', session: 's1' }, 'wrong')).status, 401);
    assert.equal((await call(port, 'POST', '/events', { body: '{}' })).status, 401);
  });

  await t.test('rejects pages served under another host name (DNS rebinding)', async () => {
    assert.equal((await call(port, 'GET', '/api/state', { headers: { Host: `evil.example:${port}` } })).status, 403);
  });

  await t.test('rejects oversized and invalid events', async () => {
    assert.equal((await post(port, { kind: 'tool', text: 'x'.repeat(20000) })).status, 413);
    assert.equal((await post(port, { kind: 'not-a-kind' })).status, 422);
  });

  await t.test('matches a hand-off description to the agent that starts next', async () => {
    const base = { session: 's1', project: 'crm-app' };
    assert.equal((await post(port, { ...base, kind: 'request', agentId: 'main', agentType: 'router', text: '/devcrew:fix' })).status, 202);
    await post(port, { ...base, kind: 'handoff', agentId: 'main', agentType: 'router', target: 'developer', text: 'Fix token expiry' });
    await post(port, { ...base, kind: 'agent.start', agentId: 'a1', agentType: 'developer' });
    await post(port, { ...base, kind: 'tool', agentId: 'a1', agentType: 'developer', tool: 'Edit', text: 'Editing User.php' });

    const state = JSON.parse((await call(port, 'GET', '/api/state')).data);
    const developer = state.agents.find((agent) => agent.id === 'a1');
    assert.equal(state.rooms.length, 6);
    assert.equal(state.crew['regression-tester'].stage, 'regression');
    assert.deepEqual([developer.stage, developer.status, developer.task, developer.text, developer.tools], ['build', 'working', 'Fix token expiry', 'Editing User.php', 1]);

    await post(port, { ...base, kind: 'agent.stop', agentId: 'a1', agentType: 'developer' });
    const after = JSON.parse((await call(port, 'GET', '/api/state')).data);
    assert.equal(after.agents.find((agent) => agent.id === 'a1').status, 'done');
  });

  await t.test('serves the page with a strict content security policy, and nothing outside public/', async () => {
    const page = await call(port, 'GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.equal((await call(port, 'GET', '/..%2fserver.js')).status, 404);
    assert.equal((await call(port, 'GET', '/vendor/../../server.js')).status, 404);
  });
});

test('shows real names and photos only from the developer\'s own crew file', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-people-'));
  fs.mkdirSync(path.join(dataDir, 'crew'));
  fs.writeFileSync(path.join(dataDir, 'crew', 'umer.png'), 'png-bytes');
  fs.writeFileSync(path.join(dataDir, 'secret.png'), 'outside the crew folder');
  fs.writeFileSync(
    path.join(dataDir, 'crew.json'),
    JSON.stringify({
      developer: { name: '  Muhammad   Umer ', title: 'Sr. Full stack developer', photo: 'umer.png' },
      'test-engineer': { name: 'Rafey Hassani', photo: '../secret.png' },
      'code-reviewer': { name: '' },
      '../bad': { name: 'Bad key' },
    }),
  );

  const port = await freePort();
  const office = createOfficeServer({ port, token: TOKEN, dataDir });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());

  const { people } = JSON.parse((await call(port, 'GET', '/api/state')).data);
  assert.deepEqual(people, {
    developer: { name: 'Muhammad Umer', title: 'Sr. Full stack developer', photo: '/people/developer' },
    'test-engineer': { name: 'Rafey Hassani', title: '', photo: null },
  });

  const photo = await call(port, 'GET', '/people/developer');
  assert.equal(photo.status, 200);
  assert.equal(photo.headers['content-type'], 'image/png');
  assert.equal(photo.data, 'png-bytes');
  for (const url of ['/people/test-engineer', '/people/nobody', '/people/..%2Fsecret.png', '/people/__proto__']) {
    assert.equal((await call(port, 'GET', url)).status, 404, url);
  }
});

test('no crew file means no people, and the office works as before', async (t) => {
  const port = await freePort();
  const office = createOfficeServer({ port, token: TOKEN });
  await new Promise((resolve) => office.server.listen(port, '127.0.0.1', resolve));
  t.after(() => office.server.close());
  assert.deepEqual(JSON.parse((await call(port, 'GET', '/api/state')).data).people, {});
  assert.equal((await call(port, 'GET', '/people/developer')).status, 404);
});

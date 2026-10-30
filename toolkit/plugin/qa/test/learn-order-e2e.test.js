// The order of a test cycle with both learned and new cases: the learned ones are tested first, then the new
// ones are learned (by a stand-in `claude` on PATH that saves a ready-made spec) and tested in a second pass.
// Skipped when no Playwright runtime is installed on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { TOKEN, call, freePort, tempHome, installedRuntimeHome, linkRuntime } = require('./helpers');
const { startFixtureApp, USERNAME, PASSWORD } = require('./fixture-app');

const runtimeHome = installedRuntimeHome(process.env.DEVCREW_HOME);
const home = tempHome('devcrew-qa-order-');
const { createOfficeServer } = require('../../office/server');
const store = require('../lib/store');

const spec = (title) => `import { test, expect } from '../../../lib/devcrew-qa';

test(${JSON.stringify(title)}, async ({ as }) => {
  const page = await as('Agent');
  await test.step('Save without a phone number', async () => {
    await page.goto('/leads/create');
    await page.getByLabel('Name').fill('QA lead');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The phone field is required')).toBeVisible();
  });
});
`;

// The stand-in: records its arguments, and for a case whose text says "learnable" writes the test where
// prepare.js looks for it (the case id is in the MCP config's file name). Other cases get a reason tag.
const FAKE = `const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', (chunk) => (prompt += chunk));
process.stdin.on('end', () => {
  const config = args[args.indexOf('--mcp-config') + 1] || '';
  const caseId = (path.basename(config).match(/^mcp-([a-z0-9]+)-/) || [])[1];
  const title = (prompt.match(/^Case title: (.*)$/m) || [])[1] || '';
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ caseId, args, at: Date.now() }) + '\\n');
  let text = 'Saved.';
  if (/learnable/.test(title)) {
    const template = fs.readFileSync(path.join(__dirname, 'spec-template.txt'), 'utf8');
    fs.writeFileSync(path.join(process.cwd(), caseId + '.spec.ts'), template.replace('__TITLE__', JSON.stringify(title)));
  } else text = 'NEEDS DATA: staging has no leads to open.';
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text }));
});
`;

function listen(port) {
  const events = [];
  const req = http.get({ host: '127.0.0.1', port, path: '/api/qa/stream', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) if (part.startsWith('data: ')) events.push({ ...JSON.parse(part.slice(6)), at: Date.now() });
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

test('learned cases are tested first, new ones are learned, then tested', { skip: runtimeHome ? false : 'no Playwright runtime installed (run a QA cycle once, or set DEVCREW_QA_RUNTIME_HOME)', timeout: 6 * 60 * 1000 }, async (t) => {
  t.after(linkRuntime(runtimeHome, home));
  const fixtureApp = await startFixtureApp();
  t.after(() => fixtureApp.server.close());

  const fakeDir = path.join(home, 'fake-bin');
  fs.mkdirSync(fakeDir, { recursive: true });
  fs.writeFileSync(path.join(fakeDir, 'fake-claude.js'), FAKE);
  fs.writeFileSync(path.join(fakeDir, 'spec-template.txt'), spec('__TITLE__').replace('"__TITLE__"', '__TITLE__'));
  fs.writeFileSync(path.join(fakeDir, 'claude.cmd'), '@node "%~dp0fake-claude.js" %*\r\n');
  fs.writeFileSync(path.join(fakeDir, 'claude'), `#!/bin/sh\nexec node "${path.join(fakeDir, 'fake-claude.js')}" "$@"\n`, { mode: 0o755 });
  const log = path.join(home, 'fake-claude.log');
  const oldPath = process.env.PATH;
  // Only the stand-in, Node and the system folders: a real Claude Code on PATH must not be found first.
  const system = process.platform === 'win32' ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
  process.env.PATH = [fakeDir, path.dirname(process.execPath), ...system].join(path.delimiter);
  process.env.FAKE_CLAUDE_LOG = log;
  t.after(() => {
    process.env.PATH = oldPath;
    delete process.env.FAKE_CLAUDE_LOG;
  });

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
  await write('POST', `/api/qa/apps/${app.id}/accounts`, { label: 'Agent', username: USERNAME, password: PASSWORD });

  const [learned, fresh, noData] = (await write('POST', `/api/qa/apps/${app.id}/cases`, { text: 'Agent cannot save a lead without a phone (learned)\nAgent cannot save a lead without a phone (learnable)\nAgent opens the newest lead' })).json;
  fs.writeFileSync(store.specFile(app.id, learned.id), spec(learned.title));
  store.setCase(app.id, learned.id, { status: 'ready', preparedAt: new Date().toISOString() });

  const started = await write('POST', `/api/qa/apps/${app.id}/runs`, { environment: envId, parallel: 2, learnParallel: 2, smoke: false, performance: false });
  assert.equal(started.status, 200, started.data);
  const { runId } = started.json;

  let summary;
  for (let waited = 0; waited < 5 * 60 * 1000; waited += 1000) {
    summary = (await call(port, 'GET', `/api/qa/runs/${runId}`)).json;
    if (summary.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(summary.status, 'passed', JSON.stringify(summary.error || summary));
  assert.deepEqual(summary.counts, { passed: 2, failed: 0, skipped: 0, notPrepared: 1 });
  const byId = new Map(summary.cases.map((item) => [item.id, item]));
  assert.deepEqual([byId.get(learned.id).status, byId.get(fresh.id).status, byId.get(noData.id).status], ['passed', 'passed', 'notPrepared']);
  assert.ok(byId.get(fresh.id).attachments, 'the second pass keeps its own evidence folder');

  // The phases, in order, without repeats.
  const phases = stream.events.filter((event) => event.type === 'run' && event.run.id === runId).map((event) => event.run.phase).filter((phase, index, all) => phase !== all[index - 1]);
  assert.deepEqual(phases.filter((phase) => ['test', 'prepare', 'retest'].includes(phase)), ['test', 'prepare', 'retest']);

  // The learned case finished before learning started; the new case ran after it was learned.
  const finished = (id) => stream.events.find((event) => event.type === 'case' && event.caseId === id && event.status !== 'running')?.at;
  const firstPrep = stream.events.find((event) => event.type === 'prep')?.at;
  assert.ok(finished(learned.id) <= firstPrep, 'the learned case was tested before any learning');
  assert.ok(finished(fresh.id) > firstPrep);

  // Fast learning passes Sonnet; two new cases, both learned.
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((entry) => entry.caseId).sort(), [fresh.id, noData.id].sort());
  for (const entry of calls) assert.equal(entry.args[entry.args.indexOf('--model') + 1], 'sonnet');

  // The case that couldn't be learned keeps its reason, without the tag in the message.
  const cases = (await call(port, 'GET', `/api/qa/apps/${app.id}/cases`)).json;
  const failed = cases.find((item) => item.id === noData.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.prepReason, 'data');
  assert.match(failed.prepError, /staging has no leads/);
  assert.doesNotMatch(failed.prepError, /NEEDS DATA:/);
});

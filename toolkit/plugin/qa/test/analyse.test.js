// Finding a failed case's root cause, with a fake Claude Code process injected in place of the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { tempHome } = require('./helpers');

tempHome('devcrew-qa-analyse-');
process.env.DEVCREW_OFFICE_PORT = '1';
const store = require('../lib/store');
const { analyseCase, planAnalysis, MAX_CASES } = require('../analyse');
const { handleMessage, toolsFor } = require('../mcp-server');

const USERNAME = 'agent@shop.test';
const PASSWORD = 'Shop-Pa55word!';
const app = store.saveApp({ name: 'Shop', environments: [{ name: 'Staging', kind: 'staging', baseUrl: 'https://staging.shop.test' }] });
const envId = app.environments[0].id;
store.addAccount(app.id, { label: 'Agent', username: USERNAME, password: PASSWORD });
const [item] = store.addCases(app.id, { text: 'Agent exports the leads list' });

const caseEntry = {
  id: item.id,
  title: item.title,
  status: 'failed',
  error: "expect(locator).toBeVisible() failed\nLocator: getByRole('button', { name: 'Export' })",
  diagnosis: {
    steps: [{ title: 'Log in as Agent', status: 'passed', durationMs: 900 }, { title: 'Find the export button', status: 'failed', durationMs: 2000, error: 'element(s) not found' }],
    failedStep: 'Find the export button',
    expected: 'The button "Export" is visible',
    actual: 'The button "Export" was not found on the page after 2 s',
    url: 'https://staging.shop.test/leads',
    reproduce: [],
    evidence: { failedRequests: [{ method: 'GET', url: 'https://staging.shop.test/api/leads', status: 500 }], consoleErrors: [`Login for ${USERNAME} expired`], pageErrors: [] },
    analysis: null,
    analysisStatus: 'pending',
  },
};

const ANSWER = { category: 'app-bug', rootCause: 'GET /api/leads returns 500, so the list and its Export button never render.', evidence: ['GET /api/leads returned 500'], reproduce: ['Log in as Agent', 'Open /leads'], suggestion: 'Fix the leads API.', confidence: 'high' };

/** A fake `claude`: records its arguments and prompt, then prints the given stream-json lines. */
function fakeClaude(lines, calls) {
  return async (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    let prompt = '';
    child.stdin.on('data', (chunk) => (prompt += chunk));
    child.stdin.on('end', () => {
      calls.at(-1).prompt = prompt;
      child.stdout.end(lines.map((line) => JSON.stringify(line)).join('\n'));
      setImmediate(() => {
        child.exitCode = 0;
        child.emit('close', 0);
      });
    });
    return child;
  };
}
const init = { type: 'system', subtype: 'init', mcp_servers: [{ name: 'devcrew_qa', status: 'connected' }] };
const result = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text });

test('a JSON answer becomes the analysis; Claude gets the evidence but no username or password', async () => {
  const calls = [];
  const events = [];
  const outcome = await analyseCase({
    appId: app.id,
    envId,
    runId: 'shop-20261028-120000-abcd',
    caseEntry,
    snapshot: `- textbox "Email": ${USERNAME}\n- heading "Leads"`,
    previousStatus: 'passed',
    onEvent: (event) => events.push(event),
    startProcess: fakeClaude([init, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__devcrew_qa__qa_explore', input: { as: 'Agent', path: '/leads' } }] } }, result(`Checked.\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)], calls),
  });
  assert.deepEqual(outcome, { analysisStatus: 'done', analysis: ANSWER });

  const [{ command, args, prompt }] = calls;
  assert.equal(command, 'claude');
  for (const flag of ['-p', '--verbose', '--no-session-persistence', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'stream-json']);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__devcrew_qa__qa_explore');
  assert.ok(!args.includes('--bare'));
  assert.ok(!args.join(' ').includes('Agent exports'), 'the case text goes on stdin, not the command line');

  assert.match(prompt, /Agent exports the leads list/);
  assert.match(prompt, /In the previous run on this environment this case passed/);
  assert.match(prompt, /Failed at step: Find the export button/);
  assert.match(prompt, /GET https:\/\/staging\.shop\.test\/api\/leads returned 500/);
  assert.match(prompt, /heading "Leads"/);
  assert.match(prompt, /base URL https:\/\/staging\.shop\.test/);
  assert.ok(!prompt.includes(USERNAME), 'the username reached Claude');
  assert.ok(!prompt.includes(PASSWORD), 'the password reached Claude');

  assert.deepEqual(events.map((event) => event.status), ['investigating', 'investigating', 'done']);
  assert.equal(events[1].message, 'Exploring /leads');
  assert.ok(events.every((event) => event.type === 'analysis' && event.caseId === item.id));
});

test('an answer that is not an analysis is marked failed', async () => {
  const outcome = await analyseCase({ appId: app.id, envId, runId: 'r', caseEntry, startProcess: fakeClaude([init, result('I think the button moved, but I am not sure.')], []) });
  assert.equal(outcome.analysisStatus, 'failed');
  assert.equal(outcome.analysis, null);
  assert.match(outcome.analysisError, /could not be read/);

  const stopped = await analyseCase({ appId: app.id, envId, runId: 'r', caseEntry, startProcess: fakeClaude([init, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Invalid API key' }], []) });
  assert.equal(stopped.analysisStatus, 'failed');
  assert.match(stopped.analysisError, /Invalid API key/);
});

test('without Claude Code the analysis is unavailable', async () => {
  const missing = async () => {
    throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
  };
  const events = [];
  const outcome = await analyseCase({ appId: app.id, envId, runId: 'r', caseEntry, onEvent: (event) => events.push(event), startProcess: missing });
  assert.equal(outcome.analysisStatus, 'unavailable');
  assert.equal(outcome.analysis, null);
  assert.match(outcome.analysisError, /not installed/);
  assert.equal(events.at(-1).status, 'unavailable');
});

test('only real cases are investigated, at most six per run', () => {
  const failed = (id) => ({ id, diagnosis: {} });
  const plan = planAnalysis([...Array.from({ length: 8 }, (_, n) => failed(`case000${n}`)), { id: 'passed01' }, failed('smoke')]);
  assert.equal(MAX_CASES, 6);
  assert.deepEqual(plan.now.map((entry) => entry.id), ['case0000', 'case0001', 'case0002', 'case0003', 'case0004', 'case0005']);
  assert.deepEqual(plan.tooMany.map((entry) => entry.id), ['case0006', 'case0007']);
  assert.deepEqual(plan.smoke.map((entry) => entry.id), ['smoke']);
});

test('while analysing, the MCP server offers only qa_explore', async () => {
  const tools = toolsFor('analyse');
  const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, () => ({}), tools);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['qa_explore']);
  const save = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'qa_save_case', arguments: { code: '' } } }, () => ({}), tools);
  assert.equal(save.error.code, -32602);
  assert.deepEqual(toolsFor('prepare').map((tool) => tool.name), ['qa_explore', 'qa_try_case', 'qa_save_case']);
});

test('the QA stream accepts analysis progress and the analyse phase', () => {
  const { sanitizeQaEvent } = require('../routes');
  const runId = 'shop-20261028-120000-abcd';
  assert.deepEqual(sanitizeQaEvent({ type: 'analysis', runId, caseId: item.id, status: 'investigating', message: 'Exploring /leads', extra: 'dropped' }), { type: 'analysis', runId, caseId: item.id, status: 'investigating', message: 'Exploring /leads' });
  assert.equal(sanitizeQaEvent({ type: 'analysis', runId, caseId: item.id, status: 'guessing' }), null);
  assert.equal(sanitizeQaEvent({ type: 'analysis', runId, caseId: '../x', status: 'done' }), null);
  const run = sanitizeQaEvent({ type: 'run', run: { id: runId, status: 'running', phase: 'analyse' } });
  assert.equal(run.run.phase, 'analyse');
});

// Finds the root cause of one failed case: a background Claude Code reads what the test did and what the
// browser saw, may open the page again as the same account through the QA MCP server (qa_explore only, so
// it can look but never save a test), and answers with one JSON object. Same safety as prepare.js: no
// built-in tools (no files, no shell), account labels only, never usernames or passwords. The analysis is
// advice next to the result: it never changes whether the case passed or failed.
const fs = require('fs');
const store = require('./lib/store');
const { casesDir } = require('./lib/paths');
const { redact } = require('./lib/login');
const { parseAnalysis } = require('./lib/diagnose');
const { redactSecrets } = require('./lib/playwright-run');
const { start, killTree } = require('./lib/spawn');
const { describeToolUse, streamParser, writeMcpConfig, SERVER } = require('./prepare');

const TIMEOUT_MS = 3 * 60 * 1000;
// At most this many failures of one run are investigated, this many at the same time.
const MAX_CASES = 6;
const IN_PARALLEL = 2;
const ALLOWED_TOOLS = [`mcp__${SERVER}__qa_explore`];
const SNAPSHOT_LIMIT = 6000;
const SPEC_LIMIT = 6000;

// One line on purpose, and without double quotes: on Windows it may pass through cmd.exe.
const RULES = [
  'You find the root cause of one failed automated browser test for a QA team that has no source code, only the running web app.',
  'Use only the devcrew QA tool qa_explore, and only to look: open the page as the same account to check your idea.',
  'Never submit a form that creates, changes or deletes data unless the failed step did exactly that.',
  'Decide between: app-bug (the app is broken), test-outdated (the app changed on purpose, for example a renamed button, and the test needs updating), environment (a server, data or account problem), flaky (timing; it works when tried again).',
  'Cite concrete evidence, for example: POST /leads returned 500, or: the button is now called Save lead.',
  'Write reproduce steps a human tester can follow. Refer to accounts by label only. Be honest about confidence.',
  'Your final answer is exactly one JSON object and nothing else.',
].join(' ');

const MARK = { passed: '[passed]', failed: '[FAILED]', skipped: '[not reached]' };
const seconds = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)} s`;

function lastRunLine(previousStatus) {
  if (previousStatus === 'passed') return 'In the previous run on this environment this case passed, so something changed since then.';
  if (['failed', 'timedOut', 'interrupted'].includes(previousStatus)) return 'In the previous run on this environment this case failed too.';
  return 'There is no earlier result for this case on this environment.';
}

/** The prompt, sent on stdin. Every username and password is masked before it is sent. */
function buildPrompt({ app, environment, item, labels, caseEntry, spec, snapshot, previousStatus }) {
  const diagnosis = caseEntry.diagnosis || {};
  const evidence = diagnosis.evidence || {};
  const list = (items, format) => (items && items.length ? items.map((entry) => `- ${format(entry)}`) : ['- none']);
  return [
    'Find the root cause of this failed QA test case.',
    '',
    `App: ${app.name}`,
    `Environment: ${environment.name} (${environment.kind}), base URL ${environment.baseUrl}`,
    `Test accounts (use the label with qa_explore): ${labels.join(', ')}`,
    `Case title: ${item?.title || caseEntry.title}`,
    'Case:',
    item?.text || caseEntry.title,
    '',
    lastRunLine(previousStatus),
    '',
    'What the test did (its top-level steps, in order):',
    ...(diagnosis.steps || []).map((step, index) => `${index + 1}. ${MARK[step.status] || ''} ${step.title} (${seconds(step.durationMs)})${step.error ? `: ${step.error}` : ''}`),
    '',
    `Failed at step: ${diagnosis.failedStep || 'not inside a step'}`,
    `Expected: ${diagnosis.expected || 'unknown'}`,
    `Actual: ${diagnosis.actual || 'unknown'}`,
    `Page address at the failure: ${diagnosis.url || 'unknown'}`,
    'Error from Playwright:',
    String(caseEntry.error || '').slice(0, 1500),
    '',
    'Failed requests to the app during the test:',
    ...list(evidence.failedRequests, (request) => `${request.method} ${request.url} returned ${request.status || 'no answer'}`),
    'Console errors:',
    ...list(evidence.consoleErrors, String),
    'Uncaught page errors:',
    ...list(evidence.pageErrors, String),
    '',
    'Accessibility snapshot of the page at the failure:',
    snapshot ? snapshot.slice(0, SNAPSHOT_LIMIT) : '(none)',
    '',
    'The saved test:',
    spec ? spec.slice(0, SPEC_LIMIT) : '(not available)',
    '',
    'How to work:',
    '1. Read all of the above and form an idea of why it failed.',
    '2. Check it with qa_explore (as = the account label the test logged in with, path = the page): is the element there under another name, does the request still fail, does it work now?',
    '3. Answer with one JSON object only, no other text, in this shape:',
    '{"category": "app-bug" | "test-outdated" | "environment" | "flaky", "rootCause": "one or two plain sentences a tester understands", "evidence": ["up to 5 short, concrete facts you saw"], "reproduce": ["steps a human tester can follow"], "suggestion": "what to do next, in one or two sentences", "confidence": "high" | "medium" | "low"}',
  ].join('\n');
}

const NOT_FOUND = /not recognized as an internal or external command|command not found|no such file or directory/i;

/**
 * Investigates one failed case and resolves { analysisStatus: 'done'|'failed'|'unavailable', analysis, analysisError }.
 * onEvent receives { type: 'analysis', runId, caseId, status: 'investigating'|'done'|'failed'|'unavailable', message }.
 * startProcess is lib/spawn's start; tests pass a fake.
 */
async function analyseCase({ appId, envId, runId, caseEntry, snapshot = '', previousStatus, onEvent = () => {}, timeoutMs = TIMEOUT_MS, startProcess = start }) {
  const app = store.getApp(appId);
  const environment = store.getEnvironment(app, envId);
  const accounts = store.accountsFor(appId, envId);
  const item = store.listCases(appId).find((entry) => entry.id === caseEntry.id);
  const mask = (text) => accounts.reduce((clean, account) => redact(clean, account), String(text ?? ''));
  const emit = (status, message) => onEvent({ type: 'analysis', runId, caseId: caseEntry.id, status, message: mask(message) });
  const finish = (analysisStatus, analysis, analysisError, message) => {
    emit(analysisStatus, message || analysisError || 'Root cause found');
    return { analysisStatus, analysis, ...(analysisError ? { analysisError: mask(analysisError) } : {}) };
  };

  let spec = '';
  try {
    spec = fs.readFileSync(store.specFile(appId, caseEntry.id), 'utf8');
  } catch {
    // Investigated without the test's code.
  }
  const prompt = mask(buildPrompt({ app, environment, item, labels: accounts.map((account) => account.label), caseEntry, spec, snapshot: redactSecrets(snapshot, accounts), previousStatus }));

  emit('investigating', 'Starting');
  const mcpConfig = writeMcpConfig({ appId, envId, caseId: caseEntry.id, runId, mode: 'analyse' });
  const parser = streamParser((name, input) => emit('investigating', describeToolUse(name, input)));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfig, '--allowedTools', ALLOWED_TOOLS.join(','), '--append-system-prompt', RULES];

  let timedOut = false;
  let spawnError = null;
  let stderr = '';
  try {
    const child = await startProcess('claude', args, { cwd: casesDir(appId), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => parser.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.stdin.on('error', () => {});
    // The case text goes in on stdin, never on the command line, so it cannot reach a shell.
    child.stdin.end(prompt);
    await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(timer);
    parser.end();
  } catch (error) {
    spawnError = error;
  } finally {
    fs.rmSync(mcpConfig, { force: true });
  }

  const { result } = parser.state;
  if (spawnError?.code === 'ENOENT' || (!result && !timedOut && NOT_FOUND.test(stderr))) {
    return finish('unavailable', null, 'Claude Code is not installed or not on PATH on this computer, so no root cause was looked for.');
  }
  if (spawnError) return finish('failed', null, `Claude Code could not start: ${spawnError.message}`);
  if (timedOut) return finish('failed', null, 'Finding the root cause took longer than 3 minutes and was stopped.');
  const said = (result?.text || stderr || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!result || result.isError) return finish('failed', null, `Claude Code stopped with an error: ${said || 'no details'}`);
  const analysis = parseAnalysis(result.text);
  if (!analysis) return finish('failed', null, 'Claude Code’s answer could not be read as a root-cause analysis.');
  // Only passwords are removed from the answer: a short username such as "admin" is also an ordinary word,
  // and the report shows the username anyway.
  const clean = (text) => redactSecrets(text, accounts);
  return finish('done', {
    ...analysis,
    rootCause: clean(analysis.rootCause),
    evidence: analysis.evidence.map(clean),
    reproduce: analysis.reproduce.map(clean),
    suggestion: clean(analysis.suggestion),
  }, null, 'Root cause found');
}

/** Which failures get investigated: real cases only (not the smoke check), the first MAX_CASES of them. */
function planAnalysis(cases) {
  const failed = cases.filter((entry) => entry.diagnosis);
  const smoke = failed.filter((entry) => entry.id === 'smoke');
  const investigate = failed.filter((entry) => entry.id !== 'smoke');
  return { now: investigate.slice(0, MAX_CASES), tooMany: investigate.slice(MAX_CASES), smoke };
}

module.exports = { analyseCase, planAnalysis, buildPrompt, RULES, ALLOWED_TOOLS, MAX_CASES, IN_PARALLEL, TIMEOUT_MS };

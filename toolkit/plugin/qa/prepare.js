// Prepares one case: a background Claude Code explores the app through the QA MCP server, writes a Playwright
// test, tries it until it passes and saves it. Claude gets no built-in tools (no files, no shell) and only
// sees account labels. Runs once per new or edited case; prepared cases replay without AI.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../office/lib/config');
const store = require('./lib/store');
const { qaHome, casesDir } = require('./lib/paths');
const { FIXTURE_IMPORT } = require('./lib/validate');
const { redactSecrets } = require('./lib/playwright-run');
const { start, killTree } = require('./lib/spawn');
const { prepReasonOf, withoutTag } = require('./lib/prep-reason');

const TIMEOUT_MS = 4 * 60 * 1000;
// "fast" learns with Sonnet; "default" uses the model Claude Code is set to on this computer.
const LEARN_MODELS = { fast: 'sonnet', default: null };
const SERVER = 'devcrew_qa';
const TOOL_NAMES = ['qa_explore', 'qa_try_case', 'qa_save_case'];
const ALLOWED_TOOLS = TOOL_NAMES.map((name) => `mcp__${SERVER}__${name}`);

// One line on purpose: on Windows it may pass through cmd.exe, where a line break ends the command.
const RULES = [
  'You prepare one automated browser test for a QA team that has no source code, only the running web app.',
  'Use only the devcrew QA tools. Explore first, then write the test, try it until it passes (at most 5 tries), then save it.',
  `The file imports only from '${FIXTURE_IMPORT}' and contains exactly one test whose title is the case title.`,
  'Use getByRole, getByLabel and getByText locators and web-first expect assertions; no fixed waits.',
  'Wrap each meaningful step in test.step with a short human name.',
  'Never write usernames, passwords or credential placeholders in the test: as(label) logs in.',
  'Never navigate outside the app origin. Do not delete or change data the case does not ask for.',
  'If the case cannot be tested as written, do not save; start your answer with the reason tag NEEDS DATA: (the environment lacks records the case needs), BLOCKED: (a captcha, email, SMS or other step a browser test cannot do), DIFFERENT: (the app does not work the way the case says) or UNCLEAR: (the case is too vague to test), then say why in one sentence.',
].join(' ');

const EXAMPLE = `import { test, expect } from '${FIXTURE_IMPORT}';

test('<the case title, exactly>', async ({ as }) => {
  const page = await as('<account label>');   // a new browser, already logged in, baseURL set
  await test.step('Open new lead form', async () => {
    await page.goto('/leads/create');
  });
  await test.step('Save without a phone number', async () => {
    await page.getByLabel('Name').fill('QA lead');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The phone field is required')).toBeVisible();
  });
});`;

function buildPrompt({ app, environment, item, labels }) {
  return [
    'Prepare an automated test for this QA test case.',
    '',
    `App: ${app.name}`,
    `Environment: ${environment.name} (${environment.kind}), base URL ${environment.baseUrl}`,
    `Test accounts (use the label with as()): ${labels.join(', ')}`,
    `Case title: ${item.title}`,
    'Case:',
    item.text,
    '',
    'How to work:',
    '1. qa_explore: look at the pages the case needs, as the right account (as = label, path = a path inside the app, optional click/fill actions).',
    '2. Write the whole test file in this shape (TypeScript, one test, title = the case title):',
    EXAMPLE,
    '   For two users in one test, call as() twice: const admin = await as(\'Admin\'); opens a second browser.',
    '   Only the fixture is available: no require, process, fs, fetch, eval, this, [name] access or file paths.',
    '3. qa_try_case with the code. Read the error and snapshot, fix, and try again (at most 5 tries).',
    '4. qa_save_case with the passing code. It runs once more and saves only if it passes.',
  ].join('\n');
}

/** "mcp__devcrew_qa__qa_explore" + input → "Exploring /leads". Shown on the QA page and in the office. */
function describeToolUse(name, input = {}) {
  if (name.endsWith('qa_explore')) return typeof input.path === 'string' && /^\/[\w\-./]{0,60}$/.test(input.path) ? `Exploring ${input.path}` : 'Exploring the app';
  if (name.endsWith('qa_try_case')) return 'Trying the test';
  if (name.endsWith('qa_save_case')) return 'Saving the test';
  return 'Working';
}

/** Reads Claude Code's stream-json output line by line. */
function streamParser(onToolUse) {
  let buffer = '';
  const state = { result: null, mcpFailed: false };
  const handle = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === 'system' && message.subtype === 'init') {
      state.mcpFailed = (message.mcp_servers || []).some((server) => server.name === SERVER && server.status !== 'connected');
    } else if (message.type === 'assistant') {
      for (const part of message.message?.content || []) if (part.type === 'tool_use') onToolUse(part.name, part.input);
    } else if (message.type === 'result') {
      state.result = { isError: Boolean(message.is_error) || message.subtype !== 'success', text: String(message.result || message.subtype || '') };
    }
  };
  return {
    state,
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handle);
    },
    end: () => buffer && handle(buffer),
  };
}

/** The MCP config for one Claude Code run. mode 'analyse' (analyse.js) gives it qa_explore only. */
function writeMcpConfig({ appId, envId, caseId, runId, mode = 'prepare' }) {
  const dir = path.join(qaHome(), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mcp-${caseId}-${crypto.randomBytes(4).toString('hex')}.json`);
  const server = {
    command: process.execPath,
    args: [path.join(__dirname, 'mcp-server.js'), '--app', appId, '--env', envId, '--case', caseId, ...(mode === 'analyse' ? ['--mode', 'analyse'] : [])],
    // Passed explicitly: an MCP server does not always inherit Claude Code's environment.
    env: {
      DEVCREW_HOME: config.dataDir(),
      DEVCREW_OFFICE_PORT: String(config.port()),
      DEVCREW_QA_OFFICE_TOKEN: process.env.DEVCREW_QA_OFFICE_TOKEN || config.token(),
      DEVCREW_QA_RUN: runId || `prepare-${caseId}`,
    },
  };
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER]: server } }), { mode: 0o600 });
  return file;
}

function failureMessage({ timedOut, timeoutMs, spawnError, state, stderr, lastStep }) {
  if (timedOut) {
    const where = lastStep ? ` It stopped while: ${lastStep}.` : ' Claude Code never started working on it.';
    return `Preparing took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.${where} Try "Re-learn", or split the case into smaller cases.`;
  }
  if (spawnError) return spawnError.code === 'ENOENT' ? 'Claude Code is not installed or not on PATH on this computer.' : `Claude Code could not start: ${spawnError.message}`;
  if (state.mcpFailed) return 'The QA browser tools could not start for Claude Code.';
  const said = (state.result?.text || stderr || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (state.result?.isError) return `Claude Code stopped with an error: ${said || 'no details'}`;
  return `No passing test was saved. ${said ? `Claude said: ${said}` : ''}`.trim();
}

/**
 * Prepares one case and resolves the updated case. onEvent receives
 * { type: 'prep', runId, appId, caseId, tile, status: 'preparing'|'ready'|'failed', message }.
 */
async function prepareCase({ appId, envId, caseId, runId = '', onEvent = () => {}, timeoutMs = TIMEOUT_MS, model = 'fast' }) {
  const app = store.getApp(appId);
  const environment = store.getEnvironment(app, envId);
  const item = store.listCases(appId).find((entry) => entry.id === caseId);
  if (!item) throw new store.QaError(404, 'case not found');
  const accounts = store.accountsFor(appId, envId);
  // tile = the explorer's live view; the test runs it tries show as `${tile}-1`.
  const emit = (status, message) => onEvent({ type: 'prep', runId, appId, caseId, tile: `prep-${caseId}`, status, message: redactSecrets(message, accounts) });

  const finish = (status, prepError, message) => {
    const changes =
      status === 'ready'
        ? { status, prepError: null, prepReason: null, preparedAt: new Date().toISOString() }
        : { status, prepError: redactSecrets(withoutTag(prepError), accounts), prepReason: prepReasonOf(prepError) };
    const updated = store.setCase(appId, caseId, changes);
    emit(status, message || changes.prepError);
    return updated;
  };

  if (accounts.length === 0) return finish('failed', `There is no test account for ${environment.name}. Add one, then run again.`);

  store.setCase(appId, caseId, { status: 'preparing', prepError: null, prepReason: null });
  emit('preparing', 'Starting');

  const startedAt = Date.now();
  const mcpConfig = writeMcpConfig({ appId, envId, caseId, runId });
  // The last thing Claude did, so a timeout can say where it got stuck.
  let lastStep = '';
  const parser = streamParser((name, input) => {
    lastStep = describeToolUse(name, input);
    emit('preparing', lastStep);
  });
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfig, '--allowedTools', ALLOWED_TOOLS.join(','), '--append-system-prompt', RULES];
  if (LEARN_MODELS[model]) args.push('--model', LEARN_MODELS[model]);

  let timedOut = false;
  let spawnError = null;
  let stderr = '';
  try {
    const child = await start('claude', args, { cwd: casesDir(appId), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => parser.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    // The case text goes in on stdin, never on the command line, so it cannot reach a shell.
    child.stdin.end(buildPrompt({ app, environment, item, labels: accounts.map((account) => account.label) }));
    await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(timer);
    parser.end();
  } catch (error) {
    spawnError = error;
  } finally {
    fs.rmSync(mcpConfig, { force: true });
  }

  const saved = (() => {
    try {
      return fs.statSync(store.specFile(appId, caseId)).mtimeMs >= startedAt - 1000;
    } catch {
      return false;
    }
  })();
  if (saved && !timedOut) return finish('ready', null, 'Ready');
  return finish('failed', failureMessage({ timedOut, timeoutMs, spawnError, state: parser.state, stderr, lastStep }));
}

module.exports = { prepareCase, buildPrompt, describeToolUse, streamParser, writeMcpConfig, RULES, ALLOWED_TOOLS, SERVER, LEARN_MODELS, TIMEOUT_MS };

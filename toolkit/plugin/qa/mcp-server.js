#!/usr/bin/env node
// The only tools the background Claude Code gets while it prepares one case (prepare.js starts it):
//   qa_explore    look at the app in a logged-in browser
//   qa_try_case   run a draft test once
//   qa_save_case  save the test once it passes
// MCP over stdio: JSON-RPC 2.0, one message per line. stdout carries protocol messages only.
// Claude sees account labels only; usernames and passwords are filled in here and masked in every reply.
//   node mcp-server.js --app <appId> --env <envId> --case <caseId> [--mode analyse]
// With --mode analyse (analyse.js, finding why a case failed) only qa_explore exists: nothing can be saved.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const store = require('./lib/store');
const { qaHome, casesDir } = require('./lib/paths');
const { validateSpec } = require('./lib/validate');
const { loginOnPage, redact } = require('./lib/login');
const { loadPlaywright } = require('./lib/runtime');
const { postQa } = require('./lib/events');
const { installLib, testEnv, writeConfig, runPlaywright, resultsOf, stripAnsi } = require('./lib/playwright-run');
const { killTree } = require('./lib/spawn');

const PROTOCOL_VERSION = '2025-06-18';
const SNAPSHOT_LIMIT = 8000;
const TRY_TIMEOUT_MS = 4 * 60 * 1000;
const MAX_ACTIONS = 10;
const FRAME_INTERVAL_MS = 500;

const TOOLS = [
  {
    name: 'qa_explore',
    description: 'Open the app in a browser logged in as one test account, optionally go to a path and click or fill things, and get the page back as an accessibility snapshot. The browser for each account stays open between calls.',
    inputSchema: {
      type: 'object',
      properties: {
        as: { type: 'string', description: 'The test account label, for example "Agent".' },
        path: { type: 'string', description: 'A path inside the app, for example /leads. Leave it out to stay on the current page.' },
        actions: {
          type: 'array',
          description: 'Done in order after opening the path. At most 10.',
          items: {
            type: 'object',
            properties: {
              click: { type: 'string', description: 'Visible text or accessible name of a button, link or element to click.' },
              fill: {
                type: 'object',
                properties: { field: { type: 'string', description: 'Field label or placeholder.' }, value: { type: 'string', description: 'Text to type. {{username}} and {{password}} are filled in with the account\'s details.' } },
                required: ['field', 'value'],
              },
            },
          },
        },
      },
      required: ['as'],
    },
  },
  {
    name: 'qa_try_case',
    description: 'Run a draft test file once, headless, and get back whether it passed, the error and an accessibility snapshot of the page where it failed.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The whole TypeScript test file.' } }, required: ['code'] },
  },
  {
    name: 'qa_save_case',
    description: 'Save the test file as this case\'s test. It is run once more first and is saved only if it passes.',
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The whole TypeScript test file.' } }, required: ['code'] },
  },
];

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? '' : String(argv[index + 1] || '');
  };
  return { appId: value('app'), envId: value('env'), caseId: value('case'), mode: value('mode') === 'analyse' ? 'analyse' : 'prepare' };
}

/** The tools of a mode: preparing gets all three, analysing a failure only gets to look. */
const toolsFor = (mode) => (mode === 'analyse' ? TOOLS.filter((tool) => tool.name === 'qa_explore') : TOOLS);

function createExplorer({ appId, envId, caseId, mode = 'prepare' }) {
  const app = store.getApp(appId);
  const environment = store.getEnvironment(app, envId);
  const item = store.listCases(appId).find((entry) => entry.id === caseId);
  if (!item) throw new Error('case not found');
  const accounts = store.accountsFor(appId, envId);
  const analysing = mode === 'analyse';
  const tile = `${analysing ? 'why' : 'prep'}-${caseId}`;
  const shownTitle = `${analysing ? 'Investigating' : 'Preparing'}: ${item.title}`;
  const runId = process.env.DEVCREW_QA_RUN || `prepare-${caseId}`;
  const pages = new Map();
  let browser = null;

  // Usernames and passwords of every account are masked in anything returned to Claude.
  const mask = (text) => accounts.reduce((clean, account) => redact(clean, account), String(text ?? ''));

  const accountFor = (label) => accounts.find((account) => account.label.toLowerCase() === String(label || '').toLowerCase());

  async function pageFor(account) {
    if (pages.has(account.label)) return pages.get(account.label);
    browser = browser || (await loadPlaywright().chromium.launch({ headless: true }));
    const context = await browser.newContext({ baseURL: `${environment.baseUrl}/`, ignoreHTTPSErrors: environment.kind !== 'production' });
    const page = await context.newPage();
    let lastSent = 0;
    await page.screencast
      .start({
        size: { width: 960, height: 600 },
        quality: 55,
        onFrame: ({ data }) => {
          if (Date.now() - lastSent < FRAME_INTERVAL_MS) return;
          lastSent = Date.now();
          postQa({ type: 'frame', runId, tile, caseId, label: account.label, caseTitle: shownTitle, data: data.toString('base64') });
        },
      })
      .catch(() => {});
    await loginOnPage(page, account, environment);
    pages.set(account.label, page);
    return page;
  }

  const target = (page, name) => page.getByRole('button', { name }).or(page.getByRole('link', { name })).or(page.getByText(name)).first();
  const field = (page, name) => page.getByLabel(name).or(page.getByPlaceholder(name)).first();
  const fillValue = (value, account) => String(value).replace(/\{\{\s*username\s*\}\}/g, account.username).replace(/\{\{\s*password\s*\}\}/g, account.password);

  async function explore({ as: label, path: appPath, actions = [] } = {}) {
    const account = accountFor(label);
    if (!account) return `No test account labelled "${label}". Available: ${accounts.map((entry) => entry.label).join(', ') || 'none'}.`;
    if (appPath !== undefined && (typeof appPath !== 'string' || !appPath.startsWith('/') || appPath.startsWith('//'))) return 'path must be a path inside the app that starts with /, for example /leads.';

    const page = await pageFor(account);
    const notes = [];
    try {
      if (appPath) await page.goto(`${environment.baseUrl}${appPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      for (const action of (Array.isArray(actions) ? actions : []).slice(0, MAX_ACTIONS)) {
        if (action?.click) await target(page, String(action.click)).click({ timeout: 10000 });
        else if (action?.fill) await field(page, String(action.fill.field)).fill(fillValue(action.fill.value, account), { timeout: 10000 });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
    } catch (error) {
      notes.push(`Action failed: ${String(error.message).split('\n')[0]}`);
    }
    if (new URL(page.url()).origin !== new URL(environment.baseUrl).origin) notes.push('The browser is outside the app now. Go back with a path inside the app.');

    const snapshot = await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch(() => '(no snapshot)');
    return mask([`url: ${page.url()}`, `title: ${await page.title().catch(() => '')}`, ...notes, 'snapshot:', snapshot.slice(0, SNAPSHOT_LIMIT)].join('\n'));
  }

  /** Runs one spec file from the cases folder once. Resolves { passed, error, snapshot }. */
  async function runOnce(fileName) {
    installLib();
    const dir = path.join(qaHome(), 'tmp', `try-${caseId}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const resultsFile = path.join(dir, 'results.json');
    const configFile = writeConfig(dir, {
      projects: [{ name: 'try', testDir: casesDir(appId), files: [fileName] }],
      reporter: [['json', { outputFile: resultsFile }]],
      outputDir: path.join(dir, 'out'),
      artifacts: false,
    });
    const { child, done } = await runPlaywright(configFile, testEnv({ runId, app, environment, accounts, tilePrefix: tile }));
    const timer = setTimeout(() => killTree(child), TRY_TIMEOUT_MS);
    const { output } = await done;
    clearTimeout(timer);

    const [found] = resultsOf(store.readJson(resultsFile, null));
    fs.rmSync(dir, { recursive: true, force: true });
    if (!found) return { passed: false, error: mask(`The test did not run. Playwright said:\n${stripAnsi(output).slice(-1500)}`), snapshot: '' };
    const snapshotAttachment = (found.result.attachments || []).find((attachment) => attachment.name === 'devcrew-snapshot' && attachment.body);
    return {
      passed: found.result.status === 'passed',
      error: mask(stripAnsi(found.result.error?.message || (found.result.status === 'passed' ? '' : `Test ${found.result.status}`)).slice(0, 1500)),
      snapshot: snapshotAttachment ? mask(Buffer.from(snapshotAttachment.body, 'base64').toString('utf8')).slice(0, SNAPSHOT_LIMIT) : '',
    };
  }

  const describe = ({ passed, error, snapshot }) => [`passed: ${passed}`, ...(error ? [`error: ${error}`] : []), ...(snapshot ? ['snapshot at failure:', snapshot] : [])].join('\n');

  async function tryCase({ code } = {}) {
    const check = validateSpec(code);
    if (!check.ok) return `passed: false\nThe test was refused: ${check.errors.join('; ')}.`;
    fs.writeFileSync(store.tryFile(appId, caseId), code);
    return describe(await runOnce(path.basename(store.tryFile(appId, caseId))));
  }

  async function saveCase({ code } = {}) {
    const check = validateSpec(code);
    if (!check.ok) return `saved: false\nThe test was refused: ${check.errors.join('; ')}.`;
    fs.writeFileSync(store.tryFile(appId, caseId), code);
    const result = await runOnce(path.basename(store.tryFile(appId, caseId)));
    if (!result.passed) return `saved: false\nThe test must pass before it is saved.\n${describe(result)}`;
    fs.writeFileSync(store.specFile(appId, caseId), code);
    fs.rmSync(store.tryFile(appId, caseId), { force: true });
    return 'saved: true';
  }

  async function close() {
    fs.rmSync(store.tryFile(appId, caseId), { force: true });
    if (browser) await browser.close().catch(() => {});
    if (pages.size) await postQa({ type: 'tile.end', runId, tile, caseId, status: 'passed' });
  }

  return { qa_explore: explore, qa_try_case: tryCase, qa_save_case: saveCase, close, mask };
}

/** Answers one JSON-RPC message. Returns the response, or null for notifications. */
async function handleMessage(message, getTools, tools = TOOLS) {
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
  const isRequest = message && message.id !== undefined && message.id !== null;

  switch (message?.method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'devcrew-qa', version: '1.0.0' } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools });
    case 'tools/call': {
      const name = message.params?.name;
      if (!tools.some((tool) => tool.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      let explorer;
      try {
        explorer = getTools();
      } catch (error) {
        return reply({ content: [{ type: 'text', text: `The QA tools could not start: ${error.message}` }], isError: true });
      }
      try {
        return reply({ content: [{ type: 'text', text: await explorer[name](message.params?.arguments || {}) }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: explorer.mask(`The tool failed: ${String(error.message).split('\n')[0]}`) }], isError: true });
      }
    }
    default:
      return isRequest ? fail(-32601, `Method not found: ${message?.method}`) : null;
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let tools = null;
  const getTools = () => (tools = tools || createExplorer(args));
  const write = (response) => response && process.stdout.write(`${JSON.stringify(response)}\n`);

  // Requests are answered in order, one at a time: the browser is shared between calls.
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    queue = queue.then(() => handleMessage(message, getTools, toolsFor(args.mode)).then(write));
  });
  lines.on('close', () => {
    queue.then(async () => {
      if (tools) await tools.close();
      process.exit(0);
    });
  });
}

module.exports = { handleMessage, parseArgs, toolsFor, TOOLS, PROTOCOL_VERSION };

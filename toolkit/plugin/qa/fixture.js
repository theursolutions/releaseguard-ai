// devcrew-qa: the fixture every prepared test imports. Copied to <qaHome>/lib/devcrew-qa.js for each run.
//   const page = await as('Agent');   a new browser context, logged in as that account, shown live on the QA page
// Accounts and the environment arrive base64-encoded in the worker's environment and are never logged.
// Logging in happens in a separate process (qa/lib/login.js), so the password never appears in a trace,
// a step title or the report.
const fs = require('fs');
const path = require('path');
const { test: base, expect } = require('@playwright/test');

const decode = (name, fallback) => {
  try {
    return JSON.parse(Buffer.from(process.env[name] || '', 'base64').toString('utf8'));
  } catch {
    return fallback;
  }
};

const ENVIRONMENT = decode('DEVCREW_QA_ENV', {});
const RUN_ID = process.env.DEVCREW_QA_RUN || 'local';
const PROJECT = process.env.DEVCREW_QA_PROJECT || 'QA';
// Set while a case is being prepared: tiles then belong to the "Preparing" view, not to the run's wall.
const TILE_PREFIX = process.env.DEVCREW_QA_TILE_PREFIX || '';
const RECORD_VIDEO = process.env.DEVCREW_QA_VIDEO === '1';
const FRAME_INTERVAL_MS = 500;
const SNAPSHOT_LIMIT = 8000;
// The runner passes the plugin folder, because this file runs from its copy in <qaHome>/lib.
const PLUGIN_QA = path.join(process.env.DEVCREW_QA_PLUGIN_DIR || path.join(__dirname, '..'), 'qa');
const { loginInChild } = require(path.join(PLUGIN_QA, 'lib', 'login.js'));
const { postOffice, postQa } = require(path.join(PLUGIN_QA, 'lib', 'events.js'));

// One login per account per worker; later tests reuse the session.
const sessions = new Map();
const startedTiles = new Set();

/** "<cases>/ab12cd34.spec.ts" (or .try.spec.ts while preparing) → "ab12cd34"; the smoke check is "smoke". */
function caseIdOf(file) {
  const name = path.basename(file);
  return name === 'smoke.spec.js' ? 'smoke' : name.replace(/(.try)?.spec.ts$/, '');
}

function accountFor(label) {
  const accounts = decode('DEVCREW_QA_ACCOUNTS', []);
  const account = accounts.find((item) => item.label.toLowerCase() === String(label).toLowerCase());
  if (!account) throw new Error(`No test account labelled "${label}" for this environment. Add it on the QA page.`);
  return account;
}

async function loggedInSession(account) {
  if (!sessions.has(account.label)) {
    const result = await loginInChild(account, ENVIRONMENT);
    if (!result.ok) throw new Error(result.message);
    sessions.set(account.label, result);
  }
  return sessions.get(account.label);
}

/** Navigation timing and Web Vitals of each page load, read by the fixture after the load event. */
const PERF_SCRIPT = `(() => {
  const vitals = { fcp: null, lcp: null, cls: 0 };
  Object.defineProperty(window, '__devcrewVitals', { value: vitals });
  const watch = (type, onEntry) => { try { new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true }); } catch {} };
  watch('paint', (entry) => { if (entry.name === 'first-contentful-paint') vitals.fcp = entry.startTime; });
  watch('largest-contentful-paint', (entry) => { vitals.lcp = entry.startTime; });
  watch('layout-shift', (entry) => { if (!entry.hadRecentInput) vitals.cls += entry.value; });
})();`;

function readPerf() {
  const [navigation] = performance.getEntriesByType('navigation');
  const vitals = window.__devcrewVitals || {};
  const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
  return {
    url: location.href.split('#')[0],
    ttfb: navigation ? round(navigation.responseStart) : null,
    fcp: round(vitals.fcp),
    lcp: round(vitals.lcp),
    cls: Number.isFinite(vitals.cls) ? Number(vitals.cls.toFixed(3)) : null,
    load: navigation && navigation.loadEventEnd > 0 ? round(navigation.loadEventEnd) : null,
  };
}

async function measure(page) {
  try {
    return await page.evaluate(readPerf);
  } catch {
    return null;
  }
}

/** Sends at most two frames a second of this page to the QA page's browser wall. */
async function startLiveView(page, { tile, label, caseId, caseTitle }) {
  let lastSent = 0;
  try {
    await page.screencast.start({
      size: { width: 960, height: 600 },
      quality: 55,
      onFrame: ({ data }) => {
        const now = Date.now();
        if (now - lastSent < FRAME_INTERVAL_MS) return;
        lastSent = now;
        postQa({ type: 'frame', runId: RUN_ID, tile, caseId, label, caseTitle, data: data.toString('base64') });
      },
    });
  } catch {
    // The live view is a viewer; the test does not depend on it.
  }
}

// What the browser saw going wrong during a test, for the report of a failed case: failed requests to the app
// (method, address, status only: never bodies, headers or cookies), console errors and uncaught page errors.
const MAX_PROBLEMS = 20;
const SECRET_PARAM = /pass|pwd|token|secret|key|auth|session|code|sig|otp/i;
const APP_ORIGIN = (() => {
  try {
    return new URL(ENVIRONMENT.baseUrl).origin;
  } catch {
    return null;
  }
})();

/** The address without the values of query parameters that could carry a secret. */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (SECRET_PARAM.test(key)) parsed.searchParams.set(key, '***');
    parsed.hash = '';
    return parsed.href;
  } catch {
    return String(url || '').split('?')[0];
  }
}

function watchForProblems(page, diagnostics) {
  const add = (list, entry) => list.length < MAX_PROBLEMS && list.push(entry);
  const sameApp = (url) => {
    try {
      return new URL(url).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  };
  page.on('response', (response) => {
    if (response.status() >= 400 && sameApp(response.url())) add(diagnostics.failedRequests, { method: response.request().method(), url: safeUrl(response.url()), status: response.status() });
  });
  page.on('requestfailed', (request) => {
    // An aborted request is the browser leaving the page, not a failure.
    if (sameApp(request.url()) && request.failure()?.errorText !== 'net::ERR_ABORTED') add(diagnostics.failedRequests, { method: request.method(), url: safeUrl(request.url()), status: 0 });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') add(diagnostics.consoleErrors, message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => add(diagnostics.pageErrors, String(error.message).slice(0, 300)));
}

const test = base.extend({
  // Labels, base URL and kind only: no usernames or passwords.
  qa: async ({}, use) => {
    await use({ labels: decode('DEVCREW_QA_ACCOUNTS', []).map((account) => account.label), baseUrl: ENVIRONMENT.baseUrl, kind: ENVIRONMENT.kind });
  },

  as: async ({ browser }, use, testInfo) => {
    const opened = [];
    const diagnostics = { failedRequests: [], consoleErrors: [], pageErrors: [] };
    const caseTitle = TILE_PREFIX ? `Preparing: ${testInfo.title}` : testInfo.title;
    const caseId = caseIdOf(testInfo.file);

    // Logging in is a step of its own, so the report's step list and reproduce steps start with it.
    const open = (label) => base.step(`Log in as ${String(label).slice(0, 40)}`, () => openAs(label));
    const openAs = async (label) => {
      const account = accountFor(label);
      const session = await loggedInSession(account);
      const context = await browser.newContext({
        baseURL: `${ENVIRONMENT.baseUrl}/`,
        storageState: session.storageState,
        ignoreHTTPSErrors: ENVIRONMENT.kind !== 'production',
        ...(RECORD_VIDEO ? { recordVideo: { dir: testInfo.outputPath('videos'), size: { width: 1280, height: 720 } } } : {}),
      });
      await context.addInitScript(PERF_SCRIPT);
      const page = await context.newPage();
      const tile = `${TILE_PREFIX || `w${testInfo.workerIndex}`}-${opened.length + 1}`;
      const entry = { page, context, tile, label: account.label, perf: [] };
      opened.push(entry);

      watchForProblems(page, diagnostics);
      page.on('load', () => setTimeout(async () => {
        const perf = await measure(page);
        if (perf && /^https?:/.test(perf.url)) entry.perf.push(perf);
      }, 300));
      await startLiveView(page, { tile, label: account.label, caseId, caseTitle });
      if (!TILE_PREFIX && !startedTiles.has(tile)) {
        startedTiles.add(tile);
        await postOffice({ kind: 'agent.start', session: RUN_ID, project: PROJECT, agentId: tile, agentType: 'qa-automation' });
      }
      await page.goto(session.landingUrl || `${ENVIRONMENT.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      return page;
    };

    await use(open);

    const failed = testInfo.status !== testInfo.expectedStatus;
    const last = opened.at(-1);
    if (failed && last) {
      try {
        const snapshot = await last.page.locator('body').ariaSnapshot({ timeout: 3000 });
        await testInfo.attach('devcrew-snapshot', { body: snapshot.slice(0, SNAPSHOT_LIMIT), contentType: 'text/plain' });
      } catch {
        // No snapshot when the page is gone; the error message still explains the failure.
      }
      await testInfo.attach('devcrew-diagnostics', { body: JSON.stringify({ url: safeUrl(last.page.url()), ...diagnostics }), contentType: 'application/json' });
    }
    const perf = opened.flatMap((entry) => entry.perf);
    if (perf.length) await testInfo.attach('devcrew-perf', { body: JSON.stringify(perf), contentType: 'application/json' });

    for (const entry of opened) {
      await entry.page.screencast.stop().catch(() => {});
      const video = entry.page.video();
      await entry.context.close().catch(() => {});
      if (video) {
        const videoPath = await video.path().catch(() => null);
        // attach() copies the file into the report's attachments, so the original is removed either way.
        if (videoPath && failed) await testInfo.attach('video', { path: videoPath, contentType: 'video/webm' });
        if (videoPath) fs.rmSync(videoPath, { force: true });
      }
      await postQa({ type: 'tile.end', runId: RUN_ID, tile: entry.tile, caseId, status: testInfo.status });
    }
  },
});

module.exports = { test, expect };

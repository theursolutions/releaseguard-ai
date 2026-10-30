#!/usr/bin/env node
// Logs a test account in to the app under test, with a heuristic that fits most login forms:
//   username = the text/email input just before the password input (or the app's own selector)
//   password = input[type=password];  submit = the form's submit button, or a "Log in" / "Sign in" button.
//
// Run as a child process (node login.js, JSON on stdin, storage state JSON on stdout), it logs in from a
// browser OUTSIDE the Playwright test runner. The runner records every action of a test (values typed,
// request bodies) in traces and reports; logging in here keeps the password out of all of them.

const pathOf = (url) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
};

/** Replaces the account's username and password anywhere in a message. */
function redact(message, account) {
  let clean = String(message ?? '');
  for (const [secret, mask] of [[account?.password, '***'], [account?.username, '{{username}}']]) {
    if (secret) clean = clean.split(secret).join(mask);
  }
  return clean;
}

async function findSubmit(page, password) {
  const form = password.locator('xpath=ancestor::form[1]');
  if (await form.count()) {
    const button = form.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
    if (await button.count()) return button;
  }
  const named = page.getByRole('button', { name: /log ?in|sign ?in/i }).first();
  return (await named.count()) ? named : null;
}

/** Logs in on an open page. Throws "Login failed for <label>: …" when the app does not let the account in. */
async function loginOnPage(page, account, environment, { timeoutMs = 20000 } = {}) {
  const selectors = environment.login || {};
  const failed = (reason) => new Error(`Login failed for ${account.label}: ${reason}`);

  await page.goto(`${environment.baseUrl}${environment.loginPath}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const password = page.locator(selectors.password || 'input[type="password"]').first();
  try {
    await password.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw failed(`no password field on ${environment.loginPath}`);
  }

  const username = selectors.username
    ? page.locator(selectors.username).first()
    : password.locator('xpath=preceding::input[not(@type) or @type="text" or @type="email" or @type="tel"][1]');
  if ((await username.count()) === 0) throw failed('no username field before the password field');

  await username.fill(account.username);
  await password.fill(account.password);
  const loginFormPath = pathOf(page.url());
  const submit = selectors.submit ? page.locator(selectors.submit).first() : await findSubmit(page, password);
  if (submit) await submit.click();
  else await password.press('Enter');

  // Done when the browser has left the login page or the password field is gone. Checked twice, half a
  // second apart, because a failed login briefly clears the page before showing the form again.
  const loggedIn = async () => {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return pathOf(page.url()) !== loginFormPath || !(await password.isVisible().catch(() => false));
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await loggedIn()) {
      await page.waitForTimeout(500);
      if (await loggedIn()) {
        await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  throw failed('still on the login page');
}

/** Logs in from a fresh browser and returns { ok, storageState, landingUrl } or { ok: false, message }. */
async function loginInFreshBrowser(account, environment, { timeoutMs } = {}) {
  const { loadPlaywright } = require('./runtime');
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: environment.kind !== 'production' });
    const page = await context.newPage();
    await loginOnPage(page, account, environment, { timeoutMs });
    return { ok: true, storageState: await context.storageState(), landingUrl: page.url() };
  } catch (error) {
    return { ok: false, message: redact(String(error.message).split('\n')[0], account) };
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', async () => {
    let result;
    try {
      const { account, environment, timeoutMs } = JSON.parse(raw);
      result = await loginInFreshBrowser(account, environment, { timeoutMs });
    } catch {
      // A parse error would quote the input, which holds the password, so it is not passed on.
      result = { ok: false, message: 'Login could not start: the account details could not be read.' };
    }
    process.stdout.write(JSON.stringify(result));
  });
}

/** Runs the login in a separate process (see the note at the top). Resolves { ok, storageState } or { ok: false, message }. */
function loginInChild(account, environment, { timeoutMs = 20000, env = process.env } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill(), timeoutMs + 30000);
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', () => resolve({ ok: false, message: 'Login could not start.' }));
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ ok: false, message: `Login failed for ${account.label}: the browser stopped unexpectedly.` });
      }
    });
    child.stdin.end(JSON.stringify({ account, environment, timeoutMs }));
  });
}

module.exports = { loginOnPage, loginInFreshBrowser, loginInChild, redact };

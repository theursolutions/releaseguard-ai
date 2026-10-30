// The Playwright runtime QA runs on: @playwright/test plus Chromium, installed once into <dataDir>/qa.
// It is the only package QA ever installs, and never into a project.
const fs = require('fs');
const path = require('path');
const { qaHome } = require('./paths');
const { run } = require('./spawn');

const PLAYWRIGHT_VERSION = '1.61.1';
const LOCK_STALE_MS = 20 * 60 * 1000;

const browsersPath = () => path.join(qaHome(), 'browsers');
const markerFile = () => path.join(qaHome(), '.runtime-ready');
const cliFile = () => path.join(qaHome(), 'node_modules', '@playwright', 'test', 'cli.js');

/** The environment every Playwright process needs so it finds the browser QA installed. */
function runtimeEnv(extra = {}) {
  return { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath(), ...extra };
}

function isInstalled() {
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(qaHome(), 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version;
    return installed === PLAYWRIGHT_VERSION && fs.readFileSync(markerFile(), 'utf8').trim() === PLAYWRIGHT_VERSION;
  } catch {
    return false;
  }
}

/** playwright-core from the runtime, for scripts that drive a browser outside a test run. */
function loadPlaywright() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath();
  return require(require.resolve('playwright-core', { paths: [qaHome()] }));
}

/** A stopped run leaves its install lock behind; the lock only counts while its process is alive. */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function isStale(lock) {
  try {
    // An empty lock is one being written right now, so only a recorded process id can be judged.
    const owner = fs.readFileSync(lock, 'utf8').trim();
    return Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS || (owner !== '' && !isAlive(Number(owner)));
  } catch {
    return false;
  }
}

async function install(onProgress) {
  const home = qaHome();
  const manifest = { name: 'devcrew-qa-runtime', private: true, description: 'Installed by devcrew QA. Safe to delete; it is installed again on the next run.', dependencies: { '@playwright/test': PLAYWRIGHT_VERSION } };
  fs.writeFileSync(path.join(home, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  onProgress('Installing the test browser (first run only)');
  const npm = await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: home, env: runtimeEnv() });
  if (npm.code !== 0) throw new Error(`Could not install Playwright. npm said:\n${npm.output.slice(-2000)}`);

  onProgress('Downloading Chromium (first run only)');
  const browser = await run(process.execPath, [cliFile(), 'install', 'chromium'], { cwd: home, env: runtimeEnv() });
  if (browser.code !== 0) throw new Error(`Could not download Chromium. Playwright said:\n${browser.output.slice(-2000)}`);

  fs.writeFileSync(markerFile(), PLAYWRIGHT_VERSION);
}

/**
 * Installs the runtime when it is missing. Safe to call any time: it returns at once when installed, and a
 * lock file makes a second caller (another run, a login check) wait for the first install instead of racing it.
 */
async function ensureRuntime(onProgress = () => {}) {
  if (isInstalled()) return;
  const lock = path.join(qaHome(), '.runtime-installing');
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (isStale(lock)) {
      fs.rmSync(lock, { force: true });
      return ensureRuntime(onProgress);
    }
    onProgress('Waiting for the test browser install to finish');
    while (fs.existsSync(lock)) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (isStale(lock)) return ensureRuntime(onProgress);
    }
    if (!isInstalled()) throw new Error('The test browser install did not finish. Try the run again.');
    return;
  }
  try {
    await install(onProgress);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

module.exports = { PLAYWRIGHT_VERSION, ensureRuntime, isInstalled, runtimeEnv, browsersPath, cliFile, loadPlaywright };

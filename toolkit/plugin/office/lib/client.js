// Talks to the local office from hook scripts: posts events and starts the server when it is not running.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('./config');

function request(method, urlPath, { body, headers = {}, timeoutMs = 800 } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: config.HOST, port: config.port(), method, path: urlPath, headers: { Host: `127.0.0.1:${config.port()}`, ...headers }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', (error) => resolve({ status: 0, error }));
    if (body) req.write(body);
    req.end();
  });
}

async function isRunning() {
  const { status, data } = await request('GET', '/health', { timeoutMs: 500 });
  return status === 200 && data.includes('devcrew-office');
}

/**
 * Starts the office as a detached background process. A short-lived lock file stops a burst of parallel
 * hooks from each starting their own copy; any extra copy exits on its own when the port is taken.
 */
function startServer() {
  const lock = path.join(config.dataDir(), 'office-starting');
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < 10000) return false;
  } catch {
    // No recent lock: this hook starts the office.
  }
  fs.writeFileSync(lock, String(process.pid));

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
  child.unref();
  return true;
}

async function ensureServer({ waitMs = 2000 } = {}) {
  if (await isRunning()) return true;
  startServer();
  for (let waited = 0; waited < waitMs; waited += 150) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await isRunning()) return true;
  }
  return false;
}

async function postEvent(event) {
  const body = JSON.stringify(event);
  const options = { body, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Devcrew-Token': config.token() } };
  const first = await request('POST', '/events', options);
  if (first.status !== 0) return first.status;

  // Nothing is listening yet: start the office and send the event once more.
  if (!(await ensureServer())) return 0;
  return (await request('POST', '/events', options)).status;
}

module.exports = { isRunning, ensureServer, postEvent, request };

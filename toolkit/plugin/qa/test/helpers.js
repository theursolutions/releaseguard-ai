// Shared helpers for the QA tests. Every test works in its own temporary DEVCREW_HOME, never in ~/.devcrew.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const TOKEN = 'qa-test-token-123';

function call(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          // Not JSON (a page or a file).
        }
        resolve({ status: res.statusCode, headers: res.headers, data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A free local port: the office needs to know its port up front for the Host header check. */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function tempHome(prefix = 'devcrew-qa-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DEVCREW_HOME = home;
  return home;
}

/**
 * Where an installed Playwright runtime can be borrowed from: DEVCREW_QA_RUNTIME_HOME, else DEVCREW_HOME as
 * it was when the tests started, else ~/.devcrew. Null when none has it (the end-to-end test is then skipped).
 */
function installedRuntimeHome(startHome) {
  const candidates = [process.env.DEVCREW_QA_RUNTIME_HOME, startHome, path.join(os.homedir(), '.devcrew')].filter(Boolean);
  return candidates.find((home) => fs.existsSync(path.join(home, 'qa', '.runtime-ready')) && fs.existsSync(path.join(home, 'qa', 'node_modules', '@playwright', 'test'))) || null;
}

/** Links the installed runtime into a temporary home (junctions on Windows), so tests do not download it again. */
function linkRuntime(fromHome, toHome) {
  const from = path.join(fromHome, 'qa');
  const to = path.join(toHome, 'qa');
  fs.mkdirSync(to, { recursive: true });
  for (const folder of ['node_modules', 'browsers']) fs.symlinkSync(path.join(from, folder), path.join(to, folder), 'junction');
  for (const file of ['package.json', '.runtime-ready']) fs.copyFileSync(path.join(from, file), path.join(to, file));
  return () => {
    for (const folder of ['node_modules', 'browsers']) fs.unlinkSync(path.join(to, folder));
  };
}

/** The text of every entry in a zip (Playwright traces and the report's data), enough to search them for secrets. */
function zipText(fileOrBuffer) {
  const zip = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end === -1) return '';
  let offset = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  let text = '';
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    text += (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return text;
}

/** Every file under a folder, with zip files (and zips embedded in the HTML report) expanded to their text. */
function allText(dir) {
  let text = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const content = fs.readFileSync(file);
    text += file.endsWith('.zip') ? zipText(content) : content.toString('utf8');
    for (const embedded of content.toString('utf8').matchAll(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/g)) text += zipText(Buffer.from(embedded[1], 'base64'));
  }
  return text;
}

module.exports = { TOKEN, call, freePort, tempHome, installedRuntimeHome, linkRuntime, zipText, allText };

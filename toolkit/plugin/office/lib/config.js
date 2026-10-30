// Where the office runs and where it keeps its token: ~/.devcrew, never inside the user's project.
// Deliberately not CLAUDE_PLUGIN_DATA: hooks get that variable but /devcrew:office and demo.js run through
// Bash without it, and a server started from there must use the same token the hooks send.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = '127.0.0.1';

function port() {
  const value = Number.parseInt(process.env.DEVCREW_OFFICE_PORT || '', 10);
  return value > 0 && value < 65536 ? value : 4317;
}

function dataDir() {
  const dir = process.env.DEVCREW_HOME || path.join(os.homedir(), '.devcrew');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The shared secret hooks send with every event, so a web page in the browser cannot post fake events
 * to the local office. Created once with exclusive write, so parallel hooks never overwrite each other.
 */
function token() {
  const file = path.join(dataDir(), 'office-token');
  try {
    fs.writeFileSync(file, crypto.randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

function officeUrl() {
  return `http://localhost:${port()}`;
}

module.exports = { HOST, port, dataDir, token, officeUrl };

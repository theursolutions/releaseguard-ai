// Where QA keeps its data. Everything is under the devcrew data folder (~/.devcrew or DEVCREW_HOME),
// never inside a project or a git repository.
//   qa/          apps, cases, runs and the Playwright runtime
//   qa-secrets/  test account passwords, kept apart so the case-preparing Claude never works above them
const fs = require('fs');
const path = require('path');
const config = require('../../office/lib/config');

function qaHome() {
  const dir = path.join(config.dataDir(), 'qa');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function secretsDir() {
  const dir = path.join(config.dataDir(), 'qa-secrets');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const appDir = (id) => path.join(qaHome(), 'apps', id);
const casesDir = (id) => path.join(appDir(id), 'cases');
const runsRoot = () => path.join(qaHome(), 'runs');
const runDir = (id) => path.join(runsRoot(), id);
const libDir = () => path.join(qaHome(), 'lib');

module.exports = { qaHome, secretsDir, appDir, casesDir, runsRoot, runDir, libDir };

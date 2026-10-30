// Starting and stopping child programs the same way on Windows, macOS and Linux.
const { spawn, spawnSync } = require('child_process');

/**
 * Starts a program directly. On Windows npm, npx and an npm-installed claude are .cmd shims that only run
 * through cmd.exe, so that case falls back to a shell with every argument quoted (as toolkit/install.js does).
 * Never pass user text as an argument here: it could reach cmd.exe. Send it on stdin instead.
 */
function start(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const direct = spawn(command, args, { windowsHide: true, ...options });
    direct.once('spawn', () => resolve(direct));
    direct.once('error', (error) => {
      if (process.platform !== 'win32' || !['ENOENT', 'EINVAL'].includes(error.code)) return reject(error);
      // A plain program name stays unquoted: cmd.exe resolves %~dp0 inside a shim to the current folder
      // when the name is quoted, and npm.cmd then looks for npm in the wrong place.
      const program = /^[\w.-]+$/.test(command) ? command : `"${command}"`;
      const quoted = [program, ...args.map((part) => `"${String(part).replace(/"/g, '""')}"`)].join(' ');
      const viaShell = spawn(quoted, { windowsHide: true, ...options, shell: true });
      viaShell.once('spawn', () => resolve(viaShell));
      viaShell.once('error', reject);
    });
  });
}

/** Runs a program to the end and resolves { code, output } (stdout and stderr together, last 64 KB). */
async function run(command, args, options = {}) {
  const child = await start(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk) => (output = (output + chunk).slice(-64 * 1024));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, output };
}

/** Stops a program and everything it started (browsers, test workers). */
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

module.exports = { start, run, killTree };

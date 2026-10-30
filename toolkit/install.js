#!/usr/bin/env node
// Installs the devcrew Claude Code plugin for ONE project, on this computer only.
//
// Nothing is added to the project's code, dependencies or git history:
//   - the plugin itself lives in Claude Code's own folder (~/.claude/plugins), not in the project;
//   - "local" scope records it only in the project's .claude/settings.local.json, a personal file;
//   - that file is added to .git/info/exclude, git's private ignore list, so it can never be committed.
//
// Usage: node install.js <path-to-project> [--dry-run] [--uninstall]

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MARKETPLACE = 'zibaproperty';
const PLUGIN = `devcrew@${MARKETPLACE}`;
const LOCAL_SETTINGS = '.claude/settings.local.json';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const uninstall = args.includes('--uninstall');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (!targetArg) {
  console.error('Usage: node install.js <path-to-project> [--dry-run] [--uninstall]');
  process.exit(1);
}

const toolkitDir = __dirname;
const projectDir = path.resolve(targetArg);

if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
  console.error(`Project folder not found: ${projectDir}`);
  process.exit(1);
}

/**
 * Runs a program directly. On Windows an npm-installed "claude" is a .cmd shim that only runs through
 * cmd.exe, so that case falls back to a shell with every argument quoted (paths may contain spaces).
 */
function run(command, commandArgs, { cwd = projectDir, quiet = false } = {}) {
  let result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT' && process.platform === 'win32') {
    const quoted = [command, ...commandArgs].map((part) => `"${String(part).replace(/"/g, '""')}"`).join(' ');
    result = spawnSync(quoted, { cwd, encoding: 'utf8', shell: true });
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (!quiet && output) console.log(output.replace(/^/gm, '    '));
  return { ok: result.status === 0 && !result.error, output };
}

function step(message, action) {
  console.log(`${dryRun ? '[dry run] ' : ''}• ${message}`);
  if (dryRun) return { ok: true, output: '' };
  const result = action();
  if (!result.ok) {
    console.error('\nStopped: the step above failed. Nothing else was changed.');
    process.exit(1);
  }
  return result;
}

if (!run('claude', ['--version'], { quiet: true }).ok) {
  console.error('Claude Code is not installed or not on PATH. Install it first (see docs/ONBOARDING.md).');
  process.exit(1);
}

console.log(`${uninstall ? 'Removing' : 'Installing'} devcrew for ${projectDir}\n`);

if (uninstall) {
  step('Uninstalling devcrew from this project (local scope)', () => run('claude', ['plugin', 'uninstall', PLUGIN, '--scope', 'local']));
  console.log('\nDone. The project files were not touched.');
  process.exit(0);
}

// 1. The marketplace is this toolkit folder. It's added once per computer; later runs refresh it,
//    so a "git pull" of the toolkit followed by this installer picks up new versions.
const marketplaces = run('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: toolkitDir, quiet: true });
const known = marketplaces.ok && marketplaces.output.includes(`"name": "${MARKETPLACE}"`);
if (known) {
  step(`Refreshing the ${MARKETPLACE} marketplace from ${toolkitDir}`, () => run('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], { cwd: toolkitDir }));
} else {
  step(`Adding the ${MARKETPLACE} marketplace from ${toolkitDir}`, () => run('claude', ['plugin', 'marketplace', 'add', toolkitDir], { cwd: toolkitDir }));
}

// 2. Install, or update when this project already has it.
const installed = run('claude', ['plugin', 'list', '--json'], { quiet: true });
const alreadyHere = installed.ok && installed.output.includes(`"${PLUGIN}"`) && installed.output.replace(/\\\\/g, '\\').includes(projectDir);
if (alreadyHere) {
  step('Updating devcrew in this project (local scope)', () => run('claude', ['plugin', 'update', PLUGIN, '--scope', 'local']));
} else {
  step('Installing devcrew in this project (local scope: only you, only this project)', () => run('claude', ['plugin', 'install', PLUGIN, '--scope', 'local']));
}

// 3. Keep the personal settings file out of git without touching the project's tracked .gitignore.
const gitDir = run('git', ['rev-parse', '--git-path', 'info/exclude'], { quiet: true });
if (gitDir.ok && gitDir.output) {
  const excludeFile = path.resolve(projectDir, gitDir.output.split(/\r?\n/).pop());
  // .git/info/exclude patterns are relative to the repository root, so a project in a subfolder
  // (for example repo/src) needs that folder in front: "/src/.claude/settings.local.json".
  const prefix = run('git', ['rev-parse', '--show-prefix'], { quiet: true }).output.split(/\r?\n/).pop() || '';
  const pattern = `/${prefix}${LOCAL_SETTINGS}`;
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (!current.split(/\r?\n/).some((line) => line.trim() === pattern)) {
    step(`Adding ${pattern} to git's private ignore list (.git/info/exclude)`, () => {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      fs.appendFileSync(excludeFile, `${current && !current.endsWith('\n') ? '\n' : ''}# devcrew (personal Claude Code settings)\n${pattern}\n`);
      return { ok: true };
    });
  }
  if (run('git', ['ls-files', '--error-unmatch', LOCAL_SETTINGS], { quiet: true }).ok) {
    console.log(`\nWARNING: ${LOCAL_SETTINGS} is already committed in this repository, so ignoring it has no effect.` + '\nAsk the team whether it should be removed from git; devcrew did not change it.');
  }
} else {
  console.log('• Not a git repository: nothing to ignore.');
}

console.log(`
Done. Nothing was added to the project's code or dependencies.

Next:
  1. Open the project in Claude Code (terminal or VS Code) and start a new session.
  2. Approve the "atlassian" server if asked, then type /mcp and sign in to Jira and Confluence.
  3. Give the crew work:  /devcrew:task <what you want>   /devcrew:fix <JIRA-KEY>   /devcrew:feature <JIRA-KEY>
  4. Watch the agents live: http://localhost:4317  (or type /devcrew:office)`);

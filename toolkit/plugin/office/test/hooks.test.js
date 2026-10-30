const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS = path.join(__dirname, '..', '..', 'hooks');

function hook(script, input, env = {}) {
  return spawnSync(process.execPath, [path.join(HOOKS, script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
}

test('secret files cannot be read, normal files can', () => {
  const project = '/work/app';
  for (const file of ['.env', 'config/.env.production', 'storage/oauth-private.key', 'certs/site.pem']) {
    const result = hook('protect-secrets.js', { tool_name: 'Read', tool_input: { file_path: `${project}/${file}` } }, { CLAUDE_PROJECT_DIR: project });
    assert.equal(result.status, 2, file);
    assert.match(result.stderr, /Blocked by devcrew/);
  }
  for (const file of ['.env.example', 'app/Models/User.php', 'keyboard.js']) {
    assert.equal(hook('protect-secrets.js', { tool_name: 'Read', tool_input: { file_path: `${project}/${file}` } }, { CLAUDE_PROJECT_DIR: project }).status, 0, file);
  }
});

test('subagents get the team rules, and Laravel rules only in Laravel projects', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-plain-'));
  const laravel = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-laravel-'));
  fs.writeFileSync(path.join(laravel, 'artisan'), '');

  const run = (dir) => JSON.parse(hook('context.js', { hook_event_name: 'SubagentStart', cwd: dir }, { CLAUDE_PROJECT_DIR: dir }).stdout);
  const plainContext = run(plain).hookSpecificOutput;
  const laravelContext = run(laravel).hookSpecificOutput;

  assert.equal(plainContext.hookEventName, 'SubagentStart');
  assert.match(plainContext.additionalContext, /Definition of Done/);
  assert.match(plainContext.additionalContext, /devcrew stays outside the project/);
  assert.doesNotMatch(plainContext.additionalContext, /Laravel conventions/);
  assert.match(laravelContext.additionalContext, /Laravel conventions/);
  assert.doesNotMatch(laravelContext.additionalContext, /^---/m);
});

test('the office emitter never fails Claude, even when the office cannot be reached', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcrew-data-'));
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'emit.js')], {
    input: 'not json',
    encoding: 'utf8',
    env: { ...process.env, DEVCREW_HOME: dataDir, DEVCREW_OFFICE_PORT: '1' },
  });
  assert.equal(result.status, 0);
});

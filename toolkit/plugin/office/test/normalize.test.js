const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, sanitizeEvent, commandName } = require('../lib/normalize');
const { stageFor, labelFor } = require('../lib/stages');

const common = { session_id: 'abc-123', cwd: '/home/dev/crm-app' };

test('a subagent tool call names the agent, the action and only the file name', () => {
  const event = normalize({ ...common, hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'devcrew:developer', tool_name: 'Edit', tool_input: { file_path: '/home/dev/crm-app/app/Http/UserController.php', old_string: 'secret', new_string: 'x' } });

  assert.equal(event.kind, 'tool');
  assert.equal(event.agentId, 'a1');
  assert.equal(event.agentType, 'developer');
  assert.equal(event.project, 'crm-app');
  assert.equal(event.text, 'Editing UserController.php');
  assert.ok(!JSON.stringify(event).includes('secret'));
  assert.ok(!JSON.stringify(event).includes('/home/dev'));
});

test('commands keep only the program and sub-command, never flags, values or secrets', () => {
  assert.equal(commandName('php artisan test --filter=UserTest'), 'php artisan test');
  assert.equal(commandName('curl -H "Authorization: Bearer sk-live-123" https://api.test'), 'curl');
  assert.equal(commandName('DB_PASSWORD=hunter2 php artisan migrate'), 'a command');
  assert.equal(commandName('/usr/bin/git diff main...HEAD | head'), 'git diff main...HEAD');
  assert.equal(commandName('npm run build && echo $TOKEN'), 'npm run build');
});

test('a prompt is reduced to its slash command, or a neutral label', () => {
  assert.equal(normalize({ ...common, hook_event_name: 'UserPromptSubmit', prompt: '/devcrew:fix ZP-12 password is hunter2' }).text, '/devcrew:fix');
  assert.equal(normalize({ ...common, hook_event_name: 'UserPromptSubmit', prompt: 'my api key is sk-123, fix login' }).text, 'New request');
});

test('a hand-off carries the target agent and its short description', () => {
  const event = normalize({ ...common, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'devcrew:qa-automation', description: 'Check acceptance criteria', prompt: 'long private prompt' } });

  assert.deepEqual([event.kind, event.agentId, event.agentType, event.target, event.text], ['handoff', 'main', 'router', 'qa-automation', 'Check acceptance criteria']);
  assert.ok(!JSON.stringify(event).includes('private'));
});

test('lifecycle hooks map to office events and unknown hooks are ignored', () => {
  assert.equal(normalize({ ...common, hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'devcrew:planner' }).kind, 'agent.start');
  assert.equal(normalize({ ...common, hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'devcrew:planner', last_assistant_message: 'private' }).kind, 'agent.stop');
  assert.equal(normalize({ ...common, hook_event_name: 'Stop' }).kind, 'session.idle');
  assert.equal(normalize({ ...common, hook_event_name: 'PreCompact' }), null);
  assert.equal(normalize(null), null);
});

test('the server drops unknown kinds and fields and clips long text', () => {
  assert.equal(sanitizeEvent({ kind: 'evil' }), null);
  const clean = sanitizeEvent({ kind: 'tool', session: 's/../1', text: 'x'.repeat(500), html: '<script>', demo: 'yes' });
  assert.equal(clean.session, 's..1');
  assert.equal(clean.text.length, 120);
  assert.equal(clean.html, undefined);
  assert.equal(clean.demo, undefined);
});

test('every crew agent has a room in pipeline order', () => {
  assert.deepEqual(
    ['router', 'devcrew:planner', 'devcrew:developer', 'frontend-3d-developer', 'test-engineer', 'devcrew:regression-tester', 'code-reviewer'].map(stageFor),
    ['triage', 'plan', 'build', 'build', 'qa', 'regression', 'review']
  );
  assert.equal(labelFor('devcrew:frontend-3d-developer'), '3D Dev');
  assert.equal(labelFor('some-custom_agent'), 'Some Custom Agent');
});

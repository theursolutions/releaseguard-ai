#!/usr/bin/env node
// Plays a scripted DEMO run in the office so people can see how it works without spending AI time.
// Every event is marked demo: true and the page labels the session "Demo".
//   node demo.js            (the office starts automatically if it is not running)
const { ensureServer, postEvent } = require('./lib/client');
const config = require('./lib/config');

const session = `demo-${Date.now()}`;
const base = { session, project: 'Demo project', demo: true };
const main = { agentId: 'main', agentType: 'router' };
const agent = (id, type) => ({ agentId: id, agentType: type });

const STEPS = [
  [{ kind: 'session.start', ...main }, 600],
  [{ kind: 'request', ...main, text: '/devcrew:fix' }, 1500],
  [{ kind: 'tool', ...main, tool: 'Grep', text: 'Searching the code' }, 1500],
  [{ kind: 'handoff', ...main, target: 'planner', text: 'Plan login reset fix' }, 300],
  [{ kind: 'handoff', ...main, target: 'regression-tester', text: 'Record test baseline' }, 300],
  [{ kind: 'agent.start', ...agent('d1', 'planner') }, 200],
  [{ kind: 'agent.start', ...agent('d2', 'regression-tester') }, 900],
  [{ kind: 'tool', ...agent('d1', 'planner'), tool: 'Read', text: 'Reading PasswordResetController.php' }, 900],
  [{ kind: 'tool', ...agent('d2', 'regression-tester'), tool: 'Bash', text: 'Running php artisan test' }, 1800],
  [{ kind: 'agent.stop', ...agent('d1', 'planner') }, 800],
  [{ kind: 'agent.stop', ...agent('d2', 'regression-tester') }, 600],
  [{ kind: 'handoff', ...main, target: 'developer', text: 'Fix token expiry check' }, 300],
  [{ kind: 'handoff', ...main, target: 'frontend-developer', text: 'Show reset error state' }, 300],
  [{ kind: 'agent.start', ...agent('d3', 'developer') }, 200],
  [{ kind: 'agent.start', ...agent('d4', 'frontend-developer') }, 900],
  [{ kind: 'tool', ...agent('d3', 'developer'), tool: 'Edit', text: 'Editing PasswordResetController.php' }, 1200],
  [{ kind: 'tool', ...agent('d4', 'frontend-developer'), tool: 'Edit', text: 'Editing ResetPassword.vue' }, 1500],
  [{ kind: 'tool', ...agent('d3', 'developer'), tool: 'Bash', text: 'Running php artisan test' }, 1800],
  [{ kind: 'agent.stop', ...agent('d4', 'frontend-developer') }, 500],
  [{ kind: 'agent.stop', ...agent('d3', 'developer') }, 800],
  [{ kind: 'handoff', ...main, target: 'test-engineer', text: 'Regression test for expiry' }, 300],
  [{ kind: 'handoff', ...main, target: 'qa-automation', text: 'Check acceptance criteria' }, 300],
  [{ kind: 'agent.start', ...agent('d5', 'test-engineer') }, 200],
  [{ kind: 'agent.start', ...agent('d6', 'qa-automation') }, 900],
  [{ kind: 'tool', ...agent('d5', 'test-engineer'), tool: 'Write', text: 'Writing PasswordResetTest.php' }, 1500],
  [{ kind: 'tool', ...agent('d6', 'qa-automation'), tool: 'Bash', text: 'Running npx playwright test' }, 1800],
  [{ kind: 'agent.stop', ...agent('d5', 'test-engineer') }, 500],
  [{ kind: 'agent.stop', ...agent('d6', 'qa-automation') }, 800],
  [{ kind: 'handoff', ...main, target: 'regression-tester', text: 'Full suite vs baseline' }, 300],
  [{ kind: 'agent.start', ...agent('d7', 'regression-tester') }, 900],
  [{ kind: 'tool', ...agent('d7', 'regression-tester'), tool: 'Bash', text: 'Running php artisan test' }, 2200],
  [{ kind: 'agent.stop', ...agent('d7', 'regression-tester') }, 800],
  [{ kind: 'handoff', ...main, target: 'code-reviewer', text: 'Review the fix' }, 300],
  [{ kind: 'agent.start', ...agent('d8', 'code-reviewer') }, 900],
  [{ kind: 'tool', ...agent('d8', 'code-reviewer'), tool: 'Bash', text: 'Running git diff' }, 1800],
  [{ kind: 'agent.stop', ...agent('d8', 'code-reviewer') }, 900],
  [{ kind: 'session.idle', ...main }, 0],
];

(async () => {
  if (!(await ensureServer())) {
    console.error('Could not start the office. Is port ' + config.port() + ' used by another program?');
    process.exit(1);
  }
  console.log(`Demo run started. Watch it at ${config.officeUrl()}`);
  for (const [event, pauseMs] of STEPS) {
    await postEvent({ ...base, ...event, ts: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  console.log('Demo run finished.');
})();

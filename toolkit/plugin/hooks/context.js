#!/usr/bin/env node
// SessionStart and SubagentStart hook: gives the main session and every agent the team rules.
// Plugins can't ship rules/ or CLAUDE.md, so the rules are injected as context instead.
// On SessionStart it also starts the local office and tells the user its URL.
const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, '..', 'rules');

/** Laravel rules only matter in Laravel projects, like the old path-scoped rule file. */
function rulesFor(projectDir) {
  const isLaravel = fs.existsSync(path.join(projectDir, 'artisan'));
  return fs
    .readdirSync(RULES_DIR)
    .filter((file) => file.endsWith('.md') && (file !== 'laravel.md' || isLaravel))
    .sort()
    .map((file) => fs.readFileSync(path.join(RULES_DIR, file), 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim())
    .join('\n\n');
}

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', async () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    // Still give the rules with the default project folder.
  }

  const event = input.hook_event_name === 'SubagentStart' ? 'SubagentStart' : 'SessionStart';
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const output = {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: `# devcrew team rules (from the devcrew plugin; they apply to all work in this project)\n\n${rulesFor(projectDir)}`,
    },
  };

  if (event === 'SessionStart') {
    try {
      const { ensureServer } = require('../office/lib/client');
      const { officeUrl } = require('../office/lib/config');
      // Short wait: the session must start quickly even when the office is slow or the port is taken.
      const running = await ensureServer({ waitMs: 1200 });
      output.systemMessage = running ? `devcrew: watch your agents live at ${officeUrl()}` : 'devcrew: the office is starting; run /devcrew:office for its address.';
    } catch {
      // The office is optional; the rules must still load.
    }
  }

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});

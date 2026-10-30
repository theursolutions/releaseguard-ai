#!/usr/bin/env node
// PreToolUse hook for Read/Grep: stops Claude from reading files that hold secrets (.env files, private
// keys, certificates). Plugins can't set permission deny rules, so this hook enforces them instead.
// Exit code 2 blocks the read and shows Claude the reason.
const path = require('path');

const SECRET = /(^|\/)\.env$|(^|\/)\.env\.(?!example$)[^/]+$|\.(pem|key|p12|pfx)$/i;

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  const target = input.tool_input?.file_path || input.tool_input?.path;
  if (!target) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const relative = path.relative(projectDir, path.resolve(projectDir, target)).split(path.sep).join('/');
  if (!SECRET.test(relative)) process.exit(0);

  process.stderr.write(
    `Blocked by devcrew: "${relative}" holds secrets and must not be read. ` +
      'Do not try another way to read it. If a value is needed, ask the user for the setting name, never the secret.\n'
  );
  process.exit(2);
});

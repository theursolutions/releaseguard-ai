#!/usr/bin/env node
// PostToolUse hook for Edit/Write: syntax-checks every PHP file Claude changes.
// A syntax error is sent back to Claude (exit code 2) so it fixes it straight away.
// Silently does nothing when the file is not PHP or PHP is not installed.
const { spawnSync } = require('child_process');
const path = require('path');

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath || !filePath.endsWith('.php')) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const result = spawnSync('php', ['-l', path.resolve(projectDir, filePath)], { encoding: 'utf8' });

  if (result.error || result.status === 0) process.exit(0);

  process.stderr.write(`PHP syntax check failed for ${filePath}:\n${result.stdout}${result.stderr}\nFix the syntax error before continuing.\n`);
  process.exit(2);
});

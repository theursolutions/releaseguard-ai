#!/usr/bin/env node
// PreToolUse hook for Bash: blocks commands that destroy data, rewrite git history or expose secrets.
// Exit code 2 blocks the command and shows Claude the reason.

const DANGEROUS = [
  { pattern: /artisan\s+(migrate:fresh|migrate:reset|migrate:refresh|db:wipe)\b/, reason: 'it wipes the database' },
  { pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE?)\b/i, reason: 'it deletes data' },
  { pattern: /\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, reason: 'force-push rewrites shared history' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'it discards uncommitted work' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'it permanently deletes untracked files' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\.|\*)(\s|$)/, reason: 'it recursively deletes a broad path' },
  { pattern: /\b(cat|type|more|less|head|tail|Get-Content)\s+[^|;&]*\.env(?!\.example)\b/, reason: 'it prints secrets from an environment file' },
  { pattern: /\b(printenv|env)\s*($|\|)/, reason: 'it prints every environment variable, including secrets' },
];

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  const command = input.tool_input?.command;
  if (!command) process.exit(0);

  const hit = DANGEROUS.find((rule) => rule.pattern.test(command));
  if (!hit) process.exit(0);

  process.stderr.write(
    `Blocked by team toolkit: this command is not allowed because ${hit.reason}. ` +
      'Do not look for a workaround. If it is truly needed, explain why and let the user run it themselves.\n'
  );
  process.exit(2);
});

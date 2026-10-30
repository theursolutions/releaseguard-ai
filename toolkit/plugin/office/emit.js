#!/usr/bin/env node
// Async hook for every session, prompt, tool call and subagent: sends a privacy-safe summary to the
// local office. It never blocks or fails Claude: every problem is swallowed and it always exits 0.
const { normalize } = require('./lib/normalize');
const { postEvent } = require('./lib/client');

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', async () => {
  try {
    const event = normalize(JSON.parse(raw || '{}'));
    if (event) await postEvent(event);
  } catch {
    // The office is a viewer; Claude's work must never depend on it.
  }
  process.exit(0);
});

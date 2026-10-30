#!/usr/bin/env node
// A stand-in for the `claude` program in the QA tests: it records the arguments and the prompt it was given
// (to FAKE_CLAUDE_LOG, one JSON line per call) and answers in Claude Code's stream-json format with a fixed
// root-cause analysis wrapped in prose and a code fence, like a real answer can be.
const fs = require('fs');

let prompt = '';
process.stdin.on('data', (chunk) => (prompt += chunk));
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args: process.argv.slice(2), prompt })}\n`);
  const analysis = {
    category: 'app-bug',
    rootCause: 'Saving a product fails on the server: POST /api/products answers 500, so the confirmation never shows.',
    evidence: ['POST /api/products returned 500', 'The console says: Saving the product failed with 500'],
    reproduce: ['Log in as Agent', 'Open /products/create', 'Type a product name and select Save product', 'No confirmation appears'],
    suggestion: 'Fix the server error behind POST /api/products, then run the case again.',
    confidence: 'high',
  };
  const lines = [
    { type: 'system', subtype: 'init', mcp_servers: [{ name: 'devcrew_qa', status: 'connected' }] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__devcrew_qa__qa_explore', input: { as: 'Agent', path: '/products/create' } }] } },
    { type: 'result', subtype: 'success', is_error: false, result: `I checked the page again.\n\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`` },
  ];
  process.stdout.write(lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { tempHome } = require('./helpers');

const home = tempHome('devcrew-qa-mcp-');

test('the MCP server answers initialize and tools/list over stdio', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server.js'), '--app', 'nope', '--env', 'local', '--case', 'abcd1234'], { env: { ...process.env, DEVCREW_HOME: home, DEVCREW_OFFICE_PORT: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map();
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    replies.set(message.id, message);
    waiting.get(message.id)?.(message);
  });
  const request = (id, method, params) =>
    new Promise((resolve) => {
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  const init = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const list = await request(2, 'tools/list', {});
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['qa_explore', 'qa_try_case', 'qa_save_case']);
  assert.ok(list.result.tools.every((tool) => tool.inputSchema.type === 'object'));

  const unknown = await request(3, 'resources/list', {});
  assert.equal(unknown.error.code, -32601);

  // The app does not exist: the tool reports it as a tool error instead of crashing the server.
  const call = await request(4, 'tools/call', { name: 'qa_explore', arguments: { as: 'Agent' } });
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /could not start/);

  child.stdin.end();
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0);
  assert.equal(replies.has(undefined), false, 'notifications get no reply');
});

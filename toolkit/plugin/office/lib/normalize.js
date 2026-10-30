// Turns a raw Claude Code hook input into a small office event.
// Privacy rule: prompts, file contents, command arguments and agent replies never leave this function.
// Only agent names, tool names, file names, command names and the short hand-off description survive.
const path = require('path');
const { baseType } = require('./stages');

const KINDS = ['session.start', 'request', 'handoff', 'agent.start', 'tool', 'agent.stop', 'session.idle', 'session.end'];

function clip(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeId(value, fallback) {
  const id = String(value ?? '').replace(/[^\w.-]/g, '').slice(0, 64);
  return id || fallback;
}

function fileName(filePath) {
  const name = clip(path.basename(String(filePath || '')), 60);
  return /^[\w.@()+ -]+$/.test(name) ? name : 'a file';
}

/** "php artisan test --filter=X" → "php artisan test". Stops at the first flag, assignment, quote or operator. */
function commandName(command) {
  const words = [];
  for (const token of String(command || '').trim().split(/\s+/)) {
    if (/[|;&<>]/.test(token) || words.length === 3) break;
    if (!/^[A-Za-z0-9_.:/\\-]{1,40}$/.test(token) || token.startsWith('-') || token.includes('=')) break;
    words.push(words.length === 0 ? path.basename(token.replace(/\\/g, '/')) : token);
  }
  return words.length ? words.join(' ') : 'a command';
}

function describeTool(tool, input = {}) {
  switch (tool) {
    case 'Read':
      return `Reading ${fileName(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${fileName(input.file_path)}`;
    case 'Write':
      return `Writing ${fileName(input.file_path)}`;
    case 'NotebookEdit':
      return `Editing ${fileName(input.notebook_path)}`;
    case 'Bash':
    case 'PowerShell':
      return `Running ${commandName(input.command)}`;
    case 'Grep':
    case 'Glob':
      return 'Searching the code';
    case 'WebFetch':
    case 'WebSearch':
      return 'Researching on the web';
    case 'TodoWrite':
      return 'Updating the task list';
    case 'Skill':
      return `Using /${safeId(input.skill, 'a skill')}`;
    default:
      if (String(tool).startsWith('mcp__')) {
        return /atlassian|jira|confluence/i.test(tool) ? 'Reading Jira / Confluence' : `Using ${safeId(String(tool).split('__')[1], 'a connector')}`;
      }
      return `Using ${safeId(tool, 'a tool')}`;
  }
}

/** Returns an office event, or null when the hook is not interesting for the office. */
function normalize(input) {
  if (!input || typeof input !== 'object') return null;

  const base = {
    ts: Date.now(),
    session: safeId(input.session_id, 'unknown'),
    project: clip(path.basename(String(input.cwd || '')), 60) || 'project',
    agentId: safeId(input.agent_id, 'main'),
    agentType: input.agent_id ? clip(baseType(input.agent_type), 60) || 'agent' : 'router',
  };

  switch (input.hook_event_name) {
    case 'SessionStart':
      return { ...base, kind: 'session.start' };
    case 'UserPromptSubmit': {
      const command = String(input.prompt || '').match(/^\s*\/([\w:-]{1,60})/);
      return { ...base, kind: 'request', text: command ? `/${command[1]}` : 'New request' };
    }
    case 'PreToolUse':
      if (input.tool_name === 'Agent' || input.tool_name === 'Task') {
        return {
          ...base,
          kind: 'handoff',
          target: clip(baseType(input.tool_input?.subagent_type), 60) || 'general-purpose',
          text: clip(input.tool_input?.description, 80),
        };
      }
      return { ...base, kind: 'tool', tool: safeId(input.tool_name, 'tool'), text: describeTool(input.tool_name, input.tool_input || {}) };
    case 'SubagentStart':
      return { ...base, kind: 'agent.start' };
    case 'SubagentStop':
      return { ...base, kind: 'agent.stop' };
    case 'Stop':
      return { ...base, kind: 'session.idle' };
    case 'SessionEnd':
      return { ...base, kind: 'session.end' };
    default:
      return null;
  }
}

/** Server-side check of an event posted to /events: drops unknown fields and clips every string again. */
function sanitizeEvent(event) {
  if (!event || typeof event !== 'object' || !KINDS.includes(event.kind)) return null;
  const clean = {
    kind: event.kind,
    ts: Number.isFinite(event.ts) ? event.ts : Date.now(),
    session: safeId(event.session, 'unknown'),
    project: clip(event.project, 60) || 'project',
    agentId: safeId(event.agentId, 'main'),
    agentType: clip(event.agentType, 60) || 'agent',
  };
  if (event.text !== undefined) clean.text = clip(event.text, 120);
  if (event.tool !== undefined) clean.tool = safeId(event.tool, 'tool');
  if (event.target !== undefined) clean.target = clip(event.target, 60);
  if (event.demo === true) clean.demo = true;
  return clean;
}

module.exports = { normalize, sanitizeEvent, describeTool, commandName, KINDS };

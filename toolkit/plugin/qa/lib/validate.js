// Checks a test written by the case-preparing Claude before it is saved or run. A spec runs as Node code
// on this computer, so it may only drive the browser through the devcrew-qa fixture: no modules, no files,
// no processes, no reflection. This is a guard rail, not a sandbox: it blocks every route we know of, and the
// background Claude has no file or shell tools either.
const MAX_SPEC_BYTES = 30 * 1024;
const FIXTURE_IMPORT = '../../../lib/devcrew-qa';

// Checked against the code with string, comment and regex contents removed, so step names such as
// "Open the Leads module" stay allowed.
const FORBIDDEN = [
  [/\brequire\b/, 'require is not allowed; import only from the devcrew-qa fixture'],
  [/\bimport\s*\(/, 'dynamic import() is not allowed'],
  [/\bimport\s*\.\s*meta\b/, 'import.meta is not allowed'],
  [/\bexport\b/, 'export is not allowed'],
  [/\bprocess\b/, 'process is not allowed'],
  [/\bchild_process\b/, 'child_process is not allowed'],
  [/\bfs\b|\bpath\b/, 'file system access (fs, path) is not allowed'],
  [/\beval\b/, 'eval is not allowed'],
  [/\bFunction\b/, 'the Function constructor is not allowed'],
  [/\bglobalThis\b|\bglobal\b|\bWebAssembly\b|\bBuffer\b/, 'global objects are not allowed'],
  [/\b__dirname\b|\b__filename\b|\bmodule\b|\bexports\b/, 'module internals are not allowed'],
  [/\bconstructor\b|\bprototype\b|__proto__|\bReflect\b|\bProxy\b|\bObject\b|\bgetPrototypeOf\b|\bprepareStackTrace\b|\barguments\b/, 'reflection (constructor, prototype, Object, Reflect) is not allowed'],
  [/\bthis\b/, 'this is not allowed in a test'],
  [/\bfetch\b/, 'fetch is not allowed; drive the page instead'],
  [/\.\s*_/, 'private Playwright members (._name) are not allowed'],
  [/\btest\s*\.\s*use\b|\blaunch\w*|\bbrowserType\b|\bexecutablePath\b|\bconnect\w*\b|\bnewCDPSession\b/, 'changing how the browser is started is not allowed'],
  [/\bsetInputFiles\b|\bsaveAs\b|\bfulfill\b|\bstorageState\b|\bcookies\b|\btoHaveScreenshot\b|\btoMatchSnapshot\b/, 'reading or writing files, cookies or sessions is not allowed'],
];

const NOT_MEMBER_ACCESS = new Set(['const', 'let', 'var', 'return', 'of', 'in', 'await', 'yield', 'typeof', 'case', 'else', 'do', 'new', 'void', 'delete', 'throw']);
const REGEX_CAN_START = /[(,=:[!&|?{};+\-*%<>~^]$/;

/** The code with the contents of strings, comments and regex literals removed. Template literals stay as they are. */
function codeOnly(code) {
  let out = '';
  let i = 0;
  const skipQuoted = (quote) => {
    i += 1;
    while (i < code.length && code[i] !== quote) {
      if (code[i] === '\\') i += 1;
      if (code[i] === '\n') throw new Error('unterminated string');
      i += 1;
    }
    if (i >= code.length) throw new Error('unterminated string');
    i += 1;
  };
  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];
    if (char === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
    } else if (char === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated comment');
      i = end + 2;
      out += ' ';
    } else if (char === '"' || char === "'") {
      skipQuoted(char);
      out += `${char}${char}`;
    } else if (char === '/' && REGEX_CAN_START.test(out.trimEnd() || ';')) {
      let inClass = false;
      i += 1;
      while (i < code.length && (code[i] !== '/' || inClass)) {
        if (code[i] === '\\') i += 1;
        else if (code[i] === '[') inClass = true;
        else if (code[i] === ']') inClass = false;
        if (code[i] === '\n') throw new Error('unterminated regular expression');
        i += 1;
      }
      i += 1;
      while (/[a-z]/i.test(code[i] || '')) i += 1;
      out += '/x/';
    } else if (char === '`') {
      const start = i;
      i += 1;
      while (i < code.length && code[i] !== '`') i += code[i] === '\\' ? 2 : 1;
      if (i >= code.length) throw new Error('unterminated template');
      i += 1;
      out += code.slice(start, i);
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** x[0] and type[] are fine; x['name'], x[key] and x[`a${b}`] can reach anything, so they are refused. */
function hasComputedAccess(code) {
  for (const match of code.matchAll(/([\w$]+|\)|\])\s*\[(?!\s*\d*\s*\])/g)) {
    if (!NOT_MEMBER_ACCESS.has(match[1])) return true;
  }
  return false;
}

/** Returns { ok, errors[] }. errors are short, plain-language reasons the background Claude can act on. */
function validateSpec(code) {
  if (typeof code !== 'string' || !code.trim()) return { ok: false, errors: ['the test is empty'] };
  if (Buffer.byteLength(code) > MAX_SPEC_BYTES) return { ok: false, errors: ['the test is larger than 30 KB'] };

  let stripped;
  try {
    stripped = codeOnly(code);
  } catch (error) {
    return { ok: false, errors: [`the test could not be read: ${error.message}`] };
  }

  const errors = [];
  const imports = [...code.matchAll(/^\s*import\b[^'"`;]*['"`]([^'"`]*)['"`]/gm)];
  if (imports.length === 0) errors.push(`the test must import { test, expect } from '${FIXTURE_IMPORT}'`);
  for (const match of imports) {
    if (match[1] !== FIXTURE_IMPORT) errors.push(`only '${FIXTURE_IMPORT}' may be imported, not '${match[1].slice(0, 60)}'`);
  }

  for (const [pattern, reason] of FORBIDDEN) {
    if (pattern.test(stripped)) errors.push(reason);
  }
  // A quoted object key such as { 'path': … } hides from the code-only checks above.
  if (/['"`](?:path|constructor|__proto__|prototype)['"`]\s*:/.test(code)) errors.push('reading or writing files, cookies or sessions is not allowed');
  if (hasComputedAccess(stripped)) errors.push('use .nth(), .first() or for...of instead of [name] or [variable] access');
  if (/\{\{\s*(?:password|username)\s*\}\}/i.test(code)) errors.push('credential placeholders are not allowed in a test; as(label) logs in');

  const tests = stripped.match(/(?<![.\w$])test\s*(?:\.\s*(?:only|skip|fixme|fail)\s*)?\(/g) || [];
  if (tests.length !== 1) errors.push(`the file must contain exactly one test( call, found ${tests.length}`);

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

module.exports = { validateSpec, FIXTURE_IMPORT, MAX_SPEC_BYTES };

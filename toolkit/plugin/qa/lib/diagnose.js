// What a failed case's report says beyond the raw error: the steps the test took (and where it stopped),
// expected vs actual in plain words, the page it was on, what the browser saw going wrong, and steps a
// human tester can follow to see the failure. Deterministic: built from Playwright's results and the
// fixture's diagnostics, without AI. Claude Code's root-cause analysis (analyse.js) is added on top.
const MAX_STEPS = 40;
const MAX_EVIDENCE = 20;
const LOGIN_STEP = /^Log in as (.+)$/;
const CATEGORIES = ['app-bug', 'test-outdated', 'environment', 'flaky'];
const CONFIDENCE = ['high', 'medium', 'low'];

const stripAnsi = (text) => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const oneLine = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const seconds = (ms) => {
  const value = Number(ms) / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} s`;
};

/** The titles of test.step('…') calls in a saved spec, in source order (only plain string titles). */
function specStepTitles(source) {
  const titles = [];
  for (const match of String(source || '').matchAll(/test\.step\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (match[1] === '`' && match[2].includes('${')) continue;
    titles.push(match[2].replace(/\\(.)/g, '$1'));
  }
  return titles;
}

/** "getByRole('button', { name: 'Export' })" → 'the button "Export"'. Null when there is no locator. */
function describeLocator(locator) {
  const text = String(locator || '').trim();
  if (!text) return null;
  const calls = [...text.matchAll(/getBy(Role|Text|Label|Placeholder|TestId|Title|AltText)\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(\/(?:\\.|[^/\\])+\/[a-z]*))(?:\s*,\s*\{([^}]*)\})?\s*\)/g)];
  const last = calls.at(-1);
  if (!last) return `the element ${oneLine(text, 120)}`;
  const [, kind, single, double, regex, options = ''] = last;
  const value = single ?? double ?? regex;
  const quoted = (name) => (name.startsWith('/') ? name : `"${name}"`);
  if (kind === 'Role') {
    const name = /name:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(\/(?:\\.|[^/\\])+\/[a-z]*))/.exec(options);
    const label = name ? name[1] ?? name[2] ?? name[3] : null;
    return label ? `the ${value} ${quoted(label)}` : `the ${value}`;
  }
  return {
    Text: `the text ${quoted(value)}`,
    Label: `the field ${quoted(value)}`,
    Placeholder: `the field with the hint ${quoted(value)}`,
    TestId: `the element with test id ${quoted(value)}`,
    Title: `the element titled ${quoted(value)}`,
    AltText: `the image ${quoted(value)}`,
  }[kind];
}

// What each web-first assertion checks, as the end of "<subject> …".
const MATCHERS = {
  toBeVisible: 'is visible',
  toBeHidden: 'is hidden',
  toBeEnabled: 'is enabled',
  toBeDisabled: 'is disabled',
  toBeChecked: 'is checked',
  toBeEditable: 'is editable',
  toBeFocused: 'has the focus',
  toBeEmpty: 'is empty',
  toBeAttached: 'is on the page',
  toBeInViewport: 'is on screen',
  toHaveText: (value) => `shows ${value}`,
  toContainText: (value) => `contains ${value}`,
  toHaveValue: (value) => `has the value ${value}`,
  toHaveCount: (value) => `appears ${value} times`,
  toHaveAttribute: (value) => `has the attribute ${value}`,
  toHaveClass: (value) => `has the class ${value}`,
};
const NEGATED = { is: 'is not', has: 'does not have', shows: 'does not show', contains: 'does not contain', appears: 'does not appear' };
const negate = (phrase) => phrase.replace(/^(is|has|shows|contains|appears)\b/, (verb) => NEGATED[verb]);
const ACTIONS = { click: 'clicked', dblclick: 'double-clicked', fill: 'filled in', check: 'checked', uncheck: 'unchecked', selectOption: 'used to choose an option', hover: 'pointed at', press: 'used to press a key', type: 'typed into', setInputFiles: 'given a file', focus: 'focused', waitFor: 'shown' };

/**
 * Plain-language expected and actual from a Playwright error message: an expect() that failed (Expected and
 * Received lines, or an element that was not found), an action that timed out, a test timeout, or a page that
 * did not open. Unknown errors keep their first line as the actual result.
 */
function parseFailure(message) {
  const text = stripAnsi(message).replace(/\r/g, '');
  if (!text.trim()) return { expected: null, actual: null };
  const line = (name) => new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(text)?.[1].trim() ?? null;
  const waitingFor = /waiting for (getBy\w+\(.*\)|locator\(.*\))\s*$/m.exec(text)?.[1] ?? null;
  const timeout = /Timeout:?\s*(\d+)\s*ms/i.exec(text)?.[1] ?? /Timeout (\d+)ms exceeded/.exec(text)?.[1] ?? null;
  const firstLine = oneLine(text.split('\n').find((part) => part.trim()) || '', 300).replace(/^\w*Error:\s*/, '');

  const assertion = /expect\((locator|page)\)\.(not\.)?(\w+)\(/.exec(text);
  if (assertion) {
    const [, target, negated, matcher] = assertion;
    const expectedValue = line('Expected');
    const received = line('Received');
    if (target === 'page' || matcher === 'toHaveURL' || matcher === 'toHaveTitle') {
      const what = matcher === 'toHaveTitle' ? 'page title' : 'page address';
      return {
        expected: `The ${what} ${negated ? 'is not' : 'is'} ${expectedValue ?? 'as the test expects'}`,
        actual: received ? `The ${what} was ${received}` : firstLine,
      };
    }
    const subject = describeLocator(line('Locator') || waitingFor) || 'the element';
    const phrase = typeof MATCHERS[matcher] === 'function' ? MATCHERS[matcher](expectedValue ?? 'the expected value') : MATCHERS[matcher] || `passes ${matcher}`;
    const expected = `${capital(subject)} ${negated ? negate(phrase) : phrase}`;
    let actual;
    if (/element\(s\) not found/.test(text)) actual = `${capital(subject)} was not found on the page${timeout ? ` after ${seconds(timeout)}` : ''}`;
    else if (received && typeof MATCHERS[matcher] === 'function') actual = `${capital(subject)} ${matcher === 'toHaveCount' ? `appears ${received} times` : `shows ${received}`}`;
    else if (matcher === 'toBeVisible' && !negated && received === 'hidden') actual = `${capital(subject)} is on the page but not visible`;
    else if (received) actual = `${capital(subject)} is ${received}`;
    else actual = firstLine;
    return { expected, actual };
  }

  const navigation = /page\.goto: (.+?) at (\S+)/.exec(text) || /page\.goto: (Timeout \d+ms exceeded)/.exec(text);
  if (navigation) {
    const address = navigation[2] || /navigating to "([^"]+)"/.exec(text)?.[1] || 'the page';
    const reason = /Timeout (\d+)ms/.test(navigation[1]) ? `it did not finish loading within ${seconds(/Timeout (\d+)ms/.exec(navigation[1])[1])}` : `the browser reported ${oneLine(navigation[1], 120)}`;
    return { expected: `The page ${address} opens`, actual: `It did not open: ${reason}` };
  }

  const action = /(?:locator|page|frame)\.(\w+): (?:Test )?[Tt]imeout (?:of )?(\d+)ms exceeded/.exec(text);
  if (action) {
    const subject = describeLocator(waitingFor) || 'the element';
    const verb = ACTIONS[action[1]] || 'used';
    const testTimeout = /Test timeout/.test(action[0]);
    return {
      expected: `${capital(subject)} can be ${verb}`,
      actual: `${capital(subject)} was not found or not ready ${testTimeout ? `before the test ran out of time (${seconds(action[2])})` : `within ${seconds(action[2])}`}`,
    };
  }

  const testTimeout = /Test timeout of (\d+)ms exceeded/.exec(text);
  if (testTimeout) {
    const subject = describeLocator(waitingFor);
    return { expected: subject ? `${capital(subject)} appears` : 'The test finishes in time', actual: `The test ran out of time after ${seconds(testTimeout[1])}${subject ? ` while waiting for ${subject}` : ''}` };
  }

  return { expected: null, actual: firstLine || null };
}

/**
 * The test's top-level steps from Playwright's result, in order: passed, failed (the one with an error), then
 * the spec's remaining steps as skipped, because Playwright stops at the first failure.
 */
function stepsOf(result, specSource = '') {
  const steps = (result?.steps || []).slice(0, MAX_STEPS).map((step) => {
    const entry = { title: oneLine(step.title, 160), status: step.error ? 'failed' : 'passed', durationMs: Math.max(0, Math.round(Number(step.duration) || 0)) };
    // The plain-language result where it can be read, else the error's first part without the call log.
    if (step.error) entry.error = oneLine(parseFailure(step.error.message).actual || stripAnsi(step.error.message).split('\nCall log:')[0], 300);
    return entry;
  });
  let cursor = 0;
  const titles = specStepTitles(specSource);
  for (const step of steps) {
    const index = titles.indexOf(step.title, cursor);
    if (index !== -1) cursor = index + 1;
  }
  const failed = steps.some((step) => step.status === 'failed');
  if (failed) for (const title of titles.slice(cursor)) if (steps.length < MAX_STEPS) steps.push({ title: oneLine(title, 160), status: 'skipped', durationMs: 0 });
  return steps;
}

/** Same-origin page address shown without the origin, so a long base URL does not hide the path. */
function pathOf(url, baseUrl) {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(baseUrl).origin ? `${parsed.pathname}${parsed.search}` || '/' : url;
  } catch {
    return url || '';
  }
}

/** Manual steps a tester can follow: where, who (label and username, never the password), what, and the result. */
function reproduceSteps({ environment, accounts, steps, failedIndex, expected, actual, url }) {
  const kind = environment.kind && environment.kind.toLowerCase() !== String(environment.name).toLowerCase() ? ` (${environment.kind})` : '';
  const lines = [`Open ${environment.name}${kind} at ${environment.baseUrl} in a browser.`];
  const upTo = failedIndex === -1 ? steps.filter((step) => step.status !== 'skipped') : steps.slice(0, failedIndex + 1);
  for (const step of upTo) {
    const login = LOGIN_STEP.exec(step.title);
    if (login) {
      const account = accounts.find((item) => item.label.toLowerCase() === login[1].toLowerCase());
      lines.push(account?.username ? `Log in as ${account.label} (account: ${account.username}).` : `Log in as ${login[1]}.`);
    } else lines.push(step.title);
  }
  if (url && failedIndex !== -1) lines.push(`The failure shows on ${pathOf(url, environment.baseUrl)}.`);
  lines.push(`Expected: ${expected || 'the step finishes without an error'} / Actual: ${actual || 'it failed'}`);
  return lines;
}

/** The fixture's diagnostics, capped and with every password removed. */
function evidenceOf(diagnostics, clean) {
  const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_EVIDENCE) : []);
  return {
    failedRequests: list(diagnostics?.failedRequests).map((request) => ({ method: oneLine(request?.method, 10).toUpperCase() || 'GET', url: clean(oneLine(request?.url, 400)), status: Math.max(0, Math.round(Number(request?.status) || 0)) })),
    consoleErrors: list(diagnostics?.consoleErrors).map((message) => clean(oneLine(message, 300))),
    pageErrors: list(diagnostics?.pageErrors).map((message) => clean(oneLine(message, 300))),
  };
}

/**
 * The deterministic part of a failed case's diagnosis. clean() removes passwords from any text.
 * analysis stays null with analysisStatus 'skipped' until analyse.js investigates the failure.
 */
function buildDiagnosis({ result, environment, accounts, specSource = '', diagnostics = null, clean = (text) => text }) {
  const steps = stepsOf(result, specSource).map((step) => (step.error ? { ...step, error: clean(step.error) } : step));
  const failedIndex = steps.findIndex((step) => step.status === 'failed');
  const failedRaw = failedIndex === -1 ? null : result.steps?.[failedIndex]?.error?.message;
  // The failing step's error has the call log; the test's error alone may only say "Test timeout".
  let { expected, actual } = parseFailure(failedRaw || result?.error?.message);
  if (!expected && !actual && failedRaw) ({ expected, actual } = parseFailure(result?.error?.message));
  expected = expected ? clean(oneLine(expected, 400)) : null;
  actual = actual ? clean(oneLine(actual, 400)) : null;
  const url = typeof diagnostics?.url === 'string' && /^https?:/.test(diagnostics.url) ? clean(oneLine(diagnostics.url, 400)) : null;
  return {
    steps,
    failedStep: failedIndex === -1 ? null : steps[failedIndex].title,
    expected,
    actual,
    url,
    reproduce: reproduceSteps({ environment, accounts, steps, failedIndex, expected, actual, url }).map((text) => clean(text)),
    evidence: evidenceOf(diagnostics, clean),
    analysis: null,
    analysisStatus: 'skipped',
  };
}

/** Shortens long text at the end of a sentence (or a word), so it never stops mid-word. */
function clipText(value, max) {
  const text = oneLine(value, 100000);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sentence = cut.lastIndexOf('. ');
  return sentence > max * 0.6 ? cut.slice(0, sentence + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}
const clipList = (value, max) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 8).map((item) => clipText(item, max)) : []);

/** Checks one analysis object; null when it is not a usable answer. */
function checkAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!CATEGORIES.includes(value.category) || !CONFIDENCE.includes(value.confidence)) return null;
  if (typeof value.rootCause !== 'string' || !value.rootCause.trim()) return null;
  if (value.evidence !== undefined && !Array.isArray(value.evidence)) return null;
  if (value.reproduce !== undefined && !Array.isArray(value.reproduce)) return null;
  return {
    category: value.category,
    rootCause: clipText(value.rootCause, 800),
    evidence: clipList(value.evidence, 400),
    reproduce: clipList(value.reproduce, 400),
    suggestion: typeof value.suggestion === 'string' ? clipText(value.suggestion, 600) : '',
    confidence: value.confidence,
  };
}

/** The JSON object starting at text[start], by brace matching that skips braces inside strings. */
function objectAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Claude Code's final answer → a checked analysis, or null. The answer may be bare JSON, JSON in a code
 * fence, or JSON after some prose; the last valid object wins.
 */
function parseAnalysis(text) {
  const source = String(text ?? '').slice(-20000);
  const candidates = [...source.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map((match) => match[1]);
  // Bounded, so a long answer full of unmatched braces cannot make this slow.
  for (let i = source.indexOf('{'), tries = 0; i !== -1 && tries < 200; i = source.indexOf('{', i + 1), tries += 1) {
    const found = objectAt(source, i);
    if (found) candidates.push(found);
  }
  let best = null;
  for (const candidate of candidates) {
    try {
      best = checkAnalysis(JSON.parse(candidate.trim())) || best;
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return best;
}

module.exports = { parseFailure, describeLocator, specStepTitles, stepsOf, buildDiagnosis, parseAnalysis, checkAnalysis, CATEGORIES, LOGIN_STEP };

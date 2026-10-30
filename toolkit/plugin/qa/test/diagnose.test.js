const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFailure, describeLocator, specStepTitles, stepsOf, buildDiagnosis, parseAnalysis } = require('../lib/diagnose');

// Error messages as Playwright 1.61 writes them in results.json (colour codes included).
const NOT_FOUND = "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoBeVisible\u001b[2m(\u001b[22m\u001b[2m)\u001b[22m failed\n\nLocator: getByRole('button', { name: 'Export' })\nExpected: visible\nTimeout: 2000ms\nError: element(s) not found\n\nCall log:\n\u001b[2m  - Expect \"toBeVisible\" with timeout 2000ms\u001b[22m\n\u001b[2m  - waiting for getByRole('button', { name: 'Export' })\u001b[22m\n";
const WRONG_TEXT = "Error: expect(locator).toHaveText(expected) failed\n\nLocator:  getByRole('heading')\nExpected: \"Hello\"\nReceived: \"Hi\"\nTimeout:  1000ms\n\nCall log:\n  - Expect \"toHaveText\" with timeout 1000ms\n  - waiting for getByRole('heading')\n    11 × locator resolved to <h1>Hi</h1>\n";
const CLICK_TIMEOUT = "TimeoutError: locator.click: Timeout 15000ms exceeded.\nCall log:\n\u001b[2m  - waiting for getByRole('link', { name: 'Reports' })\u001b[22m\n";
const TEST_TIMEOUT = "Error: locator.click: Test timeout of 90000ms exceeded.\nCall log:\n  - waiting for getByLabel('Phone')\n";
const NAVIGATION = 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/leads\nCall log:\n  - navigating to "http://127.0.0.1:9/leads", waiting until "load"\n';
const URL_MISMATCH = 'Error: expect(page).toHaveURL(expected) failed\n\nExpected: "http://app.test/leads"\nReceived: "http://app.test/login"\nTimeout: 5000ms\n';

test('Playwright errors become plain expected and actual results', () => {
  assert.deepEqual(parseFailure(NOT_FOUND), { expected: 'The button "Export" is visible', actual: 'The button "Export" was not found on the page after 2 s' });
  assert.deepEqual(parseFailure(WRONG_TEXT), { expected: 'The heading shows "Hello"', actual: 'The heading shows "Hi"' });
  assert.deepEqual(parseFailure(CLICK_TIMEOUT), { expected: 'The link "Reports" can be clicked', actual: 'The link "Reports" was not found or not ready within 15 s' });
  assert.deepEqual(parseFailure(TEST_TIMEOUT), { expected: 'The field "Phone" can be clicked', actual: 'The field "Phone" was not found or not ready before the test ran out of time (90 s)' });
  assert.deepEqual(parseFailure(NAVIGATION), { expected: 'The page http://127.0.0.1:9/leads opens', actual: 'It did not open: the browser reported net::ERR_CONNECTION_REFUSED' });
  assert.deepEqual(parseFailure(URL_MISMATCH), { expected: 'The page address is "http://app.test/leads"', actual: 'The page address was "http://app.test/login"' });
  assert.deepEqual(parseFailure('\u001b[31mTest timeout of 2000ms exceeded.\u001b[39m'), { expected: 'The test finishes in time', actual: 'The test ran out of time after 2 s' });
  assert.deepEqual(parseFailure('Error: No test account labelled "Boss" for this environment. Add it on the QA page.'), { expected: null, actual: 'No test account labelled "Boss" for this environment. Add it on the QA page.' });
  assert.deepEqual(parseFailure(''), { expected: null, actual: null });
  assert.equal(parseFailure("Error: expect(locator).not.toBeVisible() failed\n\nLocator: getByText('Error')\nExpected: not visible\nReceived: visible\n").expected, 'The text "Error" is not visible');
});

test('locators read as plain words', () => {
  assert.equal(describeLocator("getByRole('row').filter({ hasText: 'Ann' }).getByRole('button', { name: 'Edit' })"), 'the button "Edit"');
  assert.equal(describeLocator("getByLabel('Email')"), 'the field "Email"');
  assert.equal(describeLocator('getByText(/saved/i)'), 'the text /saved/i');
  assert.equal(describeLocator("locator('#x')"), "the element locator('#x')");
  assert.equal(describeLocator(''), null);
});

test('steps: in order, the failed one marked, the ones never reached skipped', () => {
  const spec = "test.step('Open the form', async () => {});\n  await test.step(\"Save it\", async () => {});\n  await test.step(`See it in the list`, async () => {});\n  await test.step(`Row ${n}`, async () => {});";
  assert.deepEqual(specStepTitles(spec), ['Open the form', 'Save it', 'See it in the list']);
  const result = { steps: [{ title: 'Log in as Agent', duration: 812.4 }, { title: 'Open the form', duration: 40 }, { title: 'Save it', duration: 2005, error: { message: NOT_FOUND } }] };
  assert.deepEqual(stepsOf(result, spec), [
    { title: 'Log in as Agent', status: 'passed', durationMs: 812 },
    { title: 'Open the form', status: 'passed', durationMs: 40 },
    { title: 'Save it', status: 'failed', durationMs: 2005, error: 'The button "Export" was not found on the page after 2 s' },
    { title: 'See it in the list', status: 'skipped', durationMs: 0 },
  ]);
});

test('the diagnosis: reproduce steps carry the username but never the password', () => {
  const accounts = [{ label: 'Agent', username: 'agent@shop.test', password: 'S3cret!pw' }];
  const clean = (text) => String(text).split('S3cret!pw').join('***');
  const diagnosis = buildDiagnosis({
    result: { status: 'failed', error: { message: NOT_FOUND }, steps: [{ title: 'Log in as Agent', duration: 900 }, { title: 'Open the leads list', duration: 30 }, { title: 'Find the export button', duration: 2010, error: { message: NOT_FOUND } }] },
    environment: { name: 'Staging', kind: 'staging', baseUrl: 'https://staging.shop.test' },
    accounts,
    specSource: "test.step('Open the leads list', a); test.step('Find the export button', b); test.step('Export', c);",
    diagnostics: { url: 'https://staging.shop.test/leads', failedRequests: [{ method: 'post', url: 'https://staging.shop.test/api/leads?password=S3cret!pw', status: 500 }], consoleErrors: ['Login with S3cret!pw failed'], pageErrors: [] },
    clean,
  });
  assert.equal(diagnosis.failedStep, 'Find the export button');
  assert.equal(diagnosis.url, 'https://staging.shop.test/leads');
  assert.deepEqual(diagnosis.steps.map((step) => step.status), ['passed', 'passed', 'failed', 'skipped']);
  assert.deepEqual(diagnosis.reproduce, [
    'Open Staging at https://staging.shop.test in a browser.',
    'Log in as Agent (account: agent@shop.test).',
    'Open the leads list',
    'Find the export button',
    'The failure shows on /leads.',
    'Expected: The button "Export" is visible / Actual: The button "Export" was not found on the page after 2 s',
  ]);
  assert.deepEqual(diagnosis.evidence, { failedRequests: [{ method: 'POST', url: 'https://staging.shop.test/api/leads?password=***', status: 500 }], consoleErrors: ['Login with *** failed'], pageErrors: [] });
  assert.equal(diagnosis.analysis, null);
  assert.equal(diagnosis.analysisStatus, 'skipped');
  assert.ok(!JSON.stringify(diagnosis).includes('S3cret!pw'));
});

const ANSWER = { category: 'test-outdated', rootCause: 'The button is now called "Download".', evidence: ['The page has a button "Download"'], reproduce: ['Log in as Agent', 'Open /leads'], suggestion: 'Re-learn the case.', confidence: 'medium' };

test('the analysis answer is read as bare JSON, in a code fence or after prose', () => {
  assert.deepEqual(parseAnalysis(JSON.stringify(ANSWER)), ANSWER);
  assert.deepEqual(parseAnalysis(`I looked at the page.\n\n\`\`\`json\n${JSON.stringify(ANSWER, null, 2)}\n\`\`\`\nThat is all.`), ANSWER);
  assert.deepEqual(parseAnalysis(`My conclusion: ${JSON.stringify(ANSWER)} (checked twice; braces { in prose } are fine)`), ANSWER);
  const long = parseAnalysis(JSON.stringify({ ...ANSWER, suggestion: `${'Ask the team whether the button ships in this build. '.repeat(12)}Then run it again.` }));
  assert.ok(long.suggestion.length <= 600 && long.suggestion.endsWith('build.'), long.suggestion);
  const minimal = parseAnalysis('{"category":"flaky","rootCause":"It passed when tried again.","confidence":"low"}');
  assert.deepEqual(minimal, { category: 'flaky', rootCause: 'It passed when tried again.', evidence: [], reproduce: [], suggestion: '', confidence: 'low' });
});

test('an answer that is not a usable analysis is refused', () => {
  assert.equal(parseAnalysis('I could not work out why it failed.'), null);
  assert.equal(parseAnalysis('{"category": "app-bug", "rootCause": '), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...ANSWER, category: 'cosmic-rays' })), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...ANSWER, confidence: 'certain' })), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...ANSWER, rootCause: '  ' })), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...ANSWER, evidence: 'one string' })), null);
  assert.equal(parseAnalysis(''), null);
  assert.equal(parseAnalysis('{'.repeat(5000)), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSpec } = require('../lib/validate');

const GOOD = `import { test, expect } from '../../../lib/devcrew-qa';

// Steps may say "process", "module" or "path" in their names: only code is checked.
test('Agent creates a lead; phone is required', async ({ as }) => {
  const page = await as('Agent');
  const admin = await as('Admin');
  await test.step('Open the Leads module and process the form', async () => {
    await page.goto('/leads/create');
    await expect(page.getByRole('heading', { name: /don't|new lead/i })).toBeVisible();
  });
  await test.step('Save', async () => {
    const rows = page.getByRole('row');
    const [first] = [rows.first()];
    await page.getByLabel('Name').fill(\`QA \${Date.now()}\`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(rows.nth(0)).toBeVisible();
    await expect(first).toBeVisible();
    await expect(admin.getByText('path: /leads')).toBeHidden();
    const items: string[] = [];
    expect(items.length / 2).toBe(0);
  });
});
`;

const withBody = (body) => `import { test, expect } from '../../../lib/devcrew-qa';\ntest('t', async ({ as }) => {\n  const page = await as('Agent');\n  ${body}\n});\n`;

test('a normal spec is accepted', () => {
  assert.deepEqual(validateSpec(GOOD), { ok: true, errors: [] });
});

test('specs that reach Node, files, other modules or reflection are refused', () => {
  const refused = {
    require: withBody("const cp = require('child_process');"),
    process: withBody('process.env.DEVCREW_QA_ACCOUNTS;'),
    fs: withBody("import('fs');"),
    childProcess: "import { exec } from 'child_process';\nimport { test } from '../../../lib/devcrew-qa';\ntest('t', async () => {});",
    eval: withBody("eval('1');"),
    functionCtor: withBody("new Function('return 1')();"),
    globalThis: withBody('globalThis.x = 1;'),
    constructorChain: withBody("page['con' + 'structor'];"),
    constructorWord: withBody('page.constructor.constructor;'),
    computed: withBody("const key = 'goto'; page[key]('/');"),
    privateMembers: withBody('page._channel;'),
    fetch: withBody("await fetch('https://evil.test');"),
    screenshotPath: withBody("await page.screenshot({ path: 'C:/x.png' });"),
    quotedPathKey: withBody("await page.screenshot({ 'path': 'x.png' });"),
    launch: withBody('await page.context().browser().browserType().launch();'),
    testUse: withBody("test.use({ baseURL: 'x' });"),
    storageState: withBody('await page.context().storageState();'),
    placeholder: withBody("await page.getByLabel('Password').fill('{{password}}');"),
    thisKeyword: withBody('(function () { return this; })();'),
    extraImport: `import { test } from '@playwright/test';\ntest('t', async () => {});`,
    noImport: `test('t', async () => {});`,
    twoTests: `${withBody('')}\ntest('second', async () => {});`,
    noTest: "import { test } from '../../../lib/devcrew-qa';",
    unterminated: withBody("const a = 'oops;"),
    tooLarge: withBody(`// ${'x'.repeat(31 * 1024)}`),
  };
  for (const [name, code] of Object.entries(refused)) {
    const result = validateSpec(code);
    assert.equal(result.ok, false, name);
    assert.ok(result.errors.length > 0, name);
  }
  assert.match(validateSpec(refused.twoTests).errors.join(), /exactly one test/);
  assert.match(validateSpec(refused.extraImport).errors.join(), /only '\.\.\/\.\.\/\.\.\/lib\/devcrew-qa' may be imported/);
  assert.equal(validateSpec('').ok, false);
  assert.equal(validateSpec(null).ok, false);
});

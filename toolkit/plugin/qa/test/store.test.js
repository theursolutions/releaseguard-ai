const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempHome } = require('./helpers');

const home = tempHome('devcrew-qa-store-');
const store = require('../lib/store');

const environment = { name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test/', loginPath: '/login' };

test('apps get a slug id, cleaned environments, and an update keeps the id', () => {
  const app = store.saveApp({ name: '  My CRM!! ', environments: [environment, { name: 'Prod', kind: 'production', baseUrl: 'https://crm.example.test', allowProduction: 'yes' }] });
  assert.equal(app.id, 'my-crm');
  assert.deepEqual(app.environments[0], { id: 'staging', name: 'Staging', kind: 'staging', baseUrl: 'https://staging.example.test', loginPath: '/login', allowProduction: false });
  assert.equal(app.environments[1].allowProduction, false, 'only a real true allows production');
  assert.equal(store.saveApp({ name: 'My CRM', environments: [environment] }).id, 'my-crm-2', 'a second app with the same name gets its own id');

  const updated = store.saveApp({ id: 'my-crm', name: 'My CRM', environments: [{ ...app.environments[0], name: 'Staging EU' }] });
  assert.equal(updated.environments[0].id, 'staging', 'environment ids survive a rename');
  assert.equal(store.getApp('my-crm').environments.length, 1);
  assert.deepEqual(store.listAppIds(), ['my-crm', 'my-crm-2']);
});

test('app validation explains what is wrong in plain language', () => {
  const rejects = (input, pattern) => assert.throws(() => store.saveApp(input), (error) => error.status === 422 && pattern.test(error.message));
  rejects({ name: '', environments: [environment] }, /needs a name/);
  rejects({ name: 'X', environments: [] }, /at least one environment/);
  rejects({ id: 'Bad Id', name: 'X', environments: [environment] }, /lowercase letters/);
  rejects({ id: `a${'b'.repeat(40)}`, name: 'X', environments: [environment] }, /lowercase letters/);
  rejects({ name: 'X', environments: [{ ...environment, kind: 'dev' }] }, /needs a kind/);
  rejects({ name: 'X', environments: [{ ...environment, baseUrl: 'ftp://x.test' }] }, /http/);
  rejects({ name: 'X', environments: [{ ...environment, baseUrl: 'https://user:pw@x.test' }] }, /username or password/);
  rejects({ name: 'X', environments: [{ ...environment, loginPath: '//evil.test/login' }] }, /must start with \//);
  assert.throws(() => store.getApp('../etc'), (error) => error.status === 404);
});

test('accounts never come back with a password, and the secrets file is private', () => {
  store.saveApp({ id: 'acc', name: 'Accounts', environments: [environment, { ...environment, name: 'UAT', kind: 'uat' }] });
  const account = store.addAccount('acc', { label: 'Agent', username: 'agent@x.test', password: 'pw-123456', environment: 'staging' });
  assert.deepEqual(Object.keys(account).sort(), ['environment', 'id', 'label', 'username']);
  assert.ok(!JSON.stringify(store.listAccounts('acc')).includes('pw-123456'));
  assert.ok(!JSON.stringify(store.appOverview()).includes('pw-123456'));
  assert.ok(!fs.readFileSync(path.join(home, 'qa', 'apps', 'acc', 'app.json'), 'utf8').includes('pw-123456'), 'passwords live only in qa-secrets');

  const file = store.secretsFile('acc');
  assert.equal(path.dirname(file), path.join(home, 'qa-secrets'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  assert.throws(() => store.addAccount('acc', { label: 'agent', username: 'b', password: 'c', environment: 'staging' }), /already an account/);
  assert.throws(() => store.addAccount('acc', { label: 'Admin', username: 'b', password: 'c', environment: 'nope' }), /Choose one of/);
  assert.throws(() => store.addAccount('acc', { label: 'Admin', username: 'b' }), /needs a password/);
  store.addAccount('acc', { label: 'Agent', username: 'uat@x.test', password: 'x', environment: 'uat' });
  assert.deepEqual(store.accountsFor('acc', 'uat').map((item) => item.username), ['uat@x.test']);

  // Removing an environment keeps its accounts, now usable in every environment.
  store.saveApp({ id: 'acc', name: 'Accounts', environments: [environment] });
  assert.deepEqual(store.listAccounts('acc').map((item) => [item.username, item.environment]), [['agent@x.test', 'staging'], ['uat@x.test', null]]);

  store.deleteAccount('acc', account.id);
  assert.equal(store.listAccounts('acc').length, 1);
  assert.throws(() => store.deleteAccount('acc', account.id), (error) => error.status === 404);
});

test('bulk case text becomes one case per line, without bullets and notes', () => {
  assert.deepEqual(store.splitCaseText('# Leads\n1. Agent creates a lead\n\n  - phone is required  \n* Admin exports\n2) Deleted lead is gone\n• Bullet'), ['Agent creates a lead', 'phone is required', 'Admin exports', 'Deleted lead is gone', 'Bullet']);

  store.saveApp({ id: 'cases', name: 'Cases', environments: [environment] });
  const created = store.addCases('cases', { text: '1. Agent creates a lead\n2. Admin exports leads', tags: 'Smoke, leads' });
  assert.equal(created.length, 2);
  assert.match(created[0].id, /^[a-z0-9]{8}$/);
  assert.deepEqual([created[0].status, created[0].tags, created[0].title], ['pending', ['smoke', 'leads'], 'Agent creates a lead']);
  assert.equal(store.addCases('cases', { cases: [{ text: 'x'.repeat(100), tags: ['a'] }] })[0].title.length, 80);
  assert.throws(() => store.addCases('cases', { text: '# only a note' }), /at least one/);
  assert.throws(() => store.addCases('cases', { text: 'ok', tags: ['bad tag!'] }), /may only use/);
});

test('editing case text sends it back to pending and drops its old test; re-learn and delete work', () => {
  const [item] = store.addCases('cases', { text: 'Edit me' });
  fs.writeFileSync(store.specFile('cases', item.id), '// prepared');
  store.setCase('cases', item.id, { status: 'ready' });

  assert.equal(store.updateCase('cases', item.id, { tags: ['x'] }).status, 'ready', 'a tag change keeps the test');
  const edited = store.updateCase('cases', item.id, { text: 'Edited text' });
  assert.deepEqual([edited.status, edited.title, fs.existsSync(store.specFile('cases', item.id))], ['pending', 'Edited text', false]);
  assert.ok(store.needsPreparing('cases', edited));

  store.setCase('cases', item.id, { status: 'failed', prepError: 'x' });
  assert.deepEqual([store.relearnCase('cases', item.id).status, store.relearnCase('cases', item.id).prepError], ['pending', null]);
  const [second, third] = store.addCases('cases', { text: 'Second\nThird' });
  store.setCase('cases', second.id, { status: 'failed', prepError: 'x', prepReason: 'data' });
  store.setCase('cases', third.id, { status: 'failed', prepError: 'y', prepReason: 'blocked' });
  assert.throws(() => store.relearnCases('cases', [second.id, 'zzzzzzzz']), (error) => error.status === 404);
  assert.equal(store.listCases('cases').find((entry) => entry.id === second.id).status, 'failed', 'an unknown id changes nothing');
  assert.throws(() => store.relearnCases('cases', []), (error) => error.status === 422);
  const relearned = store.relearnCases('cases', [second.id, third.id]);
  assert.deepEqual(relearned.map((entry) => [entry.status, entry.prepError, entry.prepReason]), [['pending', null, null], ['pending', null, null]]);
  store.deleteCase('cases', second.id);
  store.deleteCase('cases', third.id);

  store.deleteCase('cases', item.id);
  assert.throws(() => store.updateCase('cases', item.id, { text: 'y' }), (error) => error.status === 404);
});

test('runs are listed newest first, compared within an environment, and pruned to the newest 50', () => {
  store.saveApp({ id: 'runs', name: 'Runs', environments: [environment] });
  const ids = [];
  for (let i = 0; i < 53; i += 1) {
    const id = `runs-20260101-0000${String(i).padStart(2, '0')}-ab${String(i).padStart(2, '0')}`;
    ids.push(id);
    store.writeSummary({ id, app: 'runs', environment: { id: 'staging' }, status: i === 52 ? 'running' : 'passed', startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), counts: {}, cases: [] });
  }
  assert.ok(ids.every(store.isRunId));
  assert.equal(store.listRuns('runs')[0].id, ids[52]);
  assert.equal(store.previousRun('runs', 'staging', ids[52]).id, ids[51]);
  assert.equal(store.previousRun('runs', 'other-env', ids[52]), null);

  store.pruneRuns('runs');
  const left = store.listRuns('runs').map((run) => run.id);
  assert.equal(left.length, 51, '50 finished runs plus the running one');
  assert.ok(left.includes(ids[52]) && !left.includes(ids[0]) && !left.includes(ids[1]));
  assert.throws(() => store.readSummary('../../secret'), (error) => error.status === 404);
});

test('deleting an app removes its cases, accounts and runs', () => {
  store.saveApp({ id: 'gone', name: 'Gone', environments: [environment] });
  store.addAccount('gone', { label: 'A', username: 'u', password: 'p' });
  store.writeSummary({ id: 'gone-20260101-000000-abcd', app: 'gone', environment: { id: 'staging' }, status: 'passed', startedAt: '2026', cases: [] });
  store.deleteApp('gone');
  assert.equal(fs.existsSync(store.secretsFile('gone')), false);
  assert.equal(store.listRuns('gone').length, 0);
  assert.throws(() => store.getApp('gone'), (error) => error.status === 404);
});

test('apps link to project folders: full paths only, cleaned, deduplicated, and one app per folder', () => {
  const folder = path.join(home, 'code', 'crm');
  const other = path.join(home, 'code', 'shop');
  const linked = store.saveApp({ id: 'linked', name: 'Linked', environments: [environment], projects: [`${folder}${path.sep}`, ` ${folder} `, path.join(folder, 'sub', '..'), other] });
  assert.deepEqual(linked.projects, [folder, other], 'trailing separators, spaces and ".." are cleaned and duplicates dropped');
  if (process.platform === 'win32') assert.deepEqual(store.saveApp({ ...linked, projects: [folder, folder.toUpperCase()] }).projects, [folder], 'Windows paths ignore case');
  assert.deepEqual(store.saveApp({ id: 'linked', name: 'Linked again', environments: [environment] }).projects, [folder], 'saving without projects keeps them');
  assert.deepEqual(store.appOverview().find((app) => app.id === 'linked').projects, [folder]);

  // Linking the folder to another app moves it there.
  store.saveApp({ id: 'linked', name: 'Linked', environments: [environment], projects: [folder, other] });
  const moved = store.saveApp({ id: 'mover', name: 'Mover', environments: [environment], projects: [folder] });
  assert.deepEqual(moved.projects, [folder]);
  assert.deepEqual(store.getApp('linked').projects, [other]);
  assert.deepEqual(store.saveApp({ id: 'mover', name: 'Mover', environments: [environment], projects: [] }).projects, [], 'an empty list unlinks');

  const rejects = (projects, pattern) => assert.throws(() => store.saveApp({ id: 'linked', name: 'Linked', environments: [environment], projects }), (error) => error.status === 422 && pattern.test(error.message));
  rejects(['relative/folder'], /not a full folder path/);
  rejects([''], /not a full folder path/);
  rejects([`${folder}\nsecond`], /not a full folder path/);
  rejects(path.join(home, 'x'), /must be a list/);
  rejects(Array.from({ length: 21 }, (_, i) => path.join(home, `p${i}`)), /at most 20/);
  assert.deepEqual(store.getApp('linked').projects, [other], 'a refused save changes nothing');
  assert.equal(store.projectKey(store.cleanProjectPath(folder)), store.projectKey(folder));
});

// QA's files: apps and their environments, test accounts (passwords in qa-secrets/), cases and runs.
// Every function validates what it stores and throws a QaError with a plain-language message.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { secretsDir, appDir, casesDir, runsRoot, runDir } = require('./paths');

const APP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}-\d{8}-\d{6}-[a-z0-9]{4}$/;
const ITEM_ID = /^[a-z0-9]{8}$/;
const TAG = /^[a-z0-9][a-z0-9_-]{0,29}$/;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;
const ENV_KINDS = ['local', 'staging', 'uat', 'production'];
const MAX_ENVIRONMENTS = 10;
const MAX_PROJECTS = 20;
const MAX_PROJECT_PATH = 400;
const MAX_CASES_PER_APP = 1000;
const MAX_CASE_TEXT = 2000;
const KEEP_RUNS = 50;
const FINISHED = ['passed', 'failed', 'stopped', 'error'];

class QaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const invalid = (message) => new QaError(422, message);
const notFound = (what) => new QaError(404, `${what} not found`);
const randomId = (length = 8) => Array.from(crypto.randomBytes(length), (byte) => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const now = () => new Date().toISOString();

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file so a reader never sees half a file. */
function writeJson(file, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomId(4)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  try {
    fs.renameSync(temp, file);
  } catch {
    // Windows refuses the rename while another process has the file open; a direct write still works.
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
    fs.rmSync(temp, { force: true });
  }
  fs.chmodSync(file, mode);
}

// ---------- apps and environments ----------

function checkAppId(id) {
  if (typeof id !== 'string' || !APP_ID.test(id)) throw notFound('app');
  return id;
}

function getApp(id) {
  const app = readJson(path.join(appDir(checkAppId(id)), 'app.json'), null);
  if (!app) throw notFound('app');
  return app;
}

function appExists(id) {
  return APP_ID.test(String(id)) && fs.existsSync(path.join(appDir(id), 'app.json'));
}

function listAppIds() {
  try {
    return fs.readdirSync(path.join(runsRoot(), '..', 'apps')).filter(appExists).sort();
  } catch {
    return [];
  }
}

function cleanBaseUrl(value, name) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw invalid(`The base URL of "${name}" is not a valid web address, for example https://staging.example.com.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw invalid(`The base URL of "${name}" must start with http:// or https://.`);
  if (url.username || url.password) throw invalid(`The base URL of "${name}" must not contain a username or password. Add a test account instead.`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function cleanLoginSelectors(login) {
  if (!login || typeof login !== 'object') return undefined;
  const clean = {};
  for (const key of ['username', 'password', 'submit']) {
    const value = text(login[key], 200);
    if (value) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
}

function cleanEnvironment(input, taken) {
  const name = text(input?.name, 60);
  if (!name) throw invalid('Every environment needs a name, for example "Staging".');
  const kind = ENV_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw invalid(`The environment "${name}" needs a kind: local, staging, uat or production.`);

  let id = typeof input.id === 'string' && APP_ID.test(input.id) ? input.id : slug(name) || randomId();
  for (let n = 2; taken.has(id); n += 1) id = `${slug(name).slice(0, 36) || 'env'}-${n}`;
  taken.add(id);

  const loginPath = String(input.loginPath || '/login').trim();
  if (!loginPath.startsWith('/') || loginPath.startsWith('//') || loginPath.length > 200) throw invalid(`The login path of "${name}" must start with /, for example /login.`);

  const environment = { id, name, kind, baseUrl: cleanBaseUrl(input.baseUrl, name), loginPath, allowProduction: kind === 'production' && input.allowProduction === true };
  const login = cleanLoginSelectors(input.login);
  if (login) environment.login = login;
  return environment;
}

// ---------- project folders (a developer's code folder, so the crew can run the app's QA cycle) ----------

/** A project folder as stored: a full path, resolved, without a trailing separator. */
function cleanProjectPath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > MAX_PROJECT_PATH || /[\u0000-\u001f]/.test(raw) || !path.isAbsolute(raw)) {
    throw invalid(`"${raw.slice(0, 80)}" is not a full folder path, for example C:\\projects\\crm or /home/me/crm.`);
  }
  return path.resolve(raw);
}

// Folder names ignore case on Windows and macOS, so C:\Code\CRM and c:\code\crm are the same folder there.
const projectKey = (folder) => (['win32', 'darwin'].includes(process.platform) ? folder.toLowerCase() : folder);

function cleanProjects(list) {
  if (!Array.isArray(list)) throw invalid('Project folders must be a list of full folder paths.');
  const byKey = new Map();
  for (const item of list) {
    const folder = cleanProjectPath(item);
    if (!byKey.has(projectKey(folder))) byKey.set(projectKey(folder), folder);
  }
  if (byKey.size > MAX_PROJECTS) throw invalid(`An app can be linked to at most ${MAX_PROJECTS} project folders.`);
  return [...byKey.values()];
}

/** A folder belongs to one app at most: linking it to this app removes it from any other. */
function releaseProjects(appId, projects) {
  const keys = new Set(projects.map(projectKey));
  if (keys.size === 0) return;
  for (const otherId of listAppIds()) {
    if (otherId === appId) continue;
    const other = getApp(otherId);
    const kept = (other.projects || []).filter((folder) => !keys.has(projectKey(folder)));
    if (kept.length !== (other.projects || []).length) writeJson(path.join(appDir(otherId), 'app.json'), { ...other, projects: kept });
  }
}

/** Creates an app, or updates it when the id already exists. Environment ids are kept so accounts stay linked. */
function saveApp(input = {}) {
  const name = text(input.name, 60);
  if (!name) throw invalid('The app needs a name.');
  const environments = Array.isArray(input.environments) ? input.environments : [];
  if (environments.length === 0) throw invalid('Add at least one environment with its base URL.');
  if (environments.length > MAX_ENVIRONMENTS) throw invalid(`An app can have at most ${MAX_ENVIRONMENTS} environments.`);

  let id;
  if (input.id !== undefined && input.id !== null && input.id !== '') {
    if (typeof input.id !== 'string' || !APP_ID.test(input.id)) throw invalid('The app id may only use lowercase letters, numbers and dashes (up to 40 characters).');
    id = input.id;
  } else {
    const base = slug(name) || `app-${randomId(4)}`;
    id = base;
    for (let n = 2; appExists(id); n += 1) id = `${base.slice(0, 36)}-${n}`;
  }

  const taken = new Set();
  const cleanEnvironments = environments.map((environment) => cleanEnvironment(environment, taken));
  // Saving without a project list keeps the folders already linked.
  const projects = input.projects === undefined || input.projects === null ? readJson(path.join(appDir(id), 'app.json'), {}).projects || [] : cleanProjects(input.projects);
  const app = { id, name, environments: cleanEnvironments, projects };
  releaseProjects(id, projects);
  writeJson(path.join(appDir(id), 'app.json'), app);

  // Accounts of a removed environment stay, usable in every environment, rather than pointing nowhere.
  const secrets = readSecrets(id);
  if (secrets.accounts.some((account) => account.environment !== null && !taken.has(account.environment))) {
    secrets.accounts = secrets.accounts.map((account) => (account.environment !== null && !taken.has(account.environment) ? { ...account, environment: null } : account));
    writeJson(secretsFile(id), secrets, 0o600);
  }
  return app;
}

function deleteApp(id) {
  getApp(id);
  fs.rmSync(appDir(id), { recursive: true, force: true });
  fs.rmSync(secretsFile(id), { force: true });
  for (const run of listRuns(id)) fs.rmSync(runDir(run.id), { recursive: true, force: true });
}

function getEnvironment(app, envId) {
  const environment = app.environments.find((item) => item.id === envId);
  if (!environment) throw invalid('Choose one of the app\'s environments.');
  return environment;
}

// ---------- accounts (passwords live only in qa-secrets/) ----------

const secretsFile = (appId) => path.join(secretsDir(), `${appId}.json`);
const readSecrets = (appId) => readJson(secretsFile(checkAppId(appId)), { accounts: [] });
const publicAccount = ({ id, label, username, environment }) => ({ id, label, username, environment });

function listAccounts(appId) {
  getApp(appId);
  return readSecrets(appId).accounts.map(publicAccount);
}

function addAccount(appId, input = {}) {
  const app = getApp(appId);
  const label = text(input.label, 40);
  if (!LABEL.test(label)) throw invalid('The account needs a short label such as "Agent" or "Admin" (letters, numbers, spaces, dots, dashes).');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username || username.length > 200) throw invalid('The account needs a username or email.');
  const password = typeof input.password === 'string' ? input.password : '';
  if (!password || password.length > 200) throw invalid('The account needs a password.');
  const environment = input.environment ? getEnvironment(app, input.environment).id : null;

  const secrets = readSecrets(appId);
  const clash = secrets.accounts.some((account) => account.label.toLowerCase() === label.toLowerCase() && (account.environment === null || environment === null || account.environment === environment));
  if (clash) throw invalid(`There is already an account labelled "${label}" for this environment.`);

  const account = { id: randomId(), label, username, password, environment };
  secrets.accounts.push(account);
  writeJson(secretsFile(appId), secrets, 0o600);
  return publicAccount(account);
}

function deleteAccount(appId, accountId) {
  getApp(appId);
  const secrets = readSecrets(appId);
  const remaining = secrets.accounts.filter((account) => account.id !== accountId);
  if (remaining.length === secrets.accounts.length) throw notFound('account');
  writeJson(secretsFile(appId), { accounts: remaining }, 0o600);
}

/** Accounts usable in an environment, WITH passwords. Only for the runner, the login check and the explorer. */
function accountsFor(appId, envId) {
  return readSecrets(appId).accounts.filter((account) => account.environment === null || account.environment === envId);
}

// ---------- cases ----------

const caseIndex = (appId) => path.join(casesDir(appId), 'index.json');
const specFile = (appId, caseId) => path.join(casesDir(appId), `${caseId}.spec.ts`);
const tryFile = (appId, caseId) => path.join(casesDir(appId), `${caseId}.try.spec.ts`);
const hashText = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

function listCases(appId) {
  getApp(appId);
  return readJson(caseIndex(appId), []);
}

function saveCases(appId, cases) {
  writeJson(caseIndex(appId), cases);
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  const clean = [...new Set(list.map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
  const bad = clean.find((tag) => !TAG.test(tag));
  if (bad) throw invalid(`The tag "${bad.slice(0, 30)}" may only use letters, numbers, dashes and underscores.`);
  if (clean.length > 10) throw invalid('A case can have at most 10 tags.');
  return clean;
}

function cleanCaseText(value) {
  const clean = text(value, MAX_CASE_TEXT + 1);
  if (!clean) throw invalid('A test case needs some text.');
  if (clean.length > MAX_CASE_TEXT) throw invalid(`A test case can be at most ${MAX_CASE_TEXT} characters.`);
  return clean;
}

/** One case per non-empty line. Lines starting with # are notes; "1." "2)" "-" "*" "•" bullets are removed. */
function splitCaseText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^(?:\d{1,3}[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean);
}

const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Where PRD test cases came from: a title, an https link when there is one, and the kind of source. */
function cleanPrdSource(input = {}) {
  const title = oneLine(input?.title, 120);
  if (!title) throw invalid('Give the PRD a title, for example its Confluence page name.');
  let url = null;
  if (input.url) {
    let parsed = null;
    try {
      parsed = new URL(String(input.url));
    } catch {
      // Refused below.
    }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalid('The PRD link must be an https:// address, for example the Confluence page link.');
    url = parsed.href.slice(0, 500);
  }
  return { title, url, kind: ['confluence', 'file', 'text'].includes(input.kind) ? input.kind : 'text' };
}

/** A case added from a PRD keeps its source and flow, so a failure can be traced back to the requirement. */
function cleanCaseSource(input) {
  if (!input || typeof input !== 'object') return null;
  return { ...cleanPrdSource(input), flow: oneLine(input.flow, 80) || null };
}

function newCase(caseText, tags, source = null) {
  return { id: randomId(), title: caseText.slice(0, 80), text: caseText, tags, status: 'pending', prepError: null, textHash: hashText(caseText), preparedAt: null, updatedAt: now(), ...(source ? { source } : {}) };
}

/** Accepts { text, tags } (bulk text, one case per line) or { cases: [{ text, tags }] }. Returns the new cases. */
function addCases(appId, input = {}) {
  const existing = listCases(appId);
  const drafts = Array.isArray(input.cases)
    ? input.cases.map((item) => ({ text: cleanCaseText(item?.text), tags: cleanTags(item?.tags), source: cleanCaseSource(item?.source) }))
    : splitCaseText(input.text).map((line) => ({ text: cleanCaseText(line), tags: cleanTags(input.tags) }));
  if (drafts.length === 0) throw invalid('Paste at least one test case, one per line.');
  if (existing.length + drafts.length > MAX_CASES_PER_APP) throw invalid(`An app can have at most ${MAX_CASES_PER_APP} test cases.`);

  const created = drafts.map((draft) => newCase(draft.text, draft.tags, draft.source));
  saveCases(appId, [...existing, ...created]);
  return created;
}

function findCase(cases, caseId) {
  const index = cases.findIndex((item) => item.id === caseId);
  if (index === -1) throw notFound('case');
  return index;
}

/** Changes stored fields of one case. Used by the routes and by case preparation. */
function setCase(appId, caseId, changes) {
  const cases = listCases(appId);
  const index = findCase(cases, caseId);
  cases[index] = { ...cases[index], ...changes, updatedAt: now() };
  saveCases(appId, cases);
  return cases[index];
}

function updateCase(appId, caseId, input = {}) {
  const current = listCases(appId)[findCase(listCases(appId), caseId)];
  const changes = {};
  if (input.tags !== undefined) changes.tags = cleanTags(input.tags);
  if (input.text !== undefined) {
    const caseText = cleanCaseText(input.text);
    if (caseText !== current.text) {
      // The saved test no longer matches the case, so it is prepared again on the next run.
      Object.assign(changes, { text: caseText, title: caseText.slice(0, 80), textHash: hashText(caseText), status: 'pending', prepError: null, prepReason: null, preparedAt: null });
      fs.rmSync(specFile(appId, caseId), { force: true });
    }
  }
  return setCase(appId, caseId, changes);
}

function relearnCase(appId, caseId) {
  return setCase(appId, caseId, { status: 'pending', prepError: null, prepReason: null });
}

/** Marks several cases to re-learn on the next run, in one write. Unknown ids are refused before anything changes. */
function relearnCases(appId, caseIds) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) throw invalid('Choose at least one case to re-learn.');
  const cases = listCases(appId);
  const wanted = new Set(caseIds.map(String));
  for (const id of wanted) findCase(cases, id);
  const updatedAt = now();
  const updated = cases.map((item) => (wanted.has(item.id) ? { ...item, status: 'pending', prepError: null, prepReason: null, updatedAt } : item));
  saveCases(appId, updated);
  return updated.filter((item) => wanted.has(item.id));
}

function deleteCase(appId, caseId) {
  const cases = listCases(appId);
  cases.splice(findCase(cases, caseId), 1);
  saveCases(appId, cases);
  fs.rmSync(specFile(appId, caseId), { force: true });
  fs.rmSync(tryFile(appId, caseId), { force: true });
}

/** A case needs (re)preparing when it is new, edited, asked to re-learn, or its saved test is missing. */
function needsPreparing(appId, item) {
  if (item.status === 'pending' || item.status === 'preparing') return true;
  return item.status === 'ready' && !fs.existsSync(specFile(appId, item.id));
}

// ---------- runs ----------

function newRunId(appId) {
  const stamp = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}`;
  const time = `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  return `${appId}-${date}-${time}-${randomId(4)}`;
}

const isRunId = (id) => typeof id === 'string' && RUN_ID.test(id);
const summaryFile = (runId) => path.join(runDir(runId), 'summary.json');

function readSummary(runId) {
  const summary = isRunId(runId) ? readJson(summaryFile(runId), null) : null;
  if (!summary) throw notFound('run');
  return summary;
}

function writeSummary(summary) {
  writeJson(summaryFile(summary.id), summary);
}

/** Runs of one app (or all apps), newest first. kind is 'cycle' (a test cycle), 'load' or 'stress'. */
function listRuns(appId) {
  let ids = [];
  try {
    ids = fs.readdirSync(runsRoot()).filter(isRunId);
  } catch {
    return [];
  }
  return ids
    .map((id) => readJson(summaryFile(id), null))
    .filter((summary) => summary && (!appId || summary.app === appId))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map(({ id, app, environment, status, startedAt, finishedAt, counts, kind, load }) => ({ id, app, environment, status, startedAt, finishedAt, counts, kind: kind || 'cycle', ...(load?.brief ? { load: load.brief } : {}) }));
}

/** The newest finished test cycle of the same app and environment, for the regression comparison. */
function previousRun(appId, envId, currentRunId) {
  const run = listRuns(appId).find((item) => item.id !== currentRunId && item.kind === 'cycle' && item.environment?.id === envId && ['passed', 'failed'].includes(item.status));
  return run ? readSummary(run.id) : null;
}

function pruneRuns(appId, keep = KEEP_RUNS) {
  const finished = listRuns(appId).filter((run) => FINISHED.includes(run.status));
  for (const run of finished.slice(keep)) fs.rmSync(runDir(run.id), { recursive: true, force: true });
}

/** caseId → { status, runId } from the newest run that included the case. */
function lastResults(appId) {
  const results = {};
  for (const run of listRuns(appId).filter((item) => FINISHED.includes(item.status))) {
    for (const item of readSummary(run.id).cases || []) {
      if (!results[item.id] && item.status !== 'notPrepared') results[item.id] = { status: item.status, runId: run.id };
    }
  }
  return results;
}

function caseCounts(cases) {
  const count = (status) => cases.filter((item) => item.status === status).length;
  return { total: cases.length, ready: count('ready'), pending: count('pending') + count('preparing'), failed: count('failed') };
}

/** The app list for the QA page: no passwords, with case counts and the last run. */
function appOverview() {
  return listAppIds().map((id) => {
    const app = getApp(id);
    const last = listRuns(id)[0];
    return {
      ...app,
      projects: app.projects || [],
      accounts: listAccounts(id),
      caseCounts: caseCounts(listCases(id)),
      lastRun: last ? { id: last.id, status: last.status, passed: last.counts?.passed ?? 0, failed: last.counts?.failed ?? 0, finishedAt: last.finishedAt ?? null } : null,
    };
  });
}

module.exports = {
  QaError,
  APP_ID,
  ITEM_ID,
  ENV_KINDS,
  slug,
  readJson,
  writeJson,
  getApp,
  saveApp,
  deleteApp,
  listAppIds,
  cleanProjectPath,
  projectKey,
  getEnvironment,
  appOverview,
  secretsFile,
  listAccounts,
  addAccount,
  deleteAccount,
  accountsFor,
  listCases,
  addCases,
  splitCaseText,
  cleanTags,
  cleanPrdSource,
  hashText,
  setCase,
  updateCase,
  relearnCase,
  deleteCase,
  needsPreparing,
  relearnCases,
  specFile,
  tryFile,
  newRunId,
  isRunId,
  readSummary,
  writeSummary,
  listRuns,
  previousRun,
  pruneRuns,
  lastResults,
};

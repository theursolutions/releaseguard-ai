// devcrew QA, set-up view: app picker, test accounts, test cases (bulk paste, inline edit, re-learn)
// and the Run test cycle card with a plain-language checklist of anything still missing.
import { enc } from './qa-api.js';
import { createLoadSetup, isLoadKind, loadRunText, modeLabel } from './qa-load.js';
import {
  $,
  animate,
  closeDialog,
  confirmDialog,
  fadeIn,
  formatWhen,
  h,
  icon,
  openDialog,
  pill,
  plural,
  readPref,
  resultTone,
  toast,
  writePref,
} from './qa-ui.js';

const KINDS = [
  { id: 'local', label: 'Local' },
  { id: 'staging', label: 'Staging' },
  { id: 'uat', label: 'UAT' },
  { id: 'production', label: 'Production' },
];

// A ready-made app the "Add app" dialog can fill in. Nothing is added until the tester saves it.
const PRESET = {
  id: 'releaseguard',
  name: 'ReleaseGuard portal',
  environments: [{ name: 'Local', kind: 'local', baseUrl: 'http://localhost:8090', loginPath: '/login' }],
};

const CASE_STATUS = {
  pending: { label: 'Learns on next run', tone: 'neutral', title: 'New or changed. The next test cycle learns it first, then runs it.' },
  preparing: { label: 'Learning now', tone: 'info', title: 'Claude Code is exploring the app and writing this test.' },
  ready: { label: 'Ready', tone: 'pass', title: 'Learned. It replays quickly on every run.' },
  failed: { label: 'Couldn’t learn', tone: 'warn', title: 'Skipped in runs until it is re-learned.' },
};

// Why a case couldn't be learned (prepReason from the server), in the order the groups are shown.
const LEARN_REASONS = {
  data: { label: 'Needs test data', hint: 'This environment is missing records these cases need, such as a property or a lead. Add them with the test account, then re-learn.' },
  blocked: { label: 'Can’t be automated', hint: 'A captcha, email or SMS step stops the browser. Test these by hand, or ask the developers to turn the captcha off on this environment.' },
  different: { label: 'App works differently', hint: 'The app doesn’t do what these cases say. Check the wording against the app, or report a bug.' },
  unclear: { label: 'Case is unclear', hint: 'Rewrite each case with the page, the action and what should appear. Saving a change re-learns it.' },
  timeout: { label: 'Took too long', hint: 'Split each case into smaller cases, or re-learn it.' },
  setup: { label: 'Setup problem', hint: 'Claude Code or the test account wasn’t ready. Fix that, then re-learn.' },
  other: { label: 'Other reasons', hint: 'Read what Claude Code said under each case.' },
};
const reasonOf = (item) => (LEARN_REASONS[item.prepReason] ? item.prepReason : 'other');

export function createSetup(ctx) {
  const { state, api } = ctx;
  const els = {
    loading: $('setup-loading'),
    welcome: $('welcome'),
    workspace: $('workspace'),
    appSelect: $('app-select'),
    appMeta: $('app-meta'),
    composer: $('composer'),
    casesText: $('cases-text'),
    casesTags: $('cases-tags'),
    btnAddCases: $('btn-add-cases'),
    casesSummary: $('cases-summary'),
    caseTools: $('case-tools'),
    tagFilter: $('tag-filter'),
    caseList: $('case-list'),
    learnIssues: $('learn-issues'),
    learnIssuesTitle: $('learn-issues-title'),
    learnGroups: $('learn-groups'),
    casesEmpty: $('cases-empty'),
    casesFilteredEmpty: $('cases-filtered-empty'),
    runForm: $('run-form'),
    runEnv: $('run-env'),
    runEnvHint: $('run-env-hint'),
    runTag: $('run-tag'),
    runParallel: $('run-parallel'),
    runLearnParallel: $('run-learn-parallel'),
    runFastLearn: $('run-fast-learn'),
    runSmoke: $('run-smoke'),
    runPerf: $('run-perf'),
    readiness: $('readiness'),
    btnRun: $('btn-run'),
    btnRunText: $('btn-run-text'),
    runSummary: $('run-summary'),
    runActive: $('run-active'),
    runActiveTitle: $('run-active-title'),
    runActiveText: $('run-active-text'),
    runActiveWatch: $('run-active-watch'),
    accountList: $('account-list'),
    accountsEmpty: $('accounts-empty'),
    accountForm: $('account-form'),
    btnShowAccount: $('btn-show-account'),
    accLabel: $('acc-label'),
    accUser: $('acc-user'),
    accPass: $('acc-pass'),
    accEnv: $('acc-env'),
    accError: $('acc-error'),
    runList: $('run-list'),
    runsEmpty: $('runs-empty'),
    dlgApp: $('dlg-app'),
    appForm: $('app-form'),
    appName: $('app-name'),
    appTitle: $('dlg-app-title'),
    appSave: $('app-save'),
    appProjects: $('app-projects'),
    appPreset: $('app-preset'),
    btnPreset: $('btn-preset-releaseguard'),
    presetNote: $('preset-releaseguard-note'),
    envRows: $('env-rows'),
    appError: $('app-error'),
  };

  let tagFilter = '';
  let reasonFilter = '';
  let editingId = null;
  let busyRun = false;
  let appSignature = '';
  const loginResults = new Map(); // accountId -> { state: 'busy'|'ok'|'fail', message }
  const freshCaseIds = new Set();
  const loadSetup = createLoadSetup(ctx);

  // -------------------------------------------------------------------------------------------
  // App
  // -------------------------------------------------------------------------------------------

  function renderApp() {
    els.loading.hidden = state.loaded;
    els.welcome.hidden = !state.loaded || state.apps.length > 0;
    els.workspace.hidden = !state.loaded || state.apps.length === 0;
    const app = ctx.currentApp();

    const signature = state.apps.map((item) => `${item.id}|${item.name}`).join(';');
    if (signature !== appSignature) {
      appSignature = signature;
      els.appSelect.replaceChildren(...state.apps.map((item) => new Option(item.name || item.id, item.id)));
    }
    if (app) els.appSelect.value = app.id;

    if (app) {
      const envs = (app.environments || []).map((env) => env.name).join(', ');
      const counts = app.caseCounts || {};
      const parts = [envs || 'No environments', plural((app.accounts || []).length, 'account'), plural(counts.total ?? state.cases.length, 'case')];
      els.appMeta.textContent = parts.join(' · ');
    } else {
      els.appMeta.textContent = '';
    }

    renderEnvOptions(app);
    renderAccounts();
    renderRunForm();
    loadSetup.render();
  }

  function renderEnvOptions(app) {
    const envs = app?.environments || [];
    const prefs = runPrefs();
    const previousRunEnv = els.runEnv.value || prefs.environment;
    els.runEnv.replaceChildren(
      ...envs.map((env) => {
        const locked = env.kind === 'production' && !env.allowProduction;
        return new Option(`${env.name}${locked ? ' (production, locked)' : ''}`, env.id);
      }),
    );
    const usable = envs.find((env) => env.id === previousRunEnv) || envs.find((env) => env.kind !== 'production') || envs[0];
    if (usable) els.runEnv.value = usable.id;
    els.runEnv.disabled = envs.length === 0;

    const previousAccEnv = els.accEnv.value;
    els.accEnv.replaceChildren(new Option('All environments', ''), ...envs.map((env) => new Option(env.name, env.id)));
    els.accEnv.value = envs.some((env) => env.id === previousAccEnv) ? previousAccEnv : '';
  }

  els.appSelect.addEventListener('change', () => {
    editingId = null;
    tagFilter = '';
    ctx.selectApp(els.appSelect.value);
  });

  $('btn-welcome-add').addEventListener('click', () => openAppDialog());
  $('btn-add-app').addEventListener('click', () => openAppDialog());
  $('btn-edit-app').addEventListener('click', () => {
    const app = ctx.currentApp();
    if (app) openAppDialog(app);
  });

  $('btn-delete-app').addEventListener('click', async () => {
    const app = ctx.currentApp();
    if (!app) return;
    const yes = await confirmDialog({
      title: `Delete ${app.name}?`,
      body: 'Its test cases, test accounts and reports are removed from this computer. This can’t be undone.',
      confirm: 'Delete app',
    });
    if (!yes) return;
    try {
      await api('DELETE', `/api/qa/apps/${enc(app.id)}`);
      toast(`${app.name} was deleted.`);
      state.appId = null;
      await ctx.refreshApps();
      await Promise.all([ctx.refreshCases(), ctx.refreshRuns()]);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // -------------------------------------------------------------------------------------------
  // Add and edit app dialog
  // -------------------------------------------------------------------------------------------

  // dialogAppId: the app being edited (null when adding). presetId: the ready-made app chosen while adding.
  let dialogAppId = null;
  let presetId = null;
  // An environment's id and login selectors are kept when editing, so its accounts stay linked.
  const envKept = new WeakMap();

  function openAppDialog(app = null) {
    els.appForm.reset();
    els.appError.hidden = true;
    dialogAppId = app?.id || null;
    presetId = null;
    els.appTitle.textContent = app ? `Edit ${app.name}` : 'Add an app';
    els.appSave.textContent = app ? 'Save changes' : 'Add app';
    els.appPreset.hidden = Boolean(app);
    syncPreset();
    els.appName.value = app?.name || '';
    const environments = app?.environments?.length ? app.environments : [{ name: 'Staging', kind: 'staging' }];
    els.envRows.replaceChildren(...environments.map((env) => envRow(env)));
    els.appProjects.value = (app?.projects || []).join('\n');
    syncEnvRemoveButtons();
    openDialog(els.dlgApp);
    els.appName.focus();
  }

  function syncPreset() {
    const added = state.apps.some((item) => item.id === PRESET.id);
    els.btnPreset.disabled = added;
    els.btnPreset.setAttribute('aria-pressed', String(presetId === PRESET.id));
    const env = PRESET.environments[0];
    els.presetNote.textContent = added ? 'Already added' : `${env.name} · ${env.baseUrl}`;
  }

  els.btnPreset.addEventListener('click', () => {
    presetId = PRESET.id;
    els.appError.hidden = true;
    els.appName.value = PRESET.name;
    els.envRows.replaceChildren(...PRESET.environments.map((env) => envRow(env)));
    syncEnvRemoveButtons();
    syncPreset();
    fadeIn(els.envRows);
  });

  let envCounter = 0;
  function envRow(initial = {}) {
    const n = ++envCounter;
    const id = (field) => `env-${field}-${n}`;
    const kind = h('select', { class: 'select', id: id('kind'), 'data-field': 'kind' }, ...KINDS.map((k) => new Option(k.label, k.id)));
    kind.value = initial.kind || 'staging';
    const allow = h('input', { type: 'checkbox', id: id('allow'), 'data-field': 'allowProduction' });
    allow.checked = kind.value === 'production' && initial.allowProduction === true;
    const allowWrap = h(
      'label',
      { class: 'check env-allow', for: id('allow') },
      allow,
      h('span', {}, h('strong', {}, 'Allow testing on production'), h('span', {}, 'Only cases tagged “readonly” will run here.')),
    );
    allowWrap.hidden = kind.value !== 'production';
    kind.addEventListener('change', () => {
      allowWrap.hidden = kind.value !== 'production';
      if (kind.value !== 'production') allow.checked = false;
    });

    const remove = h('button', { type: 'button', class: 'btn btn-icon btn-ghost env-remove', 'aria-label': 'Remove this environment', title: 'Remove this environment' }, icon('trash'));
    const row = h(
      'li',
      { class: 'env-row' },
      field('Name', h('input', { class: 'input', id: id('name'), type: 'text', 'data-field': 'name', value: initial.name || '', placeholder: 'e.g. Staging', maxlength: '40', autocomplete: 'off' }), id('name')),
      field('Type', kind, id('kind')),
      field('Web address', h('input', { class: 'input', id: id('url'), type: 'url', 'data-field': 'baseUrl', value: initial.baseUrl || '', placeholder: 'https://staging.example.com', autocomplete: 'off', spellcheck: 'false' }), id('url'), 'env-url'),
      field('Login page', h('input', { class: 'input', id: id('login'), type: 'text', 'data-field': 'loginPath', value: initial.loginPath || '/login', autocomplete: 'off', spellcheck: 'false' }), id('login')),
      allowWrap,
      remove,
    );
    if (initial.id) envKept.set(row, { id: initial.id, login: initial.login });
    remove.addEventListener('click', () => {
      animate(row, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(12px)' }], { duration: 160 }).then(() => {
        row.remove();
        syncEnvRemoveButtons();
      });
    });
    return row;
  }

  function field(labelText, control, id, extraClass = '') {
    return h('div', { class: `field ${extraClass}`.trim() }, h('label', { for: id }, labelText), control);
  }

  function syncEnvRemoveButtons() {
    const rows = [...els.envRows.children];
    for (const row of rows) row.querySelector('.env-remove').hidden = rows.length < 2;
  }

  $('btn-add-env').addEventListener('click', () => {
    const row = envRow({ name: '', kind: 'uat' });
    els.envRows.append(row);
    syncEnvRemoveButtons();
    fadeIn(row);
    row.querySelector('input').focus();
  });

  for (const button of els.dlgApp.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(els.dlgApp));

  function slug(text, taken) {
    const base = String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'env';
    let candidate = base;
    for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
    taken.add(candidate);
    return candidate;
  }

  function showFormError(target, message, focusEl) {
    target.textContent = message;
    target.hidden = false;
    fadeIn(target, { y: -4 });
    if (focusEl && focusEl.matches('input, textarea, select')) {
      focusEl.setAttribute('aria-invalid', 'true');
      focusEl.setAttribute('aria-describedby', target.id);
      focusEl.addEventListener('input', () => focusEl.removeAttribute('aria-invalid'), { once: true });
    }
    focusEl?.focus();
  }

  els.appForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.appError.hidden = true;
    const name = els.appName.value.trim();
    if (!name) return showFormError(els.appError, 'Give the app a name, for example “CRM”.', els.appName);

    // Kept environment ids are reserved first, so a new environment never takes one of them.
    const taken = new Set([...els.envRows.children].map((row) => envKept.get(row)?.id).filter(Boolean));
    const environments = [];
    for (const row of els.envRows.children) {
      const get = (key) => row.querySelector(`[data-field="${key}"]`);
      const kept = envKept.get(row);
      const envName = get('name').value.trim();
      const baseUrl = get('baseUrl').value.trim();
      let loginPath = get('loginPath').value.trim() || '/login';
      if (!envName) return showFormError(els.appError, 'Each environment needs a name, like “Staging”.', get('name'));
      let parsed = null;
      try {
        parsed = new URL(baseUrl);
      } catch {
        parsed = null;
      }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        return showFormError(els.appError, `Enter the full web address for ${envName}, starting with http:// or https://`, get('baseUrl'));
      }
      if (!loginPath.startsWith('/')) loginPath = `/${loginPath}`;
      const kind = get('kind').value;
      environments.push({
        id: kept?.id || slug(envName, taken),
        name: envName,
        kind,
        baseUrl: parsed.origin + parsed.pathname.replace(/\/+$/, ''),
        loginPath,
        allowProduction: kind === 'production' && get('allowProduction').checked,
        ...(kept?.login ? { login: kept.login } : {}),
      });
    }
    if (!environments.length) return showFormError(els.appError, 'Add at least one environment.', $('btn-add-env'));
    const projects = els.appProjects.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    const save = els.appSave;
    const editing = dialogAppId;
    save.disabled = true;
    try {
      const appId = editing || presetId;
      const app = await api('POST', '/api/qa/apps', { ...(appId ? { id: appId } : {}), name, environments, projects });
      await closeDialog(els.dlgApp);
      if (editing) {
        toast(`${name} was saved.`);
        await ctx.refreshApps();
        return;
      }
      toast(`${name} is ready. Add a test account next.`);
      await ctx.refreshApps();
      if (app?.id) await ctx.selectApp(app.id);
      if (!(ctx.currentApp()?.accounts || []).length) openAccountForm();
    } catch (error) {
      showFormError(els.appError, error.message);
    } finally {
      save.disabled = false;
    }
  });

  // -------------------------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------------------------

  function envName(app, envId) {
    if (!envId) return 'All environments';
    return (app?.environments || []).find((env) => env.id === envId)?.name || envId;
  }

  function renderAccounts() {
    const app = ctx.currentApp();
    const accounts = app?.accounts || [];
    els.accountsEmpty.hidden = accounts.length > 0 || !els.accountForm.hidden;
    els.accountList.replaceChildren(
      ...accounts.map((account) => {
        const result = loginResults.get(account.id);
        const test = h(
          'button',
          { type: 'button', class: 'btn btn-small', 'aria-label': `Test login for ${account.label}`, disabled: result?.state === 'busy' },
          result?.state === 'busy' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('login'),
          result?.state === 'busy' ? 'Testing…' : 'Test login',
        );
        test.addEventListener('click', () => testLogin(app, account));
        const del = h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Delete account ${account.label}`, title: 'Delete account' }, icon('trash'));
        del.addEventListener('click', () => deleteAccount(app, account));

        const li = h(
          'li',
          { class: 'account' },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, (account.label || '?').trim().charAt(0).toUpperCase()),
          h(
            'div',
            { class: 'account-main' },
            h('p', { class: 'account-label' }, account.label),
            h('p', { class: 'account-user' }, account.username || ''),
            h('span', { class: 'env-tag' }, envName(app, account.environment)),
          ),
          h('div', { class: 'account-actions' }, test, del),
        );
        if (result && result.state !== 'busy') {
          const tone = result.state === 'ok' ? 'pass' : 'fail';
          const line = h('p', { class: 'login-result', dataset: { tone }, role: 'status' }, icon(result.state === 'ok' ? 'check' : 'alert'), result.message);
          li.append(line);
        }
        return li;
      }),
    );
  }

  async function testLogin(app, account) {
    const environment = account.environment || els.runEnv.value;
    if (!environment) return toast('Add an environment to the app first.', 'error');
    loginResults.set(account.id, { state: 'busy' });
    renderAccounts();
    try {
      const result = await api('POST', `/api/qa/apps/${enc(app.id)}/test-login`, { environment, account: account.id });
      const ok = Boolean(result?.ok);
      loginResults.set(account.id, { state: ok ? 'ok' : 'fail', message: result?.message || (ok ? 'Login works.' : 'Login failed.') });
    } catch (error) {
      loginResults.set(account.id, { state: 'fail', message: error.message });
    }
    renderAccounts();
    const line = [...els.accountList.querySelectorAll('.login-result')].pop();
    if (line) fadeIn(line, { y: -4 });
  }

  async function deleteAccount(app, account) {
    const yes = await confirmDialog({
      title: `Delete the ${account.label} account?`,
      body: 'Tests that log in as this account will fail until you add it again.',
      confirm: 'Delete account',
    });
    if (!yes) return;
    try {
      await api('DELETE', `/api/qa/apps/${enc(app.id)}/accounts/${enc(account.id)}`);
      loginResults.delete(account.id);
      await ctx.refreshApps();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openAccountForm(envId = '') {
    els.accountForm.hidden = false;
    els.accountsEmpty.hidden = true;
    els.btnShowAccount.setAttribute('aria-expanded', 'true');
    els.accError.hidden = true;
    if (envId) els.accEnv.value = envId;
    fadeIn(els.accountForm, { y: -6 });
    els.accLabel.focus();
  }

  function closeAccountForm() {
    els.accountForm.reset();
    els.accountForm.hidden = true;
    els.btnShowAccount.setAttribute('aria-expanded', 'false');
    renderAccounts();
  }

  els.btnShowAccount.addEventListener('click', () => (els.accountForm.hidden ? openAccountForm() : closeAccountForm()));
  $('acc-cancel').addEventListener('click', closeAccountForm);

  els.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const app = ctx.currentApp();
    if (!app) return;
    const label = els.accLabel.value.trim();
    const username = els.accUser.value.trim();
    const password = els.accPass.value;
    if (!label) return showFormError(els.accError, 'Give the account a short label, like “Agent”.', els.accLabel);
    if (!username) return showFormError(els.accError, 'Enter the username or email used to log in.', els.accUser);
    if (!password) return showFormError(els.accError, 'Enter the password for this account.', els.accPass);
    const save = $('acc-save');
    save.disabled = true;
    try {
      const body = { label, username, password };
      if (els.accEnv.value) body.environment = els.accEnv.value;
      await api('POST', `/api/qa/apps/${enc(app.id)}/accounts`, body);
      els.accPass.value = '';
      closeAccountForm();
      toast(`${label} account saved.`);
      await ctx.refreshApps();
    } catch (error) {
      showFormError(els.accError, error.message);
    } finally {
      save.disabled = false;
    }
  });

  // -------------------------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------------------------

  function parseTags(text) {
    const seen = new Set();
    const tags = [];
    for (const raw of String(text || '').split(',')) {
      const tag = raw.trim().replace(/^#/, '');
      if (tag && !seen.has(tag.toLowerCase())) {
        seen.add(tag.toLowerCase());
        tags.push(tag);
      }
    }
    return tags;
  }

  /** Mirrors the server's split so the button can say how many cases will be added. */
  function countLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.replace(/^(\d+[.)]|[-*•])\s*/, '').trim())
      .filter(Boolean).length;
  }

  function syncComposer() {
    const count = countLines(els.casesText.value);
    els.btnAddCases.disabled = count === 0 || !state.appId;
    els.btnAddCases.textContent = count === 0 ? 'Add cases' : count === 1 ? 'Add 1 case' : `Add ${count} cases`;
  }
  els.casesText.addEventListener('input', syncComposer);

  els.composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const app = ctx.currentApp();
    const text = els.casesText.value;
    if (!app || countLines(text) === 0) return;
    els.btnAddCases.disabled = true;
    try {
      const body = { text };
      const tags = parseTags(els.casesTags.value);
      if (tags.length) body.tags = tags;
      const created = await api('POST', `/api/qa/apps/${enc(app.id)}/cases`, body);
      const list = Array.isArray(created) ? created : [];
      for (const item of list) freshCaseIds.add(item.id);
      els.casesText.value = '';
      syncComposer();
      toast(list.length === 1 ? 'Added 1 test case.' : `Added ${list.length} test cases.`);
      await Promise.all([ctx.refreshCases(), ctx.refreshApps()]);
    } catch (error) {
      toast(error.message, 'error');
      syncComposer();
    }
  });

  function allTags() {
    const counts = new Map();
    for (const item of state.cases) for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function renderCases() {
    const cases = state.cases;
    const counts = { ready: 0, pending: 0, preparing: 0, failed: 0 };
    for (const item of cases) counts[item.status] = (counts[item.status] || 0) + 1;
    const parts = [];
    if (cases.length) parts.push(plural(cases.length, 'case'));
    if (counts.ready) parts.push(`${counts.ready} ready`);
    if (counts.pending + counts.preparing) parts.push(`${counts.pending + counts.preparing} to learn`);
    if (counts.failed) parts.push(`${counts.failed} need attention`);
    els.casesSummary.textContent = parts.join(' · ');

    const tags = allTags();
    if (tagFilter && !tags.some(([tag]) => tag === tagFilter)) tagFilter = '';
    els.caseTools.hidden = tags.length === 0;
    els.tagFilter.replaceChildren(
      filterChip('All', cases.length, tagFilter === '', () => setTagFilter('')),
      ...tags.map(([tag, count]) => filterChip(tag, count, tagFilter === tag, () => setTagFilter(tag))),
    );

    renderLearnIssues(cases);
    const tagged = tagFilter ? cases.filter((item) => (item.tags || []).includes(tagFilter)) : cases;
    const visible = reasonFilter ? tagged.filter((item) => item.status === 'failed' && reasonOf(item) === reasonFilter) : tagged;
    els.casesEmpty.hidden = cases.length > 0 || state.casesFor !== state.appId;
    els.casesFilteredEmpty.hidden = !(cases.length > 0 && visible.length === 0);

    const rows = visible.map((item) => (item.id === editingId ? caseEditor(item) : caseRow(item)));
    els.caseList.replaceChildren(...rows);
    let delay = 0;
    for (const row of rows) {
      if (freshCaseIds.has(row.dataset.id)) {
        fadeIn(row, { y: 10, delay, duration: 280 });
        row.classList.add('row-flash');
        delay += 50;
      }
    }
    freshCaseIds.clear();
    renderRunForm();
    renderTagOptions(tags);
  }

  /** The cases that couldn't be learned, grouped by reason, each group with what to do and a bulk re-learn. */
  function renderLearnIssues(cases) {
    const failed = cases.filter((item) => item.status === 'failed');
    const groups = Object.keys(LEARN_REASONS)
      .map((reason) => ({ reason, items: failed.filter((item) => reasonOf(item) === reason) }))
      .filter((group) => group.items.length);
    if (reasonFilter && !groups.some((group) => group.reason === reasonFilter)) reasonFilter = '';
    els.learnIssues.hidden = groups.length === 0;
    if (!groups.length) return els.learnGroups.replaceChildren();
    els.learnIssuesTitle.textContent = `${plural(failed.length, 'case')} couldn’t be learned`;
    els.learnGroups.replaceChildren(
      ...groups.map(({ reason, items }) => {
        const info = LEARN_REASONS[reason];
        const showing = reasonFilter === reason;
        const show = h('button', { type: 'button', class: 'btn btn-ghost', 'aria-pressed': String(showing) }, showing ? 'Show all cases' : 'Show these');
        show.addEventListener('click', () => {
          reasonFilter = showing ? '' : reason;
          renderCases();
        });
        const relearn = h('button', { type: 'button', class: 'btn btn-strong' }, `Re-learn ${items.length}`);
        relearn.addEventListener('click', () => relearnGroup(items, relearn));
        relearn.disabled = Boolean(state.activeRun);
        return h(
          'li',
          { class: 'learn-group', dataset: { reason, showing: String(showing) } },
          h('div', { class: 'learn-group-main' }, h('p', { class: 'learn-group-label' }, h('strong', {}, info.label), h('span', { class: 'filter-count' }, String(items.length))), h('p', { class: 'learn-group-hint' }, info.hint)),
          h('div', { class: 'learn-group-actions' }, show, relearn),
        );
      }),
    );
  }

  async function relearnGroup(items, button) {
    button.disabled = true;
    try {
      await api('POST', `/api/qa/apps/${enc(state.appId)}/relearn`, { ids: items.map((item) => item.id) });
      for (const item of items) freshCaseIds.add(item.id);
      reasonFilter = '';
      toast(items.length === 1 ? 'It will be learned again on the next run.' : `${items.length} cases will be learned again on the next run.`);
      await ctx.refreshCases();
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
    }
  }

  function filterChip(label, count, active, onClick) {
    const button = h('button', { type: 'button', class: 'filter-chip', 'aria-pressed': String(active) }, h('span', {}, label), h('span', { class: 'filter-count' }, String(count)));
    button.addEventListener('click', onClick);
    return button;
  }

  function setTagFilter(tag) {
    tagFilter = tag;
    renderCases();
  }

  function statusIcon(status) {
    const wrap = h('span', { class: 'case-icon', dataset: { status }, 'aria-hidden': 'true' });
    if (status === 'ready') wrap.append(icon('check'));
    else if (status === 'failed') wrap.append(icon('alert'));
    return wrap;
  }

  function caseRow(item) {
    const status = CASE_STATUS[item.status] ? item.status : 'pending';
    const info = CASE_STATUS[status];
    const reason = status === 'failed' && reasonOf(item) !== 'other' ? LEARN_REASONS[reasonOf(item)].label : '';
    const statusPill = pill(reason ? `${info.label}: ${reason}` : info.label, info.tone, { title: info.title });
    if (status === 'preparing') statusPill.prepend(h('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }));

    const meta = h('div', { class: 'case-meta' }, statusPill, ...(item.tags || []).map((tag) => h('span', { class: 'tag' }, `#${tag}`)));
    if (item.lastResult?.runId) {
      const { tone, label } = resultTone(item.lastResult.status);
      meta.append(h('a', { class: 'last-result', dataset: { tone }, href: `#/report/${encodeURIComponent(item.lastResult.runId)}`, title: 'Open the report of the last run' }, `Last run: ${label}`));
    }

    const main = h('div', { class: 'case-main' }, h('p', { class: 'case-title' }, item.text || item.title || ''), meta);
    if (item.source?.title) main.append(caseSource(item.source));
    if (status === 'failed' && item.prepError) main.append(h('p', { class: 'case-error' }, item.prepError));
    const live = h('p', { class: 'case-live', dataset: { for: item.id } });
    main.append(live);

    const edit = iconButton('edit', `Edit: ${item.title || 'case'}`, 'Edit', () => {
      editingId = item.id;
      renderCases();
      els.caseList.querySelector('textarea')?.focus();
    });
    const relearn = iconButton('relearn', `Re-learn: ${item.title || 'case'}`, 'Re-learn on the next run', () => relearnCase(item));
    relearn.disabled = status === 'pending' || status === 'preparing';
    const del = iconButton('trash', `Delete: ${item.title || 'case'}`, 'Delete', () => deleteCase(item));

    return h('li', { class: 'case', dataset: { id: item.id, status } }, statusIcon(status), main, h('div', { class: 'case-actions' }, edit, relearn, del));
  }

  /** "From PRD: <title> · <flow>", linked when the PRD has a link, so a case traces back to its requirement. */
  function caseSource(source) {
    const name = source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : h('span', {}, source.title);
    return h('p', { class: 'case-source' }, 'From PRD: ', name, source.flow ? ` · ${source.flow}` : '');
  }

  function iconButton(name, label, title, onClick) {
    const button = h('button', { type: 'button', class: 'btn btn-icon btn-ghost btn-quiet', 'aria-label': label, title }, icon(name));
    button.addEventListener('click', onClick);
    return button;
  }

  function caseEditor(item) {
    const textId = `edit-text-${item.id}`;
    const tagsId = `edit-tags-${item.id}`;
    const text = h('textarea', { class: 'input textarea', id: textId, rows: '3' });
    text.value = item.text || '';
    const tags = h('input', { class: 'input', id: tagsId, type: 'text', autocomplete: 'off' });
    tags.value = (item.tags || []).join(', ');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancel');
    const save = h('button', { type: 'submit', class: 'btn btn-strong' }, 'Save');
    const note = h('p', { class: 'field-hint' }, 'Changing the text means the case is learned again on the next run.');
    const form = h(
      'form',
      { class: 'case-editor', novalidate: true },
      h('label', { class: 'sr-only', for: textId }, 'Use case text'),
      text,
      h('div', { class: 'composer-row' }, h('div', { class: 'field composer-tags' }, h('label', { for: tagsId }, 'Tags'), tags), h('div', { class: 'form-actions' }, cancel, save)),
      note,
    );
    const stop = () => {
      editingId = null;
      renderCases();
    };
    cancel.addEventListener('click', stop);
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') stop();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newText = text.value.trim();
      if (!newText) return text.focus();
      const body = {};
      if (newText !== (item.text || '')) body.text = newText;
      const newTags = parseTags(tags.value);
      if (newTags.join(',') !== (item.tags || []).join(',')) body.tags = newTags;
      if (!Object.keys(body).length) return stop();
      save.disabled = true;
      try {
        await api('PUT', `/api/qa/apps/${enc(state.appId)}/cases/${enc(item.id)}`, body);
        editingId = null;
        freshCaseIds.add(item.id);
        toast(body.text ? 'Saved. It will be learned again on the next run.' : 'Saved.');
        await ctx.refreshCases();
      } catch (error) {
        save.disabled = false;
        toast(error.message, 'error');
      }
    });
    const li = h('li', { class: 'case case-editing', dataset: { id: item.id } }, form);
    fadeIn(li, { y: 0, duration: 180 });
    return li;
  }

  async function relearnCase(item) {
    try {
      await api('POST', `/api/qa/apps/${enc(state.appId)}/cases/${enc(item.id)}/relearn`);
      freshCaseIds.add(item.id);
      toast('It will be learned again on the next run.');
      await ctx.refreshCases();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteCase(item) {
    const yes = await confirmDialog({ title: 'Delete this test case?', body: item.text || item.title || '', confirm: 'Delete case' });
    if (!yes) return;
    try {
      await api('DELETE', `/api/qa/apps/${enc(state.appId)}/cases/${enc(item.id)}`);
      const row = els.caseList.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
      if (row) await animate(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }], { duration: 200 });
      await Promise.all([ctx.refreshCases(), ctx.refreshApps()]);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  /** Live preparation progress from the stream: updates the case's chip without a reload. */
  function onPrep(event) {
    const item = state.cases.find((c) => c.id === event.caseId);
    if (!item) return;
    if (event.status && CASE_STATUS[event.status] && item.status !== event.status) {
      item.status = event.status;
      if (event.status === 'failed' && event.message) item.prepError = event.message;
      if (item.id !== editingId) {
        const old = els.caseList.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
        if (old) {
          const row = caseRow(item);
          old.replaceWith(row);
          animate(row.querySelector('.pill'), [{ transform: 'scale(0.85)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260 });
        }
      }
    }
    const live = els.caseList.querySelector(`.case-live[data-for="${CSS.escape(item.id)}"]`);
    if (live) live.textContent = event.status === 'preparing' && event.message ? event.message : '';
  }

  // -------------------------------------------------------------------------------------------
  // Run card
  // -------------------------------------------------------------------------------------------

  function runPrefs() {
    return readPref(`run:${state.appId}`, {}) || {};
  }

  function saveRunPrefs() {
    if (!state.appId) return;
    writePref(`run:${state.appId}`, {
      environment: els.runEnv.value,
      tag: els.runTag.value,
      parallel: selectedParallel(),
      learnParallel: selectedLearnParallel(),
      fastLearn: els.runFastLearn.checked,
      smoke: els.runSmoke.checked,
      performance: els.runPerf.checked,
    });
  }

  // Parallel browsers: a 1–6 segmented control built from real radio buttons.
  for (let n = 1; n <= 6; n++) {
    const input = h('input', { type: 'radio', name: 'parallel', id: `par-${n}`, value: String(n), class: 'seg-input' });
    const label = h('label', { for: `par-${n}`, class: 'seg-item', title: n === 1 ? 'One browser at a time' : `${n} browsers at the same time` }, String(n));
    els.runParallel.append(input, label);
    input.addEventListener('change', saveRunPrefs);
  }

  // Cases learned at the same time: each one is a Claude Code session with its own browser.
  for (let n = 1; n <= 6; n++) {
    const input = h('input', { type: 'radio', name: 'learn-parallel', id: `learn-${n}`, value: String(n), class: 'seg-input' });
    const label = h('label', { for: `learn-${n}`, class: 'seg-item', title: n === 1 ? 'Learn one case at a time' : `Learn ${n} cases at the same time` }, String(n));
    els.runLearnParallel.append(input, label);
    input.addEventListener('change', saveRunPrefs);
  }

  function selectedParallel() {
    return Number(els.runParallel.querySelector('input:checked')?.value || 3);
  }

  function selectedLearnParallel() {
    return Number(els.runLearnParallel.querySelector('input:checked')?.value || 4);
  }

  function applyRunPrefs() {
    const prefs = runPrefs();
    const parallel = Number.isInteger(prefs.parallel) && prefs.parallel >= 1 && prefs.parallel <= 6 ? prefs.parallel : 3;
    els.runParallel.querySelector(`#par-${parallel}`).checked = true;
    const learnParallel = Number.isInteger(prefs.learnParallel) && prefs.learnParallel >= 1 && prefs.learnParallel <= 6 ? prefs.learnParallel : 4;
    els.runLearnParallel.querySelector(`#learn-${learnParallel}`).checked = true;
    els.runFastLearn.checked = prefs.fastLearn !== false;
    els.runSmoke.checked = prefs.smoke !== false;
    els.runPerf.checked = prefs.performance !== false;
  }

  function renderTagOptions(tags) {
    const prefs = runPrefs();
    const previous = els.runTag.value || prefs.tag || '';
    els.runTag.replaceChildren(new Option('All cases', ''), ...tags.map(([tag, count]) => new Option(`Tagged #${tag} (${count})`, tag)));
    els.runTag.value = tags.some(([tag]) => tag === previous) ? previous : '';
    renderRunForm();
  }

  /** What the run would include, for the button summary and the live view's expected totals. */
  function runPlan() {
    const app = ctx.currentApp();
    const env = (app?.environments || []).find((item) => item.id === els.runEnv.value) || null;
    const tag = els.runTag.value;
    let cases = state.cases.filter((item) => !tag || (item.tags || []).includes(tag));
    if (env?.kind === 'production') cases = cases.filter((item) => (item.tags || []).includes('readonly'));
    const runnable = cases.filter((item) => item.status !== 'failed');
    const toLearn = runnable.filter((item) => item.status === 'pending' || item.status === 'preparing').length;
    const accounts = (app?.accounts || []).filter((account) => !account.environment || account.environment === env?.id);
    return { app, env, tag, cases, runnable, toLearn, skipped: cases.length - runnable.length, accounts };
  }

  function renderRunForm() {
    const plan = runPlan();
    const { app, env } = plan;
    if (!app) return;

    if (env) {
      let host = env.baseUrl || '';
      try {
        host = new URL(env.baseUrl).host;
      } catch {
        /* keep the raw value */
      }
      const kind = KINDS.find((k) => k.id === env.kind)?.label || env.kind || '';
      els.runEnvHint.textContent = `${kind} · ${host}`;
    } else {
      els.runEnvHint.textContent = '';
    }

    const missing = [];
    if (!env) missing.push({ text: 'Add an environment to this app', action: null });
    if (env && env.kind === 'production' && !env.allowProduction) missing.push({ text: 'Testing on production is switched off for this environment', action: null });
    if (env && plan.accounts.length === 0) missing.push({ text: `Add a test account for ${env.name}`, action: { label: 'Add account', run: () => openAccountForm(env.id) } });
    if (state.cases.length === 0) missing.push({ text: 'Add at least one test case', action: { label: 'Add cases', run: () => els.casesText.focus() } });
    else if (plan.runnable.length === 0) {
      const why = env?.kind === 'production' ? 'No cases tagged #readonly to run on production' : plan.tag ? `No runnable cases tagged #${plan.tag}` : 'Every case needs attention; re-learn one to run it';
      missing.push({ text: why, action: null });
    }

    els.readiness.hidden = missing.length === 0;
    els.readiness.replaceChildren(
      ...missing.map((item) => {
        const li = h('li', {}, h('span', { class: 'readiness-dot', 'aria-hidden': 'true' }), h('span', { class: 'readiness-text' }, item.text));
        if (item.action) {
          const button = h('button', { type: 'button', class: 'link-btn' }, item.action.label);
          button.addEventListener('click', item.action.run);
          li.append(button);
        }
        return li;
      }),
    );

    const blocked = missing.length > 0 || busyRun || Boolean(state.activeRun);
    els.btnRun.disabled = blocked;
    els.btnRunText.textContent = busyRun ? 'Starting…' : 'Run test cycle';
    if (missing.length) {
      els.runSummary.textContent = '';
    } else {
      const parts = [`${plural(plan.runnable.length, 'case')} will run`];
      if (plan.toLearn) parts.push(`learned ones first, then ${plan.toLearn} new ${plan.toLearn === 1 ? 'one is' : 'ones are'} learned and tested`);
      if (plan.skipped) parts.push(`${plan.skipped} skipped (needs attention)`);
      if (env?.kind === 'production') parts.push('read-only cases only');
      els.runSummary.textContent = parts.join(' · ');
    }
  }

  for (const input of [els.runEnv, els.runTag, els.runSmoke, els.runPerf, els.runFastLearn]) {
    input.addEventListener('change', () => {
      saveRunPrefs();
      renderRunForm();
    });
  }

  els.btnRun.addEventListener('click', async () => {
    const plan = runPlan();
    if (!plan.env || busyRun) return;
    busyRun = true;
    renderRunForm();
    const options = {
      environment: plan.env.id,
      parallel: selectedParallel(),
      learnParallel: selectedLearnParallel(),
      learnModel: els.runFastLearn.checked ? 'fast' : 'default',
      smoke: els.runSmoke.checked,
      performance: els.runPerf.checked,
    };
    if (plan.tag) options.tags = [plan.tag];
    saveRunPrefs();
    try {
      await ctx.startRun(options, {
        expectedCases: plan.runnable.length + (options.smoke ? 1 : 0),
        toLearn: plan.toLearn,
        caseTitles: new Map(plan.runnable.map((item) => [item.id, item.title || item.text])),
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      busyRun = false;
      renderRunForm();
    }
  });

  function setActive(run) {
    els.runForm.hidden = Boolean(run);
    els.runActive.hidden = !run;
    if (run) {
      els.runActiveWatch.href = `#/live/${run.id}`;
      els.runActiveTitle.textContent = isLoadKind(run.kind) ? `A ${modeLabel(run.kind).toLowerCase()} is running.` : 'A test cycle is running.';
      els.runActiveText.textContent = run.message || '';
    }
    renderRunForm();
    loadSetup.renderForm();
  }

  // -------------------------------------------------------------------------------------------
  // Recent runs
  // -------------------------------------------------------------------------------------------

  function renderRuns() {
    const runs = state.runs.slice(0, 8);
    els.runsEmpty.hidden = runs.length > 0;
    els.runList.replaceChildren(...runs.map((run) => runRow(ctx, run)));
  }

  function show() {
    syncComposer();
    renderRunForm();
  }

  applyRunPrefs();
  syncComposer();

  return {
    renderApp: () => {
      applyRunPrefs();
      renderApp();
    },
    renderCases,
    renderRuns,
    onPrep,
    setActive,
    show,
  };
}

/** A run in a history list; shared with the report view. */
export function runRow(ctx, run, { current = false } = {}) {
  const active = ctx.isActive(run.status);
  const { tone, label } = active ? { tone: 'info', label: 'Running' } : runTone(run);
  const app = ctx.appById(run.app);
  const env = typeof run.environment === 'object' ? run.environment : (app?.environments || []).find((item) => item.id === run.environment);
  const counts = run.counts || {};
  const loadRun = isLoadKind(run.kind);
  const countText = active
    ? loadRun ? `${modeLabel(run.kind)} · running now` : 'Running now'
    : loadRun
      ? [loadRunText(run), run.status === 'stopped' || run.status === 'error' ? label : ''].filter(Boolean).join(' · ')
      : [counts.passed ? `${counts.passed} passed` : '', counts.failed ? `${counts.failed} failed` : '', !counts.passed && !counts.failed ? label : '']
          .filter(Boolean)
          .join(' · ');
  const link = h(
    'a',
    { class: 'run-row', href: active ? `#/live/${encodeURIComponent(run.id)}` : `#/report/${encodeURIComponent(run.id)}`, 'aria-current': current ? 'page' : null, dataset: { tone } },
    h('span', { class: 'run-dot', 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'run-main' },
      h('span', { class: 'run-when' }, formatWhen(run.startedAt) || run.id),
      h('span', { class: 'run-env' }, h('span', { class: 'sr-only' }, `${label}. `), [env?.name || run.environment?.name || run.environment || '', countText].filter(Boolean).join(' · ')),
    ),
    icon('chevron', 'run-chev'),
  );
  return h('li', {}, link);
}

export function runTone(run) {
  switch (run?.status) {
    case 'passed':
      return { tone: 'pass', label: 'Passed' };
    case 'failed':
      return { tone: 'fail', label: 'Failed' };
    case 'stopped':
      return { tone: 'neutral', label: 'Stopped' };
    case 'error':
      return { tone: 'fail', label: 'Didn’t finish' };
    default:
      return { tone: 'info', label: run?.status ? String(run.status) : 'Running' };
  }
}

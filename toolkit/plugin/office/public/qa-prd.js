// devcrew QA, test cases from a PRD: paste the PRD (or choose a .txt/.md file) and Claude Code writes draft
// cases on the server, or drafts arrive from /devcrew:qa-from-prd in Claude Code. Either way QA reviews them
// here, ticks the ones to keep and adds them. Drafts that need test data or a manual step start unticked;
// drafts that are already cases can't be added twice.
import { enc } from './qa-api.js';
import { $, closeDialog, fadeIn, h, openDialog, pill, plural, toast } from './qa-ui.js';

const POLL_MS = 2500;
const MAX_FILE_BYTES = 200 * 1024;
const KIND_LABELS = { criterion: 'Acceptance', edge: 'Edge case', error: 'Error case' };
const NEEDS_LABELS = { data: 'Needs test data', manual: 'Manual step' };

export function createPrd(ctx) {
  const { state, api } = ctx;
  const els = {
    open: $('btn-prd-import'),
    banner: $('prd-banner'),
    bannerText: $('prd-banner-text'),
    review: $('btn-prd-review'),
    dialog: $('dlg-prd'),
    sub: $('prd-sub'),
    form: $('prd-form'),
    name: $('prd-name'),
    text: $('prd-text'),
    file: $('prd-file'),
    command: $('prd-command'),
    error: $('prd-error'),
    working: $('prd-working'),
    reviewStep: $('prd-review'),
    source: $('prd-source'),
    groups: $('prd-groups'),
    all: $('prd-all'),
    none: $('prd-none'),
    removed: $('prd-removed'),
    removedTitle: $('prd-removed-title'),
    removedList: $('prd-removed-list'),
    discard: $('prd-discard'),
    go: $('prd-go'),
    add: $('prd-add'),
  };

  let draft = null; // the app's draft from the server, or null
  let draftFor = null;
  let chosen = new Set(); // refs of ticked drafts
  let pollTimer = null;
  let busy = false;

  // -------------------------------------------------------------------------------------------
  // Server
  // -------------------------------------------------------------------------------------------

  /** Reads the app's draft. Called when the app or its cases change, and when the page gets focus. */
  async function check() {
    const appId = state.appId;
    if (!appId) return show(null, null);
    try {
      const next = await api('GET', `/api/qa/apps/${enc(appId)}/prd-draft`);
      if (state.appId === appId) show(next || null, appId);
    } catch {
      /* The banner simply stays as it was; the next check catches up. */
    }
  }

  function show(next, appId) {
    const changed = appId !== draftFor || next?.status !== draft?.status || next?.updatedAt !== draft?.updatedAt;
    draft = next;
    draftFor = appId;
    if (changed && draft?.status === 'ready') chosen = new Set(draft.cases.filter((item) => !item.exists && !item.needs).map((item) => item.ref));
    renderBanner();
    if (els.dialog.open && changed) renderDialog();
    clearTimeout(pollTimer);
    if (draft?.status === 'generating') pollTimer = setTimeout(check, POLL_MS);
  }

  // -------------------------------------------------------------------------------------------
  // Banner on the cases card
  // -------------------------------------------------------------------------------------------

  function renderBanner() {
    const wasHidden = els.banner.hidden;
    els.banner.hidden = !draft;
    if (!draft) return;
    els.banner.dataset.status = draft.status;
    const title = `“${draft.source?.title || 'PRD'}”`;
    if (draft.status === 'generating') els.bannerText.textContent = `Claude Code is writing test cases from ${title}…`;
    else if (draft.status === 'failed') els.bannerText.textContent = `Writing test cases from ${title} didn’t work.`;
    else {
      const fresh = draft.cases.filter((item) => !item.exists).length;
      els.bannerText.textContent = fresh ? `${plural(fresh, 'new test case')} from ${title} ${fresh === 1 ? 'is' : 'are'} ready to review.` : `Every case in ${title} is already in your list.`;
    }
    els.review.textContent = draft.status === 'generating' ? 'Show' : 'Review';
    if (wasHidden) fadeIn(els.banner, { y: 6 });
  }

  // -------------------------------------------------------------------------------------------
  // Dialog
  // -------------------------------------------------------------------------------------------

  function step(name) {
    els.form.hidden = name !== 'form';
    els.working.hidden = name !== 'working';
    els.reviewStep.hidden = name !== 'review';
    els.go.hidden = name !== 'form';
    els.add.hidden = name !== 'review';
    els.discard.hidden = name === 'form';
  }

  function renderDialog() {
    const app = ctx.currentApp();
    els.command.textContent = `/devcrew:qa-from-prd ${app?.id || '<app-id>'} <link or file>`;
    if (!draft) {
      els.sub.textContent = 'Claude Code reads the PRD and writes one case per acceptance criterion, edge case and error case. You choose which to add.';
      return step('form');
    }
    if (draft.status === 'generating') {
      els.sub.textContent = `From “${draft.source.title}”`;
      return step('working');
    }
    if (draft.status === 'failed') {
      els.sub.textContent = 'Fix the problem below and try again.';
      els.name.value = draft.source?.title || els.name.value;
      showError(draft.error || 'Writing test cases didn’t work.');
      step('form');
      els.discard.hidden = false;
      return;
    }
    els.sub.textContent = 'Tick the cases to add. They are learned on the next test cycle.';
    renderReview();
    step('review');
  }

  function renderReview() {
    const { source, cases, removed } = draft;
    const from = [h('span', {}, `${plural(cases.length, 'case')} from `)];
    from.push(source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : h('strong', {}, source.title));
    els.source.replaceChildren(...from);

    const flows = new Map();
    for (const item of cases) {
      if (!flows.has(item.flow)) flows.set(item.flow, []);
      flows.get(item.flow).push(item);
    }
    els.groups.replaceChildren(
      ...[...flows.entries()].map(([flow, items]) =>
        h('section', { class: 'prd-flow' }, h('h3', { class: 'prd-flow-title' }, flow, h('span', { class: 'filter-count' }, String(items.length))), h('ul', { class: 'prd-list' }, ...items.map(draftRow))),
      ),
    );

    els.removed.hidden = removed.length === 0;
    els.removedTitle.textContent = `${plural(removed.length, 'case')} from this PRD ${removed.length === 1 ? 'is' : 'are'} no longer in it`;
    els.removedList.replaceChildren(...removed.map((item) => h('li', {}, item.text)));
    syncAdd();
  }

  function draftRow(item) {
    const id = `prd-${item.ref}`;
    const box = h('input', { type: 'checkbox', id, class: 'prd-check' });
    box.checked = chosen.has(item.ref);
    box.disabled = item.exists;
    box.addEventListener('change', () => {
      if (box.checked) chosen.add(item.ref);
      else chosen.delete(item.ref);
      syncAdd();
    });
    const marks = [pill(KIND_LABELS[item.kind] || 'Acceptance', item.kind === 'error' ? 'warn' : 'neutral')];
    if (item.exists) marks.push(pill('Already a case', 'pass'));
    else if (item.needs) marks.push(pill(NEEDS_LABELS[item.needs], 'warn', { title: item.note || '' }));
    const body = h('div', { class: 'prd-row-main' }, h('label', { for: id, class: 'prd-text' }, item.text), h('div', { class: 'case-meta' }, ...marks));
    if (item.note && item.needs && !item.exists) body.append(h('p', { class: 'prd-note' }, item.note));
    return h('li', { class: 'prd-row', dataset: { exists: String(item.exists) } }, box, body);
  }

  function syncAdd() {
    const count = chosen.size;
    els.add.textContent = count ? `Add ${plural(count, 'case')}` : 'Add cases';
    els.add.disabled = count === 0 || busy;
  }

  function showError(message) {
    els.error.hidden = !message;
    els.error.textContent = message || '';
  }

  // -------------------------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------------------------

  els.open.addEventListener('click', () => {
    if (!state.appId) return toast('Add or choose an app first.', 'error');
    showError('');
    renderDialog();
    openDialog(els.dialog);
    if (!draft) els.name.focus();
  });
  els.review.addEventListener('click', () => {
    renderDialog();
    openDialog(els.dialog);
  });
  for (const button of els.dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(els.dialog));

  els.file.addEventListener('change', async () => {
    const file = els.file.files?.[0];
    els.file.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return showError('That file is too big. Choose one feature or section of the PRD.');
    if (!/\.(txt|md|markdown)$/i.test(file.name)) return showError('Choose a .txt or .md file. For PDF or Word, use /devcrew:qa-from-prd in Claude Code.');
    els.text.value = await file.text();
    if (!els.name.value.trim()) els.name.value = file.name.replace(/\.(txt|md|markdown)$/i, '');
    els.text.dataset.kind = 'file';
    showError('');
  });
  els.text.addEventListener('input', () => delete els.text.dataset.kind);

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const title = els.name.value.trim();
    const text = els.text.value.trim();
    if (!title) {
      showError('Give the PRD a title, for example its Confluence page name.');
      return els.name.focus();
    }
    if (text.length < 40) {
      showError('Paste the PRD text, or choose a .txt or .md file.');
      return els.text.focus();
    }
    busy = true;
    els.go.disabled = true;
    showError('');
    try {
      const next = await api('POST', `/api/qa/apps/${enc(state.appId)}/prd-import`, { title, text, kind: els.text.dataset.kind === 'file' ? 'file' : 'text' });
      els.text.value = '';
      show(next, state.appId);
      renderDialog();
    } catch (error) {
      showError(error.message);
    } finally {
      busy = false;
      els.go.disabled = false;
    }
  });

  els.all.addEventListener('click', () => {
    chosen = new Set(draft.cases.filter((item) => !item.exists).map((item) => item.ref));
    renderReview();
  });
  els.none.addEventListener('click', () => {
    chosen.clear();
    renderReview();
  });

  els.add.addEventListener('click', async () => {
    if (busy || !chosen.size) return;
    busy = true;
    syncAdd();
    try {
      const created = await api('POST', `/api/qa/apps/${enc(state.appId)}/prd-draft/accept`, { refs: [...chosen] });
      toast(`Added ${plural(created.length, 'test case')}. They are learned on the next test cycle.`);
      els.name.value = '';
      await closeDialog(els.dialog);
      show(null, state.appId);
      await Promise.all([ctx.refreshCases(), ctx.refreshApps()]);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      busy = false;
      syncAdd();
    }
  });

  els.discard.addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/qa/apps/${enc(state.appId)}/prd-draft`);
      show(null, state.appId);
      showError('');
      renderDialog();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  window.addEventListener('focus', () => {
    if (!els.dialog.open || draft?.status !== 'ready') check();
  });

  return { check };
}

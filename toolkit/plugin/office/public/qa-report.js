// devcrew QA, report view: summary ring, regression comparison, per-case results with evidence links,
// the smoke check and page-speed tables (Web Vitals colouring), and the run history.
import { enc } from './qa-api.js';
import { createLoadReport, isLoadKind, modeLabel } from './qa-load.js';
import { runRow } from './qa-setup.js';
import { $, animate, fadeIn, formatDuration, formatWhen, h, icon, motionOK, pill, plural, resultTone, safePath, svg, toMs, toast } from './qa-ui.js';

// Google's Web Vitals thresholds: good ≤ first value, poor > second value.
const VITALS = {
  ttfb: [800, 1800],
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
};
const RATING_TEXT = { good: 'good', needs: 'needs work', poor: 'poor' };
const REGRESSION = {
  newlyFailing: { label: 'Newly failing', tone: 'fail', hint: 'Passed last time, failing now' },
  fixed: { label: 'Fixed', tone: 'pass', hint: 'Failed last time, passing now' },
  stillFailing: { label: 'Still failing', tone: 'warn', hint: 'Failing in both runs' },
};
const TONE_ORDER = { fail: 0, warn: 1, neutral: 2, info: 3, pass: 4 };
const KIND_LABEL = { local: 'Local', staging: 'Staging', uat: 'UAT', production: 'Production' };
const ANSI = /\u001b\[[0-9;]*m/g;
// Claude Code's verdict on a failure, in the words a tester uses.
const CATEGORY = {
  'app-bug': { label: 'App bug', tone: 'fail' },
  'test-outdated': { label: 'Test needs updating', tone: 'warn' },
  environment: { label: 'Environment or data', tone: 'info' },
  flaky: { label: 'Flaky', tone: 'neutral' },
};
const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const STEP_MARK = { passed: { icon: 'check', text: 'passed' }, failed: { icon: 'close', text: 'failed' }, skipped: { icon: 'minus', text: 'not reached' } };
const LOGIN_LINE = /^Log in as (.+?) \(account: (.+)\)\.$/;

export function createReport(ctx) {
  const els = {
    sub: $('report-sub'),
    html: $('report-html'),
    loading: $('report-loading'),
    error: $('report-error'),
    body: $('report-body'),
    ring: $('report-ring'),
    headline: $('summary-headline'),
    counts: $('summary-counts'),
    meta: $('summary-meta'),
    compareChips: $('compare-chips'),
    compareNote: $('compare-note'),
    filter: $('result-filter'),
    list: $('result-list'),
    empty: $('result-empty'),
    smokeCard: $('smoke-card'),
    smokeSummary: $('smoke-summary'),
    smokeBody: $('smoke-table').tBodies[0],
    perfCard: $('perf-card'),
    perfBody: $('perf-table').tBodies[0],
    runs: $('report-runs'),
    cycleCards: [...document.querySelectorAll('#view-report .cycle-only')],
  };
  const loadReport = createLoadReport();

  let currentId = null;
  let summary = null;
  let filter = 'all';
  let loadToken = 0;
  // Failed cases whose "why it failed" panel is open. The first failure opens by itself once per report.
  const expanded = new Set();
  let autoOpened = false;

  async function show(runId) {
    const same = runId === currentId && summary;
    currentId = runId;
    const token = ++loadToken;
    if (!same) {
      filter = 'all';
      expanded.clear();
      autoOpened = false;
      summary = null;
      els.loading.hidden = false;
      els.body.hidden = true;
      els.error.hidden = true;
      els.html.hidden = true;
      els.sub.textContent = '';
    }
    try {
      const data = await ctx.api('GET', `/api/qa/runs/${enc(runId)}`);
      if (token !== loadToken) return;
      summary = data || {};
      render();
      loadHistory(summary.app || ctx.appIdFromRun(runId));
    } catch (error) {
      if (token !== loadToken) return;
      summary = null;
      els.loading.hidden = true;
      els.error.hidden = false;
      els.error.replaceChildren(
        h('p', { class: 'empty-title' }, error.status === 404 ? 'This report doesn’t exist any more' : 'The report couldn’t be loaded'),
        h('p', { class: 'empty-text' }, error.status === 404 ? 'Only the last 50 test cycles of each app are kept.' : error.message),
        h('a', { class: 'btn', href: '#/' }, 'Back to test cases'),
      );
    }
  }

  async function loadHistory(appId) {
    if (!appId) return;
    let runs = appId === ctx.state.appId ? ctx.state.runs : [];
    if (!runs.length) {
      try {
        runs = await ctx.api('GET', `/api/qa/runs?app=${enc(appId)}`);
      } catch {
        runs = [];
      }
    }
    if (!summary) return;
    els.runs.replaceChildren(...(Array.isArray(runs) ? runs : []).slice(0, 20).map((run) => runRow(ctx, run, { current: run.id === summary.id })));
  }

  // -------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------

  function render() {
    const s = summary;
    const app = ctx.appById(s.app);
    const env = s.environment && typeof s.environment === 'object' ? s.environment : { name: String(s.environment || '') };
    els.sub.textContent = [app?.name || s.app, env.name, formatWhen(s.startedAt)].filter(Boolean).join(' · ');
    const reportUrl = safePath(s.htmlReport);
    els.html.hidden = !reportUrl;
    if (reportUrl) els.html.href = reportUrl;

    // Load and stress tests have their own report; test cycles keep theirs.
    const load = isLoadKind(s.kind);
    $('h-report').textContent = load ? `${modeLabel(s.kind)} report` : 'Report';
    for (const card of els.cycleCards) card.hidden = load;
    loadReport.show(load);
    if (load) {
      els.smokeCard.hidden = true;
      els.perfCard.hidden = true;
      els.loading.hidden = true;
      els.body.hidden = false;
      loadReport.render(s, ctx);
    } else {
      renderSummary(s, env);
      renderCompare(s);
      renderResults();
      renderSmoke(s.smoke);
      renderPerf(s.performance);
    }

    els.loading.hidden = true;
    els.body.hidden = false;
    [...els.body.querySelectorAll('.report-main > .card:not([hidden]), .load-report > .card:not([hidden]), .report-history')].forEach((card, index) => fadeIn(card, { y: 10, delay: index * 60, duration: 300 }));
  }

  function renderSummary(s, env) {
    const counts = s.counts || {};
    const passed = counts.passed || 0;
    const failed = counts.failed || 0;
    const skipped = counts.skipped || 0;
    const notPrepared = counts.notPrepared || 0;
    const total = passed + failed + skipped + notPrepared;

    els.ring.replaceChildren(ring(passed, failed, total));

    let headline;
    if (s.status === 'error') headline = 'The test cycle didn’t finish';
    else if (s.status === 'stopped') headline = `Stopped after ${plural(passed + failed, 'test case')}`;
    else if (ctx.isActive(s.status)) headline = 'Still running';
    else if (failed > 0) headline = `${failed} of ${passed + failed} test ${passed + failed === 1 ? 'case' : 'cases'} failed`;
    // Cases that could not be learned did not run, so "all passed" would overstate the result.
    else if (notPrepared > 0 && passed > 0) headline = `${plural(passed, 'test case')} passed, ${notPrepared} not learned yet`;
    else if (passed > 0) headline = passed === 1 ? 'The test case passed' : `All ${passed} test cases passed`;
    else headline = 'No test cases ran';
    els.headline.textContent = headline;

    const item = (label, value, tone) => [h('dt', { dataset: { tone } }, label), h('dd', {}, String(value))];
    els.counts.replaceChildren(
      ...item('Passed', passed, 'pass'),
      ...item('Failed', failed, 'fail'),
      ...(skipped ? item('Skipped', skipped, 'neutral') : []),
      ...(notPrepared ? item('Not learned', notPrepared, 'warn') : []),
    );

    const started = toMs(s.startedAt);
    const finished = toMs(s.finishedAt);
    const parts = [];
    const kindLabel = KIND_LABEL[env.kind] || env.kind || '';
    if (env.name) parts.push(kindLabel && kindLabel.toLowerCase() !== env.name.toLowerCase() ? `${env.name} (${kindLabel})` : env.name);
    if (started && finished) parts.push(`took ${formatDuration(finished - started)}`);
    if (total) parts.push(plural(total, 'case'));
    els.meta.replaceChildren(...parts.flatMap((part, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), part] : [part])));
    if (s.status === 'error' || s.status === 'stopped') {
      const { tone, label } = s.status === 'error' ? { tone: 'fail', label: 'Didn’t finish' } : { tone: 'neutral', label: 'Stopped' };
      els.meta.prepend(pill(label, tone), ' ');
    }
  }

  function ring(passed, failed, total) {
    const size = 132;
    const r = 54;
    const c = 2 * Math.PI * r;
    const passLen = total ? (c * passed) / total : 0;
    const failLen = total ? (c * failed) / total : 0;
    const graphic = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ring-svg', 'aria-hidden': 'true' });
    const base = { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': 12 };
    graphic.append(svg('circle', { ...base, class: 'ring-track' }));
    const pass = svg('circle', { ...base, class: 'ring-pass', 'stroke-linecap': passLen && failLen ? 'butt' : 'round' });
    const fail = svg('circle', { ...base, class: 'ring-fail', 'stroke-linecap': 'butt' });
    pass.style.strokeDasharray = `0 ${c}`;
    fail.style.strokeDasharray = `0 ${c}`;
    fail.style.strokeDashoffset = `${-passLen}`;
    graphic.append(fail, pass);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pass.style.strokeDasharray = `${passLen} ${c}`;
        fail.style.strokeDasharray = `${failLen} ${c}`;
      }),
    );
    const percent = total ? Math.round((passed / total) * 100) : 0;
    return h(
      'div',
      { class: 'ring-box', role: 'img', 'aria-label': total ? `${percent}% passed: ${passed} of ${total}` : 'No results' },
      graphic,
      h('span', { class: 'ring-center', 'aria-hidden': 'true' }, h('span', { class: 'ring-num' }, total ? `${percent}%` : '–'), h('span', { class: 'ring-label' }, 'passed')),
    );
  }

  function renderCompare(s) {
    const cmp = s.comparison || null;
    if (!cmp || !cmp.previousRunId) {
      els.compareChips.replaceChildren();
      els.compareChips.hidden = true;
      els.compareNote.replaceChildren('This is the first test cycle on this environment, so there’s nothing to compare with yet.');
      return;
    }
    els.compareChips.hidden = false;
    els.compareChips.replaceChildren(
      ...Object.entries(REGRESSION).map(([key, info]) => {
        const ids = Array.isArray(cmp[key]) ? cmp[key] : [];
        const button = h(
          'button',
          { type: 'button', class: 'cmp-chip', dataset: { tone: ids.length ? info.tone : 'none' }, 'aria-pressed': String(filter === key), title: info.hint, disabled: ids.length === 0 },
          h('span', { class: 'cmp-num' }, String(ids.length)),
          h('span', { class: 'cmp-label' }, info.label),
        );
        button.addEventListener('click', () => {
          filter = filter === key ? 'all' : key;
          renderCompare(summary);
          renderResults();
        });
        return button;
      }),
    );
    const total = REGRESSION_KEYS.reduce((sum, key) => sum + (Array.isArray(cmp[key]) ? cmp[key].length : 0), 0);
    const link = h('a', { href: `#/report/${encodeURIComponent(cmp.previousRunId)}` }, 'the previous run');
    els.compareNote.replaceChildren(total ? 'Select a number to see those cases. Compared with ' : 'Nothing changed compared with ', link, '.');
  }

  // -------------------------------------------------------------------------------------------
  // Case results
  // -------------------------------------------------------------------------------------------

  function regressionOf(caseId) {
    const cmp = summary.comparison || {};
    for (const key of REGRESSION_KEYS) if (Array.isArray(cmp[key]) && cmp[key].includes(caseId)) return key;
    return null;
  }

  function renderResults() {
    const cases = Array.isArray(summary.cases) ? summary.cases : [];
    const groups = { all: cases.length, failed: 0, passed: 0, other: 0 };
    for (const item of cases) {
      const { tone } = resultTone(item.status);
      if (tone === 'fail') groups.failed++;
      else if (tone === 'pass') groups.passed++;
      else groups.other++;
    }

    const chips = [
      ['all', 'All', groups.all],
      ['failed', 'Failed', groups.failed],
      ['passed', 'Passed', groups.passed],
      ['other', 'Other', groups.other],
    ].filter(([key, , count]) => key === 'all' || count > 0);
    els.filter.replaceChildren(
      ...chips.map(([key, label, count]) => {
        const button = h('button', { type: 'button', class: 'filter-chip', 'aria-pressed': String(filter === key) }, h('span', {}, label), h('span', { class: 'filter-count' }, String(count)));
        button.addEventListener('click', () => {
          filter = key;
          renderCompare(summary);
          renderResults();
        });
        return button;
      }),
    );

    const visible = cases
      .filter((item) => {
        const { tone } = resultTone(item.status);
        if (filter === 'failed') return tone === 'fail';
        if (filter === 'passed') return tone === 'pass';
        if (filter === 'other') return tone !== 'fail' && tone !== 'pass';
        if (REGRESSION[filter]) return regressionOf(item.id) === filter;
        return true;
      })
      .map((item, index) => ({ item, index, tone: resultTone(item.status).tone }))
      .sort((a, b) => (TONE_ORDER[a.tone] ?? 9) - (TONE_ORDER[b.tone] ?? 9) || a.index - b.index)
      .map(({ item }) => item);

    if (!autoOpened) {
      autoOpened = true;
      const first = cases.find((item) => diagnosisOf(item));
      if (first) expanded.add(first.id);
    }
    els.list.replaceChildren(...visible.map(resultRow));
    els.empty.hidden = visible.length > 0;
    els.empty.textContent = cases.length ? 'No cases match this filter.' : 'No test cases ran in this cycle.';
  }

  /** The PRD a case was written from, when the page has this app's cases loaded. */
  function sourceOf(caseId) {
    if (ctx.state.casesFor !== summary?.app) return null;
    const source = ctx.state.cases.find((entry) => entry.id === caseId)?.source;
    return source?.title ? source : null;
  }

  function resultRow(item) {
    const { tone, label, icon: iconName } = resultTone(item.status);
    const regression = regressionOf(item.id);
    const titleLine = h('p', { class: 'result-title' }, item.title || 'Untitled case');
    const meta = h('p', { class: 'result-meta' }, h('span', {}, label));
    if (Number.isFinite(item.durationMs)) meta.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), h('span', {}, formatDuration(item.durationMs)));
    if (regression) meta.append(pill(REGRESSION[regression].label, REGRESSION[regression].tone, { title: REGRESSION[regression].hint }));

    const main = h('div', { class: 'result-main' }, titleLine, meta);
    const source = sourceOf(item.id);
    if (source) {
      const name = source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : h('span', {}, source.title);
      main.append(h('p', { class: 'case-source' }, 'From PRD: ', name, source.flow ? ` · ${source.flow}` : ''));
    }
    const diagnosis = diagnosisOf(item);
    if (item.error && !diagnosis) {
      const text = String(item.error).replace(ANSI, '').trim();
      const details = h('details', { class: 'result-error' }, h('summary', {}, 'What went wrong'), h('pre', {}, text));
      if (tone === 'fail' && text.length < 400) details.open = true;
      main.append(details);
    }

    const attachments = item.attachments || {};
    const links = [];
    const shot = safePath(attachments.screenshot);
    const video = safePath(attachments.video);
    const trace = safePath(attachments.trace);
    if (shot) links.push(h('a', { class: 'evidence', href: shot, target: '_blank', rel: 'noopener noreferrer' }, icon('image'), 'Screenshot'));
    if (video) links.push(h('a', { class: 'evidence', href: video, target: '_blank', rel: 'noopener noreferrer' }, icon('video'), 'Video'));
    if (trace) links.push(h('a', { class: 'evidence', href: trace, download: '', title: 'Download the Playwright trace (open it with the Playwright trace viewer)' }, icon('trace'), 'Trace'));
    if (diagnosis) main.append(diagnosisPanel(item, diagnosis, { links, shot, video, trace }));
    else if (links.length) main.append(h('div', { class: 'evidence-row' }, ...links));

    const row = h('li', { class: 'result', dataset: { tone } }, h('span', { class: 'result-icon', 'aria-hidden': 'true' }, icon(iconName)), main);
    if (shot && tone === 'fail') {
      row.append(
        h(
          'a',
          { class: 'thumb', href: shot, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Screenshot of the failure: ${item.title || 'case'}` },
          h('img', { src: shot, alt: '', loading: 'lazy', decoding: 'async' }),
        ),
      );
    }
    return row;
  }

  // -------------------------------------------------------------------------------------------
  // Why a case failed: what happened, the root cause, steps to reproduce, the steps, the evidence
  // -------------------------------------------------------------------------------------------

  function diagnosisPanel(item, diagnosis, files) {
    const panelId = `diag-${item.id}`;
    const open = expanded.has(item.id);
    const steps = list(diagnosis.steps);
    const failedIndex = steps.findIndex((step) => step?.status === 'failed');
    const analysis = diagnosis.analysisStatus === 'done' && diagnosis.analysis && typeof diagnosis.analysis === 'object' ? diagnosis.analysis : null;

    const hint = analysis && CATEGORY[analysis.category] ? pill(CATEGORY[analysis.category].label, CATEGORY[analysis.category].tone) : null;
    const toggle = h(
      'button',
      { type: 'button', class: 'diag-toggle', 'aria-expanded': String(open), 'aria-controls': panelId },
      icon('chevron', 'diag-chev'),
      h('span', {}, 'Why it failed and how to reproduce it'),
    );
    const panel = h(
      'div',
      { class: 'diag', id: panelId, hidden: !open },
      whatHappened(item, diagnosis, steps, failedIndex),
      rootCause(diagnosis, analysis),
      reproduce(item, diagnosis, analysis, files),
      timeline(steps),
      evidence(item, diagnosis, files),
    );
    toggle.addEventListener('click', () => {
      const opening = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) expanded.add(item.id);
      else expanded.delete(item.id);
      slide(panel, opening);
    });
    return h('div', { class: 'diag-wrap' }, h('div', { class: 'diag-bar' }, toggle, hint), panel);
  }

  /** Opens or closes a panel with a short height-and-fade transition (instant with reduced motion). */
  function slide(panel, opening) {
    for (const running of panel.getAnimations?.() || []) running.cancel();
    if (opening) panel.hidden = false;
    if (!motionOK()) {
      panel.hidden = !opening;
      return;
    }
    const height = `${panel.scrollHeight}px`;
    const frames = [
      { height: '0px', opacity: 0, overflow: 'hidden' },
      { height, opacity: 1, overflow: 'hidden' },
    ];
    animate(panel, opening ? frames : frames.reverse(), { duration: opening ? 280 : 200 }).then(() => {
      if (!opening && panel.parentElement?.querySelector('.diag-toggle')?.getAttribute('aria-expanded') !== 'true') panel.hidden = true;
    });
  }

  function section(title, ...children) {
    return h('section', { class: 'diag-sec' }, h('h4', { class: 'diag-h' }, title), ...children);
  }

  function whatHappened(item, diagnosis, steps, failedIndex) {
    const firstLine = String(item.error || '').replace(ANSI, '').split('\n').find((line) => line.trim()) || 'The test failed';
    const facts = [
      ['Expected', diagnosis.expected || 'The test finishes without an error'],
      ['Actual', diagnosis.actual || firstLine.trim()],
      ['Failed at', failedIndex === -1 ? 'Outside a named step' : `Step ${failedIndex + 1} of ${steps.length}: ${steps[failedIndex].title}`],
    ];
    if (diagnosis.url) facts.push(['Page', diagnosis.url]);
    return section(
      'What happened',
      h('dl', { class: 'diag-facts' }, ...facts.flatMap(([label, value]) => [h('dt', {}, label), h('dd', { dataset: { fact: label.toLowerCase().replace(/\s+/g, '-') } }, String(value))])),
    );
  }

  function rootCause(diagnosis, analysis) {
    const byline = h('span', { class: 'diag-by' }, 'Analysis by Claude Code');
    const head = h('div', { class: 'diag-h-row' }, h('h4', { class: 'diag-h' }, 'Root cause'), byline);
    const box = h('section', { class: 'diag-sec diag-cause' }, head);
    if (analysis) {
      const category = CATEGORY[analysis.category];
      box.append(
        h('div', { class: 'diag-verdict' }, category ? pill(category.label, category.tone) : null, h('span', { class: 'diag-confidence', dataset: { level: analysis.confidence } }, CONFIDENCE[analysis.confidence] || '')),
        h('p', { class: 'diag-cause-text' }, String(analysis.rootCause || '')),
      );
      const facts = list(analysis.evidence).map(String);
      if (facts.length) box.append(h('ul', { class: 'diag-bullets' }, ...facts.map((fact) => h('li', {}, fact))));
      if (analysis.suggestion) box.append(h('p', { class: 'diag-suggestion' }, h('strong', {}, 'What to do: '), String(analysis.suggestion)));
      return box;
    }
    const status = diagnosis.analysisStatus;
    let note;
    if (status === 'pending') note = ctx.isActive(summary.status) ? 'Claude Code is looking into this failure. The root cause shows here when it is done.' : 'The investigation didn’t finish because the test cycle stopped.';
    else if (status === 'unavailable') note = 'Claude Code isn’t available on this computer, so there is no root-cause analysis. What happened, the steps to reproduce and the evidence below are still complete.';
    else if (status === 'failed') note = `Claude Code couldn’t work out the root cause this time${diagnosis.analysisError ? ` (${String(diagnosis.analysisError).replace(/\.$/, '')})` : ''}. What happened and the steps below are still accurate.`;
    else note = diagnosis.analysisError ? String(diagnosis.analysisError) : 'This failure was not investigated.';
    box.dataset.state = status === 'pending' && ctx.isActive(summary.status) ? 'working' : 'none';
    box.append(h('p', { class: 'diag-note' }, note));
    return box;
  }

  function reproduce(item, diagnosis, analysis, files) {
    const lines = list(diagnosis.reproduce).map(String);
    const copy = h('button', { type: 'button', class: 'btn btn-quiet diag-copy' }, icon('copy'), h('span', {}, 'Copy bug report'));
    copy.addEventListener('click', async () => {
      const text = bugReport(item, diagnosis, analysis, files);
      try {
        await navigator.clipboard.writeText(text);
        toast('Bug report copied. Paste it into your tracker.');
        copy.querySelector('span').textContent = 'Copied';
        setTimeout(() => (copy.querySelector('span').textContent = 'Copy bug report'), 2000);
      } catch {
        toast('The browser didn’t allow copying. Select the steps and copy them by hand.', 'error');
      }
    });
    const head = h('div', { class: 'diag-h-row' }, h('h4', { class: 'diag-h' }, 'Steps to reproduce'), copy);
    return h('section', { class: 'diag-sec' }, head, h('ol', { class: 'diag-repro' }, ...lines.map((line) => h('li', { dataset: { outcome: String(/^Expected: /.test(line)) } }, line))));
  }

  function timeline(steps) {
    return section(
      'What the test did',
      h(
        'ol',
        { class: 'diag-steps' },
        ...steps.map((step) => {
          const status = STEP_MARK[step?.status] ? step.status : 'passed';
          const mark = STEP_MARK[status];
          return h(
            'li',
            { class: 'diag-step', dataset: { status } },
            h('span', { class: 'diag-step-mark', 'aria-hidden': 'true' }, icon(mark.icon)),
            h(
              'span',
              { class: 'diag-step-body' },
              h('span', { class: 'diag-step-title' }, String(step?.title || 'Step'), h('span', { class: 'sr-only' }, ` (${mark.text})`)),
              step?.error ? h('span', { class: 'diag-step-error' }, String(step.error)) : null,
            ),
            h('span', { class: 'diag-step-time' }, status === 'skipped' ? '–' : formatDuration(Number(step?.durationMs) || 0)),
          );
        }),
      ),
    );
  }

  function evidence(item, diagnosis, { links, shot }) {
    const seen = diagnosis.evidence && typeof diagnosis.evidence === 'object' ? diagnosis.evidence : {};
    const requests = list(seen.failedRequests);
    const consoleErrors = list(seen.consoleErrors).map(String);
    const pageErrors = list(seen.pageErrors).map(String);
    const parts = [];
    if (shot) {
      parts.push(
        h(
          'a',
          { class: 'diag-shot', href: shot, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open the screenshot of the failure' },
          h('img', { src: shot, alt: '', loading: 'lazy', decoding: 'async' }),
        ),
      );
    }
    if (links.length) parts.push(h('div', { class: 'evidence-row' }, ...links));
    if (requests.length) {
      parts.push(
        h('p', { class: 'diag-sub' }, 'Failed requests to the app'),
        h(
          'div',
          { class: 'diag-table-wrap' },
          h(
            'table',
            { class: 'data-table diag-table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Request'), h('th', { scope: 'col' }, 'Address'), h('th', { scope: 'col' }, 'Status'))),
            h(
              'tbody',
              {},
              ...requests.map((request) =>
                h(
                  'tr',
                  {},
                  cell('Request', h('span', { class: 'diag-method' }, String(request?.method || 'GET'))),
                  cell('Address', h('span', { class: 'url', title: String(request?.url || '') }, shortUrl(request?.url))),
                  cell('Status', pill(Number(request?.status) > 0 ? String(request.status) : 'No answer', 'fail')),
                ),
              ),
            ),
          ),
        ),
      );
    }
    if (consoleErrors.length) parts.push(h('p', { class: 'diag-sub' }, 'Console errors'), h('ul', { class: 'diag-log' }, ...consoleErrors.map((text) => h('li', {}, text))));
    if (pageErrors.length) parts.push(h('p', { class: 'diag-sub' }, 'Page errors'), h('ul', { class: 'diag-log' }, ...pageErrors.map((text) => h('li', {}, text))));
    if (!requests.length && !consoleErrors.length && !pageErrors.length) parts.push(h('p', { class: 'diag-note' }, 'The browser saw no failed requests, console errors or page errors during this test.'));
    if (item.error) parts.push(h('details', { class: 'result-error' }, h('summary', {}, 'Full error message'), h('pre', {}, String(item.error).replace(ANSI, '').trim())));
    return section('Evidence', ...parts);
  }

  /** A Markdown bug report: everything a developer needs, without passwords (the summary never has them). */
  function bugReport(item, diagnosis, analysis, { shot, video, trace }) {
    const env = summary.environment && typeof summary.environment === 'object' ? summary.environment : { name: String(summary.environment || '') };
    const app = ctx.appById(summary.app);
    const lines = list(diagnosis.reproduce).map(String);
    const steps = lines.filter((line) => !/^Expected: /.test(line));
    const accounts = lines.map((line) => LOGIN_LINE.exec(line)).filter(Boolean).map(([, label, username]) => `${label} (${username})`);
    const base = /\bat (https?:\/\/\S+) in a browser\.$/.exec(lines[0] || '')?.[1];
    const fileName = (url) => decodeURIComponent(String(url).split('/').pop() || '');
    const kindLabel = KIND_LABEL[env.kind] || env.kind || '';
    const envName = kindLabel && kindLabel.toLowerCase() !== String(env.name || '').toLowerCase() ? `${env.name} (${kindLabel})` : env.name;
    const source = sourceOf(item.id);
    const out = [
      `## ${item.title || 'Test case'} fails`,
      '',
      `**App:** ${app?.name || summary.app || ''}`,
      `**Environment:** ${envName || ''}${base ? `, ${base}` : ''}`,
      ...(accounts.length ? [`**Account:** ${accounts.join(', ')}`] : []),
      `**Test cycle:** ${summary.id} · ${formatWhen(summary.startedAt)}`,
      ...(source ? [`**Requirement:** ${source.title}${source.flow ? ` · ${source.flow}` : ''}${source.url ? ` (${source.url})` : ''}`] : []),
      '',
      '### Steps to reproduce',
      ...steps.map((line, index) => `${index + 1}. ${line}`),
      '',
      '### Expected',
      diagnosis.expected || 'The test finishes without an error',
      '',
      '### Actual',
      diagnosis.actual || String(item.error || '').replace(ANSI, '').split('\n')[0],
    ];
    if (analysis) {
      out.push('', `### Root cause (analysis by Claude Code, ${String(analysis.confidence || '').toLowerCase()} confidence)`, `${CATEGORY[analysis.category]?.label || analysis.category}: ${analysis.rootCause}`);
      for (const fact of list(analysis.evidence)) out.push(`- ${fact}`);
      if (analysis.suggestion) out.push('', `**Suggestion:** ${analysis.suggestion}`);
    }
    const seen = diagnosis.evidence || {};
    const evidenceLines = [
      ...list(seen.failedRequests).map((request) => `- ${request?.method || 'GET'} ${request?.url} → ${Number(request?.status) > 0 ? request.status : 'no answer'}`),
      ...list(seen.consoleErrors).map((text) => `- Console error: ${text}`),
      ...list(seen.pageErrors).map((text) => `- Page error: ${text}`),
      ...(shot ? [`- Screenshot: ${fileName(shot)}`] : []),
      ...(video ? [`- Video: ${fileName(video)}`] : []),
      ...(trace ? [`- Trace: ${fileName(trace)}`] : []),
    ];
    if (evidenceLines.length) out.push('', '### Evidence', ...evidenceLines);
    return `${out.join('\n')}\n`;
  }

  // -------------------------------------------------------------------------------------------
  // Smoke and performance
  // -------------------------------------------------------------------------------------------

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}` || '/';
    } catch {
      return String(url || '');
    }
  }

  function cell(label, ...children) {
    return h('td', { 'data-label': label }, ...children);
  }

  function listDetails(summaryText, items) {
    if (!items.length) return h('span', { class: 'zero' }, '0');
    return h('details', { class: 'cell-details' }, h('summary', {}, summaryText), h('ul', {}, ...items.map((text) => h('li', {}, text))));
  }

  function renderSmoke(smoke) {
    const pages = Array.isArray(smoke?.pages) ? smoke.pages : [];
    els.smokeCard.hidden = !smoke;
    if (!smoke) return;
    let consolePages = 0;
    let broken = 0;
    let badStatus = 0;
    els.smokeBody.replaceChildren(
      ...pages.map((page) => {
        const errors = Array.isArray(page.consoleErrors) ? page.consoleErrors.map(String) : [];
        const links = Array.isArray(page.brokenLinks) ? page.brokenLinks.map((link) => (typeof link === 'string' ? link : `${shortUrl(link?.url)}${link?.status ? ` (${link.status})` : ''}`)) : [];
        if (errors.length) consolePages++;
        broken += links.length;
        const status = Number(page.status);
        if (!(status >= 200 && status < 400)) badStatus++;
        const tone = status >= 200 && status < 300 ? 'pass' : status >= 300 && status < 400 ? 'neutral' : 'fail';
        return h(
          'tr',
          { dataset: { problem: String(tone === 'fail' || errors.length > 0 || links.length > 0) } },
          cell('Page', h('span', { class: 'url', title: page.url || '' }, shortUrl(page.url))),
          cell('Status', pill(Number.isFinite(status) && status ? String(status) : 'No answer', tone)),
          cell('Console errors', listDetails(plural(errors.length, 'error'), errors)),
          cell('Broken links', listDetails(plural(links.length, 'link'), links)),
        );
      }),
    );
    const parts = [`${plural(pages.length, 'page')} visited`];
    parts.push(badStatus ? `${badStatus} with an error status` : 'every page answered');
    if (consolePages) parts.push(`${consolePages} with console errors`);
    parts.push(broken ? plural(broken, 'broken link') : 'no broken links');
    els.smokeSummary.textContent = parts.join(' · ');
  }

  function rate(metric, value) {
    const limits = VITALS[metric];
    if (!limits || !Number.isFinite(value)) return null;
    return value <= limits[0] ? 'good' : value <= limits[1] ? 'needs' : 'poor';
  }

  function metricCell(label, metric, value) {
    if (!Number.isFinite(value)) return cell(label, h('span', { class: 'zero' }, '—'));
    const text = metric === 'cls' ? value.toFixed(value < 0.01 ? 3 : 2) : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
    const rating = rate(metric, value);
    return cell(label, h('span', { class: 'metric', dataset: { rating: rating || 'none' } }, text, rating ? h('span', { class: 'sr-only' }, ` (${RATING_TEXT[rating]})`) : null));
  }

  function renderPerf(rows) {
    const list = Array.isArray(rows) ? rows : [];
    els.perfCard.hidden = list.length === 0;
    els.perfBody.replaceChildren(
      ...list.map((row) =>
        h(
          'tr',
          {},
          cell('Page', h('span', { class: 'url', title: row.url || '' }, shortUrl(row.url))),
          metricCell('TTFB', 'ttfb', num(row.ttfb)),
          metricCell('FCP', 'fcp', num(row.fcp)),
          metricCell('LCP', 'lcp', num(row.lcp)),
          metricCell('CLS', 'cls', num(row.cls)),
          metricCell('Load', 'load', num(row.load)),
        ),
      ),
    );
  }

  return {
    show,
    invalidate: () => {
      summary = null;
      currentId = null;
    },
  };
}

const REGRESSION_KEYS = Object.keys(REGRESSION);

const list = (value) => (Array.isArray(value) ? value : []);

/** A failed case's diagnosis (runs before root-cause analysis existed have none). */
function diagnosisOf(item) {
  return resultTone(item?.status).tone === 'fail' && item.diagnosis && typeof item.diagnosis === 'object' ? item.diagnosis : null;
}

/** Missing measurements stay missing (Number(null) would read as 0 ms). */
function num(value) {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}

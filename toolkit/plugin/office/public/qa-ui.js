// devcrew QA: small DOM helpers shared by the QA page modules. Everything that shows data goes
// through textContent (h() children) — never innerHTML — so app and case text can't inject markup.

export const $ = (id) => document.getElementById(id);

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const motionOK = () => !reducedMotion.matches;

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const SPRING = 'cubic-bezier(0.2, 1.5, 0.4, 1)';

/** Creates an element. props: class, text, dataset, on, and plain attributes. Children: nodes or strings. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'on') for (const [name, fn] of Object.entries(value)) el.addEventListener(name, fn);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendAll(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
  relearn: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 7.5v6M12 17v.01',
  chevron: 'M9 6l6 6-6 6',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15l2.5-2.5L20 17M15 9.5h.01',
  video: 'M3 6h12v12H3zM15 10l6-3.5v11L15 14',
  trace: 'M3 12h4l3-7 4 14 3-7h4',
  login: 'M10 17l5-5-5-5M15 12H3M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  minus: 'M6 12h12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  dot: 'M12 12h.01',
};

export function icon(name, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `ic ${extraClass}`.trim());
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.dot);
  svg.append(path);
  return svg;
}

export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Only same-origin absolute paths are used as links, so a stored value can never become javascript:. */
export function safePath(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('/') && !text.startsWith('//') && !text.includes('\\') ? text : null;
}

// ---------------------------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------------------------

/** element.animate when motion is allowed; resolves when finished (or at once when it isn't). */
export function animate(el, keyframes, options) {
  if (!motionOK() || !el.animate) return Promise.resolve();
  try {
    const animation = el.animate(keyframes, { easing: EASE_OUT, ...options });
    return animation.finished.catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

export function fadeIn(el, { y = 8, duration = 220, delay = 0 } = {}) {
  return animate(el, [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }], { duration, delay, fill: 'backwards' });
}

/** Swaps an element's text with a short slide: old text leaves upward, new text arrives from below. */
export function swapText(container, text) {
  const current = container.lastElementChild;
  if (current && current.textContent === text) return;
  const next = h('span', { class: 'swap' }, text);
  if (!current || !motionOK()) {
    container.replaceChildren(next);
    return;
  }
  container.append(next);
  current.classList.add('swap-out');
  animate(current, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-70%)' }], { duration: 200 }).then(() => current.remove());
  animate(next, [{ opacity: 0, transform: 'translateY(70%)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  // Several quick swaps can stack spans; keep only the newest two.
  while (container.children.length > 2) container.firstElementChild.remove();
}

const counters = new WeakMap();

/** Counts a number up (or down) to `value`. */
export function countTo(el, value) {
  const target = Math.max(0, Math.round(Number(value) || 0));
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(target);
  if (from === target) {
    el.textContent = String(target);
    return;
  }
  cancelAnimationFrame(counters.get(el));
  if (!motionOK()) {
    el.textContent = String(target);
    return;
  }
  const start = performance.now();
  const duration = Math.min(700, 250 + Math.abs(target - from) * 60);
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(from + (target - from) * eased));
    if (t < 1) counters.set(el, requestAnimationFrame(step));
  };
  counters.set(el, requestAnimationFrame(step));
  if (target > from) animate(el, [{ transform: 'scale(1.18)' }, { transform: 'none' }], { duration: 380 });
}

/** Records where an element is, so a later layout change can glide from there (FLIP). */
export function flipFrom(el, first, { scale = true } = {}) {
  if (!first || !motionOK()) return Promise.resolve();
  // A glide still in flight would skew the measurement; the new one starts from where it was seen.
  for (const running of el.getAnimations?.() || []) running.cancel();
  const last = el.getBoundingClientRect();
  if (!last.width || !last.height) return Promise.resolve();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (!scale) {
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return Promise.resolve();
    return animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380 });
  }
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  return animate(
    el,
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' },
    ],
    { duration: 380 },
  );
}

// ---------------------------------------------------------------------------------------------
// Feedback: toasts and confirm dialog
// ---------------------------------------------------------------------------------------------

export function toast(message, tone = 'info') {
  const host = $('toasts');
  if (!host) return;
  const item = h('div', { class: 'toast', dataset: { tone }, role: tone === 'error' ? 'alert' : null }, icon(tone === 'error' ? 'alert' : 'check', 'toast-ic'), h('span', {}, message));
  host.append(item);
  fadeIn(item, { y: 12 });
  const leave = () => animate(item, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 200 }).then(() => item.remove());
  setTimeout(leave, tone === 'error' ? 7000 : 4000);
  item.addEventListener('click', leave);
}

/** Opens a dialog with a fade/scale entrance and closes it again with a short exit. */
export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  animate(dialog, [{ opacity: 0, transform: 'translateY(10px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
}

export async function closeDialog(dialog, value = '') {
  if (!dialog.open) return;
  await animate(dialog, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(0.98)' }], { duration: 160 });
  dialog.close(value);
}

export function confirmDialog({ title, body, confirm = 'Confirm' }) {
  const dialog = $('dlg-confirm');
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-yes').textContent = confirm;
  return new Promise((resolve) => {
    const yes = $('confirm-yes');
    const no = $('confirm-no');
    const finish = (answer) => {
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onCancel);
      closeDialog(dialog);
      resolve(answer);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dialog.addEventListener('cancel', onCancel);
    openDialog(dialog);
    no.focus();
  });
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

export function toMs(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatWhen(value) {
  const ms = toMs(value);
  if (ms === null) return '';
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
}

export function formatClockElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Normalises a case/test result status into a tone + plain label. */
export function resultTone(status) {
  switch (String(status || '').toLowerCase()) {
    case 'passed':
    case 'pass':
    case 'expected':
      return { tone: 'pass', label: 'Passed', icon: 'check' };
    case 'failed':
    case 'fail':
    case 'timedout':
    case 'timed-out':
    case 'interrupted':
    case 'unexpected':
      return { tone: 'fail', label: status === 'timedOut' ? 'Timed out' : 'Failed', icon: 'close' };
    case 'skipped':
      return { tone: 'neutral', label: 'Skipped', icon: 'minus' };
    case 'notprepared':
    case 'not-prepared':
    case 'not_prepared':
      return { tone: 'warn', label: 'Not learned', icon: 'alert' };
    case 'running':
    case 'started':
      return { tone: 'info', label: 'Running', icon: 'dot' };
    default:
      return { tone: 'neutral', label: status ? String(status) : 'Unknown', icon: 'dot' };
  }
}

export function pill(text, tone = 'neutral', extra = {}) {
  return h('span', { class: 'pill', dataset: { tone }, ...extra }, text);
}

/** Reads/writes a small per-browser preference; storage can be unavailable (private windows). */
export function readPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`devcrew-qa:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(`devcrew-qa:${key}`, JSON.stringify(value));
  } catch {
    /* Storage refused: the choice still applies for this visit. */
  }
}

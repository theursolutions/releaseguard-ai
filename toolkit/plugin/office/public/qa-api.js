// devcrew QA: talks to the office server's /api/qa routes and follows the live QA stream.
// Every write carries the per-server page token (X-Devcrew-Page) from GET /api/qa/session.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let pageToken = null;

async function token(force = false) {
  if (pageToken && !force) return pageToken;
  const response = await fetch('/api/qa/session', { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiError('Can’t reach the devcrew server. Is it still running?', response.status);
  const body = await response.json();
  pageToken = typeof body?.pageToken === 'string' ? body.pageToken : null;
  if (!pageToken) throw new ApiError('The devcrew server did not hand out a page token.', 500);
  return pageToken;
}

function plainError(status) {
  if (status === 403) return 'The page lost its connection to the devcrew server. Reload the page and try again.';
  if (status === 404) return 'That item no longer exists. It may have been deleted in another tab.';
  if (status === 409) return 'A test cycle is already running. Wait for it to finish or stop it first.';
  if (status === 413) return 'That is too much at once. Try pasting fewer cases.';
  return `Something went wrong (HTTP ${status}). Please try again.`;
}

/** JSON request to the QA API. Throws ApiError with a plain-language message on failure. */
export async function api(method, path, body) {
  const write = method !== 'GET';
  const send = async (force) => {
    const headers = { Accept: 'application/json' };
    const init = { method, headers, cache: 'no-store' };
    if (write) {
      headers['Content-Type'] = 'application/json';
      headers['X-Devcrew-Page'] = await token(force);
      init.body = JSON.stringify(body ?? {});
    }
    return fetch(path, init);
  };

  let response;
  try {
    response = await send(false);
    // The server hands out a new token each time it starts, so one stale-token retry is expected.
    if (write && response.status === 403) response = await send(true);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Can’t reach the devcrew server. Is it still running?', 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new ApiError(typeof data?.error === 'string' && data.error ? data.error : plainError(response.status), response.status);
  return data;
}

export const enc = encodeURIComponent;

const EVENT_NAMES = ['run', 'prep', 'analysis', 'case', 'step', 'frame', 'tile.end'];

/**
 * Follows /api/qa/stream. Accepts both plain `data:` messages carrying { type } and named SSE events
 * (`event: run`), so either server style works. onEvent receives { type, ...payload }.
 */
export function connectStream({ onEvent, onState }) {
  let source = null;
  let retryTimer = null;
  let retryDelay = 2000;

  const deliver = (fallbackType, raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const type = typeof payload.type === 'string' ? payload.type : fallbackType;
    if (!type) return;
    onEvent({ ...payload, type });
  };

  const open = () => {
    clearTimeout(retryTimer);
    const wasOpen = Boolean(source);
    source?.close();
    onState(wasOpen ? 'reconnecting' : 'connecting');
    source = new EventSource('/api/qa/stream');
    source.onopen = () => {
      retryDelay = 2000;
      onState('live');
    };
    source.onmessage = (message) => deliver(null, message.data);
    for (const name of EVENT_NAMES) source.addEventListener(name, (message) => deliver(name, message.data));
    source.onerror = () => {
      onState('reconnecting');
      if (source.readyState === EventSource.CLOSED) {
        retryTimer = setTimeout(open, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    };
  };

  open();
  return { close: () => source?.close() };
}

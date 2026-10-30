// Posts QA progress to the local office: standard office events to /events (the 3D office) and QA page
// events to /qa/events. Both use the office token, like the hooks do. They never throw: the office is a viewer.
const config = require('../../office/lib/config');
const { request } = require('../../office/lib/client');

// The office server passes its own token to the processes it starts, so they work with any server instance.
const officeToken = () => process.env.DEVCREW_QA_OFFICE_TOKEN || config.token();

async function post(urlPath, event, timeoutMs) {
  try {
    const body = JSON.stringify(event);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Devcrew-Token': officeToken() };
    return (await request('POST', urlPath, { body, headers, timeoutMs })).status;
  } catch {
    return 0;
  }
}

/** The QA page's "run" event, built from a run summary, the same way by the runners and the routes. */
function runEvent(summary, message = '') {
  const { id, app, environment, status, phase, startedAt, counts, totals } = summary;
  return { type: 'run', run: { id, app, environment, kind: summary.kind || 'cycle', status, phase, message, startedAt, counts, totals } };
}

const postOffice = (event) => post('/events', { ts: Date.now(), ...event }, 1500);
const postQa = (event) => post('/qa/events', event, 3000);

module.exports = { postOffice, postQa, runEvent };

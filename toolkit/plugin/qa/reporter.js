// Playwright reporter for QA runs: posts each case's status and each test.step to the QA page, and the
// same progress to the 3D office. Copied to <qaHome>/lib/devcrew-reporter.js for each run.
const path = require('path');

// The runner passes the plugin folder, because this file runs from its copy in <qaHome>/lib.
const PLUGIN_QA = path.join(process.env.DEVCREW_QA_PLUGIN_DIR || path.join(__dirname, '..'), 'qa');
const { postOffice, postQa } = require(path.join(PLUGIN_QA, 'lib', 'events.js'));

const RUN_ID = process.env.DEVCREW_QA_RUN || 'local';
const PROJECT = process.env.DEVCREW_QA_PROJECT || 'QA';

/** "<qaHome>/apps/crm/cases/ab12cd34.spec.ts" → "ab12cd34"; the smoke check is "smoke". */
function caseIdOf(test) {
  const file = path.basename(test.location.file);
  return file === 'smoke.spec.js' ? 'smoke' : file.replace(/\.spec\.ts$/, '');
}

class DevcrewReporter {
  constructor() {
    this.pending = new Set();
    this.tiles = new Set();
  }

  send(promise) {
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise));
  }

  office(tile, text) {
    this.tiles.add(tile);
    this.send(postOffice({ kind: 'tool', session: RUN_ID, project: PROJECT, agentId: tile, agentType: 'qa-automation', tool: 'Playwright', text }));
  }

  onTestBegin(test, result) {
    const tile = `w${result.workerIndex}-1`;
    this.send(postQa({ type: 'case', runId: RUN_ID, caseId: caseIdOf(test), title: test.title, status: 'running' }));
    this.office(tile, test.title);
  }

  onStepBegin(test, result, step) {
    if (step.category !== 'test.step') return;
    const tile = `w${result.workerIndex}-1`;
    this.send(postQa({ type: 'step', runId: RUN_ID, tile, caseId: caseIdOf(test), caseTitle: test.title, step: step.title }));
    this.office(tile, `${test.title}: ${step.title}`);
  }

  onTestEnd(test, result) {
    this.send(postQa({ type: 'case', runId: RUN_ID, caseId: caseIdOf(test), title: test.title, status: result.status }));
  }

  async onEnd() {
    for (const tile of this.tiles) this.send(postOffice({ kind: 'agent.stop', session: RUN_ID, project: PROJECT, agentId: tile, agentType: 'qa-automation' }));
    await Promise.all([...this.pending]);
  }

  printsToStdio() {
    return false;
  }
}

module.exports = DevcrewReporter;

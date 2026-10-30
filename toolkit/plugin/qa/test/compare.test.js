const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRuns } = require('../lib/compare');

test('a run is compared with the previous one by case id', () => {
  const previous = { id: 'run-1', cases: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'failed' }, { id: 'e', status: 'notPrepared' }] };
  const current = { id: 'run-2', cases: [{ id: 'a', status: 'failed' }, { id: 'b', status: 'passed' }, { id: 'c', status: 'failed' }, { id: 'd', status: 'failed' }, { id: 'e', status: 'failed' }, { id: 'f', status: 'skipped' }, { id: 'g', status: 'timedOut' }] };
  assert.deepEqual(compareRuns(previous, current), { previousRunId: 'run-1', newlyFailing: ['a', 'd', 'e', 'g'], fixed: ['b'], stillFailing: ['c'] });
  assert.deepEqual(compareRuns(null, current), { previousRunId: null, newlyFailing: [], fixed: [], stillFailing: [] });
});

// Compares a run with the previous run of the same app and environment, by case id.

// Playwright's statuses: a timeout or an interrupted test is a failure too.
const FAILING = ['failed', 'timedOut', 'interrupted'];
const isFailing = (status) => FAILING.includes(status);

/**
 * newlyFailing: fails now, and passed (or did not exist) last time.
 * fixed:        failed last time, passes now.
 * stillFailing: failed both times.
 * Without a previous run there is nothing to compare, so all lists are empty.
 */
function compareRuns(previous, current) {
  const result = { previousRunId: previous?.id ?? null, newlyFailing: [], fixed: [], stillFailing: [] };
  if (!previous) return result;

  const before = new Map((previous.cases || []).map((item) => [item.id, item.status]));
  for (const item of current.cases || []) {
    const was = before.get(item.id);
    if (isFailing(item.status) && isFailing(was)) result.stillFailing.push(item.id);
    else if (isFailing(item.status) && (was === undefined || was === 'passed' || was === 'notPrepared')) result.newlyFailing.push(item.id);
    else if (item.status === 'passed' && isFailing(was)) result.fixed.push(item.id);
  }
  return result;
}

module.exports = { compareRuns, isFailing };

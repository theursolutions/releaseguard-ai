// The load engine against local fixture servers: limits, per-second points, cookies, redirects, the
// stress stop conditions and stopping. The subtests run at the same time, each with its own server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempHome } = require('./helpers');

tempHome('devcrew-qa-load-engine-');
const { runLoad, Histogram, cookieJar, applySetCookie } = require('../lib/load-engine');
const { checkPlan, stressSteps } = require('../lib/load-plan');
const { startLoadFixture } = require('./load-fixture');

const local = (baseUrl) => ({ id: 'local', name: 'Local', kind: 'local', baseUrl, loginPath: '/login' });

test('plans are checked against the limits; production and other sites are always refused', () => {
  const env = local('http://127.0.0.1:9');
  const load = { mode: 'load', paths: ['/'], users: 5, durationSec: 20 };
  const refused = (plan, environment, pattern) => assert.throws(() => checkPlan(plan, environment), (error) => error.status === 422 && pattern.test(error.message), JSON.stringify(plan));

  assert.deepEqual(checkPlan(load, env), { mode: 'load', paths: ['/'], users: 5, durationSec: 20, rampUpSec: 0, thinkMs: 500, account: null });
  refused({ ...load, users: 51 }, env, /1 to 50/);
  refused({ ...load, users: 0 }, env, /1 to 50/);
  refused({ ...load, users: 2.5 }, env, /1 to 50/);
  refused({ ...load, durationSec: 301 }, env, /300 seconds/);
  refused({ ...load, durationSec: 9 }, env, /10 seconds/);
  refused({ ...load, rampUpSec: 21 }, env, /ramp-up/);
  refused({ ...load, thinkMs: 20000 }, env, /pause/);
  refused({ ...load, paths: [] }, env, /at least one page/);
  for (const bad of ['https://evil.example/', 'http://127.0.0.1:9/', '//evil.example/x', '/\\evil.example', 'leads', '/a b', 42]) refused({ ...load, paths: [bad] }, env, /not a page of this app/);
  refused(load, { ...env, kind: 'production', allowProduction: true }, /never run on production/);

  const stress = { mode: 'stress', paths: ['/', '/a?x=1#top'], stress: { startUsers: 2, step: 2, stepEverySec: 5, maxUsers: 10 } };
  const plan = checkPlan(stress, env);
  assert.deepEqual(plan.paths, ['/', '/a?x=1']);
  assert.deepEqual(plan.stress, { startUsers: 2, step: 2, stepEverySec: 5, maxUsers: 10, maxErrorRate: 5, maxP95Ms: 2000, steps: 5 });
  assert.equal(plan.durationSec, 25);
  assert.deepEqual(stressSteps(plan.stress), [2, 4, 6, 8, 10]);
  refused({ ...stress, stress: { startUsers: 1, step: 1, stepEverySec: 10, maxUsers: 50 } }, env, /would take 500 seconds/);
  refused({ ...stress, stress: { ...stress.stress, maxUsers: 51 } }, env, /to 50/);
  refused({ ...stress, stress: { ...stress.stress, maxUsers: 1 } }, env, /from the start users/);
  refused({ ...stress, mode: 'spike' }, env, /load test or a stress test/);
});

test('histogram percentiles, cookie jar and Set-Cookie handling', () => {
  const histogram = new Histogram();
  for (let ms = 1; ms <= 100; ms += 1) histogram.add(ms);
  assert.deepEqual(histogram.summary(), { p50: 50, p95: 95, p99: 99, min: 1, max: 100, avg: 51 });
  histogram.add(60000);
  assert.equal(histogram.summary().max, 10000, 'capped at the request timeout');

  const jar = cookieJar([{ name: 'session', value: 'abc', domain: 'app.test' }, { name: 'sub', value: '1', domain: '.test' }, { name: 'other', value: 'x', domain: 'elsewhere.test' }, { name: 'old', value: 'y', domain: 'app.test', expires: 1 }], 'https://app.test/base');
  assert.deepEqual([...jar], [['session', 'abc'], ['sub', '1']]);
  applySetCookie(jar, ['session=def; Path=/; HttpOnly', 'sub=; Max-Age=0']);
  assert.deepEqual([...jar], [['session', 'def']]);
});

test('the engine', { concurrency: true, timeout: 60000 }, (t) => {
  const runs = [];
  runs.push(t.test('refuses plans over the limits, and production, by itself', async () => {
    await assert.rejects(runLoad({ environment: local('http://127.0.0.1:9'), plan: { mode: 'load', paths: ['/'], users: 51, durationSec: 10 } }), /1 to 50/);
    await assert.rejects(runLoad({ environment: { ...local('http://127.0.0.1:9'), kind: 'production', allowProduction: true }, plan: { mode: 'load', paths: ['/'], users: 1, durationSec: 10 } }), /production/);
  }));

  runs.push(t.test('a load test: one point per second, GET only, the session cookie, redirects counted apart', async (st) => {
    const fixture = await startLoadFixture();
    st.after(fixture.close);
    const points = [];
    const result = await runLoad({
      environment: local(fixture.baseUrl),
      plan: { mode: 'load', paths: ['/', '/private', '/redirect'], users: 3, durationSec: 10, rampUpSec: 2, thinkMs: 100 },
      cookies: [{ name: 'session', value: 'abc', domain: '127.0.0.1', path: '/' }, { name: 'tracker', value: 'no', domain: 'example.com' }],
      onSecond: (point) => points.push(point),
    });

    assert.deepEqual(points.map((point) => point.t), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(points[0].users, 2, 'users join over the ramp-up (0 s and 0.67 s)');
    assert.equal(points.at(-1).users, 3);
    assert.ok(points.every((point) => point.rps > 0 && Number.isFinite(point.p95) && point.errorRate === 0), JSON.stringify(points));
    assert.equal(points.at(-1).requests, result.timeline.reduce((sum, point) => sum + point.rps, 0));

    assert.ok(fixture.seen.length > 50);
    assert.ok(fixture.seen.every((entry) => entry.method === 'GET'), 'GET requests only');
    assert.ok(fixture.seen.every((entry) => entry.cookie === 'session=abc'), 'every request carries the session cookie, and only it');
    assert.equal(fixture.maxInFlight() <= 3, true);

    const { totals } = result;
    assert.equal(result.stopped, false);
    assert.ok(result.durationSec >= 10 && result.durationSec < 11, String(result.durationSec));
    assert.equal(totals.errors, 0);
    assert.equal(totals.loginRedirects, 0, 'the session was kept');
    const page = (path) => result.pages.find((item) => item.path === path);
    assert.equal(page('/private').statuses[200], page('/private').requests);
    assert.equal(page('/redirect').redirects, page('/redirect').requests, 'redirects are not followed');
    assert.equal(totals.redirects, page('/redirect').requests);
    assert.ok(totals.p50 >= 20 && totals.p95 >= totals.p50 && totals.p99 >= totals.p95 && totals.max >= totals.p99 && totals.min <= totals.p50);
    assert.equal(totals.peakUsers, 3);
    assert.ok(totals.avgRps > 5);
  }));

  runs.push(t.test('without the session, a redirect to the login page is reported as a lost session', async (st) => {
    const fixture = await startLoadFixture();
    st.after(fixture.close);
    const result = await runLoad({ environment: local(fixture.baseUrl), plan: { mode: 'load', paths: ['/private'], users: 2, durationSec: 10, thinkMs: 200 } });
    assert.ok(result.totals.requests > 10);
    assert.equal(result.totals.loginRedirects, result.totals.requests);
    assert.equal(result.totals.errors, 0, '3xx are not errors');
  }));

  runs.push(t.test('stress: stops at the step where errors pass the limit, and reports it as the breaking point', async (st) => {
    const fixture = await startLoadFixture({ limit: 4, overload: 'error' });
    st.after(fixture.close);
    const steps = [];
    const result = await runLoad({
      environment: local(fixture.baseUrl),
      plan: { mode: 'stress', paths: ['/', '/a'], thinkMs: 0, stress: { startUsers: 2, step: 1, stepEverySec: 3, maxUsers: 8 } },
      onStep: (step) => steps.push(step.users),
    });
    assert.deepEqual(steps, [2, 3, 4]);
    assert.equal(result.breakingPoint?.users, 4, JSON.stringify(result.steps));
    assert.equal(result.breakingPoint.condition, 'errorRate');
    assert.ok(result.breakingPoint.value > 5);
    assert.equal(result.heldUpTo, 3);
    assert.deepEqual(result.steps.map((step) => [step.users, Boolean(step.broke)]), [[2, false], [3, false], [4, true]]);
    assert.ok(result.durationSec >= 9 && result.durationSec < 10, 'it stops right after the step that broke');
    assert.deepEqual(result.timeline.map((point) => point.users), [2, 2, 2, 3, 3, 3, 4, 4, 4], 'a staircase');
  }));

  runs.push(t.test('stress: stops when the 95th percentile response time passes the limit', async (st) => {
    // Wide margins (1.5 s answers against a 0.8 s limit), so a busy machine cannot trip the limit early.
    const fixture = await startLoadFixture({ limit: 4, overload: 'slow', slowMs: 1500 });
    st.after(fixture.close);
    const result = await runLoad({ environment: local(fixture.baseUrl), plan: { mode: 'stress', paths: ['/'], thinkMs: 0, stress: { startUsers: 2, step: 1, stepEverySec: 3, maxUsers: 8, maxP95Ms: 800 } } });
    assert.deepEqual(result.breakingPoint && { users: result.breakingPoint.users, condition: result.breakingPoint.condition }, { users: 4, condition: 'p95' }, JSON.stringify(result.steps));
    assert.equal(result.heldUpTo, 3);
  }));

  runs.push(t.test('stress: requests that never answer still count as slow', async (st) => {
    const fixture = await startLoadFixture({ limit: 3, overload: 'hang' });
    st.after(fixture.close);
    const result = await runLoad({ environment: local(fixture.baseUrl), plan: { mode: 'stress', paths: ['/'], thinkMs: 0, stress: { startUsers: 1, step: 1, stepEverySec: 3, maxUsers: 6, maxP95Ms: 1500 } } });
    assert.equal(result.breakingPoint?.users, 3, JSON.stringify(result.steps));
    assert.equal(result.breakingPoint.condition, 'p95');
    assert.ok(result.breakingPoint.waiting >= 1, 'the waiting requests are named in the result');
    assert.ok(result.totals.unfinished >= 1, 'requests still waiting at the end are counted apart');
  }));

  runs.push(t.test('stress: holds up to max users when nothing breaks', async (st) => {
    const fixture = await startLoadFixture();
    st.after(fixture.close);
    const result = await runLoad({ environment: local(fixture.baseUrl), plan: { mode: 'stress', paths: ['/'], thinkMs: 50, stress: { startUsers: 1, step: 2, stepEverySec: 3, maxUsers: 5 } } });
    assert.equal(result.breakingPoint, null);
    assert.equal(result.heldUpTo, 5);
    assert.deepEqual(result.steps.map((step) => step.users), [1, 3, 5]);
  }));

  runs.push(t.test('stopping aborts at once and keeps what ran', async (st) => {
    const fixture = await startLoadFixture({ delayMs: 300 });
    st.after(fixture.close);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2300);
    const started = Date.now();
    const result = await runLoad({ environment: local(fixture.baseUrl), plan: { mode: 'load', paths: ['/'], users: 5, durationSec: 120, thinkMs: 0 }, signal: controller.signal });
    assert.ok(Date.now() - started < 3000, 'resolved right after the stop');
    assert.equal(result.stopped, true);
    assert.equal(result.timeline.length, 2);
    assert.ok(result.totals.requests >= 20);
  }));
  return Promise.all(runs);
});

// The smoke check: logged in as the environment's first account, it walks the app's own links (breadth
// first, at most 25 pages, 3 clicks deep) and records each page's HTTP status, console errors, broken links
// and speed. Read only: it never submits forms and skips logout/delete/remove links.
// Copied to <qaHome>/lib/smoke.spec.js for each run.
const { test } = require('./devcrew-qa');

const MAX_PAGES = 25;
const MAX_DEPTH = 3;
const MAX_LINK_CHECKS = 50;
const UNSAFE_LINK = /log ?out|sign ?out|logoff|delete|destroy|remove|unsubscribe/i;
const NOT_A_PAGE = /\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|svg|webp|mp4|mp3|exe|dmg)$|\/(download|export)s?(\/|$)/i;

const clean = (url) => url.split('#')[0];

test('Smoke check', async ({ as, qa }) => {
  test.setTimeout(10 * 60 * 1000);
  const page = await as(qa.labels[0]);
  const origin = new URL(qa.baseUrl).origin;
  const sameApp = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && /^https?:$/.test(parsed.protocol);
    } catch {
      return false;
    }
  };

  let consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error.message).slice(0, 300)));

  const pages = [];
  const performance = [];
  const checkedLinks = new Map();
  const queue = [{ url: clean(page.url()), depth: 0, first: true }];
  const seen = new Set([queue[0].url]);

  while (queue.length && pages.length < MAX_PAGES) {
    const { url, depth, first } = queue.shift();
    consoleErrors = [];
    let status = 0;
    try {
      const response = first ? await page.reload({ waitUntil: 'load', timeout: 30000 }) : await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      status = response ? response.status() : 0;
    } catch (error) {
      consoleErrors.push(`Page did not load: ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
    await page.waitForTimeout(400);

    const links = await page
      .$$eval('a[href]', (anchors) => anchors.map((anchor) => ({ href: anchor.href, text: (anchor.textContent || '').trim().slice(0, 80), download: anchor.hasAttribute('download') })))
      .catch(() => []);
    const brokenLinks = [];
    for (const link of links) {
      const href = clean(link.href);
      if (!sameApp(href) || UNSAFE_LINK.test(href) || UNSAFE_LINK.test(link.text)) continue;

      if (!checkedLinks.has(href) && checkedLinks.size < MAX_LINK_CHECKS) {
        const linkStatus = await page.request
          .get(href, { timeout: 15000, maxRedirects: 5 })
          .then((response) => response.status())
          .catch(() => 0);
        checkedLinks.set(href, linkStatus);
      }
      const linkStatus = checkedLinks.get(href);
      if (linkStatus !== undefined && (linkStatus >= 400 || linkStatus === 0)) brokenLinks.push({ url: href, status: linkStatus });

      // Files and downloads are link-checked but never opened as pages.
      if (depth < MAX_DEPTH && !seen.has(href) && !link.download && !NOT_A_PAGE.test(new URL(href).pathname)) {
        seen.add(href);
        queue.push({ url: href, depth: depth + 1 });
      }
    }

    const speed = await page.evaluate(() => {
      const [navigation] = window.performance.getEntriesByType('navigation');
      const vitals = window.__devcrewVitals || {};
      const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
      return {
        ttfb: navigation ? round(navigation.responseStart) : null,
        fcp: round(vitals.fcp),
        lcp: round(vitals.lcp),
        cls: Number.isFinite(vitals.cls) ? Number(vitals.cls.toFixed(3)) : null,
        load: navigation && navigation.loadEventEnd > 0 ? round(navigation.loadEventEnd) : null,
      };
    }).catch(() => null);

    pages.push({ url, status, consoleErrors: [...new Set(consoleErrors)].slice(0, 20), brokenLinks: brokenLinks.slice(0, 50) });
    if (speed) performance.push({ url, ...speed });
  }

  await test.info().attach('devcrew-smoke', { body: JSON.stringify({ pages, performance }), contentType: 'application/json' });
});

// A tiny web app for the load tests. It counts the requests in flight and, from `limit` requests at the
// same time, answers 500 (overload: 'error'), answers slowly ('slow') or never answers ('hang').
//   /, /a           plain pages (after `delayMs`)
//   /private        200 with the cookie session=abc, else a redirect to /login
//   /redirect       a redirect elsewhere (not to the login page)
// Every request's method and Cookie header is recorded. Listens on 127.0.0.1 only.
const http = require('http');

function startLoadFixture({ limit = Infinity, overload = 'error', delayMs = 20, slowMs = 400 } = {}) {
  const seen = [];
  const hanging = new Set();
  let inFlight = 0;
  let maxInFlight = 0;

  const server = http.createServer((req, res) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    seen.push({ method: req.method, path: req.url, cookie: req.headers.cookie || '' });
    const over = inFlight >= limit;
    const answer = (status, headers = {}, body = '') => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    res.on('close', () => {
      inFlight -= 1;
      hanging.delete(res);
    });

    if (over && overload === 'hang') {
      hanging.add(res);
      return;
    }
    setTimeout(() => {
      if (over && overload === 'error') return answer(500, {}, '<h1>Overloaded</h1>');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/private') return /(^|;\s*)session=abc(;|$)/.test(req.headers.cookie || '') ? answer(200, {}, '<h1>Private</h1>') : answer(302, { Location: '/login' });
      if (url.pathname === '/redirect') return answer(302, { Location: '/elsewhere' });
      if (url.pathname === '/' || url.pathname === '/a') return answer(200, {}, `<h1>Page ${url.pathname}</h1>`);
      return answer(404, {}, '<h1>Not found</h1>');
    }, over && overload === 'slow' ? slowMs : delayMs);
  });
  server.keepAliveTimeout = 30000;

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        seen,
        maxInFlight: () => maxInFlight,
        close: () => {
          for (const res of hanging) res.destroy();
          server.closeAllConnections?.();
          return new Promise((done) => server.close(() => done()));
        },
      }),
    );
  });
}

module.exports = { startLoadFixture };

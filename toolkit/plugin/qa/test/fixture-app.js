// A tiny web app for the QA tests: a login form, a leads page with a required phone field, a link that
// returns 500, a page with a console error and a product form whose save always fails. Listens on 127.0.0.1 only.
const crypto = require('crypto');
const http = require('http');

const USERNAME = 'agent@fixture.test';
const PASSWORD = 'Fixture-Pa55word!7';

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

function startFixtureApp() {
  const sessions = new Set();
  const leads = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const cookie = /session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const html = (status, title, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      res.end(page(title, body));
    };
    const redirect = (location, headers = {}) => {
      res.writeHead(302, { Location: location, ...headers });
      res.end();
    };
    const readForm = (done) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => done(new URLSearchParams(raw)));
    };
    const loginForm = (error = '') =>
      html(200, 'Log in', `<h1>Log in</h1>${error ? `<p role="alert">${error}</p>` : ''}<form method="post" action="/login"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Log in</button></form>`);

    if (url.pathname === '/login' && req.method === 'GET') return sessions.has(cookie) ? redirect('/dashboard') : loginForm();
    if (url.pathname === '/login' && req.method === 'POST') {
      return readForm((form) => {
        if (form.get('email') !== USERNAME || form.get('password') !== PASSWORD) return loginForm('These credentials do not match our records.');
        const id = crypto.randomBytes(8).toString('hex');
        sessions.add(id);
        redirect('/dashboard', { 'Set-Cookie': `session=${id}; Path=/; HttpOnly` });
      });
    }
    if (!sessions.has(cookie)) return redirect('/login');

    switch (url.pathname) {
      case '/':
      case '/dashboard':
        return html(200, 'Dashboard', '<h1>Dashboard</h1><nav><a href="/leads">Leads</a> <a href="/reports">Reports</a> <a href="/console-error">Activity</a> <a href="/logout">Log out</a> <a href="https://example.com/">Help</a></nav>');
      case '/leads':
        if (req.method === 'POST') {
          return readForm((form) => {
            if (!form.get('phone')) return html(422, 'New lead', '<h1>New lead</h1><p role="alert">The phone field is required</p><a href="/leads">Back</a>');
            leads.push(form.get('name'));
            redirect('/leads');
          });
        }
        return html(200, 'Leads', `<h1>Leads</h1><a href="/leads/create">New lead</a><ul>${leads.map((name) => `<li>${name}</li>`).join('')}</ul>`);
      case '/leads/create':
        return html(200, 'New lead', '<h1>New lead</h1><form method="post" action="/leads"><label>Name <input name="name"></label><label>Phone <input name="phone"></label><button type="submit">Save</button></form>');
      case '/reports':
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end(page('Server error', '<h1>500 Server Error</h1>'));
      // Not linked from anywhere (the smoke check never finds it): saving a product always fails with a 500,
      // and the page logs a console error instead of confirming.
      case '/products/create':
        return html(
          200,
          'New product',
          '<h1>New product</h1><form id="product"><label>Product name <input name="name"></label><button type="submit">Save product</button></form><p id="saved" hidden>Product saved</p>' +
            '<script>document.getElementById("product").addEventListener("submit", async (event) => { event.preventDefault(); const response = await fetch("/api/products", { method: "POST", body: new FormData(event.target) }); if (response.ok) document.getElementById("saved").hidden = false; else console.error("Saving the product failed with " + response.status); });</script>',
        );
      case '/api/products':
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end('{"message":"Server Error"}');
      case '/console-error':
        return html(200, 'Activity', '<h1>Activity</h1><script>console.error("Fixture console error")</script>');
      case '/logout':
        sessions.delete(cookie);
        return redirect('/login');
      default:
        return html(404, 'Not found', '<h1>Not found</h1>');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

module.exports = { startFixtureApp, USERNAME, PASSWORD };

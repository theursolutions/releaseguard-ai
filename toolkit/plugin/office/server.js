#!/usr/bin/env node
// The local agent office: a tiny web server on 127.0.0.1 that receives hook events and streams them
// to the 3D office page. No dependencies and no files written; state lives in memory only.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('./lib/config');
const { ROOMS, AGENTS } = require('./lib/stages');
const { OfficeState } = require('./lib/state');
const { sanitizeEvent } = require('./lib/normalize');
const { readPeople, publicPeople, photoType } = require('./lib/people');
const { createQaRoutes } = require('../qa/routes');

const VERSION = require('../.claude-plugin/plugin.json').version;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 16 * 1024;
const IDLE_EXIT_MS = 4 * 60 * 60 * 1000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// startQaRunner is only for tests: it replaces the process that runs a QA test cycle.
function createOfficeServer({ port, token, publicDir = PUBLIC_DIR, dataDir = null, onActivity = () => {}, startQaRunner, generatePrdCases }) {
  const state = new OfficeState();
  const clients = new Set();
  // Only these Host headers are served, which blocks DNS-rebinding pages from reading the office.
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const broadcast = (update) => {
    const message = `data: ${JSON.stringify(update)}\n\n`;
    for (const client of clients) client.write(message);
  };

  const receive = (req, res) => {
    if (!sameSecret(req.headers['x-devcrew-token'], token)) return send(res, 401, { error: 'token required' });

    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      tooLarge = tooLarge || size > MAX_BODY_BYTES;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return send(res, 413, { error: 'event too large' });
      let event;
      try {
        event = sanitizeEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        event = null;
      }
      if (!event) return send(res, 422, { error: 'not an office event' });
      onActivity();
      broadcast(state.apply(event));
      send(res, 202, { ok: true });
    });
  };

  const stream = (req, res) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    onActivity();
    req.on('close', () => clients.delete(res));
  };

  const serveStatic = (req, res, pathname) => {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(publicDir, relative);
    const type = TYPES[path.extname(file).toLowerCase()];
    const insidePublic = file.startsWith(path.resolve(publicDir) + path.sep);
    if (!insidePublic || !type || relative.split(/[\\/]/).some((part) => part.startsWith('.'))) return send(res, 404, { error: 'not found' });

    fs.readFile(file, (error, content) => {
      if (error) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
      res.end(content);
    });
  };

  // QA test cycles (/qa page, /api/qa/*, /qa/events). Its live stream is separate from the office stream; runs
  // also post standard office events, which arrive here through officeEvent.
  const qa = createQaRoutes({
    port,
    token,
    send,
    securityHeaders: SECURITY_HEADERS,
    onActivity,
    ...(startQaRunner ? { startRunner: startQaRunner } : {}),
    ...(generatePrdCases ? { generatePrdCases } : {}),
    officeEvent: (event) => {
      const clean = sanitizeEvent(event);
      if (clean) broadcast(state.apply(clean));
    },
  });

  // Real names and photos are optional and only exist when the developer set them up in their data folder.
  const people = () => (dataDir ? readPeople(dataDir) : {});

  const servePhoto = (res, type) => {
    const crew = people();
    const file = Object.hasOwn(crew, type) ? crew[type].photoFile : null;
    if (!file) return send(res, 404, { error: 'not found' });
    fs.readFile(file, (error, content) => {
      if (error) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': photoType(file) });
      res.end(content);
    });
  };

  const server = http.createServer((req, res) => {
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { error: 'forbidden host' });

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
    const { pathname } = url;

    if (pathname === '/qa/events' || pathname.startsWith('/api/qa/')) return qa.handle(req, res, url);
    if (req.method === 'POST' && pathname === '/events') return receive(req, res);
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (pathname === '/health') return send(res, 200, { ok: true, app: 'devcrew-office', version: VERSION });
    if (pathname === '/api/state') return send(res, 200, { version: VERSION, rooms: ROOMS, crew: AGENTS, people: publicPeople(people()), ...state.snapshot() });
    if (pathname.startsWith('/people/')) return servePhoto(res, pathname.slice('/people/'.length));
    if (pathname === '/api/stream') return stream(req, res);
    if (pathname === '/qa') return serveStatic(req, res, '/qa.html');
    return serveStatic(req, res, pathname);
  });

  // Keeps open pages' connections alive through proxies and sleeping laptops.
  const heartbeat = setInterval(() => {
    for (const client of [...clients, ...qa.clients]) client.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    qa.close();
  });

  return { server, state, clients, qa };
}

if (require.main === module) {
  const port = config.port();
  let lastActivity = Date.now();
  const { server, clients, qa } = createOfficeServer({ port, token: config.token(), dataDir: config.dataDir(), onActivity: () => (lastActivity = Date.now()) });

  server.on('error', (error) => {
    // Another office is already running (a parallel hook started it first); that one serves everyone.
    if (error.code === 'EADDRINUSE') process.exit(0);
    throw error;
  });

  // Stops by itself when nobody has used it for hours, so it never lingers as a forgotten process.
  setInterval(() => {
    if (clients.size === 0 && !qa.isBusy() && Date.now() - lastActivity > IDLE_EXIT_MS) server.close(() => process.exit(0));
  }, 60000).unref();

  server.listen(port, config.HOST);
}

module.exports = { createOfficeServer, VERSION };

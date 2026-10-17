#!/usr/bin/env node
/*
 * Therapy Planner clinic server: keeps one shared copy of the clinic's records on this computer's disk and
 * serves the app to everyone's browser. Each person signs in; the server sends them only what their role may see,
 * checks every change against the same rules, and pushes updates to everyone who is signed in.
 *
 * No dependencies beyond Node.js 18+.  Usage: see docs/SERVER-SETUP.md, or `node server/server.js --help`.
 *
 * Copyright (C) 2026 the Therapy Planner contributors. Licensed under the GNU AGPL v3 or later (see LICENSE).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const Sync = require('../js/sync.js');
const L = require('../js/logic.js');

const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PW_ITERATIONS = 100000; // same as the browser (js/store.js)
const SESSION_IDLE_MS = 60 * 60 * 1000;
const SESSION_MAX_MS = 14 * 60 * 60 * 1000;
const MAX_BODY = 25 * 1024 * 1024;

/* ---------- options ---------- */

function parseArgs(argv) {
  const o = {
    port: Number(process.env.PORT) || 8080, host: process.env.HOST || '0.0.0.0',
    data: process.env.THERAPY_DATA_DIR || path.join(ROOT, 'clinic-data'),
    tlsCert: process.env.TLS_CERT || '', tlsKey: process.env.TLS_KEY || '',
    source: process.env.THERAPY_SOURCE_URL || (PKG.repository && PKG.repository.url) || '',
    demo: false, initAdmin: null, help: false, quiet: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--port') o.port = Number(next());
    else if (a === '--host') o.host = next();
    else if (a === '--data') o.data = path.resolve(next());
    else if (a === '--tls-cert') o.tlsCert = next();
    else if (a === '--tls-key') o.tlsKey = next();
    else if (a === '--source') o.source = next();
    else if (a === '--demo') o.demo = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--init-admin') o.initAdmin = { name: next(), email: next() };
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('Unknown option ' + a);
  }
  return o;
}

const HELP = `Therapy Planner clinic server

  node server/server.js [options]

  --init-admin "Name" email   Create the first supervisor account and print a temporary password, then exit
  --demo                      Start with the demo clinic if there is no data yet (password demo1234)
  --port 8080                 Port to listen on (env PORT)
  --host 0.0.0.0              Address to listen on, e.g. this computer's Tailscale address (env HOST)
  --data ./clinic-data        Folder for the clinic's data (env THERAPY_DATA_DIR)
  --tls-cert file --tls-key file   Serve over HTTPS (env TLS_CERT, TLS_KEY)
  --source URL                Where users can get the source code (AGPL section 13)

  Set THERAPY_DATA_PASSPHRASE to encrypt the data files on disk (AES-256-GCM). If it is lost, the data is lost.
`;

/* ---------- storage on disk ---------- */

function makeVault(dir, passphrase) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyCache = {};
  function keyFor(salt) {
    const id = salt.toString('base64');
    if (!keyCache[id]) keyCache[id] = crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return keyCache[id];
  }
  let salt = null;
  function read(name) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return null;
    const box = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!box.enc) {
      if (passphrase) console.warn('Note: ' + name + ' is not encrypted yet; it will be encrypted on the next save.');
      return box.data;
    }
    if (!passphrase) throw new Error(name + ' is encrypted. Set THERAPY_DATA_PASSPHRASE to open it.');
    salt = Buffer.from(box.salt, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(salt), Buffer.from(box.iv, 'base64'));
    d.setAAD(Buffer.from(name));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    try { return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8')); }
    catch (e) { throw new Error('Could not decrypt ' + name + ': wrong THERAPY_DATA_PASSPHRASE?'); }
  }
  // Write to a temporary file and rename, so a crash or power cut never leaves half a file.
  function write(name, data) {
    let box;
    if (passphrase) {
      salt = salt || crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', keyFor(salt), iv);
      c.setAAD(Buffer.from(name));
      const ct = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
      box = { format: 'therapy-planner-server', v: 1, enc: true, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
    } else box = { format: 'therapy-planner-server', v: 1, enc: false, data: data };
    const file = path.join(dir, name), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(box), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  return { read: read, write: write, dir: dir };
}

/* ---------- passwords and sessions ---------- */

function hashPassword(pass, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(pass), salt, PW_ITERATIONS, 32, 'sha256');
  return { pwSalt: salt.toString('base64'), pwHash: hash.toString('base64') };
}
function checkPassword(u, pass) {
  const h = Buffer.from(hashPassword(pass, u.pwSalt).pwHash, 'base64'), want = Buffer.from(u.pwHash, 'base64');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}

/* ---------- the server ---------- */

function createServer(opts) {
  const vault = makeVault(opts.data, process.env.THERAPY_DATA_PASSPHRASE || '');
  let db = vault.read('clinic-data.json');
  let keys = vault.read('patient-keys.json') || {};
  if (!db) {
    db = { version: 1, state: opts.demo ? require('./demo.js')() : emptyState() };
    vault.write('clinic-data.json', db);
  }
  Sync.ensureIds(db.state);
  const sessions = new Map(); // token -> { userId, created, seen }
  const failures = new Map(); // login -> { n, until }
  const streams = new Set();
  const secure = !!(opts.tlsCert && opts.tlsKey);
  const logFile = path.join(vault.dir, 'access.log');

  // Accountability: who did what and when. Never patient names or clinical content.
  function log(req, user, action, detail) {
    const line = JSON.stringify({ at: new Date().toISOString(), ip: req ? req.socket.remoteAddress : '', user: user ? user.id : '', role: user ? user.role : '', action: action, detail: detail || '' });
    fs.appendFile(logFile, line + '\n', { mode: 0o600 }, () => {});
  }

  function persist() { vault.write('clinic-data.json', db); }
  function persistKeys() { vault.write('patient-keys.json', keys); }
  function userById(id) { return db.state.users.find((u) => u.id === id); }

  function sessionFor(req) {
    const m = /(?:^|;\s*)tp_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const s = sessions.get(m[1]), now = Date.now();
    if (!s || now - s.seen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS || !userById(s.userId)) { sessions.delete(m[1]); return null; }
    s.seen = now;
    return { token: m[1], user: userById(s.userId) };
  }
  function endSessionsOf(userId) {
    for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
    for (const st of streams) if (st.userId === userId) st.res.end();
  }
  function cookie(token, maxAge) {
    return 'tp_session=' + token + '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') + (maxAge === 0 ? '; Max-Age=0' : '');
  }

  function broadcast() {
    for (const st of streams) st.res.write('data: ' + JSON.stringify({ version: db.version }) + '\n\n');
  }

  const STATIC = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '': 'text/plain; charset=utf-8' };
  const ALLOWED = /^\/(index\.html|sw\.js|manifest\.webmanifest|LICENSE|css\/[\w.-]+\.css|js\/[\w.-]+\.js|icons\/[\w.-]+\.(svg|png))$/;

  function headers(type, extra) {
    return Object.assign({
      'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Cache-Control': 'no-cache'
    }, secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}, extra || {});
  }
  function json(res, status, body, extra) { res.writeHead(status, headers('application/json; charset=utf-8', Object.assign({ 'Cache-Control': 'no-store' }, extra))); res.end(JSON.stringify(body)); }

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    if (!ALLOWED.test(pathname)) { res.writeHead(404, headers('text/plain')); res.end('Not found'); return; }
    fs.readFile(path.join(ROOT, pathname), (err, buf) => {
      if (err) { res.writeHead(404, headers('text/plain')); res.end('Not found'); return; }
      // Tell the app it is talking to a clinic server (it then keeps no patient data on the device).
      if (pathname === '/index.html') buf = Buffer.from(buf.toString('utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="therapy-server" content="1">'));
      res.writeHead(200, headers(STATIC[path.extname(pathname)] || STATIC['']));
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
      req.on('error', reject);
    });
  }

  function info() {
    return { app: 'Therapy Planner', version: PKG.version, license: 'AGPL-3.0-or-later', source: opts.source, clinic: db.state.settings.messaging && db.state.settings.messaging.clinicName || '',
      encryptedAtRest: !!process.env.THERAPY_DATA_PASSPHRASE, https: secure,
      demoAccounts: db.state.seeded ? db.state.users.map((u) => ({ login: u.email || u.name, name: u.name, role: u.role })) : null };
  }

  async function api(req, res, pathname) {
    // Changes must be same-origin JSON: a cross-site form or script cannot send these.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON only' });
      const origin = req.headers.origin;
      if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return json(res, 403, { error: 'Cross-site request refused' });
    }
    if (pathname === '/api/info') return json(res, 200, info());

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const login = String(body.login || '').trim().toLowerCase();
      const f = failures.get(login);
      if (f && f.until > Date.now()) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const u = db.state.users.find((x) => (x.email || '').toLowerCase() === login || x.name.toLowerCase() === login);
      const ok = u && (u.pwHash ? checkPassword(u, body.password || '') : true);
      if (!ok) {
        const n = (f ? f.n : 0) + 1;
        failures.set(login, { n: n, until: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
        log(req, null, 'Failed sign-in');
        return json(res, 401, { error: 'Email or password not recognised.' });
      }
      failures.delete(login);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { userId: u.id, created: Date.now(), seen: Date.now() });
      if (!u.pwHash) u.mustChange = true;
      log(req, u, 'Signed in');
      return json(res, 200, { user: Sync.publicUser(u) }, { 'Set-Cookie': cookie(token) });
    }

    const sess = sessionFor(req);
    if (!sess) return json(res, 401, { error: 'Not signed in' });
    const me = sess.user;

    if (pathname === '/api/logout' && req.method === 'POST') {
      sessions.delete(sess.token);
      log(req, me, 'Signed out');
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }
    if (pathname === '/api/state' && req.method === 'GET') {
      const view = Sync.viewFor(me, db.state);
      log(req, me, 'Opened records', view.patients.length + ' patients visible');
      return json(res, 200, { version: db.version, me: me.id, state: view, keys: me.role === 'supervisor' ? keys : null });
    }
    if (pathname === '/api/changes' && req.method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.ops)) return json(res, 400, { error: 'No changes' });
      if (me.mustChange) return json(res, 403, { error: 'Choose your own password first' });
      const r = Sync.applyFrom(me, db.state, body.ops);
      if (r.applied) {
        r.erased.forEach((pid) => { delete keys[pid]; });
        if (r.erased.length) persistKeys();
        db.version++;
        persist();
        broadcast();
      }
      const counts = {};
      body.ops.forEach((op) => { counts[op.c] = (counts[op.c] || 0) + 1; });
      log(req, me, 'Changed records', Object.keys(counts).map((k) => k + '×' + counts[k]).join(' ') + (r.rejected.length ? ' · ' + r.rejected.length + ' refused' : ''));
      return json(res, 200, { version: db.version, applied: r.applied, rejected: r.rejected });
    }
    if (pathname === '/api/password' && req.method === 'POST') {
      const body = await readBody(req);
      const target = userById(body.userId);
      if (!target) return json(res, 404, { error: 'No such account' });
      if (target.id !== me.id && me.role !== 'supervisor') return json(res, 403, { error: 'Only a supervisor can reset someone else\'s password' });
      if (String(body.password || '').length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      Object.assign(target, hashPassword(body.password), { mustChange: target.id === me.id ? false : !!body.mustChange });
      if (target.id !== me.id) endSessionsOf(target.id);
      db.version++;
      persist();
      broadcast();
      log(req, me, target.id === me.id ? 'Set own password' : 'Reset password', target.id);
      return json(res, 200, { ok: true, version: db.version });
    }
    if (pathname === '/api/keys' && req.method === 'PUT') {
      if (me.role !== 'supervisor') return json(res, 403, { error: 'Only a supervisor manages patient keys' });
      const body = await readBody(req);
      if (!body.keys || typeof body.keys !== 'object') return json(res, 400, { error: 'No keys' });
      keys = {};
      Object.keys(body.keys).forEach((pid) => { if (/^[\w-]+$/.test(pid) && typeof body.keys[pid] === 'string') keys[pid] = body.keys[pid]; });
      persistKeys();
      log(req, me, 'Updated patient keys', Object.keys(keys).length + ' keys');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, headers('text/event-stream', { 'Cache-Control': 'no-store', Connection: 'keep-alive' }));
      res.write('retry: 3000\ndata: ' + JSON.stringify({ version: db.version }) + '\n\n');
      const st = { res: res, userId: me.id };
      streams.add(st);
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
      req.on('close', () => { clearInterval(beat); streams.delete(st); });
      return;
    }
    return json(res, 404, { error: 'Unknown request' });
  }

  function handler(req, res) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (pathname.indexOf('/api/') === 0) {
      api(req, res, pathname).catch((e) => {
        if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
        if (!e.status) console.error(e);
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers('text/plain')); res.end(); return; }
    serveStatic(req, res, pathname);
  }

  const server = secure
    ? https.createServer({ cert: fs.readFileSync(opts.tlsCert), key: fs.readFileSync(opts.tlsKey) }, handler)
    : http.createServer(handler);
  server.vault = vault;
  server.state = () => db;
  return server;
}

function emptyState() {
  return {
    settings: { dayStart: '08:00', dayEnd: '17:00', lunchStart: '12:30', lunchEnd: '13:30', retentionYears: 8, autoLockMinutes: 10, nextCaseNo: 1, autoCover: false, autoErase: false, lastRetentionRun: '' },
    users: [], patients: [], goals: [], materials: [], appointments: [], logs: [], assessments: [], referrals: [], documents: [],
    audit: [], messages: [], leave: [], deletionReceipts: [], reminders: [], events: [], packed: {}
  };
}

function initAdmin(opts) {
  const vault = makeVault(opts.data, process.env.THERAPY_DATA_PASSPHRASE || '');
  const db = vault.read('clinic-data.json') || { version: 1, state: emptyState() };
  const email = String(opts.initAdmin.email || '').trim();
  if (!opts.initAdmin.name || !email) throw new Error('Usage: --init-admin "Full name" email');
  if (db.state.users.some((u) => (u.email || '').toLowerCase() === email.toLowerCase())) throw new Error('Someone already uses ' + email);
  const pass = tempPassword();
  db.state.users.push(Object.assign({ id: L.uid('use'), name: opts.initAdmin.name, email: email, role: 'supervisor', mustChange: true }, hashPassword(pass)));
  db.version++;
  vault.write('clinic-data.json', db);
  console.log('Created supervisor ' + opts.initAdmin.name + ' <' + email + '>\nTemporary password: ' + pass + '\nThey choose their own password at first sign-in.');
}

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv); } catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(2); }
  if (opts.help) { console.log(HELP); process.exit(0); }
  try {
    if (opts.initAdmin) { initAdmin(opts); process.exit(0); }
    const server = createServer(opts);
    server.listen(opts.port, opts.host, () => {
      const proto = opts.tlsCert ? 'https' : 'http';
      console.log('Therapy Planner clinic server ' + PKG.version + ' – ' + proto + '://' + (opts.host === '0.0.0.0' ? 'localhost' : opts.host) + ':' + opts.port);
      console.log('Data folder: ' + opts.data + (process.env.THERAPY_DATA_PASSPHRASE ? ' (encrypted)' : ' (NOT encrypted: set THERAPY_DATA_PASSPHRASE, and use full-disk encryption)'));
      if (!opts.tlsCert) console.log('No HTTPS: use only inside a VPN such as Tailscale/WireGuard, which encrypts the traffic. See docs/SERVER-SETUP.md.');
      if (!server.state().state.users.length) console.log('No accounts yet. Stop the server and run: node server/server.js --init-admin "Your name" you@clinic.example');
    });
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { createServer: createServer, parseArgs: parseArgs, hashPassword: hashPassword };

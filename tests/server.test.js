// Starts the clinic server on a free port with the demo clinic, and talks to it like browsers on different computers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server.js');

function client(base) {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method, headers: Object.assign({ cookie }, body !== undefined ? { 'content-type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-server-'));
  const old = process.env.THERAPY_DATA_PASSPHRASE;
  if (env && env.passphrase) process.env.THERAPY_DATA_PASSPHRASE = env.passphrase; else delete process.env.THERAPY_DATA_PASSPHRASE;
  const server = createServer({ data: dir, demo: true, source: 'https://example.org/src' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const stop = () => new Promise((r) => { server.closeAllConnections(); server.close(r); if (old === undefined) delete process.env.THERAPY_DATA_PASSPHRASE; else process.env.THERAPY_DATA_PASSPHRASE = old; });
  return { dir, base, stop, server };
}

test('serves the app marked as server mode, and never the data folder', async () => {
  const s = await start();
  try {
    const c = client(s.base);
    const page = await c('GET', '');
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /<meta name="therapy-server" content="1">/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual((await c('GET', 'clinic-data/clinic-data.json')).status, 404);
    assert.strictEqual((await c('GET', 'server/server.js')).status, 404);
    assert.strictEqual((await c('GET', 'js/../server/server.js')).status, 404);
    assert.strictEqual((await c('GET', 'LICENSE')).status, 200);
    const info = (await c('GET', 'api/info')).body;
    assert.strictEqual(info.license, 'AGPL-3.0-or-later');
    assert.strictEqual(info.source, 'https://example.org/src');
    assert.strictEqual((await c('GET', 'api/state')).status, 401);
  } finally { await s.stop(); }
});

test('each person gets only what their role may see; changes reach colleagues', async () => {
  const s = await start();
  try {
    const sup = client(s.base), stu = client(s.base);
    assert.strictEqual((await stu('POST', 'api/login', { login: 'ana@uni.example', password: 'wrong' })).status, 401);
    const demo = (await sup('GET', 'api/info')).body.demoAccounts;
    const student = demo.find((u) => u.role === 'student');
    assert.strictEqual((await stu('POST', 'api/login', { login: student.login, password: 'demo1234' })).status, 200);
    assert.strictEqual((await sup('POST', 'api/login', { login: 'priya@clinic.example', password: 'demo1234' })).status, 200);

    const full = (await sup('GET', 'api/state')).body;
    const mine = (await stu('GET', 'api/state')).body;
    assert.ok(full.keys !== null && mine.keys === null);
    assert.ok(mine.state.patients.length < full.state.patients.length);
    assert.ok(mine.state.patients.every((p) => p.assignedTo === mine.me || mine.state.appointments.some((a) => a.patientId === p.id)));
    assert.ok(mine.state.users.every((u) => !('pwHash' in u)));
    assert.deepStrictEqual(mine.state.audit, []);
    const stubs = mine.state.appointments.filter((a) => a.busy);
    assert.ok(stubs.length > 0 && stubs.every((a) => !a.patientId && a.clinicianId !== undefined));

    // The student adds a goal to their own case, and tries one on someone else's.
    const own = mine.state.patients.find((p) => p.assignedTo === mine.me);
    const other = full.state.patients.find((p) => !mine.state.patients.some((q) => q.id === p.id));
    const r = await stu('POST', 'api/changes', { ops: [
      { c: 'goals', id: 'g_new', v: { id: 'g_new', patientId: own.id, title: 'From the student laptop' } },
      { c: 'goals', id: 'g_bad', v: { id: 'g_bad', patientId: other.id, title: 'Not allowed' } }
    ] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.applied, 1);
    assert.strictEqual(r.body.rejected.length, 1);
    assert.strictEqual(r.body.version, full.version + 1);
    const after = (await sup('GET', 'api/state')).body;
    assert.ok(after.state.goals.some((g) => g.id === 'g_new'));
    assert.ok(!after.state.goals.some((g) => g.id === 'g_bad'));

    // Cross-site and non-JSON requests are refused.
    assert.strictEqual((await fetch(s.base + 'api/changes', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);

    // The access log records who did what, without patient names.
    const log = fs.readFileSync(path.join(s.dir, 'access.log'), 'utf8');
    assert.match(log, /Changed records/);
    assert.ok(!log.includes(own.name));
  } finally { await s.stop(); }
});

test('passwords: set at first sign-in, reset by a supervisor, never readable', async () => {
  const s = await start();
  try {
    const sup = client(s.base), sam = client(s.base);
    await sup('POST', 'api/login', { login: 'priya@clinic.example', password: 'demo1234' });
    const ops = [{ c: 'users', id: 'u_x', v: { id: 'u_x', name: 'Ravi', email: 'ravi@clinic.example', role: 'therapist' } }];
    assert.strictEqual((await sup('POST', 'api/changes', { ops })).body.applied, 1);
    assert.strictEqual((await sup('POST', 'api/password', { userId: 'u_x', password: 'temp-pass-1', mustChange: true })).status, 200);
    const login = await sam('POST', 'api/login', { login: 'ravi@clinic.example', password: 'temp-pass-1' });
    assert.strictEqual(login.body.user.mustChange, true);
    assert.strictEqual((await sam('POST', 'api/changes', { ops: [] })).status, 403);
    assert.strictEqual((await sam('POST', 'api/password', { userId: 'u_sup', password: 'hijack-123' })).status, 403);
    assert.strictEqual((await sam('POST', 'api/password', { userId: 'u_x', password: 'my-own-pass' })).status, 200);
    const me = (await sam('GET', 'api/state')).body.state.users.find((u) => u.id === 'u_x');
    assert.strictEqual(me.mustChange, false);
    assert.strictEqual(me.pwHash, undefined);
    // After five wrong passwords the account is held for a few minutes.
    const x = client(s.base);
    for (let i = 0; i < 5; i++) await x('POST', 'api/login', { login: 'ravi@clinic.example', password: 'nope' });
    assert.strictEqual((await x('POST', 'api/login', { login: 'ravi@clinic.example', password: 'my-own-pass' })).status, 429);
  } finally { await s.stop(); }
});

test('with a passphrase the data files on disk are encrypted, and erasure removes the patient key', async () => {
  const s = await start({ passphrase: 'correct horse battery staple' });
  try {
    const raw = fs.readFileSync(path.join(s.dir, 'clinic-data.json'), 'utf8');
    assert.match(raw, /"enc":true/);
    assert.ok(!raw.includes('Priya'));
    const sup = client(s.base);
    await sup('POST', 'api/login', { login: 'priya@clinic.example', password: 'demo1234' });
    const st = (await sup('GET', 'api/state')).body.state;
    const pid = st.patients[0].id;
    await sup('PUT', 'api/keys', { keys: { [pid]: 'a2V5', other: 'b3RoZXI=' } });
    assert.strictEqual((await sup('POST', 'api/changes', { ops: [{ c: 'patients', id: pid, del: true }] })).body.applied, 1);
    const keys = (await sup('GET', 'api/state')).body.keys;
    assert.deepStrictEqual(Object.keys(keys), ['other']);
    assert.match(fs.readFileSync(path.join(s.dir, 'patient-keys.json'), 'utf8'), /"enc":true/);
  } finally { await s.stop(); }
});

test('a real clinic server: no sign-in without a password, no patients until the data is encrypted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-server-'));
  delete process.env.THERAPY_DATA_PASSPHRASE;
  const { hashPassword } = require('../server/server.js');
  const server = createServer({ data: dir, demo: false });
  server.state().state.users.push(Object.assign({ id: 'u_a', name: 'Meenakshi', email: 'm@clinic.in', role: 'supervisor' }, hashPassword('a-good-password')),
    { id: 'u_b', name: 'No Password', email: 'np@clinic.in', role: 'therapist' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const c = client('http://127.0.0.1:' + server.address().port + '/');
  try {
    assert.strictEqual((await c('POST', 'api/login', { login: 'np@clinic.in', password: '' })).status, 401);
    assert.strictEqual((await c('GET', 'api/info')).body.demo, false);
    assert.strictEqual((await c('POST', 'api/login', { login: 'm@clinic.in', password: 'a-good-password' })).status, 200);
    const r = await c('POST', 'api/changes', { ops: [{ c: 'patients', id: 'p1', v: { id: 'p1', name: 'Real Person', status: 'waiting' } }, { c: 'materials', id: 'm1', v: { id: 'm1', name: 'Mirror' } }] });
    assert.strictEqual(r.body.applied, 1);
    assert.match(r.body.rejected[0].reason, /THERAPY_DATA_PASSPHRASE/);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});

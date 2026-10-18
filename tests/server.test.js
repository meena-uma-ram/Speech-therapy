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

test('files on the clinic server: encrypted on disk, need-to-know, removed when deleted or erased', async () => {
  const s = await start({ passphrase: 'file passphrase 123' });
  try {
    const sup = client(s.base), stu = client(s.base);
    await sup('POST', 'api/login', { login: 'priya@clinic.example', password: 'demo1234' });
    const demo = (await sup('GET', 'api/info')).body.demoAccounts;
    await stu('POST', 'api/login', { login: demo.find((u) => u.role === 'student').login, password: 'demo1234' });
    const full = (await sup('GET', 'api/state')).body.state;
    const mine = (await stu('GET', 'api/state')).body;
    const own = mine.state.patients.find((p) => p.assignedTo === mine.me);
    const other = full.patients.find((p) => !mine.state.patients.some((q) => q.id === p.id));
    const put = (who, id, type, body, hdr) => fetch(s.base + 'api/files/' + id, { method: 'PUT', headers: Object.assign({ 'content-type': type, cookie: who.cookie }, hdr === false ? {} : { 'x-tjs-upload': '1' }), body });
    // the client helper keeps its cookie private; log in again with fetch to get one
    const login = async (l) => (await fetch(s.base + 'api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: 'demo1234' }) })).headers.get('set-cookie').split(';')[0];
    const supC = { cookie: await login('priya@clinic.example') };
    assert.strictEqual((await put(supC, 'fil_abc123', 'application/pdf', '%PDF-1.4 secret report', false)).status, 415);
    assert.strictEqual((await put(supC, 'fil_abc123', 'text/html', '<script>', true)).status, 415);
    assert.strictEqual((await put(supC, 'fil_abc123', 'application/pdf', '%PDF-1.4 secret report')).status, 200);
    assert.strictEqual((await put(supC, 'fil_abc123', 'application/pdf', 'again')).status, 409);
    const raw = fs.readFileSync(path.join(s.dir, 'files', 'fil_abc123.bin'));
    assert.ok(!raw.includes('secret report') && raw.subarray(0, 5).toString() === 'TJSF1');
    const meta = { id: 'fil_abc123', patientId: other.id, name: 'report.pdf', type: 'application/pdf', size: 22, addedBy: 'u_sup', addedAt: new Date().toISOString(), category: 'Scanned report', source: 'upload' };
    assert.strictEqual((await sup('POST', 'api/changes', { ops: [{ c: 'attachments', id: meta.id, v: meta }] })).body.applied, 1);
    const got = await fetch(s.base + 'api/files/fil_abc123', { headers: { cookie: supC.cookie } });
    assert.strictEqual(got.status, 200);
    assert.strictEqual(await got.text(), '%PDF-1.4 secret report');
    assert.strictEqual(got.headers.get('content-disposition'), 'attachment');
    const stuC = { cookie: await login(demo.find((u) => u.role === 'student').login) };
    assert.strictEqual((await fetch(s.base + 'api/files/fil_abc123', { headers: { cookie: stuC.cookie } })).status, 404, 'student cannot open another clinician\'s patient file');
    assert.ok(!(await stu('GET', 'api/state')).body.state.attachments.some((a) => a.id === 'fil_abc123'));
    // a student's own unfiled upload: only they (and supervisors) see it, and only they can file it to their case
    assert.strictEqual((await put(stuC, 'fil_stu001', 'image/jpeg', 'jpegbytes')).status, 200);
    const unf = { id: 'fil_stu001', patientId: null, name: 'IMG.jpg', type: 'image/jpeg', size: 9, addedBy: mine.me, addedAt: new Date().toISOString(), category: 'Other', source: 'share' };
    assert.strictEqual((await stu('POST', 'api/changes', { ops: [{ c: 'attachments', id: unf.id, v: unf }] })).body.applied, 1);
    assert.strictEqual((await stu('POST', 'api/changes', { ops: [{ c: 'attachments', id: unf.id, v: Object.assign({}, unf, { patientId: own.id }) }] })).body.applied, 1);
    // deleting the record removes the stored file; erasing the patient removes theirs
    assert.strictEqual((await sup('POST', 'api/changes', { ops: [{ c: 'attachments', id: meta.id, del: true }] })).body.applied, 1);
    assert.ok(!fs.existsSync(path.join(s.dir, 'files', 'fil_abc123.bin')));
    assert.strictEqual((await sup('POST', 'api/changes', { ops: [{ c: 'patients', id: own.id, del: true }, { c: 'attachments', id: unf.id, del: true }] })).body.applied, 2);
    assert.ok(!fs.existsSync(path.join(s.dir, 'files', 'fil_stu001.bin')));
  } finally { await s.stop(); }
});

// Runs the browser store in a sandbox (Node's WebCrypto, an in-memory localStorage) to check the security fixes end to end.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function boot(ws, mem) {
  mem = mem || {};
  mem['tjs-workspace'] = ws;
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }, key: () => null, length: 0 };
  const win = { localStorage: storage, sessionStorage: storage, document: { querySelector: () => null }, crypto: require('crypto').webcrypto, location: { reload() {} } };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { TextEncoder, TextDecoder, btoa, atob, console, Blob }));
  ['js/logic.js', 'js/sync.js', 'js/consent.js', 'js/store.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  return { S: ctx.Store, mem };
}

test('the clinic workspace starts empty; the demo is full and separate', () => {
  const clinic = boot('clinic');
  assert.strictEqual(clinic.S.state.users.length, 0);
  assert.strictEqual(clinic.S.isDemo(), false);
  const demo = boot('demo', clinic.mem);
  assert.ok(demo.S.state.users.length > 0 && demo.S.state.patients.length > 0);
  assert.ok(demo.S.state.consents.length > 0);
  demo.S.save();
  assert.ok(Object.keys(demo.mem).some((k) => k.endsWith('-demo')));
  assert.ok(!('speech-therapy-planner-v1' in demo.mem), 'demo data never lands in the clinic key');
});

test('no password-less sign-in; first supervisor; clean start removes every account', async () => {
  const { S } = boot('clinic');
  await S.createFirstSupervisor('Meenakshi Ramesh', 'm@clinic.in', 'a-long-password', 'Real Clinic');
  S.upsert('users', { id: 'u_np', name: 'No Password', email: 'np@clinic.in', role: 'therapist' });
  S.signOut();
  await assert.rejects(S.signIn('np@clinic.in', ''), /no password yet/);
  await S.signIn('m@clinic.in', 'a-long-password');
  await S.cleanStart();
  assert.strictEqual(S.state.users.length, 0);
  assert.strictEqual(S.currentUser(), null);
});

test('encrypted backup; erased patients never come back; old key files refused; audit keeps the case code', async () => {
  const { S } = boot('demo');
  await S.signIn('priya@clinic.example', 'demo1234');
  const p = S.patient('p_ava'), code = p.caseCode;
  S.audit('Opened patient record', 'p_ava', 'Ava Thompson notes');
  const backup = await S.exportBackup('backup-password-1');
  assert.ok(!backup.includes('Ava Thompson') && !backup.includes('Dr. Priya Nair') && !backup.includes(code));
  await assert.rejects(S.importBackup(backup), /backup password/);
  await assert.rejects(S.importBackup(backup, 'wrong-password'), /not correct/);
  const oldKeys = S.exportKeyFile();
  const receipt = S.erasePatient('p_ava', 'Erasure request');
  assert.match(receipt.keyDestroyed, /key file/);
  assert.ok(S.state.audit.some((e) => e.target === code && e.erased && !e.patientId && !/Ava Thompson/.test(e.detail)));
  await assert.rejects(S.importBackup(oldKeys), /older than the latest erasure/);
  const r = await S.importBackup(backup, 'backup-password-1');
  assert.ok(!S.patient('p_ava'));
  assert.ok(r.shredded.includes(code));
  // A plain (old-format) export with the erased patient in it doesn't bring them back either.
  const legacy = JSON.stringify(Object.assign({}, JSON.parse(S.exportJSON()), { patients: S.state.patients.concat([Object.assign({}, p)]) }));
  await S.importJSON(legacy);
  assert.ok(!S.patient('p_ava'));
});

test('fake patients only in the demo, at every stage, with consent', async () => {
  const { S } = boot('demo');
  await S.signIn('priya@clinic.example', 'demo1234');
  const made = S.generateFake(6);
  assert.deepStrictEqual([...new Set(made.map((p) => p.status))].sort(), ['active', 'discharged', 'referred', 'waiting']);
  assert.ok(made.filter((p) => p.status !== 'waiting').every((p) => p.consent.ledger));
  const clinic = boot('clinic');
  assert.throws(() => clinic.S.generateFake(1), /only be added to the demo/);
});

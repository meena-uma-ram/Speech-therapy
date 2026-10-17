const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const C = require('../js/consent.js');
const Sync = require('../js/sync.js');

const giver = { name: 'Lakshmi Iyer', relationship: 'parent' };
const all = (action) => C.PURPOSES.map((p) => ({ purpose: p.id, action }));

test('sha256 matches Node for ASCII, Indian scripts and emoji', () => {
  for (const s of ['', 'abc', 'தமிழ் हिन्दी മലയാളം ಕನ್ನಡ', '😀'.repeat(40), 'x'.repeat(1000)]) {
    assert.strictEqual(C.sha256(s), crypto.createHash('sha256').update(s).digest('hex'));
  }
});

test('ledger: entries chain, current status folds in order, flags follow it', () => {
  const L = [];
  L.push(C.makeEntry(L, { patientId: 'p', decisions: all('grant'), giver, recordedBy: 'u', method: 'signature', evidence: { signature: 'data:image/png;base64,AAAA' } }));
  L.push(C.makeEntry(L, { patientId: 'p', decisions: [{ purpose: 'students', action: 'withdraw' }], giver, recordedBy: 'u', method: 'phone' }));
  assert.strictEqual(L[1].prev, L[0].hash);
  assert.strictEqual(L[1].seq, 2);
  assert.deepStrictEqual(C.verify(L, 'p'), { ok: true, problems: [], count: 2 });
  const f = C.flags(L, 'p');
  assert.strictEqual(f.therapy, true);
  assert.strictEqual(f.students, false);
  assert.strictEqual(C.current(L, 'p').students.action, 'withdraw');
});

test('ledger: any later change to an entry or its evidence shows up', () => {
  const L = [];
  L.push(C.makeEntry(L, { patientId: 'p', decisions: all('refuse'), giver, recordedBy: 'u', method: 'paper', evidence: { scan: 'data:image/jpeg;base64,BBBB' } }));
  L.push(C.makeEntry(L, { patientId: 'p', decisions: all('grant'), giver, recordedBy: 'u', method: 'signature' }));
  const a = JSON.parse(JSON.stringify(L)); a[0].decisions[0].action = 'grant';
  assert.match(C.verify(a, 'p').problems[0], /changed after it was sealed/);
  const b = JSON.parse(JSON.stringify(L)); b[0].evidence.scan = 'data:image/jpeg;base64,CCCC';
  assert.match(C.verify(b, 'p').problems.join(), /Evidence "scan"/);
  const c = JSON.parse(JSON.stringify(L)); c.splice(0, 1);
  assert.ok(!C.verify(c, 'p').ok);
});

test('re-consent triggers: none, turned 18, guardian changed, new purpose, legacy', () => {
  const p = { id: 'p', dob: '2008-01-01', guardian: 'Lakshmi Iyer' };
  assert.deepStrictEqual(C.reviewNeeded(p, [], '2026-01-01').map((r) => r.code), ['none']);
  const L = [C.makeEntry([], { patientId: 'p', decisions: all('grant'), giver, recordedBy: 'u', method: 'signature' })];
  assert.deepStrictEqual(C.reviewNeeded(p, L, '2025-12-31'), []);
  assert.deepStrictEqual(C.reviewNeeded(p, L, '2026-01-01').map((r) => r.code), ['adult']);
  assert.deepStrictEqual(C.reviewNeeded(Object.assign({}, p, { guardian: 'Ravi Iyer' }), L, '2025-06-01').map((r) => r.code), ['guardian']);
  const partial = [C.makeEntry([], { patientId: 'p', decisions: [{ purpose: 'treatment', action: 'grant' }], giver, recordedBy: '', method: 'legacy' })];
  const codes = C.reviewNeeded(p, partial, '2025-06-01').map((r) => r.code);
  assert.ok(codes.includes('legacy') && codes.filter((c) => c === 'purpose').length === C.PURPOSES.length - 1);
});

test('notices: every language covers every purpose; missing text falls back to English', () => {
  Object.keys(C.LANGUAGES).forEach((lang) => {
    const n = C.notice(lang, null, { clinic: 'Bright Steps', years: 8, contact: 'x' });
    assert.strictEqual(n.lang, lang);
    C.PURPOSES.forEach((p) => { assert.ok(n.purposes[p.id].label && n.purposes[p.id].text && n.purposes[p.id].simple, lang + ' ' + p.id); });
    assert.ok(!/\{(clinic|years)\}/.test(n.intro + n.purposes.records.text));
  });
  assert.strictEqual(C.notice('fr').lang, 'en');
  assert.strictEqual(C.notice('ta').status, 'draft-translation');
});

test('server rules: the consent ledger is append-only', () => {
  const s = { settings: {}, users: [{ id: 't', role: 'therapist' }, { id: 's', role: 'supervisor' }], patients: [{ id: 'p', assignedTo: 't' }], appointments: [], consents: [] };
  const e = C.makeEntry([], { patientId: 'p', decisions: all('grant'), giver, recordedBy: 't', method: 'signature' });
  assert.strictEqual(Sync.applyFrom(s.users[0], s, [{ c: 'consents', id: e.id, v: e }]).applied, 1);
  const changed = Object.assign({}, e, { decisions: all('refuse') });
  assert.strictEqual(Sync.applyFrom(s.users[0], s, [{ c: 'consents', id: e.id, v: changed }]).rejected.length, 1);
  assert.strictEqual(Sync.applyFrom(s.users[1], s, [{ c: 'consents', id: e.id, v: changed }]).rejected.length, 1);
  assert.strictEqual(Sync.applyFrom(s.users[0], s, [{ c: 'consents', id: e.id, del: true }]).rejected.length, 1);
  assert.strictEqual(Sync.applyFrom(s.users[1], s, [{ c: 'consents', id: e.id, del: true }]).applied, 1);
});

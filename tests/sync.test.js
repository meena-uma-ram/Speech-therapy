const test = require('node:test');
const assert = require('node:assert');
const Sync = require('../js/sync.js');
const L = require('../js/logic.js');

function clinic() {
  return {
    settings: { dayStart: '08:00', nextCaseNo: 3, hideNames: false, currentUserId: 'u_sup' },
    users: [
      { id: 'u_sup', name: 'Priya', role: 'supervisor', pwHash: 'h1', pwSalt: 's1' },
      { id: 'u_ther', name: 'Sam', role: 'therapist', pwHash: 'h2', pwSalt: 's2' },
      { id: 'u_stu', name: 'Asha', role: 'student', pwHash: 'h3', pwSalt: 's3' }
    ],
    patients: [{ id: 'p1', name: 'Ava Brown', assignedTo: 'u_ther', status: 'active' }, { id: 'p2', name: 'Leo King', assignedTo: 'u_stu', status: 'active' }],
    goals: [{ id: 'g1', patientId: 'p1' }, { id: 'g2', patientId: 'p2' }],
    appointments: [
      { id: 'a1', patientId: 'p1', date: '2026-10-19', time: '09:00', duration: 30, status: 'scheduled', observers: [] },
      { id: 'a2', patientId: 'p2', date: '2026-10-19', time: '10:00', duration: 45, status: 'scheduled', observers: [{ userId: 'u_ther', role: 'Observe', status: 'invited' }] }
    ],
    messages: [{ id: 'm1', to: 'u_ther', from: 'u_sup' }, { id: 'm2', to: 'u_stu', from: 'u_sup' }],
    leave: [{ id: 'l1', userId: 'u_ther', from: '2026-10-20', to: '2026-10-21', reason: 'Sick leave', status: 'requested' }],
    events: [{ id: 'e1', title: 'Case conference', date: '2026-10-19', time: '13:30', duration: 60, attendees: ['u_sup', 'u_ther'], createdBy: 'u_sup' }],
    audit: [{ id: 'au1', action: 'Opened' }],
    deletionReceipts: [{ id: 'dr1' }],
    materials: [{ id: 'mat1', name: 'Mirror' }],
    logs: [], assessments: [], referrals: [], documents: [], reminders: [],
    packed: { '2026-10-19': { mat1: true } }
  };
}
const user = (s, id) => s.users.find((u) => u.id === id);

test('diff finds upserts, deletes and map keys, and skips per-device settings', () => {
  const a = clinic(), b = Sync.clone(a);
  b.goals[0].title = 'New';
  b.goals.splice(1, 1);
  b.materials.push({ id: 'mat2', name: 'Cards' });
  b.settings.dayStart = '08:30';
  b.settings.hideNames = true;
  b.settings.currentUserId = 'u_ther';
  delete b.packed['2026-10-19'];
  const ops = Sync.diff(a, b);
  assert.deepStrictEqual(ops.map((o) => [o.c, o.id || o.k, o.del ? 'del' : 'set']).sort(), [
    ['goals', 'g1', 'set'], ['goals', 'g2', 'del'], ['materials', 'mat2', 'set'], ['packed', '2026-10-19', 'del'], ['settings', 'dayStart', 'set']
  ].sort());
  const c = Sync.apply(Sync.clone(a), ops);
  assert.strictEqual(c.goals.length, 1);
  assert.strictEqual(c.goals[0].title, 'New');
  assert.strictEqual(c.settings.dayStart, '08:30');
  assert.strictEqual(c.settings.hideNames, false);
  assert.deepStrictEqual(Sync.diff(c, Sync.apply(Sync.clone(c), [])), []);
});

test('two people editing different records both keep their change', () => {
  const server = clinic();
  const mine = Sync.clone(server), theirs = Sync.clone(server);
  mine.goals[0].title = 'Mine';
  theirs.goals[1].title = 'Theirs';
  Sync.apply(server, Sync.diff(clinic(), mine));
  Sync.apply(server, Sync.diff(clinic(), theirs));
  assert.strictEqual(server.goals[0].title, 'Mine');
  assert.strictEqual(server.goals[1].title, 'Theirs');
});

test('viewFor: therapist sees own patients, invitations, and only stubs of the rest', () => {
  const s = clinic();
  const v = Sync.viewFor(user(s, 'u_ther'), s);
  assert.deepStrictEqual(v.patients.map((p) => p.id), ['p1', 'p2']); // p2 via pending invitation
  assert.ok(v.users.every((u) => !u.pwHash && !u.pwSalt && u.hasPassword));
  assert.deepStrictEqual(v.messages.map((m) => m.id), ['m1']);
  assert.deepStrictEqual(v.audit, []);
  assert.deepStrictEqual(v.deletionReceipts, []);
  const st = Sync.viewFor(user(s, 'u_stu'), s);
  assert.deepStrictEqual(st.patients.map((p) => p.id), ['p2']);
  assert.deepStrictEqual(st.goals.map((g) => g.id), ['g2']);
  const a1 = st.appointments.find((a) => a.id === 'a1');
  assert.strictEqual(a1.busy, true);
  assert.strictEqual(a1.patientId, undefined);
  assert.strictEqual(a1.clinicianId, 'u_ther');
  const l1 = st.leave.find((l) => l.id === 'l1');
  assert.strictEqual(l1.reason, undefined);
  const e1 = st.events.find((e) => e.id === 'e1');
  assert.strictEqual(e1.title, undefined);
  assert.strictEqual(e1.busy, true);
  assert.strictEqual(Sync.viewFor(user(s, 'u_sup'), s).patients.length, 2);
});

test('applyFrom: refuses changes outside your role and applies the rest', () => {
  const s = clinic(), stu = user(s, 'u_stu');
  const r = Sync.applyFrom(stu, s, [
    { c: 'goals', id: 'g2', v: { id: 'g2', patientId: 'p2', title: 'ok' } },
    { c: 'goals', id: 'g1', v: { id: 'g1', patientId: 'p1', title: 'not mine' } },
    { c: 'goals', id: 'g9', v: { id: 'g9', patientId: 'p1' } },
    { c: 'users', id: 'u_stu', v: { id: 'u_stu', name: 'Asha', role: 'supervisor' } },
    { c: 'settings', k: 'dayStart', v: '06:00' },
    { c: 'settings', k: 'nextCaseNo', v: 1 },
    { c: 'audit', id: 'au1', del: true },
    { c: 'audit', id: 'au2', v: { id: 'au2', action: 'Opened', user: 'Someone else' } },
    { c: 'messages', id: 'm9', v: { id: 'm9', to: 'u_sup', from: 'u_sup' } },
    { c: 'leave', id: 'l9', v: { id: 'l9', userId: 'u_stu', from: '2026-11-01', to: '2026-11-01' } },
    { c: 'appointments', id: 'a1', v: { id: 'a1', busy: true } },
    { c: '__proto__', v: {} }
  ]);
  assert.deepStrictEqual(r.rejected.map((x) => x.i), [1, 2, 3, 4, 6, 8, 10, 11]);
  assert.strictEqual(s.goals.find((g) => g.id === 'g2').title, 'ok');
  assert.strictEqual(s.settings.nextCaseNo, 3); // never goes backwards
  assert.strictEqual(s.audit.find((e) => e.id === 'au2').user, 'Asha'); // stamped by the server
  assert.strictEqual(user(s, 'u_stu').role, 'student');
});

test('applyFrom: supervisors cannot overwrite password hashes or delete themselves', () => {
  const s = clinic(), sup = user(s, 'u_sup');
  const r = Sync.applyFrom(sup, s, [
    { c: 'users', id: 'u_ther', v: { id: 'u_ther', name: 'Sam O', role: 'therapist', pwHash: 'evil' } },
    { c: 'users', id: 'u_new', v: { id: 'u_new', name: 'New', role: 'student', pwHash: 'h9', pwSalt: 's9' } },
    { c: 'users', id: 'u_sup', del: true },
    { c: 'patients', id: 'p1', del: true }
  ]);
  assert.deepStrictEqual(r.rejected.map((x) => x.i), [2]);
  assert.strictEqual(user(s, 'u_ther').pwHash, 'h2');
  assert.strictEqual(user(s, 'u_ther').name, 'Sam O');
  assert.strictEqual(user(s, 'u_new').pwHash, 'h9');
  assert.deepStrictEqual(r.erased, ['p1']);
});

test('events: only the organiser changes them', () => {
  const s = clinic();
  const r = Sync.applyFrom(user(s, 'u_ther'), s, [
    { c: 'events', id: 'e1', v: Object.assign({}, s.events[0], { title: 'Renamed' }) },
    { c: 'events', id: 'e2', v: { id: 'e2', title: 'Supervision', date: '2026-10-19', time: '15:00', duration: 30, attendees: ['u_ther', 'u_stu'], createdBy: 'u_ther' } }
  ]);
  assert.deepStrictEqual(r.rejected.map((x) => x.i), [0]);
  assert.strictEqual(s.events.length, 2);
});

test('freeSlots finds common gaps around sessions and lunch', () => {
  const busy = [{ start: 540, end: 600 }, { start: 570, end: 660 }, { start: 900, end: 930 }];
  assert.deepStrictEqual(L.freeSlots(busy, '08:00', '17:00', 30, { start: '12:30', end: '13:30' }),
    [{ start: 480, end: 540 }, { start: 660, end: 750 }, { start: 810, end: 900 }, { start: 930, end: 1020 }]);
  assert.deepStrictEqual(L.freeSlots([{ start: 480, end: 1020 }], '08:00', '17:00', 30), []);
  assert.strictEqual(L.weekStart('2026-10-17'), '2026-10-12');
  assert.strictEqual(L.weekStart('2026-10-12'), '2026-10-12');
});

const test = require('node:test');
const assert = require('node:assert');
const L = require('../js/logic.js');

test('accuracy rounds and handles empty trials', () => {
  assert.strictEqual(L.accuracy(7, 10), 70);
  assert.strictEqual(L.accuracy(2, 3), 67);
  assert.strictEqual(L.accuracy(5, 0), null);
  assert.strictEqual(L.accuracy(12, 10), 100);
});

test('addDays crosses month boundaries', () => {
  assert.strictEqual(L.addDays('2026-01-31', 1), '2026-02-01');
  assert.strictEqual(L.addDays('2026-03-01', -1), '2026-02-28');
});

test('goalSeries sorts by date and goalStats detects trend', () => {
  const logs = [
    { date: '2026-02-03', entries: [{ goalId: 'g', trials: 10, correct: 8 }] },
    { date: '2026-01-01', entries: [{ goalId: 'g', accuracy: 40 }, { goalId: 'other', accuracy: 99 }] },
    { date: '2026-01-15', entries: [{ goalId: 'g', accuracy: 60 }] }
  ];
  const s = L.goalSeries('g', logs);
  assert.deepStrictEqual(s.map(p => p.accuracy), [40, 60, 80]);
  const st = L.goalStats(s, 80);
  assert.strictEqual(st.latest, 80);
  assert.strictEqual(st.average, 60);
  assert.strictEqual(st.trend, 'up');
  assert.strictEqual(st.metTarget, true);
});

test('materialsForDay finds materials shared across sessions, skipping cancelled', () => {
  const goals = { g1: { materialIds: ['cards', 'mirror'] }, g2: { materialIds: ['cards'] }, g3: { materialIds: ['bubbles'] } };
  const mats = { cards: { id: 'cards', name: 'Cards' }, mirror: { id: 'mirror', name: 'Mirror' }, bubbles: { id: 'bubbles', name: 'Bubbles' } };
  const pats = { a: { name: 'A' }, b: { name: 'B' } };
  const appts = [
    { patientId: 'a', goalIds: ['g1', 'g2'] },             // cards counted once for this session
    { patientId: 'b', goalIds: ['g2'], extraMaterialIds: ['mirror'] },
    { patientId: 'b', goalIds: ['g3'], status: 'cancelled' }
  ];
  const out = L.materialsForDay(appts, goals, mats, pats);
  assert.deepStrictEqual(out.map(x => [x.material.id, x.count]), [['cards', 2], ['mirror', 2]]);
});

test('clientReport includes goals, accuracy, notes and home practice', () => {
  const text = L.clientReport({
    patient: { name: 'Ava Thompson', guardian: 'Ms. Thompson' },
    log: { date: '2026-10-16', entries: [{ goalId: 'g', trials: 20, correct: 15, cueing: 'Minimal', progress: 'improving' }], notes: 'Great focus.', homework: 'Practise /s/ words.' },
    goalsById: { g: { title: '/s/ initial' } },
    therapist: 'Jo'
  });
  assert.match(text, /Hello Ms\. Thompson/);
  assert.match(text, /\/s\/ initial: 75% accuracy, 15 of 20 attempts, minimal cues \(Improving\)/);
  assert.match(text, /Practise \/s\/ words\./);
  assert.match(text, /Jo$/);
});

test('layoutDay puts overlapping sessions in lanes and widens the day range', () => {
  const out = L.layoutDay([
    { id: 'a', time: '09:00', duration: 30 },
    { id: 'b', time: '09:00', duration: 45 },
    { id: 'c', time: '09:30', duration: 30 },   // fits in lane 0 after a
    { id: 'd', time: '11:00', duration: 30 },   // separate cluster
    { id: 'e', time: '17:30', duration: 30 }
  ], '08:00', '17:00');
  const by = Object.fromEntries(out.blocks.map(b => [b.appt.id, [b.lane, b.lanes]]));
  assert.deepStrictEqual(by, { a: [1, 2], b: [0, 2], c: [1, 2], d: [0, 1], e: [0, 1] });
  assert.strictEqual(out.start, 8 * 60);
  assert.strictEqual(out.end, 18 * 60);
});

test('splitByLunch divides by start time', () => {
  const r = L.splitByLunch([{ time: '11:30' }, { time: '12:00' }, { time: '14:00' }], '12:00');
  assert.strictEqual(r.morning.length, 1);
  assert.strictEqual(r.afternoon.length, 2);
});

test('case labels and condition families', () => {
  assert.strictEqual(L.caseLabel({ ageGroup: 'Child', condition: 'CLP' }), 'Child · CLP');
  assert.strictEqual(L.caseLabel({ dob: '1950-01-01', condition: 'Stroke – aphasia' }), 'Adult · Stroke – aphasia');
  assert.strictEqual(L.conditionFamily('Stroke – aphasia'), 'language');
  assert.strictEqual(L.conditionFamily('CLP'), 'speech');
  assert.strictEqual(L.conditionFamily('Dysphagia'), 'swallow');
  assert.strictEqual(L.conditionFamily('Something new'), 'other');
});

test('report addresses adults without a guardian directly', () => {
  const text = L.clientReport({ patient: { name: 'Robert Hughes', ageGroup: 'Adult' }, log: { date: '2026-10-16', entries: [] }, goalsById: {} });
  assert.match(text, /^Hello Robert,$/m);
  assert.match(text, /summary of your speech therapy session/);
});

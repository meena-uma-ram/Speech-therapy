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

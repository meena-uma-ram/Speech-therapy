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

test('initials and case codes pseudonymise patients', () => {
  assert.strictEqual(L.initials('Robert  Hughes'), 'R.H.');
  assert.strictEqual(L.caseCode(2026, 7), 'SLT-26-007');
});

test('need-to-know access by role', () => {
  const student = { id: 's1', role: 'student' }, ther = { id: 't1', role: 'therapist' }, diag = { id: 'd1', role: 'diagnostician' };
  const mine = { assignedTo: 's1', status: 'active' }, other = { assignedTo: 's2', status: 'active' }, referred = { status: 'referred' };
  assert.strictEqual(L.canSeePatient(student, mine), true);
  assert.strictEqual(L.canSeePatient(student, other), false);
  assert.strictEqual(L.canSeePatient(student, referred), false);
  assert.strictEqual(L.canSeePatient(ther, referred), false);
  assert.strictEqual(L.canSeePatient(ther, { id: 'px', assignedTo: 's2' }, { px: true }), true);
  assert.strictEqual(L.canSeePatient(ther, other), false);
  assert.strictEqual(L.canSeePatient(diag, other), false);
  assert.strictEqual(L.canSeePatient(diag, { assessedBy: 'd1', status: 'active' }), true);
  assert.strictEqual(L.canSeePatient(diag, referred), false);
  assert.strictEqual(L.canSeePatient({ role: 'supervisor' }, other), true);
});

test('allotment respects consent', () => {
  const student = { role: 'student' }, ther = { role: 'therapist' };
  assert.strictEqual(L.canAllot({ consent: { therapy: true, students: false } }, student).ok, false);
  assert.strictEqual(L.canAllot({ consent: { therapy: true, students: false } }, ther).ok, true);
  assert.strictEqual(L.canAllot({ consent: {} }, ther).ok, false);
});

test('retention period after discharge', () => {
  assert.strictEqual(L.isPastRetention({ status: 'discharged', dischargedAt: '2018-03-01' }, 8, '2026-03-01'), true);
  assert.strictEqual(L.isPastRetention({ status: 'discharged', dischargedAt: '2018-03-02' }, 8, '2026-03-01'), false);
  assert.strictEqual(L.isPastRetention({ status: 'active' }, 0, '2026-03-01'), false);
});

test('session report is pre-filled from the session log', () => {
  const goals = [{ id: 'g', title: '/s/ initial', specific: 'X will say /s/' }];
  const log = { notes: 'Tired today.', homework: '5 words daily', entries: [{ goalId: 'g', trials: 10, correct: 7, cueing: 'Minimal', progress: 'improving' }] };
  const d = L.prefillDoc('session-report', { goals, log });
  assert.strictEqual(d.subjective, 'Tired today.');
  assert.match(d.objective, /\/s\/ initial: 7\/10 \(70%\), minimal cues/);
  assert.match(d.assessment, /improving/);
  assert.match(d.plan, /5 words daily/);
});

test('caseProgress names the next step', () => {
  assert.strictEqual(L.caseProgress([], 0).next, 'Write pre-assessment');
  assert.strictEqual(L.caseProgress([{ type: 'pre-assessment', status: 'approved' }], 2).next, 'Write session report');
  assert.strictEqual(L.caseProgress([{ type: 'pre-assessment', status: 'approved' }, { type: 'lesson-plan', status: 'returned' }], 0).next, 'Revise lesson plan');
});

test('session counts: attended of allotted, missed, rescheduled', () => {
  const c = L.sessionCounts([
    { date: '2026-10-01', status: 'attended' }, { date: '2026-10-08', status: 'completed' },
    { date: '2026-10-15', status: 'missed', reschedules: [{}] }, { date: '2026-10-20', status: 'scheduled' },
    { date: '2026-10-22', status: 'cancelled' }
  ], 12, '2026-10-17');
  assert.deepStrictEqual([c.attended, c.missed, c.cancelled, c.upcoming, c.rescheduled, c.remaining, c.attendanceRate], [2, 1, 1, 1, 1, 10, 67]);
});

test('pickCover chooses a free, allowed clinician with the lightest day', () => {
  const users = [{ id: 'away', role: 'therapist' }, { id: 'busy', role: 'therapist' }, { id: 'free', role: 'therapist' }, { id: 'stu', role: 'student' }, { id: 'sup', role: 'supervisor' }];
  const patientsById = { p1: { id: 'p1', assignedTo: 'away', consent: { students: false } }, p2: { id: 'p2', assignedTo: 'busy' }, p3: { id: 'p3', assignedTo: 'free' } };
  const target = { id: 'x', patientId: 'p1', date: '2026-10-20', time: '10:00', duration: 30 };
  const appts = [target,
    { id: 'y', patientId: 'p2', date: '2026-10-20', time: '10:15', duration: 30 },   // busy overlaps
    { id: 'z', patientId: 'p3', date: '2026-10-20', time: '14:00', duration: 30 }];
  const pick = L.pickCover(target, { users, patientsById, appts, leaves: [], awayId: 'away' });
  assert.strictEqual(pick.id, 'free');   // student excluded: no consent for students
  const none = L.pickCover(target, { users, patientsById, appts, leaves: [{ userId: 'free', from: '2026-10-19', to: '2026-10-21' }], awayId: 'away' });
  assert.strictEqual(none, null);
});

test('backups split into one bundle per patient and merge back', () => {
  const state = {
    settings: { x: 1 }, users: [{ id: 'u' }], materials: [{ id: 'm' }], deletionReceipts: [{ id: 'DR-1' }],
    patients: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    goals: [{ id: 'g1', patientId: 'p1' }, { id: 'g2', patientId: 'p2' }],
    appointments: [{ id: 'a1', patientId: 'p2' }], logs: [], assessments: [], referrals: [], documents: [],
    messages: [{ id: 'm1', patientId: 'p1' }, { id: 'm2' }],
    audit: [{ at: '2', patientId: 'p2' }, { at: '1' }]
  };
  const { shared, bundles } = L.splitForBackup(state);
  assert.deepStrictEqual(Object.keys(bundles), ['p1', 'p2']);
  assert.deepStrictEqual(shared.messages, [{ id: 'm2' }]);          // no patient data in the shared part
  assert.strictEqual(JSON.stringify(shared).includes('"A"'), false);
  assert.deepStrictEqual(bundles.p2.appointments, [{ id: 'a1', patientId: 'p2' }]);
  const all = L.mergeBundles(shared, [bundles.p1, bundles.p2]);
  assert.strictEqual(all.patients.length, 2);
  assert.deepStrictEqual(all.audit.map(e => e.at), ['1', '2']);
  // A shredded patient (key destroyed) simply cannot be merged back.
  const without = L.mergeBundles(shared, [bundles.p1]);
  assert.deepStrictEqual(without.patients.map(p => p.id), ['p1']);
  assert.strictEqual(without.goals.some(g => g.patientId === 'p2'), false);
  assert.deepStrictEqual(without.deletionReceipts, [{ id: 'DR-1' }]);
});

test('reminder channel follows clinic setting, patient choice and opt-in', () => {
  const base = { optIn: true, phone: '+91 98765 43210' };
  const sms = { channel: 'sms' }, wa = { channel: 'whatsapp' }, both = { channel: 'both', defaultChannel: 'whatsapp' };
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'default' } }, sms).channel, 'sms');
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'default' } }, wa).channel, 'whatsapp');
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'default' } }, both).channel, 'whatsapp');
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'sms' } }, both).channel, 'sms');
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'whatsapp' } }, sms).channel, 'sms'); // clinic uses SMS only
  assert.strictEqual(L.reminderChannel({ reminders: { ...base, channel: 'none' } }, both).channel, null);
  assert.strictEqual(L.reminderChannel({ reminders: { phone: '1', channel: 'sms' } }, sms).reason, 'No opt-in recorded');
});

test('reminder templates stay neutral and SMS parts are counted', () => {
  assert.strictEqual(L.fillTemplate('{clinic}: {day} {time}. {link}', { clinic: 'Bright Steps', day: 'Tue 20 Oct', time: '10:30 AM', link: 'x.in/a' }), 'Bright Steps: Tue 20 Oct 10:30 AM. x.in/a');
  assert.deepStrictEqual(L.templateWarnings('Your appointment at {clinic} on {day}'), []);
  assert.strictEqual(L.templateWarnings('Speech therapy for {name}').length, 2);
  assert.deepStrictEqual(L.smsParts('a'.repeat(160)), { chars: 160, unicode: false, parts: 1 });
  assert.strictEqual(L.smsParts('a'.repeat(161)).parts, 2);
  assert.strictEqual(L.smsParts('नमस्ते').unicode, true);
  assert.strictEqual(L.maskPhone('+919876543210'), '+91••••••3210');
});

test('meetingLink keeps only https join links from Zoom, Google Meet and Teams', () => {
  assert.deepStrictEqual(L.meetingLink(' https://us02web.zoom.us/j/123?pwd=ab '), { app: 'zoom', url: 'https://us02web.zoom.us/j/123?pwd=ab' });
  assert.strictEqual(L.meetingLink('https://meet.google.com/abc-defg-hij', 'meet').app, 'meet');
  assert.strictEqual(L.meetingLink('https://teams.microsoft.com/l/meetup-join/19%3a1', 'teams').app, 'teams');
  assert.strictEqual(L.meetingLink('https://meet.google.com/abc-defg-hij', 'zoom'), null, 'link must match the chosen app');
  assert.strictEqual(L.meetingLink('http://zoom.us/j/1'), null);
  assert.strictEqual(L.meetingLink('javascript:alert(1)'), null);
  assert.strictEqual(L.meetingLink('https://zoom.us.evil.com/j/1'), null);
  assert.strictEqual(L.meetingLink('https://evil.com/?meet.google.com'), null);
  assert.strictEqual(L.meetingLink('not a link'), null);
});

test('icsCalendar writes escaped, folded events that end on the next day when needed', () => {
  const ics = L.icsCalendar([{ uid: 'apt_1', date: '2026-10-18', time: '23:45', duration: 30, title: 'Session, SLT-26-001; room 2', url: 'https://meet.google.com/abc-defg-hij', description: 'Line 1\nLine 2' }], new Date(Date.UTC(2026, 9, 1)));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20261018T234500\r\nDTEND:20261019T001500\r\n/);
  assert.match(ics, /\r\nSUMMARY:Session\\, SLT-26-001\\; room 2\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261001T000000Z\r\n/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines folded at 75');
  assert.match(ics.replace(/\r\n /g, ''), /DESCRIPTION:Line 1\\nLine 2\\nJoin: https:\/\/meet.google.com\/abc-defg-hij/);
  assert.match(ics, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
});

test('calendarLinks prefill Google Calendar and Outlook', () => {
  const c = L.calendarLinks({ date: '2026-10-18', time: '09:00', duration: 45, title: 'Supervision', url: 'https://zoom.us/j/9' });
  assert.match(c.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Supervision&dates=20261018T090000\/20261018T094500&/);
  assert.match(c.google, /location=https%3A%2F%2Fzoom\.us%2Fj%2F9/);
  assert.match(c.outlook, /^https:\/\/outlook\.office\.com\/calendar\/0\/deeplink\/compose\?/);
  assert.match(c.outlook, /startdt=2026-10-18T09%3A00%3A00&enddt=2026-10-18T09%3A45%3A00/);
});

test('reminder templates accept {meeting}', () => {
  assert.strictEqual(L.fillTemplate('Join: {meeting}', { meeting: 'https://zoom.us/j/1' }), 'Join: https://zoom.us/j/1');
  assert.deepStrictEqual(L.templateWarnings('{clinic} {day} {time} {meeting}'), []);
  assert.strictEqual(L.templateWarnings('{clinic} {name}').length, 1);
});

test('the author credit (AGPL section 7(b), NOTICE) is on every screen and in both builds', () => {
  const fs = require('fs'), path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('index.html'), /<footer class="credit[^>]*>TJS · Created by Meenakshi Ramesh/);
  assert.match(read('tjs.html'), /Created by Meenakshi Ramesh/, 'rebuild tjs.html after changing index.html');
  assert.match(read('NOTICE'), /section 7\(b\)/);
  assert.match(read('js/app.js'), /Created by Meenakshi Ramesh/);
});

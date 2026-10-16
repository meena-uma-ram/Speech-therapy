/* Local data store. Everything lives in this browser's localStorage; nothing is sent anywhere. */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'speech-therapy-planner-v1';

  const EMPTY = {
    settings: { therapistName: '' },
    patients: [], goals: [], materials: [], appointments: [], logs: [],
    packed: {} // { 'YYYY-MM-DD': { materialId: true } }
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign({}, EMPTY, JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt: fall through to demo data */ }
    return seed();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('Could not save to localStorage', e); }
  }

  function byId(list) {
    const m = {};
    list.forEach(function (x) { m[x.id] = x; });
    return m;
  }

  function upsert(collection, item) {
    const list = state[collection];
    if (!item.id) item.id = L.uid(collection.slice(0, 3));
    const i = list.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) list[i] = item; else list.push(item);
    save();
    return item;
  }

  function remove(collection, id) {
    state[collection] = state[collection].filter(function (x) { return x.id !== id; });
    if (collection === 'patients') {
      state.goals = state.goals.filter(function (g) { return g.patientId !== id; });
      state.appointments = state.appointments.filter(function (a) { return a.patientId !== id; });
      state.logs = state.logs.filter(function (l) { return l.patientId !== id; });
    }
    if (collection === 'goals') {
      state.appointments.forEach(function (a) { a.goalIds = (a.goalIds || []).filter(function (g) { return g !== id; }); });
    }
    if (collection === 'materials') {
      state.goals.forEach(function (g) { g.materialIds = (g.materialIds || []).filter(function (m) { return m !== id; }); });
      state.appointments.forEach(function (a) { a.extraMaterialIds = (a.extraMaterialIds || []).filter(function (m) { return m !== id; }); });
    }
    save();
  }

  function seed() {
    const t = L.todayISO();
    const s = JSON.parse(JSON.stringify(EMPTY));
    s.settings.therapistName = 'Your Therapist';
    s.seeded = true;

    const mat = function (id, name, category, location) { s.materials.push({ id: id, name: name, category: category, location: location }); };
    mat('m_artic', 'Articulation cards – /s/ & /r/', 'Cards', 'Shelf A, bin 2');
    mat('m_mirror', 'Hand mirror', 'Tools', 'Desk drawer');
    mat('m_tokens', 'Token board & stickers', 'Reinforcers', 'Desk');
    mat('m_bubbles', 'Bubbles', 'Reinforcers', 'Toy cupboard');
    mat('m_books', 'Picture books (Brown Bear, Very Hungry Caterpillar)', 'Books', 'Bookshelf');
    mat('m_aac', 'Core-word AAC board', 'AAC', 'Cupboard B');
    mat('m_wh', 'WH-question picture cards', 'Cards', 'Shelf A, bin 4');
    mat('m_metronome', 'Metronome / pacing board', 'Tools', 'Desk drawer');
    mat('m_feelings', 'Emotions & social scenario cards', 'Cards', 'Shelf B');
    mat('m_playdoh', 'Play-Doh & animal figurines', 'Toys', 'Toy cupboard');

    const pat = function (id, name, dob, diagnosis, guardian, contact) {
      s.patients.push({ id: id, name: name, dob: dob, diagnosis: diagnosis, guardian: guardian, contact: contact, notes: '' });
    };
    pat('p_ava', 'Ava Thompson', L.addDays(t, -365 * 6), 'Speech sound disorder (/s/, /r/)', 'Ms. Thompson', 'thompson.family@example.com');
    pat('p_leo', 'Leo Martinez', L.addDays(t, -365 * 4), 'Expressive language delay', 'Mr. Martinez', '(555) 201-3344');
    pat('p_maya', 'Maya Chen', L.addDays(t, -365 * 9), 'Childhood-onset fluency disorder', 'Mrs. Chen', 'chen.home@example.com');
    pat('p_noah', 'Noah Williams', L.addDays(t, -365 * 7), 'Autism – social communication', 'Ms. Williams', '(555) 887-1200');

    const goal = function (id, patientId, area, title, specific, measurable, achievable, relevant, weeks, target, materialIds) {
      s.goals.push({
        id: id, patientId: patientId, area: area, title: title,
        specific: specific, measurable: measurable, achievable: achievable, relevant: relevant,
        timeBound: L.addDays(t, weeks * 7), targetAccuracy: target, status: 'active', materialIds: materialIds,
        createdAt: L.addDays(t, -60)
      });
    };
    goal('g_ava1', 'p_ava', 'Articulation', '/s/ in initial position of words',
      'Ava will produce /s/ in the initial position of words', 'with 80% accuracy across 3 consecutive sessions',
      'Currently ~50% with visual cues; stimulable', 'Improves intelligibility in class', 12, 80, ['m_artic', 'm_mirror', 'm_tokens']);
    goal('g_ava2', 'p_ava', 'Articulation', 'Vocalic /r/ at word level',
      'Ava will produce vocalic /r/ in single words', 'with 70% accuracy given minimal cues',
      'Emerging in isolation', 'Needed for reading aloud and peer conversation', 16, 70, ['m_artic', 'm_mirror']);
    goal('g_leo1', 'p_leo', 'Expressive language', '2–3 word phrases',
      'Leo will combine 2–3 words to request or comment', '10 times per session with no more than 1 model',
      'Uses 40+ single words', 'Reduces frustration at home and preschool', 12, 80, ['m_aac', 'm_bubbles', 'm_playdoh']);
    goal('g_leo2', 'p_leo', 'Receptive language', 'Answer “what/where” questions',
      'Leo will answer what/where questions about pictures', 'with 80% accuracy',
      'Answers “what” with 50% accuracy', 'Supports story comprehension', 12, 80, ['m_wh', 'm_books']);
    goal('g_maya1', 'p_maya', 'Fluency', 'Easy onset in structured sentences',
      'Maya will use easy onset in structured sentences', 'with 85% fluent utterances',
      'Uses easy onset at word level', 'Builds confidence for class presentations', 10, 85, ['m_metronome', 'm_books']);
    goal('g_noah1', 'p_noah', 'Pragmatics', 'Identify emotions in scenarios',
      'Noah will identify the feelings of characters in social scenarios', 'with 80% accuracy',
      'Labels basic emotions in photos', 'Supports peer relationships at recess', 12, 80, ['m_feelings', 'm_tokens']);
    goal('g_noah2', 'p_noah', 'Pragmatics', 'Conversational turn-taking',
      'Noah will maintain a topic for 3 conversational turns', 'in 4 of 5 opportunities',
      'Currently maintains 1–2 turns', 'Needed for lunchtime conversations', 12, 80, ['m_feelings']);

    const appt = function (id, patientId, date, time, goalIds, status, room) {
      s.appointments.push({ id: id, patientId: patientId, date: date, time: time, duration: 30, room: room || 'Room 1', goalIds: goalIds, extraMaterialIds: [], status: status || 'scheduled', notes: '' });
    };
    appt('a_1', 'p_ava', t, '09:00', ['g_ava1', 'g_ava2']);
    appt('a_2', 'p_leo', t, '10:00', ['g_leo1', 'g_leo2'], 'scheduled', 'Room 2');
    appt('a_3', 'p_maya', t, '11:30', ['g_maya1']);
    appt('a_4', 'p_noah', t, '14:00', ['g_noah1', 'g_noah2'], 'scheduled', 'Room 2');
    appt('a_5', 'p_ava', L.addDays(t, 1), '09:00', ['g_ava1']);
    appt('a_6', 'p_leo', L.addDays(t, 1), '13:00', ['g_leo1']);

    // Past sessions so the progress charts have history.
    const history = {
      g_ava1: [40, 45, 50, 55, 60, 62, 68],
      g_ava2: [20, 25, 25, 30, 35, 40, 42],
      g_leo1: [30, 35, 40, 50, 50, 55, 60],
      g_leo2: [50, 45, 55, 60, 60, 65, 70],
      g_maya1: [60, 65, 70, 68, 75, 78, 82],
      g_noah1: [50, 55, 60, 60, 65, 70, 75],
      g_noah2: [20, 30, 30, 40, 40, 45, 50]
    };
    const byPatient = {};
    s.goals.forEach(function (g) { (byPatient[g.patientId] = byPatient[g.patientId] || []).push(g.id); });
    Object.keys(byPatient).forEach(function (pid) {
      for (let i = 0; i < 7; i++) {
        const date = L.addDays(t, -7 * (7 - i));
        const entries = byPatient[pid].map(function (gid) {
          const acc = history[gid][i];
          const trials = 20;
          const correct = Math.round(acc / 100 * trials);
          const prev = i ? history[gid][i - 1] : acc;
          return {
            goalId: gid, trials: trials, correct: correct, accuracy: L.accuracy(correct, trials),
            cueing: i < 3 ? 'Moderate' : 'Minimal',
            progress: acc > prev ? 'improving' : acc < prev ? 'regressing' : 'steady', note: ''
          };
        });
        s.logs.push({ id: 'l_' + pid + i, appointmentId: null, patientId: pid, date: date, entries: entries, notes: 'Good engagement.', homework: '' });
      }
    });
    return s;
  }

  window.Store = {
    get state() { return state; },
    save: save,
    byId: byId,
    upsert: upsert,
    remove: remove,
    patient: function (id) { return state.patients.find(function (p) { return p.id === id; }); },
    goal: function (id) { return state.goals.find(function (g) { return g.id === id; }); },
    appointment: function (id) { return state.appointments.find(function (a) { return a.id === id; }); },
    logForAppointment: function (apptId) { return state.logs.find(function (l) { return l.appointmentId === apptId; }); },
    logsForPatient: function (pid) { return state.logs.filter(function (l) { return l.patientId === pid; }); },
    goalsForPatient: function (pid) { return state.goals.filter(function (g) { return g.patientId === pid; }); },
    appointmentsOn: function (date) {
      return state.appointments.filter(function (a) { return a.date === date; })
        .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    },
    setPacked: function (date, mid, val) {
      state.packed[date] = state.packed[date] || {};
      if (val) state.packed[date][mid] = true; else delete state.packed[date][mid];
      save();
    },
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.patients) || !Array.isArray(data.goals)) throw new Error('Not a valid backup file');
      state = Object.assign({}, EMPTY, data);
      save();
    },
    clearAll: function () { state = JSON.parse(JSON.stringify(EMPTY)); save(); },
    resetDemo: function () { state = seed(); save(); }
  };
})();

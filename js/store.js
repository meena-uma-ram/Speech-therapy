/*
 * Local data store. Everything lives in this browser's localStorage; nothing is sent anywhere.
 * With a passphrase set, the data is encrypted at rest (AES-GCM, key derived with PBKDF2).
 */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'speech-therapy-planner-v1';
  const ENC_KEY = KEY + '-encrypted';
  const AUDIT_MAX = 2000;

  const EMPTY = {
    settings: {
      therapistName: '', dayStart: '08:00', dayEnd: '17:00', lunchStart: '12:30', lunchEnd: '13:30', scheduleView: 'timetable',
      currentUserId: '', hideNames: false, retentionYears: 8, autoLockMinutes: 10, nextCaseNo: 1
    },
    users: [], patients: [], goals: [], materials: [], appointments: [], logs: [],
    assessments: [], referrals: [], documents: [], audit: [],
    packed: {} // { 'YYYY-MM-DD': { materialId: true } }
  };

  let locked = false;
  let cryptoKey = null, cryptoSalt = null;
  let writing = Promise.resolve();
  let state = load();

  function blank() { return JSON.parse(JSON.stringify(EMPTY)); }

  function load() {
    try {
      if (localStorage.getItem(ENC_KEY)) { locked = true; return blank(); }
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(Object.assign(blank(), JSON.parse(raw)));
    } catch (e) { /* storage blocked or corrupt: fall through to demo data */ }
    return seed();
  }

  /* Fill in fields added after earlier releases. */
  function migrate(s) {
    s.settings = Object.assign({}, EMPTY.settings, s.settings);
    ['users', 'assessments', 'referrals', 'documents', 'audit'].forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    const demoCases = { p_ava: 'Speech sound disorder', p_leo: 'DLD', p_maya: 'Stammering', p_noah: 'Autism' };
    if (!s.users.length) {
      s.users.push({ id: 'u_me', name: s.settings.therapistName || 'Me', role: 'supervisor' });
      s.settings.currentUserId = 'u_me';
    }
    const me = s.settings.currentUserId || s.users[0].id;
    s.patients.forEach(function (p) {
      if (!p.ageGroup) p.ageGroup = L.ageGroup(p) || 'Child';
      if (p.condition == null) p.condition = s.seeded && demoCases[p.id] || '';
      if (!p.caseCode) p.caseCode = L.caseCode(new Date().getFullYear(), s.settings.nextCaseNo++);
      if (!p.status) p.status = 'active';
      if (!p.assignedTo && p.status === 'active') p.assignedTo = me;
      if (!p.consent) p.consent = { therapy: true, students: false, shareReports: false, teaching: false, recordedOn: '', givenBy: '' };
    });
    return s;
  }

  /* ---------- persistence & encryption ---------- */

  const enc = new TextEncoder(), dec = new TextDecoder();
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) { return Uint8Array.from(atob(str), function (c) { return c.charCodeAt(0); }); }

  function cryptoAvailable() { return !!(window.crypto && crypto.subtle && window.isSecureContext !== false); }

  function deriveKey(pass, salt) {
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  function writeEncrypted(json) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, enc.encode(json)).then(function (ct) {
      localStorage.setItem(ENC_KEY, JSON.stringify({ v: 1, salt: b64(cryptoSalt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }));
      localStorage.removeItem(KEY);
    });
  }

  function save() {
    if (locked) return;
    const json = JSON.stringify(state);
    if (cryptoKey) {
      // Writes are chained so the newest state always lands last.
      writing = writing.then(function () { return writeEncrypted(json); }).catch(function (e) { console.warn('Could not save', e); });
      return;
    }
    try { localStorage.setItem(KEY, json); }
    catch (e) { console.warn('Could not save to localStorage', e); }
  }

  function setPassphrase(pass) {
    cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(pass, cryptoSalt).then(function (key) {
      cryptoKey = key;
      save();
      return writing;
    });
  }

  function removePassphrase() {
    return writing.then(function () {
      cryptoKey = null; cryptoSalt = null;
      localStorage.removeItem(ENC_KEY);
      save();
    });
  }

  function unlock(pass) {
    const payload = JSON.parse(localStorage.getItem(ENC_KEY));
    const salt = unb64(payload.salt);
    return deriveKey(pass, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.ct)).then(function (plain) {
        cryptoKey = key; cryptoSalt = salt;
        state = migrate(Object.assign(blank(), JSON.parse(dec.decode(plain))));
        locked = false;
      }, function () { throw new Error('That passphrase is not correct.'); });
    });
  }

  function lock() {
    return writing.then(function () {
      if (!cryptoKey) return;
      cryptoKey = null;
      state = blank();
      locked = true;
    });
  }

  /* ---------- records ---------- */

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
      // Erasure covers every record linked to the person.
      ['goals', 'appointments', 'logs', 'assessments', 'referrals', 'documents'].forEach(function (k) {
        state[k] = state[k].filter(function (x) { return x.patientId !== id; });
      });
      state.audit.forEach(function (e) { if (e.patientId === id) { e.patientId = null; e.target = '(erased record)'; } });
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

  function currentUser() {
    return state.users.find(function (u) { return u.id === state.settings.currentUserId; }) || state.users[0] || null;
  }

  function audit(action, patientId, detail) {
    const u = currentUser();
    const p = patientId && state.patients.find(function (x) { return x.id === patientId; });
    state.audit.push({ at: new Date().toISOString(), userId: u ? u.id : '', user: u ? u.name : '', action: action,
      patientId: patientId || null, target: p ? p.caseCode : '', detail: detail || '' });
    if (state.audit.length > AUDIT_MAX) state.audit.splice(0, state.audit.length - AUDIT_MAX);
    save();
  }

  /* Everything held about one person, for a subject access or portability request. */
  function patientRecord(pid) {
    const pick = function (k) { return state[k].filter(function (x) { return x.patientId === pid; }); };
    return {
      exportedAt: new Date().toISOString(),
      patient: state.patients.find(function (p) { return p.id === pid; }),
      assessments: pick('assessments'), referrals: pick('referrals'), goals: pick('goals'),
      appointments: pick('appointments'), sessionLogs: pick('logs'), documents: pick('documents'),
      accessLog: state.audit.filter(function (e) { return e.patientId === pid; })
    };
  }

  /* ---------- demo data ---------- */

  function seed() {
    const t = L.todayISO();
    const s = blank();
    s.seeded = true;
    s.settings = Object.assign({}, EMPTY.settings, { therapistName: 'Dr. Priya Nair', currentUserId: 'u_sup' });

    s.users.push(
      { id: 'u_sup', name: 'Dr. Priya Nair', role: 'supervisor' },
      { id: 'u_ther', name: 'Sam Okafor', role: 'therapist' },
      { id: 'u_diag', name: 'Dr. Elena Rossi', role: 'diagnostician' },
      { id: 'u_stu1', name: 'Aisha Khan', role: 'student', year: 'Year 3' },
      { id: 'u_stu2', name: 'Tom Becker', role: 'student', year: 'Year 4' }
    );

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
    mat('m_naming', 'Naming picture cards (everyday objects)', 'Cards', 'Shelf C');
    mat('m_commbook', 'Communication book & whiteboard', 'AAC', 'Cupboard B');
    mat('m_blow', 'Straws, whistles & cotton-ball blowing kit', 'Tools', 'Desk drawer');
    mat('m_nasal', 'Nasal airflow mirror', 'Tools', 'Desk drawer');

    const consentAll = { therapy: true, students: true, shareReports: true, teaching: false, recordedOn: L.addDays(t, -70), givenBy: 'Parent' };
    const pat = function (id, name, years, ageGroup, condition, diagnosis, guardian, contact, extra) {
      s.patients.push(Object.assign({
        id: id, name: name, dob: L.addDays(t, -365 * years), ageGroup: ageGroup, condition: condition, diagnosis: diagnosis,
        guardian: guardian, contact: contact, notes: '', caseCode: L.caseCode(new Date().getFullYear(), s.settings.nextCaseNo++),
        status: 'active', assessedBy: 'u_diag', referredAt: L.addDays(t, -63), consent: Object.assign({}, consentAll)
      }, extra));
    };
    pat('p_ava', 'Ava Thompson', 6, 'Child', 'Speech sound disorder', 'Errors on /s/ and /r/', 'Ms. Thompson', 'thompson.family@example.com', { assignedTo: 'u_stu1', supervisorId: 'u_sup' });
    pat('p_isla', 'Isla Brown', 5, 'Child', 'CLP', 'Repaired cleft palate; glottal substitutions, weak oral pressure', 'Mrs. Brown', 'brown.family@example.com', { assignedTo: 'u_stu1', supervisorId: 'u_sup' });
    pat('p_leo', 'Leo Martinez', 4, 'Child', 'DLD', 'Expressive language below age level', 'Mr. Martinez', '(555) 201-3344', { assignedTo: 'u_stu2', supervisorId: 'u_sup' });
    pat('p_maya', 'Maya Chen', 9, 'Child', 'Stammering', 'Childhood-onset fluency disorder', 'Mrs. Chen', 'chen.home@example.com', { assignedTo: 'u_stu2', supervisorId: 'u_sup' });
    pat('p_rob', 'Robert Hughes', 67, 'Adult', 'Stroke – aphasia', 'Left MCA stroke 4 months ago; anomia, good comprehension', '', 'r.hughes@example.com',
      { assignedTo: 'u_ther', consent: Object.assign({}, consentAll, { students: false, givenBy: 'Patient' }) });
    pat('p_noah', 'Noah Williams', 7, 'Child', 'Autism', 'Social communication', 'Ms. Williams', '(555) 887-1200', { assignedTo: 'u_ther' });
    // Referred by diagnostics, waiting to be allotted.
    pat('p_grace', 'Grace Lee', 72, 'Adult', 'Dysphagia', 'Oropharyngeal dysphagia after stroke; coughing on thin fluids', 'Daughter: Ms. Lee', 'lee.family@example.com',
      { status: 'referred', referredAt: L.addDays(t, -2), consent: Object.assign({}, consentAll, { givenBy: 'Patient', recordedOn: L.addDays(t, -3) }) });
    pat('p_ethan', 'Ethan Patel', 5, 'Child', 'DLD', 'Receptive and expressive language delay', 'Mrs. Patel', 'patel.home@example.com',
      { status: 'referred', referredAt: L.addDays(t, -1), consent: Object.assign({}, consentAll, { students: false, recordedOn: L.addDays(t, -2) }) });
    // On the diagnostics waiting list.
    pat('p_oliver', 'Oliver Smith', 6, 'Child', 'Stammering', 'Query stammering – parent concern', 'Mr. Smith', 'smith.family@example.com',
      { status: 'waiting', assessedBy: null, referredAt: null, consent: { therapy: true, students: true, shareReports: false, teaching: false, recordedOn: t, givenBy: 'Parent' } });

    const assess = function (id, pid, days, fields, status) {
      s.assessments.push(Object.assign({ id: id, patientId: pid, assessorId: 'u_diag', date: L.addDays(t, -days), status: status || 'completed' }, fields));
    };
    assess('as_ava', 'p_ava', 66, { source: 'School nurse', reason: 'unclear speech', history: 'Typical development otherwise; hearing normal.', tests: 'DEAP articulation & phonology; oro-motor exam', findings: '/s/ produced as dental fricative in all positions; vocalic /r/ distorted. Stimulable for /s/ with visual cue.', diagnosis: 'Speech sound disorder (articulation)', severity: 'Mild', recommendations: 'Weekly articulation therapy; home practice.', frequency: 'Weekly, 30 min' });
    assess('as_isla', 'p_isla', 66, { source: 'Cleft team', reason: 'post-palate repair speech', history: 'Cleft palate repaired at 11 months. Grommets at 2 years.', tests: 'CAPS-A; nasometry; perceptual assessment', findings: 'Glottal stops for /p b t d/; mild hypernasality; nasal emission on pressure consonants.', diagnosis: 'Cleft palate speech (compensatory articulation)', severity: 'Moderate', recommendations: 'Articulation therapy for oral placement; review velopharyngeal function in 6 months.', frequency: 'Weekly, 45 min' });
    assess('as_leo', 'p_leo', 65, { source: 'Health visitor', reason: 'late talking', tests: 'CELF Preschool-2; language sample', findings: 'Expressive language standard score 72; uses ~40 single words.', diagnosis: 'Developmental language disorder', severity: 'Moderate', recommendations: 'Language stimulation; parent training.', frequency: 'Weekly, 30 min' });
    assess('as_maya', 'p_maya', 65, { source: 'Parent', reason: 'stammering at school', tests: 'SSI-4; OASES-S', findings: '7% syllables stuttered; moderate impact on communication attitudes.', diagnosis: 'Developmental stammering', severity: 'Mild–moderate', recommendations: 'Fluency shaping and attitude work.', frequency: 'Weekly, 30 min' });
    assess('as_rob', 'p_rob', 64, { source: 'Stroke unit', reason: 'aphasia after stroke', tests: 'WAB-R; Boston Naming Test', findings: 'Anomic aphasia; BNT 28/60; comprehension functional.', diagnosis: 'Anomic aphasia', severity: 'Moderate', recommendations: 'Naming therapy (semantic feature analysis); communication partner training.', frequency: 'Weekly, 45 min' });
    assess('as_noah', 'p_noah', 64, { source: 'Paediatrician', reason: 'social communication', tests: 'CCC-2; observation', findings: 'Difficulty with topic maintenance and inferring emotions.', diagnosis: 'Social communication difficulties (autism)', severity: 'Moderate', recommendations: 'Social communication group or individual therapy.', frequency: 'Weekly, 30 min' });
    assess('as_grace', 'p_grace', 3, { source: 'Acute stroke ward', reason: 'coughing on drinks', history: 'Right hemisphere stroke 3 weeks ago.', tests: 'Bedside swallow assessment; 90 ml water test', findings: 'Delayed swallow trigger; coughing on thin fluids; safe on mildly thick fluids.', diagnosis: 'Oropharyngeal dysphagia', severity: 'Moderate', recommendations: 'Swallow therapy; IDDSI level 2 fluids; review for instrumental assessment.', frequency: 'Twice weekly, 30 min' });
    assess('as_ethan', 'p_ethan', 2, { source: 'Nursery', reason: 'not following instructions', tests: 'CELF Preschool-2; play observation', findings: 'Receptive SS 74, expressive SS 70.', diagnosis: 'Developmental language disorder', severity: 'Moderate', recommendations: 'Language therapy; nursery strategies.', frequency: 'Weekly, 30 min' });
    s.assessments.push({ id: 'as_oliver', patientId: 'p_oliver', assessorId: 'u_diag', date: t, status: 'draft', source: 'Parent', reason: 'repetitions and blocks for 6 months', history: '', tests: '', findings: '', diagnosis: '', severity: '', recommendations: '', frequency: '' });

    const ref = function (pid, days, priority, status, extra) {
      s.referrals.push(Object.assign({ id: 'r_' + pid, patientId: pid, assessmentId: 'as_' + pid.slice(2), fromId: 'u_diag', at: L.addDays(t, -days), priority: priority, notes: '', status: status }, extra));
    };
    ref('p_ava', 63, 'Routine', 'allotted', { allottedTo: 'u_stu1', allottedBy: 'u_sup' });
    ref('p_isla', 63, 'Soon', 'allotted', { allottedTo: 'u_stu1', allottedBy: 'u_sup' });
    ref('p_leo', 63, 'Routine', 'allotted', { allottedTo: 'u_stu2', allottedBy: 'u_sup' });
    ref('p_maya', 63, 'Routine', 'allotted', { allottedTo: 'u_stu2', allottedBy: 'u_sup' });
    ref('p_rob', 63, 'Soon', 'allotted', { allottedTo: 'u_ther', allottedBy: 'u_sup' });
    ref('p_noah', 63, 'Routine', 'allotted', { allottedTo: 'u_ther', allottedBy: 'u_sup' });
    ref('p_grace', 2, 'Urgent', 'pending', { notes: 'Aspiration risk – please see this week.' });
    ref('p_ethan', 1, 'Routine', 'pending', { notes: 'Parents prefer a qualified therapist (no student consent).' });

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
    goal('g_isla1', 'p_isla', 'Articulation', 'Oral /p/ /b/ with good pressure',
      'Isla will produce /p/ and /b/ with oral airflow (no glottal substitution) in words', 'with 80% accuracy',
      'Correct in isolation with nasal mirror feedback', 'Makes her speech easier to understand at school', 12, 80, ['m_blow', 'm_nasal', 'm_artic']);
    goal('g_isla2', 'p_isla', 'Articulation', '/t/ /d/ at front of mouth',
      'Isla will produce /t/ and /d/ at the alveolar ridge in syllables and words', 'with 70% accuracy with visual cues',
      'Emerging in syllables', 'Reduces backing pattern', 16, 70, ['m_mirror', 'm_nasal']);
    goal('g_rob1', 'p_rob', 'Expressive language', 'Name everyday objects',
      'Robert will name pictured everyday objects', 'with 80% accuracy using self-cueing strategies',
      'Names 45% with phonemic cues', 'Lets him take part in family conversation and shopping', 12, 80, ['m_naming', 'm_commbook']);
    goal('g_rob2', 'p_rob', 'Expressive language', 'Functional phrases for daily needs',
      'Robert will use 10 functional phrases (e.g. “I need…”, “Can you…”)', 'in 4 of 5 role-play opportunities',
      'Uses 3–4 automatic phrases', 'Supports independence at home', 10, 80, ['m_commbook']);

    const appt = function (id, patientId, date, time, goalIds, room, duration) {
      s.appointments.push({ id: id, patientId: patientId, date: date, time: time, duration: duration || 30, room: room || 'Room 1', goalIds: goalIds, extraMaterialIds: [], status: 'scheduled', notes: '' });
    };
    appt('a_1', 'p_ava', t, '08:30', ['g_ava1', 'g_ava2']);
    appt('a_2', 'p_isla', t, '09:15', ['g_isla1', 'g_isla2'], 'Room 1', 45);
    appt('a_3', 'p_leo', t, '10:30', ['g_leo1', 'g_leo2'], 'Room 2');
    appt('a_4', 'p_maya', t, '11:30', ['g_maya1']);
    appt('a_5', 'p_rob', t, '13:30', ['g_rob1', 'g_rob2'], 'Room 3', 45);
    appt('a_6', 'p_noah', t, '14:45', ['g_noah1', 'g_noah2'], 'Room 2');
    appt('a_7', 'p_ava', L.addDays(t, 1), '09:00', ['g_ava1']);
    appt('a_8', 'p_leo', L.addDays(t, 1), '13:30', ['g_leo1']);

    // Past sessions so the progress charts have history.
    const history = {
      g_ava1: [40, 45, 50, 55, 60, 62, 68], g_ava2: [20, 25, 25, 30, 35, 40, 42],
      g_leo1: [30, 35, 40, 50, 50, 55, 60], g_leo2: [50, 45, 55, 60, 60, 65, 70],
      g_maya1: [60, 65, 70, 68, 75, 78, 82],
      g_noah1: [50, 55, 60, 60, 65, 70, 75], g_noah2: [20, 30, 30, 40, 40, 45, 50],
      g_isla1: [30, 35, 45, 50, 55, 60, 65], g_isla2: [15, 20, 20, 30, 35, 35, 45],
      g_rob1: [45, 48, 52, 55, 60, 58, 64], g_rob2: [30, 40, 40, 50, 55, 60, 70]
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

    // Student coursework at different stages.
    const doc = function (id, type, pid, author, status, days, extra) {
      const at = new Date(Date.now() - days * 864e5).toISOString();
      s.documents.push(Object.assign({
        id: id, type: type, patientId: pid, authorId: author, reviewerId: 'u_sup', appointmentId: null, status: status,
        fields: {}, createdAt: at, submittedAt: status === 'draft' ? null : at, history: []
      }, extra));
    };
    const pre = function (pid, extra) {
      const p = s.patients.find(function (x) { return x.id === pid; });
      return L.prefillDoc('pre-assessment', { patient: p, assessment: s.assessments.find(function (a) { return a.patientId === pid; }), goals: s.goals.filter(function (g) { return g.patientId === pid; }) });
    };
    doc('d_ava_pre', 'pre-assessment', 'p_ava', 'u_stu1', 'approved', 55, { fields: pre('p_ava'), history: [{ at: new Date(Date.now() - 50 * 864e5).toISOString(), by: 'u_sup', action: 'approved', note: 'Clear baseline. Good.' }] });
    doc('d_isla_pre', 'pre-assessment', 'p_isla', 'u_stu1', 'returned', 6, { fields: pre('p_isla'), history: [{ at: new Date(Date.now() - 4 * 864e5).toISOString(), by: 'u_sup', action: 'returned', note: 'Please add a word-level baseline for /t/ /d/ and say which cueing you used.' }] });
    doc('d_leo_pre', 'pre-assessment', 'p_leo', 'u_stu2', 'approved', 55, { fields: pre('p_leo') });
    doc('d_maya_pre', 'pre-assessment', 'p_maya', 'u_stu2', 'approved', 55, { fields: pre('p_maya') });
    const ava = s.appointments.find(function (a) { return a.id === 'a_1'; });
    doc('d_ava_lp', 'lesson-plan', 'p_ava', 'u_stu1', 'submitted', 1, { appointmentId: 'a_1', fields: Object.assign(L.prefillDoc('lesson-plan', {
      goals: s.goals.filter(function (g) { return ava.goalIds.indexOf(g.id) >= 0; }),
      materials: s.materials.filter(function (m) { return ['m_artic', 'm_mirror', 'm_tokens'].indexOf(m.id) >= 0; })
    }), { procedure: '1. Warm-up: /s/ in isolation with mirror (5 min)\n2. Picture card naming, initial /s/ (15 min)\n3. Fishing game with /s/ words (10 min)', cueing: 'Visual (mirror) → verbal model → phonetic placement. Token per 5 correct.' }) });
    doc('d_leo_lp', 'lesson-plan', 'p_leo', 'u_stu2', 'draft', 0, { appointmentId: 'a_3', fields: L.prefillDoc('lesson-plan', { goals: s.goals.filter(function (g) { return g.patientId === 'p_leo'; }) }) });
    doc('d_maya_sr', 'session-report', 'p_maya', 'u_stu2', 'submitted', 2, { fields: { subjective: 'Maya arrived chatty and settled quickly.', objective: '• Easy onset in structured sentences: 16/20 (80%), minimal cues', assessment: 'Improving; generalising to picture description.', plan: 'Move to short monologues next week.' } });

    s.audit.push({ at: new Date().toISOString(), userId: 'u_sup', user: 'Dr. Priya Nair', action: 'Loaded demo data', patientId: null, target: '', detail: '' });
    return s;
  }

  window.Store = {
    get state() { return state; },
    isLocked: function () { return locked; },
    hasPassphrase: function () { try { return !!cryptoKey || !!localStorage.getItem(ENC_KEY); } catch (e) { return false; } },
    cryptoAvailable: cryptoAvailable,
    setPassphrase: setPassphrase,
    removePassphrase: removePassphrase,
    unlock: unlock,
    lock: lock,
    save: save,
    byId: byId,
    upsert: upsert,
    remove: remove,
    audit: audit,
    currentUser: currentUser,
    patientRecord: patientRecord,
    user: function (id) { return state.users.find(function (u) { return u.id === id; }); },
    patient: function (id) { return state.patients.find(function (p) { return p.id === id; }); },
    goal: function (id) { return state.goals.find(function (g) { return g.id === id; }); },
    doc: function (id) { return state.documents.find(function (d) { return d.id === id; }); },
    assessment: function (id) { return state.assessments.find(function (a) { return a.id === id; }); },
    latestAssessment: function (pid) {
      return state.assessments.filter(function (a) { return a.patientId === pid; }).sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
    },
    referralFor: function (pid) { return state.referrals.filter(function (r) { return r.patientId === pid; }).slice(-1)[0]; },
    appointment: function (id) { return state.appointments.find(function (a) { return a.id === id; }); },
    logForAppointment: function (apptId) { return state.logs.find(function (l) { return l.appointmentId === apptId; }); },
    logsForPatient: function (pid) { return state.logs.filter(function (l) { return l.patientId === pid; }); },
    goalsForPatient: function (pid) { return state.goals.filter(function (g) { return g.patientId === pid; }); },
    docsForPatient: function (pid) { return state.documents.filter(function (d) { return d.patientId === pid; }); },
    appointmentsOn: function (date) {
      return state.appointments.filter(function (a) { return a.date === date; })
        .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    },
    nextCaseCode: function () { return L.caseCode(new Date().getFullYear(), state.settings.nextCaseNo++); },
    setPacked: function (date, mid, val) {
      state.packed[date] = state.packed[date] || {};
      if (val) state.packed[date][mid] = true; else delete state.packed[date][mid];
      save();
    },
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.patients) || !Array.isArray(data.goals)) throw new Error('Not a valid backup file');
      state = migrate(Object.assign(blank(), data));
      save();
    },
    clearAll: function () {
      const users = state.users, me = state.settings.currentUserId;
      state = blank();
      state.users = users; state.settings.currentUserId = me;
      save();
    },
    resetDemo: function () { state = seed(); save(); }
  };
})();

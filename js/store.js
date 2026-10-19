// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
/*
 * Data store. Two modes:
 * - On its own (a file, or any website): everything lives in this browser's localStorage; nothing is sent anywhere.
 *   With a passphrase set, the data is encrypted at rest (AES-GCM, key derived with PBKDF2).
 * - From a clinic server (server/server.js): the records live on the server's disk. This browser holds them in memory
 *   only while someone is signed in, sends each change to the server and picks up colleagues' changes as they happen.
 */
(function () {
  'use strict';
  const L = window.Logic;
  const Sync = window.Sync;
  const C = window.Consent;
  const REMOTE = !!(window.document && document.querySelector('meta[name="therapy-server"]'));
  // Two workspaces per device, kept apart: the demo (fake data, for showing people) and the clinic (real data, starts empty).
  const BASE_KEY = 'speech-therapy-planner-v1';
  const WS_KEY = 'tjs-workspace';
  const WORKSPACE = REMOTE ? '' : pickWorkspace();
  const KEY = WORKSPACE === 'demo' ? BASE_KEY + '-demo' : BASE_KEY;
  const ENC_KEY = KEY + '-encrypted';
  // Per-patient keys live apart from the data and are never written into a backup.
  const KEYRING_KEY = KEY + '-patient-keys';
  const AUDIT_MAX = 2000;
  const SESSION_KEY = 'speech-therapy-planner-session';
  const PREFS_KEY = KEY + '-device-prefs';
  const PW_ITERATIONS = 100000;
  const DEMO_PW = { pwSalt: 'dGhlcmFweS1wbGFubmVyLWRlbW8tc2FsdA==', pwHash: 'dDoovX6na8XDoauJ0apDiDsLUMsVSr79pyCCuUXcDK4=' }; // "demo1234"

  const GIVEN_BY = { Patient: 'self', Parent: 'parent', 'Legal guardian': 'legal-guardian', 'Carer with legal authority': 'legal-guardian' };
  const FLAG_PURPOSE = { therapy: 'treatment', students: 'students', shareReports: 'reports', teaching: 'teaching' };

  const EMPTY = {
    settings: {
      therapistName: '', dayStart: '08:00', dayEnd: '17:00', lunchStart: '12:30', lunchEnd: '13:30', scheduleView: 'timetable',
      currentUserId: '', hideNames: false, retentionYears: 8, autoLockMinutes: 10, nextCaseNo: 1, autoCover: false,
      autoErase: false, lastRetentionRun: '',
      messaging: {
        channel: 'both', defaultChannel: 'sms', clinicName: 'Bright Steps Clinic', portalLink: 'brightsteps.in/r', provider: '',
        smsSenderId: 'BRSTEP', smsTemplateId: '', waTemplateName: 'appointment_reminder', hoursBefore: 24,
        smsTemplate: '{clinic}: appointment on {day} at {time}. Details: {link}',
        waTemplate: 'Hello, this is a reminder from {clinic} about your appointment on {day} at {time}. View details: {link}'
      }
    },
    users: [], patients: [], goals: [], materials: [], appointments: [], logs: [],
    assessments: [], referrals: [], documents: [], audit: [], messages: [], leave: [], deletionReceipts: [], reminders: [], events: [], consents: [], attachments: [], letters: [],
    packed: {} // { 'YYYY-MM-DD': { materialId: true } }
  };

  let locked = false;
  let cryptoKey = null, cryptoSalt = null;
  let keyring = {}; // { patientId: base64 AES-256 key }
  let writing = Promise.resolve();
  let remoteMe = ''; // on a clinic server, who is signed in comes from the server
  let state = REMOTE ? blank() : load();

  function blank() { return JSON.parse(JSON.stringify(EMPTY)); }

  /* Which workspace this device last used. Data from before workspaces existed: demo data becomes the demo, anything else the clinic. */
  function pickWorkspace() {
    try {
      const ws = localStorage.getItem(WS_KEY);
      if (ws === 'demo' || ws === 'clinic') return ws;
      const raw = localStorage.getItem(BASE_KEY);
      if (localStorage.getItem(BASE_KEY + '-encrypted')) { localStorage.setItem(WS_KEY, 'clinic'); return 'clinic'; }
      if (!raw) return '';
      if (JSON.parse(raw).seeded) {
        [['', ''], ['-patient-keys', '-patient-keys']].forEach(function (k) {
          const v = localStorage.getItem(BASE_KEY + k[0]);
          if (v != null) { localStorage.setItem(BASE_KEY + '-demo' + k[1], v); localStorage.removeItem(BASE_KEY + k[0]); }
        });
        localStorage.setItem(WS_KEY, 'demo');
        return 'demo';
      }
      localStorage.setItem(WS_KEY, 'clinic');
      return 'clinic';
    } catch (e) { return 'demo'; }
  }

  function load() {
    try {
      if (localStorage.getItem(ENC_KEY)) { locked = true; return blank(); }
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(Object.assign(blank(), JSON.parse(raw)));
    } catch (e) { /* storage blocked or corrupt */ }
    // The demo starts full; the clinic starts empty and asks for its first supervisor.
    return WORKSPACE === 'demo' ? migrate(seed()) : migrate(blank());
  }

  /* Fill in fields added after earlier releases. */
  function migrate(s) {
    s.settings = Object.assign({}, EMPTY.settings, s.settings);
    s.settings.messaging = Object.assign({}, EMPTY.settings.messaging, s.settings.messaging);
    ['users', 'assessments', 'referrals', 'documents', 'audit', 'messages', 'leave', 'deletionReceipts', 'reminders', 'events', 'consents', 'attachments', 'letters'].forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    Sync.ensureIds(s);
    s.appointments.forEach(function (a) {
      if (a.status === 'completed') a.status = 'attended';
      if (!a.reschedules) a.reschedules = [];
      if (!a.observers) a.observers = [];
    });
    if (!REMOTE) {
      s.users.forEach(function (u) { if (!u.pwHash) u.mustChange = true; });
      // Who is signed in belongs to this browser tab, not to the saved data.
      let session = '';
      try { session = sessionStorage.getItem(SESSION_KEY) || ''; } catch (e) { /* storage blocked */ }
      s.settings.currentUserId = s.users.some(function (u) { return u.id === session; }) ? session : '';
    } else s.settings.currentUserId = remoteMe;
    const demoCases = { p_ava: 'Speech sound disorder', p_leo: 'DLD', p_maya: 'Stammering', p_noah: 'Autism' };
    const me = s.settings.currentUserId || (s.users[0] || {}).id || '';
    s.patients.forEach(function (p) {
      if (!p.ageGroup) p.ageGroup = L.ageGroup(p) || 'Child';
      if (p.condition == null) p.condition = s.seeded && demoCases[p.id] || '';
      if (!p.caseCode) p.caseCode = L.caseCode(new Date().getFullYear(), s.settings.nextCaseNo++);
      if (!p.status) p.status = 'active';
      if (!p.assignedTo && p.status === 'active') p.assignedTo = me;
      if (!p.consent) p.consent = {};
      // Consent now lives in the ledger. Older yes/no answers become a 'legacy' entry, flagged for asking again.
      if (!REMOTE && !p.consent.ledger && !s.consents.some(function (e) { return e.patientId === p.id; })) ledgerFromFlags(s, p, 'legacy');
      if (s.consents.some(function (e) { return e.patientId === p.id; })) p.consent = Object.assign({}, p.consent, C.flags(s.consents, p.id));
      if (p.sessionsAllotted == null) p.sessionsAllotted = p.status === 'active' ? 12 : 0;
      if (!p.reminders) p.reminders = { channel: 'default', phone: '', optIn: false, optInAt: '', optInBy: '' };
    });
    return s;
  }

  function ledgerFromFlags(s, p, method, demo) {
    const c = p.consent || {};
    const decisions = Object.keys(FLAG_PURPOSE).filter(function (k) { return c[k]; }).map(function (k) { return { purpose: FLAG_PURPOSE[k], action: 'grant' }; });
    if (demo) {
      decisions.push({ purpose: 'records', action: 'grant' });
      if (!c.teaching) decisions.push({ purpose: 'teaching', action: 'refuse' });
      if (!c.students) decisions.push({ purpose: 'students', action: 'refuse' });
      if (!c.shareReports) decisions.push({ purpose: 'reports', action: 'refuse' });
      decisions.push({ purpose: 'reminders', action: p.reminders && p.reminders.optIn ? 'grant' : 'refuse' });
    }
    if (!decisions.length) return;
    const rel = GIVEN_BY[c.givenBy] || (p.guardian ? 'parent' : 'self');
    const e = C.makeEntry(s.consents, {
      patientId: p.id, decisions: decisions, at: (c.recordedOn || L.todayISO()) + 'T10:00:00.000Z',
      giver: { name: rel === 'self' ? p.name : (p.guardian || '').replace(/^.*?:\s*/, '') || 'Not recorded', relationship: rel },
      recordedBy: '', method: method, demo: !!demo, note: demo ? 'Demo data' : 'Converted from the earlier yes/no consent fields'
    });
    s.consents.push(e);
    p.consent = Object.assign({}, c, C.flags(s.consents, p.id));
  }

  /*
   * Append to the consent ledger and apply it: the patient's consent flags, reminder opt-in. Entries are never edited;
   * a change of mind is a new entry. Returns the sealed entry.
   */
  function recordConsent(f) {
    const p = state.patients.find(function (x) { return x.id === f.patientId; });
    const u = currentUser();
    const e = C.makeEntry(state.consents, Object.assign({ recordedBy: u ? u.id : '', demo: WORKSPACE === 'demo' || !!serverInfo.demo }, f));
    state.consents.push(e);
    p.consent = Object.assign({}, p.consent, C.flags(state.consents, p.id));
    const rem = e.decisions.find(function (d) { return d.purpose === 'reminders'; });
    if (rem) {
      p.reminders = Object.assign({ channel: 'default', phone: '' }, p.reminders, rem.action === 'grant'
        ? { optIn: true, optInAt: e.at, optInBy: C.RELATIONSHIPS[e.giver.relationship] || '' } : { optIn: false, optInAt: '', optInBy: '' });
    }
    audit(e.decisions.some(function (d) { return d.action === 'withdraw'; }) ? 'Consent withdrawn' : 'Consent recorded', p.id,
      e.decisions.map(function (d) { return d.purpose + ' ' + d.action; }).join(', ') + ' · ' + e.receiptId);
    save();
    return e;
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
    if (REMOTE) { scheduleFlush(); return; }
    const json = JSON.stringify(state);
    if (cryptoKey) {
      // Writes are chained so the newest state always lands last.
      writing = writing.then(function () { return writeEncrypted(json); }).catch(function (e) { console.warn('Could not save', e); });
      return;
    }
    try { localStorage.setItem(KEY, json); }
    catch (e) { console.warn('Could not save to localStorage', e); }
  }

  function readKeyringPlain() {
    try {
      const o = JSON.parse(localStorage.getItem(KEYRING_KEY) || '{}');
      return o.enc ? {} : (o.keys || {});
    } catch (e) { return {}; }
  }

  function persistKeyring() {
    if (REMOTE) {
      // On a clinic server the keys live in their own file on the server, apart from the records. Only supervisors hold them.
      const u = currentUser();
      if (!u || u.role !== 'supervisor') return Promise.resolve();
      const body = { keys: Object.assign({}, keyring) };
      writing = writing.then(function () { return flush(); }).then(function () { return api('PUT', 'api/keys', body); }).catch(function (e) { console.warn('Could not save patient keys', e); });
      return writing;
    }
    const json = JSON.stringify(keyring), key = cryptoKey;
    writing = writing.then(function () {
      if (!key) { localStorage.setItem(KEYRING_KEY, JSON.stringify({ v: 1, keys: JSON.parse(json) })); return; }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(json)).then(function (ct) {
        localStorage.setItem(KEYRING_KEY, JSON.stringify({ v: 1, enc: true, iv: b64(iv), ct: b64(new Uint8Array(ct)) }));
      });
    }).catch(function (e) { console.warn('Could not save patient keys', e); });
    return writing;
  }

  function setPassphrase(pass) {
    cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(pass, cryptoSalt).then(function (key) {
      cryptoKey = key;
      save();
      return persistKeyring();
    });
  }

  function removePassphrase() {
    return writing.then(function () {
      cryptoKey = null; cryptoSalt = null;
      localStorage.removeItem(ENC_KEY);
      save();
      return persistKeyring();
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
        const o = JSON.parse(localStorage.getItem(KEYRING_KEY) || '{}');
        if (!o.enc) { keyring = o.keys || {}; return; }
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)).then(function (k) { keyring = JSON.parse(dec.decode(k)); });
      }, function () { throw new Error('That passphrase is not correct.'); });
    });
  }

  function lock() {
    return writing.then(function () {
      if (!cryptoKey) return;
      cryptoKey = null;
      state = blank();
      keyring = {};
      locked = true;
    });
  }

  /* ---------- sign-in ---------- */

  function hashPassword(pass, saltB64) {
    const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: PW_ITERATIONS, hash: 'SHA-256' }, k, 256);
    }).then(function (bits) { return { pwSalt: b64(salt), pwHash: b64(new Uint8Array(bits)) }; });
  }

  function findUser(login) {
    const q = (login || '').trim().toLowerCase();
    return state.users.find(function (u) { return (u.email || '').toLowerCase() === q || u.name.toLowerCase() === q; });
  }

  function setSession(id) {
    state.settings.currentUserId = id;
    try { if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* storage blocked */ }
  }

  function signIn(login, pass) {
    if (REMOTE) {
      return api('POST', 'api/login', { login: login, password: pass }).then(function () { return connect(); }).then(function () { return currentUser(); });
    }
    const u = findUser(login);
    const fail = function () { audit('Failed sign-in', null, login); throw new Error('Email or password not recognised.'); };
    if (!u) return Promise.resolve().then(fail);
    // Every account needs a password: a supervisor sets a temporary one, and the person chooses their own at first sign-in.
    if (!u.pwHash) { audit('Refused sign-in: no password set', null, u.name); return Promise.reject(new Error('This account has no password yet. Ask a supervisor to set a temporary one.')); }
    return hashPassword(pass, u.pwSalt).then(function (h) {
      if (h.pwHash !== u.pwHash) fail();
      setSession(u.id);
      audit('Signed in');
      return u;
    });
  }

  /* Clinic workspace, first run or after a clean start: the first supervisor chooses their own password. */
  function createFirstSupervisor(name, email, pass, clinicName) {
    if (state.users.length) return Promise.reject(new Error('This clinic already has accounts.'));
    return hashPassword(pass).then(function (h) {
      const u = Object.assign({ id: L.uid('use'), name: name, email: email, role: 'supervisor', mustChange: false }, h);
      state.users.push(u);
      if (clinicName) state.settings.messaging.clinicName = clinicName;
      setSession(u.id);
      audit('Created the clinic\u2019s first supervisor account', null, name);
      return u;
    });
  }

  /*
   * Clean start (clinic workspace): everything goes, including every account. Deletion receipts are kept as proof.
   * The next screen asks for a new first supervisor.
   */
  function cleanStart() {
    const receipts = state.deletionReceipts, n = state.patients.length, by = (currentUser() || {}).name || 'System';
    const p = cryptoKey ? removePassphrase() : Promise.resolve();
    return p.then(function () { return blobClear(); }).then(function () {
      state = blank();
      keyring = {};
      state.deletionReceipts = receipts.concat(n ? [{ id: 'DR-' + L.todayISO().replace(/-/g, '') + '-CLEAN', recordId: '*', caseCode: 'All ' + n + ' patients and all accounts',
        erasedAt: new Date().toISOString(), erasedBy: by, reason: 'Clean start', destroyed: ['All patient records', 'All accounts'],
        keyDestroyed: 'All patient keys destroyed on this device. Old backups stay readable to anyone who still has an older key file and the backup password: destroy those too.' }] : []);
      setSession('');
      save();
      return persistKeyring();
    });
  }

  function signOut() {
    if (REMOTE) {
      const done = function () { disconnect(); emit('change'); };
      return flush().then(function () { return api('POST', 'api/logout', {}); }).then(done, done);
    }
    audit('Signed out'); setSession(''); save();
  }

  function setPassword(userId, pass, mustChange) {
    if (REMOTE) {
      // The server hashes it; hashes never reach the browser.
      return flush().then(function () { return api('POST', 'api/password', { userId: userId, password: pass, mustChange: !!mustChange }); }).then(function () {
        [state, shadow].forEach(function (s) { const u = s && s.users.find(function (x) { return x.id === userId; }); if (u) { u.mustChange = userId === state.settings.currentUserId ? false : !!mustChange; u.hasPassword = true; } });
      });
    }
    return hashPassword(pass).then(function (h) {
      const u = state.users.find(function (x) { return x.id === userId; });
      u.pwSalt = h.pwSalt; u.pwHash = h.pwHash; u.mustChange = !!mustChange;
      save();
    });
  }

  /* ---------- clinic server: sync ---------- */

  let shadow = null;          // the state as the server last confirmed it (for working out what changed)
  let version = 0, flushTimer = null, inflight = null, needRefresh = false, events = null, retryTimer = null;
  let status = REMOTE ? 'connecting' : 'local';
  let busyCheck = function () { return false; };
  let serverInfo = {};
  const listeners = [];

  function emit(type, detail) { listeners.forEach(function (fn) { try { fn(type, detail); } catch (e) { console.warn(e); } }); }
  function setStatus(s) { if (s !== status) { status = s; emit('status', s); } }

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          const e = new Error(data.error || 'The clinic server refused this (' + res.status + ').');
          e.status = res.status;
          if (res.status === 401 && url !== 'api/login' && shadow) { disconnect(); emit('signedout'); }
          throw e;
        }
        return data;
      });
    }, function () {
      const e = new Error('Can’t reach the clinic server.');
      e.status = 0;
      throw e;
    });
  }

  function readPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { return {}; } }
  function writePrefs() {
    const o = {};
    Sync.LOCAL_SETTINGS.forEach(function (k) { if (k !== 'currentUserId') o[k] = state.settings[k]; });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(o)); } catch (e) { /* storage blocked */ }
  }

  /* Take the server's copy. Changes made here that haven't reached the server yet are replayed on top of it. */
  function adopt(data) {
    const pending = shadow ? Sync.diff(shadow, state) : [];
    remoteMe = data.me;
    const fresh = migrate(Object.assign(blank(), data.state));
    Object.assign(fresh.settings, readPrefs(), { currentUserId: data.me });
    shadow = Sync.clone(fresh);
    Sync.apply(fresh, pending);
    state = fresh;
    version = data.version;
    keyring = data.keys || {};
    if (pending.length) scheduleFlush();
  }

  function connect() {
    return api('GET', 'api/state').then(function (data) {
      adopt(data);
      setStatus('synced');
      listen();
    });
  }

  function disconnect() {
    if (events) { events.close(); events = null; }
    clearTimeout(flushTimer); clearTimeout(retryTimer);
    shadow = null; version = 0; keyring = {}; remoteMe = '';
    state = blank();
    setStatus('signedout');
  }

  // The server announces each new version; fetch it unless it is our own change.
  function listen() {
    if (events || typeof EventSource === 'undefined') return;
    events = new EventSource('api/events');
    events.onmessage = function (ev) {
      let v = 0;
      try { v = JSON.parse(ev.data).version; } catch (e) { return; }
      if (status === 'offline') setStatus('synced');
      if (v > version) { needRefresh = true; if (!inflight) refresh(); }
    };
    events.onerror = function () { if (shadow) setStatus('offline'); };
  }

  function refresh() {
    needRefresh = false;
    if (!shadow) return Promise.resolve();
    // Don't swap records under someone's open form; try again shortly.
    if (busyCheck()) { clearTimeout(retryTimer); retryTimer = setTimeout(refresh, 2500); return Promise.resolve(); }
    return api('GET', 'api/state').then(function (data) {
      if (!shadow) return;
      adopt(data);
      setStatus('synced');
      emit('change');
    }, function (e) { if (e.status === 0) setStatus('offline'); });
  }

  function scheduleFlush() {
    writePrefs();
    if (!shadow) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 150);
  }

  /* Send what changed since the server last confirmed. */
  function flush() {
    clearTimeout(flushTimer);
    if (inflight) return inflight.then(flush);
    if (!shadow) return Promise.resolve();
    const snap = Sync.clone(state);
    const ops = Sync.diff(shadow, snap);
    if (!ops.length) return Promise.resolve();
    setStatus('saving');
    inflight = api('POST', 'api/changes', { ops: ops }).then(function (r) {
      if (!shadow) return;
      shadow = snap;
      if (r.version !== version + 1) needRefresh = true; // someone else saved in between
      version = r.version;
      if (r.rejected && r.rejected.length) { needRefresh = true; emit('rejected', r.rejected); }
      setStatus('synced');
    }, function (e) {
      if (e.status === 0) { setStatus('offline'); clearTimeout(retryTimer); retryTimer = setTimeout(flush, 5000); }
      else if (e.status !== 401) { needRefresh = true; emit('rejected', [{ reason: e.message }]); }
    }).then(function () {
      inflight = null;
      if (needRefresh) return refresh();
    });
    return inflight;
  }

  const ready = !REMOTE ? Promise.resolve() : api('GET', 'api/info').then(function (i) { serverInfo = i; }, function () { /* offline */ })
    .then(function () { return connect(); })
    .catch(function (e) { setStatus(e.status === 0 ? 'unreachable' : 'signedout'); });

  /* ---------- files: scanned reports, letters, photos, voice notes, videos ---------- */

  /*
   * The file itself lives apart from the records: in this browser's IndexedDB (encrypted with the patient's own key,
   * so erasing the patient makes it unreadable) or, on a clinic server, on the server's disk (encrypted there).
   * The records hold only a description of each file (state.attachments). Files nobody has filed yet carry
   * patientId null and use a separate key until they are filed.
   */
  const FILE_MAX = 25 * 1024 * 1024;
  const FILE_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/pdf|audio\/(ogg|mpeg|mp4|aac|wav|x-wav|webm|x-m4a|opus)|video\/(mp4|webm|3gpp|quicktime))$/;
  const UNFILED = '_unfiled';
  const memFiles = {}; // when IndexedDB is unavailable (private windows, tests)

  function fileDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (fileDb.p) return fileDb.p;
    fileDb.p = new Promise(function (resolve) {
      const req = indexedDB.open('tjs-files-' + (WORKSPACE || 'clinic'), 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return fileDb.p;
  }
  // A request (or the in-memory stand-in) gives its result, which may be undefined for a missing file.
  function unwrap(o) { return o && typeof o === 'object' && 'result' in o ? o.result : o; }
  function idb(mode, fn) {
    return fileDb().then(function (db) {
      if (!db) return unwrap(fn(null));
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('files', mode), st = tx.objectStore('files');
        const out = fn(st);
        tx.oncomplete = function () { resolve(unwrap(out)); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function blobPut(id, v) { return idb('readwrite', function (st) { if (!st) { memFiles[id] = v; return; } st.put(v, id); }); }
  function blobGet(id) { return idb('readonly', function (st) { return st ? st.get(id) : { result: memFiles[id] }; }); }
  function blobDel(id) { return idb('readwrite', function (st) { if (!st) { delete memFiles[id]; return; } st.delete(id); }); }
  function blobKeys() { return idb('readonly', function (st) { return st ? st.getAllKeys() : { result: Object.keys(memFiles) }; }); }
  function blobClear() { return idb('readwrite', function (st) { if (!st) { Object.keys(memFiles).forEach(function (k) { delete memFiles[k]; }); return; } st.clear(); }); }

  function fileKey(pid) {
    const id = pid || UNFILED;
    if (!keyring[id]) { keyring[id] = b64(crypto.getRandomValues(new Uint8Array(32))); persistKeyring(); }
    return aesKey(keyring[id]);
  }
  function sealBytes(pid, fid, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return fileKey(pid).then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(fid) }, k, bytes); })
      .then(function (ct) { return { iv: b64(iv), ct: new Uint8Array(ct) }; });
  }
  function openBytes(pid, fid, box) {
    const raw = keyring[pid || UNFILED];
    if (!raw) return Promise.reject(new Error('This file can no longer be opened: its patient was erased.'));
    return aesKey(raw).then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(fid) }, k, box.ct); });
  }
  function hex(buf) { return Array.from(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  /* Add a file. f: { patientId (or '' for unfiled), category, note, source: upload | camera | share | email | whatsapp } */
  function addFile(file, f) {
    if (file.size > FILE_MAX) return Promise.reject(new Error(file.name + ' is larger than 25 MB.'));
    const type = file.type || 'application/octet-stream';
    if (!FILE_TYPES.test(type)) return Promise.reject(new Error(file.name + ': only photos, PDFs, audio and video can be added.'));
    const u = currentUser(), id = L.uid('fil'), pid = f.patientId || null;
    return file.arrayBuffer().then(function (bytes) {
      return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
        const meta = { id: id, patientId: pid, name: String(file.name || 'file').slice(0, 160), type: type, size: file.size, sha256: hex(digest),
          category: f.category || 'Other', note: f.note || '', source: f.source || 'upload', addedBy: u ? u.id : '', addedAt: new Date().toISOString(), from: f.from || '' };
        const dup = state.attachments.find(function (a) { return a.sha256 === meta.sha256 && a.patientId === pid; });
        const store = REMOTE
          ? flush().then(function () { return fetch('api/files/' + id, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': type, 'X-TJS-Upload': '1' }, body: bytes }); })
            .then(function (res) { if (!res.ok) return res.json().catch(function () { return {}; }).then(function (d) { throw new Error(d.error || 'The server did not accept the file.'); }); })
          : sealBytes(pid, id, bytes).then(function (box) { return blobPut(id, box); });
        return store.then(function () {
          state.attachments.push(meta);
          audit('Added file', pid, meta.category + ' · ' + meta.type + (meta.source !== 'upload' ? ' · via ' + meta.source : ''));
          save();
          return Object.assign({ duplicate: !!dup }, meta);
        });
      });
    });
  }

  /* The file's contents as a Blob, for viewing or saving. */
  function openFile(id) {
    const meta = state.attachments.find(function (a) { return a.id === id; });
    if (!meta) return Promise.reject(new Error('File not found.'));
    audit('Opened file', meta.patientId, meta.category);
    if (REMOTE) {
      return fetch('api/files/' + id, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('The server could not send this file.');
        return res.blob();
      });
    }
    return blobGet(id).then(function (box) {
      if (!box) throw new Error('This file is not on this device.');
      return openBytes(meta.patientId, id, box);
    }).then(function (bytes) { return new Blob([bytes], { type: meta.type }); });
  }

  /* File it under a patient (or move it to another one). Re-encrypted with that patient's key. */
  function fileTo(id, pid, category) {
    const meta = state.attachments.find(function (a) { return a.id === id; });
    if (!meta) return Promise.reject(new Error('File not found.'));
    const done = function () {
      meta.patientId = pid; if (category) meta.category = category;
      audit('Filed file', pid, meta.category);
      save();
      return meta;
    };
    if (REMOTE || meta.patientId === pid) return Promise.resolve(done());
    return blobGet(id).then(function (box) { return openBytes(meta.patientId, id, box); })
      .then(function (bytes) { return sealBytes(pid, id, bytes); })
      .then(function (box) { return blobPut(id, box); }).then(done);
  }

  function deleteFile(id) {
    const meta = state.attachments.find(function (a) { return a.id === id; });
    if (!meta) return Promise.resolve();
    state.attachments = state.attachments.filter(function (a) { return a.id !== id; });
    audit('Deleted file', meta.patientId, meta.category);
    save();
    return REMOTE ? Promise.resolve() : blobDel(id);
  }

  /* Remove stored files that no record points to any more (after an erasure, a restore or a clean start). */
  function sweepFiles() {
    if (REMOTE) return Promise.resolve(0);
    const keep = {};
    state.attachments.forEach(function (a) { keep[a.id] = true; });
    return blobKeys().then(function (ids) {
      const gone = (ids || []).filter(function (id) { return !keep[id]; });
      return Promise.all(gone.map(blobDel)).then(function () { return gone.length; });
    });
  }

  /* Files shared into TJS from another app (WhatsApp, Files, Gallery) wait in the offline worker's inbox. Move them in, encrypted. */
  function takeSharedFiles() {
    if (!window.indexedDB || REMOTE && !shadow) return Promise.resolve([]);
    return new Promise(function (resolve) {
      const req = indexedDB.open('tjs-incoming', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('items', { keyPath: 'id' }); };
      req.onerror = function () { resolve([]); };
      req.onsuccess = function () {
        const db = req.result, tx = db.transaction('items', 'readonly'), all = tx.objectStore('items').getAll();
        tx.oncomplete = function () { resolve({ db: db, items: all.result || [] }); };
      };
    }).then(function (r) {
      if (!r.items || !r.items.length) return [];
      return r.items.reduce(function (p, it) {
        return p.then(function (out) {
          const file = new File([it.blob], it.name, { type: it.type });
          return addFile(file, { patientId: '', source: 'share', note: it.text || '', category: 'Other' })
            .then(function (m) { out.push(m); return out; }, function (e) { out.push({ error: e.message, name: it.name }); return out; })
            .then(function (o) { r.db.transaction('items', 'readwrite').objectStore('items').delete(it.id); return o; });
        });
      }, Promise.resolve([]));
    });
  }

  /* ---------- inbox ---------- */

  function send(to, msg) {
    const from = currentUser();
    (Array.isArray(to) ? to : [to]).filter(Boolean).forEach(function (uid) {
      state.messages.push(Object.assign({ id: L.uid('msg'), to: uid, from: from ? from.id : '', at: new Date().toISOString(), read: false, kind: 'note', body: '', link: '' }, msg));
    });
    save();
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
    const gone = collection === 'patients' && state.patients.find(function (x) { return x.id === id; });
    state[collection] = state[collection].filter(function (x) { return x.id !== id; });
    if (collection === 'patients') {
      // Erasure covers every record linked to the person, including messages and consent records about them.
      ['messages', 'reminders', 'goals', 'appointments', 'logs', 'assessments', 'referrals', 'documents', 'consents', 'attachments', 'letters'].forEach(function (k) {
        state[k] = state[k].filter(function (x) { return x.patientId !== id; });
      });
      // The access log keeps a pseudonymised trail (case code only), so what happened stays accountable after erasure.
      const code = gone && gone.caseCode || 'erased record';
      state.audit.forEach(function (e) {
        if (e.patientId !== id) return;
        e.patientId = null; e.target = code; e.erased = true;
        if (gone && gone.name && e.detail) e.detail = e.detail.split(gone.name).join(code);
      });
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
    return state.users.find(function (u) { return u.id === state.settings.currentUserId; }) || null;
  }

  function audit(action, patientId, detail) {
    const u = currentUser();
    const p = patientId && state.patients.find(function (x) { return x.id === patientId; });
    state.audit.push({ id: L.uid('aud'), at: new Date().toISOString(), userId: u ? u.id : '', user: u ? u.name : '', action: action,
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

  /* ---------- crypto-shredding: per-patient keys, backups, erasure ---------- */

  function aesKey(rawB64) { return crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']); }

  /*
   * Backup format v3: the whole file is encrypted with a backup password (AES-256-GCM, PBKDF2 key), so people,
   * messages and settings are not readable either. Inside, each patient's records are encrypted again with that
   * patient's own key (patient id bound as associated data). The patient keys are NOT included.
   */
  const BACKUP_ITERATIONS = 310000;
  function exportBackup(password) {
    if (!password || password.length < 10) return Promise.reject(new Error('Choose a backup password of at least 10 characters.'));
    return exportInner().then(function (inner) {
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      return passwordKey(password, salt).then(function (k) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode('tjs-backup') }, k, enc.encode(inner));
      }).then(function (ct) {
        return JSON.stringify({ format: 'tjs-backup', v: 3, createdAt: new Date().toISOString(),
          note: 'Encrypted backup. Opening it needs the backup password; each patient also needs their key from the key file or this device.',
          kdf: { name: 'PBKDF2-SHA256', iterations: BACKUP_ITERATIONS, salt: b64(salt) }, iv: b64(iv), ct: b64(new Uint8Array(ct)) });
      });
    });
  }
  function passwordKey(password, salt) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: BACKUP_ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /* The inside of a backup, for restoring and for the deletion test. */
  function openBackup(text, password) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data.format !== 'tjs-backup') return Promise.resolve(data);
    if (!password) return Promise.reject(Object.assign(new Error('This backup needs its backup password.'), { needsPassword: true }));
    return passwordKey(password, unb64(data.kdf.salt)).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: enc.encode('tjs-backup') }, k, unb64(data.ct));
    }).then(function (pt) { return JSON.parse(dec.decode(pt)); }, function () { throw Object.assign(new Error('That backup password is not correct.'), { needsPassword: true }); });
  }
  function exportInner() {
    const split = L.splitForBackup(state);
    const ids = Object.keys(split.bundles);
    let added = false;
    ids.forEach(function (pid) { if (!keyring[pid]) { keyring[pid] = b64(crypto.getRandomValues(new Uint8Array(32))); added = true; } });
    return (added ? persistKeyring() : Promise.resolve()).then(function () {
      return Promise.all(ids.map(function (pid) {
        return aesKey(keyring[pid]).then(function (k) {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(pid) }, k, enc.encode(JSON.stringify(split.bundles[pid])))
            .then(function (ct) { return { pid: pid, caseCode: split.bundles[pid].patient.caseCode, iv: b64(iv), ct: b64(new Uint8Array(ct)) }; });
        });
      }));
    }).then(function (patients) {
      const shared = Object.assign({}, split.shared, { settings: Object.assign({}, split.shared.settings, { currentUserId: '' }) });
      // Files go in as they are stored: already encrypted with their patient's key (not available on a clinic server, which backs them up itself).
      return (REMOTE ? Promise.resolve([]) : Promise.all(state.attachments.map(function (a) {
        return blobGet(a.id).then(function (box) { return box ? { id: a.id, iv: box.iv, ct: b64(new Uint8Array(box.ct)) } : null; });
      }))).then(function (files) {
        return JSON.stringify({ format: 'therapy-planner-backup', v: 2, createdAt: new Date().toISOString(),
          note: 'Each patient is encrypted with their own key. Keys are not in this file.', shared: shared, patients: patients, files: files.filter(Boolean), erased: erasedIds() });
      });
    });
  }

  function openBundle(b) {
    const raw = keyring[b.pid];
    if (!raw) return Promise.resolve(null); // key destroyed: crypto-shredded
    return aesKey(raw).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(b.iv), additionalData: enc.encode(b.pid) }, k, unb64(b.ct));
    }).then(function (pt) { return JSON.parse(dec.decode(pt)); }, function () { return null; });
  }

  function importBackup(text, password) {
    const outer = JSON.parse(text);
    if (outer.format === 'therapy-planner-keys') return importKeyFile(outer);
    return openBackup(outer, password).then(restoreInner);
  }
  function restoreInner(data) {
    // Never bring back someone who was erased, whichever backup or key file is used.
    const erased = {};
    erasedIds().concat(data.erased || []).forEach(function (id) { erased[id] = true; });
    if (data.format !== 'therapy-planner-backup') {
      if (!data || !Array.isArray(data.patients) || !Array.isArray(data.goals)) throw new Error('Not a valid backup file');
      const receipts = state.deletionReceipts, session = state.settings.currentUserId;
      const skipped = data.patients.filter(function (p) { return erased[p.id]; }).map(function (p) { return p.caseCode; });
      state = migrate(Object.assign(blank(), data));
      Object.keys(erased).forEach(function (id) { if (state.patients.some(function (p) { return p.id === id; })) remove('patients', id); });
      state.deletionReceipts = mergeReceipts(receipts, state.deletionReceipts);
      state.settings.currentUserId = session;
      save();
      return { restored: state.patients.length, shredded: skipped, legacy: true };
    }
    const bundles = data.patients.filter(function (b) { return !erased[b.pid]; });
    return Promise.all(bundles.map(openBundle)).then(function (opened) {
      const receipts = state.deletionReceipts, session = state.settings.currentUserId;
      const ok = opened.filter(Boolean);
      state = migrate(Object.assign(blank(), L.mergeBundles(data.shared, ok)));
      state.deletionReceipts = mergeReceipts(receipts, state.deletionReceipts);
      state.settings.currentUserId = session;
      save();
      const known = {};
      state.attachments.forEach(function (a) { known[a.id] = true; });
      return Promise.all((data.files || []).filter(function (f) { return known[f.id]; }).map(function (f) { return blobPut(f.id, { iv: f.iv, ct: unb64(f.ct) }); }))
        .then(sweepFiles).then(function () { return opened; });
    }).then(function (opened) {
      return { restored: opened.filter(Boolean).length, shredded: data.patients.filter(function (b) { return erased[b.pid] || !opened[bundles.indexOf(b)]; }).map(function (b) { return b.caseCode; }) };
    });
  }

  function mergeReceipts(a, b) {
    const seen = {};
    return (a || []).concat(b || []).filter(function (r) { if (seen[r.id]) return false; seen[r.id] = true; return true; });
  }

  /* The key file is the disaster-recovery copy of the key ring. Keep it apart from backups. */
  function exportKeyFile() {
    const at = new Date().toISOString(), version = state.settings.keysetVersion || 0;
    state.settings.keyFileExports = (state.settings.keyFileExports || []).concat([{ at: at, version: version, pids: Object.keys(keyring) }]);
    save();
    return JSON.stringify({ format: 'therapy-planner-keys', v: 2, exportedAt: at, keysetVersion: version, erased: erasedIds(), keys: keyring });
  }
  function erasedIds() { return state.deletionReceipts.map(function (r) { return r.recordId; }).filter(function (x) { return x && x !== '*'; }); }
  function importKeyFile(data) {
    // A key file made before the latest erasure may still hold erased patients' keys.
    if ((data.keysetVersion || 0) < (state.settings.keysetVersion || 0)) {
      return Promise.reject(new Error('This key file is older than the latest erasure, so it may hold keys of erased patients. Use the newest key file.'));
    }
    const erased = {};
    erasedIds().concat(data.erased || []).forEach(function (id) { erased[id] = true; });
    let n = 0;
    Object.keys(data.keys || {}).forEach(function (pid) { if (!erased[pid] && !keyring[pid]) { keyring[pid] = data.keys[pid]; n++; } });
    return persistKeyring().then(function () { return { keysAdded: n, keysRefused: Object.keys(data.keys || {}).filter(function (pid) { return erased[pid]; }).length }; });
  }

  /* Erase a patient everywhere on this device and destroy their key, then issue a deletion receipt. */
  function erasePatient(pid, reason, by, isTest) {
    const p = state.patients.find(function (x) { return x.id === pid; });
    if (!p) return null;
    const counted = {};
    L.PATIENT_COLLECTIONS.forEach(function (k) { counted[k] = state[k].filter(function (x) { return x.patientId === pid; }).length; });
    const hadKey = !!keyring[pid];
    const inKeyFiles = (state.settings.keyFileExports || []).filter(function (x) { return (x.pids || []).indexOf(pid) >= 0; });
    remove('patients', pid);
    delete keyring[pid];
    persistKeyring();
    sweepFiles();
    const now = new Date();
    const u = currentUser();
    const receipt = {
      id: 'DR-' + now.toISOString().slice(0, 10).replace(/-/g, '') + '-' + b64(crypto.getRandomValues(new Uint8Array(3))).replace(/[^A-Za-z0-9]/g, 'x'),
      recordId: pid, caseCode: p.caseCode, erasedAt: now.toISOString(), erasedBy: by || (u ? u.name : 'System'), reason: reason,
      destroyed: ['Patient record', counted.goals + ' goals', counted.appointments + ' sessions', counted.logs + ' session logs',
        counted.assessments + ' assessments', counted.documents + ' documents', counted.messages + ' messages', counted.attachments + ' files'],
      keyDestroyed: !hadKey ? 'No backup had been made, so no key existed'
        : inKeyFiles.length ? 'Key destroyed on this device. ' + inKeyFiles.length + ' key file' + (inKeyFiles.length === 1 ? '' : 's') + ' made before this erasure (' +
          inKeyFiles.map(function (x) { return x.at.slice(0, 10); }).join(', ') + ') still hold the key: destroy them and make a new key file, or old backups stay readable'
        : 'Key destroyed. No key file held it, so earlier backups can no longer be read for this patient',
      keyFilesToDestroy: inKeyFiles.map(function (x) { return x.at; }),
      test: !!isTest
    };
    // Key files made before now may hold this key; a key file older than the latest erasure is refused on restore.
    state.settings.keysetVersion = (state.settings.keysetVersion || 0) + 1;
    state.deletionReceipts.push(receipt);
    audit(isTest ? 'Deletion test' : 'Erased record', null, p.caseCode + ' · receipt ' + receipt.id);
    return receipt;
  }

  /* Automatic retention rule: erase discharged records once the retention period has passed. */
  function runRetention(today) {
    const years = state.settings.retentionYears;
    const due = state.patients.filter(function (p) { return L.isPastRetention(p, years, today) && !p.legalHold; });
    const receipts = due.map(function (p) { return erasePatient(p.id, 'Retention period ended (' + years + ' years after discharge)', 'Automatic retention rule'); });
    state.settings.lastRetentionRun = today || L.todayISO();
    save();
    return receipts;
  }

  /* ---------- demo data ---------- */

  function seed() {
    const t = L.todayISO();
    const s = blank();
    s.seeded = true;
    s.settings = Object.assign({}, EMPTY.settings, { therapistName: 'Dr. Priya Nair', currentUserId: '' });

    const person = function (id, name, role, email, extra) { s.users.push(Object.assign({ id: id, name: name, role: role, email: email }, DEMO_PW, extra)); };
    person('u_sup', 'Dr. Priya Nair', 'supervisor', 'priya@clinic.example');
    person('u_ther', 'Sam Okafor', 'therapist', 'sam@clinic.example');
    person('u_diag', 'Dr. Elena Rossi', 'diagnostician', 'elena@clinic.example');
    person('u_stu1', 'Aisha Khan', 'student', 'aisha@uni.example', { year: 'Year 3' });
    person('u_stu2', 'Tom Becker', 'student', 'tom@uni.example', { year: 'Year 4' });

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
        status: 'active', assessedBy: 'u_diag', referredAt: L.addDays(t, -63), consent: Object.assign({}, consentAll), sessionsAllotted: 12
      }, extra));
    };
    pat('p_ava', 'Ava Thompson', 6, 'Child', 'Speech sound disorder', 'Errors on /s/ and /r/', 'Ms. Thompson', 'thompson.family@example.com', { assignedTo: 'u_stu1', supervisorId: 'u_sup' });
    pat('p_isla', 'Isla Brown', 5, 'Child', 'CLP', 'Repaired cleft palate; glottal substitutions, weak oral pressure', 'Mrs. Brown', 'brown.family@example.com', { assignedTo: 'u_stu1', supervisorId: 'u_sup' });
    pat('p_leo', 'Leo Martinez', 4, 'Child', 'DLD', 'Expressive language below age level', 'Mr. Martinez', '(555) 201-3344', { assignedTo: 'u_stu2', supervisorId: 'u_sup' });
    pat('p_maya', 'Maya Chen', 9, 'Child', 'Stammering', 'Childhood-onset fluency disorder', 'Mrs. Chen', 'chen.home@example.com', { assignedTo: 'u_stu2', supervisorId: 'u_sup' });
    pat('p_rob', 'Robert Hughes', 67, 'Adult', 'Stroke – aphasia', 'Left MCA stroke 4 months ago; anomia, good comprehension', '', 'r.hughes@example.com',
      { assignedTo: 'u_ther', consent: Object.assign({}, consentAll, { students: false, givenBy: 'Patient' }) });
    pat('p_noah', 'Noah Williams', 7, 'Child', 'Autism', 'Social communication', 'Ms. Williams', '(555) 887-1200', { assignedTo: 'u_ther' });
    const prefs = {
      p_ava: ['whatsapp', '+91 98450 12345', true], p_isla: ['sms', '+91 99860 22334', true], p_leo: ['default', '+91 90080 45566', true],
      p_maya: ['whatsapp', '+91 97400 78899', true], p_rob: ['sms', '+91 94480 11223', true], p_noah: ['default', '+91 98860 33445', false]
    };
    s.patients.forEach(function (p) {
      const x = prefs[p.id];
      p.reminders = x ? { channel: x[0], phone: x[1], optIn: x[2], optInAt: x[2] ? new Date(Date.now() - 70 * 864e5).toISOString() : '', optInBy: x[2] ? (p.guardian ? 'Parent' : 'Patient') : '' }
        : { channel: 'default', phone: '', optIn: false, optInAt: '', optInBy: '' };
    });
    // Referred by diagnostics, waiting to be allotted.
    pat('p_grace', 'Grace Lee', 72, 'Adult', 'Dysphagia', 'Oropharyngeal dysphagia after stroke; coughing on thin fluids', 'Daughter: Ms. Lee', 'lee.family@example.com',
      { status: 'referred', sessionsAllotted: 0, referredAt: L.addDays(t, -2), consent: Object.assign({}, consentAll, { givenBy: 'Patient', recordedOn: L.addDays(t, -3) }) });
    pat('p_ethan', 'Ethan Patel', 5, 'Child', 'DLD', 'Receptive and expressive language delay', 'Mrs. Patel', 'patel.home@example.com',
      { status: 'referred', sessionsAllotted: 0, referredAt: L.addDays(t, -1), consent: Object.assign({}, consentAll, { students: false, recordedOn: L.addDays(t, -2) }) });
    // On the diagnostics waiting list.
    pat('p_oliver', 'Oliver Smith', 6, 'Child', 'Stammering', 'Query stammering – parent concern', 'Mr. Smith', 'smith.family@example.com',
      { status: 'waiting', sessionsAllotted: 0, assessedBy: null, referredAt: null, consent: { therapy: true, students: true, shareReports: false, teaching: false, recordedOn: t, givenBy: 'Parent' } });

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
      s.appointments.push({ id: id, patientId: patientId, date: date, time: time, duration: duration || 30, room: room || 'Room 1', goalIds: goalIds, extraMaterialIds: [], status: 'scheduled', notes: '', reschedules: [], observers: [] });
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
        const today = s.appointments.find(function (a) { return a.patientId === pid && a.date === t; });
        const aid = 'a_' + pid + '_' + i;
        s.appointments.push({ id: aid, patientId: pid, date: date, time: today.time, duration: today.duration, room: today.room,
          goalIds: byPatient[pid].slice(), extraMaterialIds: [], status: 'attended', notes: '', reschedules: [], observers: [] });
        s.logs.push({ id: 'l_' + pid + i, appointmentId: aid, patientId: pid, date: date, entries: entries, notes: 'Good engagement.', homework: '' });
      }
    });
    s.patients.find(function (x) { return x.id === 'p_rob'; }).sessionsAllotted = 10;
    // A missed session, and a session the family asked to move.
    s.appointments.push({ id: 'a_leo_dna', patientId: 'p_leo', date: L.addDays(t, -11), time: '10:30', duration: 30, room: 'Room 2', goalIds: ['g_leo1'],
      extraMaterialIds: [], status: 'missed', notes: 'Did not attend; no call.', reschedules: [], observers: [] });
    const moved = s.appointments.find(function (a) { return a.id === 'a_p_maya_6'; });
    moved.reschedules.push({ at: new Date(Date.now() - 9 * 864e5).toISOString(), userId: 'u_stu2', by: 'Patient / family', reason: 'School trip',
      fromDate: L.addDays(moved.date, -1), fromTime: '11:30', toDate: moved.date, toTime: moved.time });

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

    const code = function (pid) { const p = s.patients.find(function (x) { return x.id === pid; }); return p.caseCode + ' (' + L.initials(p.name) + ')'; };
    const msg = function (to, from, days, subject, body, link, kind, extra) {
      s.messages.push(Object.assign({ id: 'msg_' + s.messages.length, to: to, from: from, at: new Date(Date.now() - days * 864e5).toISOString(),
        subject: subject, body: body, link: link, kind: kind, read: false }, extra));
    };
    msg('u_stu1', 'u_sup', 4, 'Pre-assessment returned – ' + code('p_isla'), 'Please add a word-level baseline for /t/ /d/ and say which cueing you used.', '#/doc/d_isla_pre', 'review', { patientId: 'p_isla' });
    msg('u_sup', 'u_stu1', 1, 'Lesson plan submitted – ' + code('p_ava'), 'Ready for your review.', '#/doc/d_ava_lp', 'submitted', { patientId: 'p_ava' });
    msg('u_sup', 'u_stu2', 2, 'Session report submitted – ' + code('p_maya'), 'Ready for your review.', '#/doc/d_maya_sr', 'submitted', { patientId: 'p_maya' });
    msg('u_sup', 'u_diag', 2, 'New referral (Urgent) – ' + code('p_grace'), 'Aspiration risk – please see this week.', '#/cases?tab=allot', 'referral', { patientId: 'p_grace' });
    msg('u_sup', 'u_stu2', 9, 'Session rescheduled by Patient / family – ' + code('p_maya'), 'Reason: School trip. Moved by one day.', '#/session/a_p_maya_6', 'reschedule', { patientId: 'p_maya' });

    // Tom is away tomorrow: his session needs cover.
    s.leave.push({ id: 'lv_tom', userId: 'u_stu2', from: L.addDays(t, 1), to: L.addDays(t, 1), reason: 'University exam', note: '', status: 'requested', createdAt: new Date().toISOString(), apptIds: ['a_8'] });
    s.appointments.find(function (a) { return a.id === 'a_8'; }).coverNeeded = true;
    msg('u_sup', 'u_stu2', 0, 'Leave request – Tom Becker, ' + L.formatDate(L.addDays(t, 1), { weekday: 'short', day: 'numeric', month: 'short' }), 'University exam. 1 session needs cover.', '#/leave', 'leave');

    // Tom has invited Sam to observe today's session.
    s.appointments.find(function (a) { return a.id === 'a_3'; }).observers.push({ userId: 'u_ther', role: 'Observe', status: 'invited', by: 'u_stu2' });
    msg('u_ther', 'u_stu2', 0, 'Invitation to observe – ' + code('p_leo') + ', today 10:30', 'Would you observe my session? I would value feedback on modelling.', '#/session/a_3', 'invite', { apptId: 'a_3', patientId: 'p_leo' });

    s.patients.forEach(function (p) { ledgerFromFlags(s, p, 'paper', true); });
    s.audit.push({ at: new Date().toISOString(), userId: '', user: 'System', action: 'Loaded demo data', patientId: null, target: '', detail: '' });
    return s;
  }

  /* ---------- demo: fake patients ---------- */

  const FAKE = {
    child: ['Aarav', 'Ananya', 'Kavin', 'Diya', 'Ishaan', 'Meera', 'Arjun', 'Saanvi', 'Vihaan', 'Nila', 'Rohan', 'Tara', 'Advik', 'Lakshana', 'Kabir', 'Aditi', 'Nikhil', 'Keerthana'],
    adult: ['Ramesh', 'Lakshmi', 'Suresh', 'Kamala', 'Venkatesh', 'Fatima', 'Joseph', 'Parvathi', 'Rajesh', 'Shanthi', 'Mohan', 'Gita', 'Abdul', 'Usha'],
    surname: ['Iyer', 'Nair', 'Reddy', 'Sharma', 'Menon', 'Pillai', 'Rao', 'Gowda', 'Patel', 'Das', 'Khan', 'Fernandes', 'Krishnan', 'Joshi', 'Banerjee', 'Kurian', 'Hegde', 'Subramanian'],
    parent: ['Mrs.', 'Mr.'],
    childCases: [['DLD', 'Expressive and receptive language delay'], ['Speech sound disorder', 'Fronting of /k g/, cluster reduction'], ['Autism', 'Limited joint attention; few spontaneous words'],
      ['Stammering', 'Repetitions and blocks for 8 months'], ['CLP', 'Repaired cleft palate; hypernasality'], ['Hearing loss', 'Bilateral hearing aids since age 2'], ['Childhood apraxia of speech', 'Inconsistent errors, groping']],
    adultCases: [['Stroke – aphasia', 'Left MCA stroke; word-finding difficulty'], ['Stroke – dysarthria', 'Slurred speech after brainstem stroke'], ['Dysphagia', 'Coughing on thin fluids'],
      ["Parkinson's", 'Reduced loudness; monotone'], ['Head & neck cancer', 'After partial glossectomy'], ['Voice', 'Hoarseness; vocal nodules'], ['Dementia', 'Word-finding and conversation difficulties']],
    sources: ['Paediatrician', 'School teacher', 'ENT', 'Neurology ward', 'Parent', 'Anganwadi worker', 'Physician']
  };

  /*
   * Demo only: add fake patients at every stage, spread across everyone so each role has something new to see:
   * waiting for assessment (diagnosticians), referred and waiting to be allotted (supervisors), in therapy with each
   * therapist and student (with goals, sessions and logs), and discharged.
   */
  function generateFake(n) {
    if (WORKSPACE !== 'demo' && !serverInfo.demo) throw new Error('Fake patients can only be added to the demo.');
    const t = L.todayISO(), made = [];
    const pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    const staff = function (role) { return state.users.filter(function (u) { return u.role === role; }); };
    const sups = staff('supervisor'), ther = staff('therapist'), stus = staff('student'), diags = staff('diagnostician');
    const clinicians = ther.concat(stus);
    const diag = function () { return (pick(diags.length ? diags : sups) || {}).id || ''; };
    const stages = ['waiting', 'referred', 'active', 'active', 'active', 'discharged'];
    let clinicianTurn = 0;
    for (let i = 0; i < (n || 6); i++) {
      const child = Math.random() < 0.6, cases = pick(child ? FAKE.childCases : FAKE.adultCases);
      const first = pick(child ? FAKE.child : FAKE.adult), last = pick(FAKE.surname);
      const years = child ? 3 + Math.floor(Math.random() * 10) : 25 + Math.floor(Math.random() * 55);
      const status = stages[i % stages.length];
      const who = status === 'active' || status === 'discharged' ? clinicians[clinicianTurn++ % Math.max(clinicians.length, 1)] : null;
      const toStudent = who && who.role === 'student';
      const p = {
        id: L.uid('pat'), name: first + ' ' + last, dob: L.addDays(t, -365 * years - Math.floor(Math.random() * 300)), ageGroup: child ? 'Child' : 'Adult',
        condition: cases[0], diagnosis: cases[1], guardian: child ? pick(FAKE.parent) + ' ' + last : '', contact: 'fake.' + last.toLowerCase() + '@example.com',
        notes: 'Fake demo patient', caseCode: L.caseCode(new Date().getFullYear(), state.settings.nextCaseNo++), status: status,
        assignedTo: who ? who.id : '', supervisorId: toStudent && sups[0] ? sups[0].id : '', assessedBy: status === 'waiting' ? null : diag(),
        referredAt: status === 'waiting' ? null : L.addDays(t, status === 'referred' ? -1 : -40), sessionsAllotted: who ? 10 : 0,
        dischargedAt: status === 'discharged' ? L.addDays(t, -5) : '', registeredAt: new Date().toISOString(), allottedAt: who ? t : '', fake: true,
        reminders: { channel: 'default', phone: '+91 9' + String(Math.floor(1e8 + Math.random() * 9e8)), optIn: false, optInAt: '', optInBy: '' },
        consent: {}
      };
      state.patients.push(p);
      // Consent as a parent or the patient would give it; students only if this case went to a student.
      const decisions = [{ purpose: 'treatment', action: 'grant' }, { purpose: 'records', action: 'grant' },
        { purpose: 'students', action: toStudent || Math.random() < 0.5 ? 'grant' : 'refuse' }, { purpose: 'reports', action: 'grant' },
        { purpose: 'reminders', action: Math.random() < 0.7 ? 'grant' : 'refuse' }, { purpose: 'teaching', action: Math.random() < 0.4 ? 'grant' : 'refuse' }];
      if (status !== 'waiting' || Math.random() < 0.5) {
        recordConsent({ patientId: p.id, decisions: decisions, giver: { name: child ? p.guardian : p.name, relationship: child ? 'parent' : 'self' },
          method: 'signature', language: pick(['en', 'ta', 'hi', 'ml', 'kn']), note: 'Fake demo consent' });
      }
      const assessor = p.assessedBy || diag();
      state.assessments.push({ id: L.uid('ass'), patientId: p.id, assessorId: assessor, date: status === 'waiting' ? t : L.addDays(t, -42), status: status === 'waiting' ? 'draft' : 'completed',
        source: pick(FAKE.sources), reason: cases[1].toLowerCase(), history: '', tests: status === 'waiting' ? '' : 'Standardised assessment; observation',
        findings: status === 'waiting' ? '' : cases[1] + '.', diagnosis: status === 'waiting' ? '' : cases[0], severity: status === 'waiting' ? '' : pick(['Mild', 'Moderate', 'Severe']),
        recommendations: status === 'waiting' ? '' : 'Weekly therapy', frequency: status === 'waiting' ? '' : 'Weekly, 30 min' });
      if (status !== 'waiting') {
        state.referrals.push({ id: L.uid('ref'), patientId: p.id, fromId: assessor, at: p.referredAt, priority: pick(['Routine', 'Routine', 'Soon', 'Urgent']), notes: 'Fake demo referral',
          status: who ? 'allotted' : 'pending', allottedTo: who ? who.id : undefined, allottedBy: who && sups[0] ? sups[0].id : undefined, allottedAt: who ? t : undefined });
      }
      if (who && status === 'active') {
        const gid = L.uid('goa');
        state.goals.push({ id: gid, patientId: p.id, area: child ? 'Expressive language' : 'Expressive language', title: 'Name everyday objects', specific: first + ' will name everyday objects',
          measurable: 'with 80% accuracy', achievable: 'Currently about 40%', relevant: 'Needed at home', timeBound: L.addDays(t, 84), targetAccuracy: 80, status: 'active',
          materialIds: state.materials.slice(0, 2).map(function (m) { return m.id; }), createdAt: L.addDays(t, -14) });
        [-7, 0, 7].forEach(function (d, k) {
          const a = { id: L.uid('app'), patientId: p.id, date: L.addDays(t, d), time: ['09:00', '11:30', '14:00', '15:30'][(i + k) % 4], duration: 30, goalIds: [gid], room: 'Room ' + (1 + i % 3),
            status: d < 0 ? 'attended' : 'scheduled', reschedules: [], observers: [], extraMaterialIds: [] };
          state.appointments.push(a);
          if (d < 0) state.logs.push({ id: L.uid('log'), appointmentId: a.id, patientId: p.id, date: a.date, entries: [{ goalId: gid, trials: 10, correct: 5, accuracy: 50, cueing: 'Moderate', progress: 'emerging' }], notes: 'Fake demo session', homework: '' });
        });
        send([who.id], { kind: 'allotted', patientId: p.id, link: '#/cases/' + p.id, subject: 'New case – ' + p.caseCode + ' (' + L.initials(p.name) + ')', body: 'Fake demo patient allotted to you.' });
      }
      made.push(p);
    }
    audit('Generated fake demo patients', null, made.length + ' patients');
    save();
    return made;
  }

  if (!locked && !REMOTE) keyring = readKeyringPlain();

  window.Store = {
    get state() { return state; },
    isLocked: function () { return locked; },
    isServer: function () { return REMOTE; },
    call: function (method, url, body) { return flush().then(function () { return api(method, url, body); }); },
    ready: ready,
    syncStatus: function () { return status; },
    serverInfo: function () { return serverInfo; },
    onSync: function (fn) { listeners.push(fn); },
    setBusyCheck: function (fn) { busyCheck = fn; },
    reconnect: function () { setStatus('connecting'); return connect().catch(function (e) { setStatus(e.status === 0 ? 'unreachable' : 'signedout'); }); },
    sync: function () { return flush(); },
    hasPassphrase: function () { if (REMOTE) return false; try { return !!cryptoKey || !!localStorage.getItem(ENC_KEY); } catch (e) { return false; } },
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
    signIn: signIn,
    signOut: signOut,
    setPassword: setPassword,
    send: send,
    inbox: function (uid) { return state.messages.filter(function (m) { return m.to === uid; }).sort(function (a, b) { return b.at.localeCompare(a.at); }); },
    unread: function (uid) { return state.messages.filter(function (m) { return m.to === uid && !m.read; }).length; },
    appointmentsFor: function (pid) { return state.appointments.filter(function (a) { return a.patientId === pid; }); },
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
    exportBackup: exportBackup,
    importBackup: function (text, password) { return Promise.resolve().then(function () { return importBackup(text, password); }); },
    openBackup: openBackup,
    workspace: function () { return REMOTE ? (serverInfo.demo ? 'demo' : 'clinic') : WORKSPACE; },
    isDemo: function () { return REMOTE ? !!serverInfo.demo : WORKSPACE === 'demo'; },
    chooseWorkspace: function (ws) {
      try { localStorage.setItem(WS_KEY, ws); sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* storage blocked */ }
      location.reload();
    },
    createFirstSupervisor: createFirstSupervisor,
    recordConsent: recordConsent,
    addFile: addFile,
    openFile: openFile,
    fileTo: fileTo,
    deleteFile: deleteFile,
    takeSharedFiles: takeSharedFiles,
    fileStoredHere: function (id) { return blobGet(id).then(function (b) { return !!b; }); },
    FILE_MAX: FILE_MAX,
    fileTypeOk: function (t) { return FILE_TYPES.test(t || ''); },
    cleanStart: cleanStart,
    generateFake: generateFake,
    exportKeyFile: exportKeyFile,
    openBundle: openBundle,
    erasePatient: erasePatient,
    runRetention: runRetention,
    hasKey: function (pid) { return !!keyring[pid]; },
    keyCount: function () { return Object.keys(keyring).length; },
    flush: function () { return writing; },
    storageReport: function () {
      const rows = [];
      if (REMOTE) {
        rows.push({ what: 'Patient and clinic data', where: 'The clinic server (' + location.host + '), in its data folder', key: 'clinic-data.json', bytes: new Blob([JSON.stringify(state)]).size, encrypted: !!serverInfo.encryptedAtRest });
        rows.push({ what: 'Per-patient keys', where: 'The clinic server, in a separate file', key: 'patient-keys.json', bytes: 0, encrypted: !!serverInfo.encryptedAtRest });
        rows.push({ what: 'On this device', where: 'Only in memory while you are signed in, plus display preferences', key: PREFS_KEY, bytes: 0, encrypted: false });
        return rows;
      }
      const size = function (v) { return v ? new Blob([v]).size : 0; };
      const get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
      const data = get(KEY), encData = get(ENC_KEY), ring = get(KEYRING_KEY);
      rows.push({ what: 'Patient and clinic data', where: 'This browser\'s local storage', key: encData ? ENC_KEY : KEY, bytes: size(encData || data), encrypted: !!encData });
      let ringEnc = false;
      try { ringEnc = !!(ring && JSON.parse(ring).enc); } catch (e) { /* ignore */ }
      rows.push({ what: 'Per-patient keys (' + Object.keys(keyring).length + ')', where: 'This browser\'s local storage, kept apart from the data', key: KEYRING_KEY, bytes: size(ring), encrypted: ringEnc });
      let sess = null;
      try { sess = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
      rows.push({ what: 'Who is signed in', where: 'This browser tab only (cleared when the tab closes)', key: SESSION_KEY, bytes: size(sess), encrypted: false });
      return rows;
    },
    rawStorage: function () {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf(KEY) === 0) out.push(localStorage.getItem(k)); } } catch (e) { /* blocked */ }
      return out.join('\n');
    },
    importJSON: function (text) { return restoreInner(JSON.parse(text)); },
    clearAll: function () {
      blobClear();
      const users = state.users, me = state.settings.currentUserId, receipts = state.deletionReceipts, n = state.patients.length;
      state = blank();
      state.users = users; state.settings.currentUserId = me;
      keyring = {};
      persistKeyring();
      state.deletionReceipts = receipts.concat([{ id: 'DR-' + L.todayISO().replace(/-/g, '') + '-ALL', recordId: '*', caseCode: 'All ' + n + ' patients',
        erasedAt: new Date().toISOString(), erasedBy: (users.find(function (u) { return u.id === me; }) || {}).name || 'System', reason: 'All patient data deleted',
        destroyed: ['All patient records'], keyDestroyed: 'All patient keys destroyed – every backup is unreadable for patient data' }]);
      save();
    },
    demoPassword: 'demo1234',
    resetDemo: function () {
      blobClear();
      const cur = state.settings.currentUserId;
      keyring = {};
      persistKeyring();
      const meBefore = state.users.find(function (u) { return u.id === cur; });
      state = seed();
      // On a clinic server, keep the signed-in account so they stay signed in.
      if (REMOTE && meBefore && !state.users.some(function (u) { return u.id === cur; })) state.users.unshift(meBefore);
      if (state.users.some(function (u) { return u.id === cur; })) state.settings.currentUserId = cur;
      save();
    }
  };
})();

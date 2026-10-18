// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/*
 * Sync rules shared by the browser and the clinic server: record-level changes, who sees what, who may change what.
 * Pure functions with no DOM or storage access, so they can be unit-tested in Node.
 */
(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.Logic;

  // Per-device display preferences: never sent to the server.
  const LOCAL_SETTINGS = ['currentUserId', 'hideNames', 'scheduleView'];
  // Settings anyone may change (the rest are clinic-wide and belong to supervisors).
  const SHARED_SETTINGS = ['nextCaseNo', 'lastRetentionRun'];
  const MAPS = ['settings', 'packed'];
  const SECRET = ['pwHash', 'pwSalt'];
  const LINKED = ['goals', 'logs', 'assessments', 'referrals', 'documents', 'reminders', 'consents', 'letters'];
  const AUDIT_MAX = 5000;

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /*
   * Changes between two states, one per record: {c, id, v} upserts, {c, id, del} deletes,
   * {c, k, v} / {c, k, del} for keyed maps (settings, packed), {c, v} for other top-level values.
   */
  function diff(base, next) {
    const ops = [];
    base = base || {};
    Object.keys(next).forEach(function (c) {
      const a = base[c], b = next[c];
      if (Array.isArray(b)) {
        const old = {}, seen = {};
        (Array.isArray(a) ? a : []).forEach(function (x) { if (x && x.id) old[x.id] = x; });
        b.forEach(function (x) {
          if (!x || !x.id) return;
          seen[x.id] = true;
          if (!old[x.id] || !same(old[x.id], x)) ops.push({ c: c, id: x.id, v: clone(x) });
        });
        Object.keys(old).forEach(function (id) { if (!seen[id]) ops.push({ c: c, id: id, del: true }); });
      } else if (MAPS.indexOf(c) >= 0) {
        const ao = a || {}, bo = b || {};
        Object.keys(Object.assign({}, ao, bo)).forEach(function (k) {
          if (c === 'settings' && LOCAL_SETTINGS.indexOf(k) >= 0) return;
          if (!(k in bo)) ops.push({ c: c, k: k, del: true });
          else if (!same(ao[k], bo[k])) ops.push({ c: c, k: k, v: clone(bo[k]) });
        });
      } else if (!same(a, b)) ops.push({ c: c, v: clone(b) });
    });
    return ops;
  }

  /* Records sync by id. Older access-log entries had none: give them one that every copy works out the same way. */
  function ensureIds(state) {
    (state.audit || []).forEach(function (e, i) { if (!e.id) e.id = 'aud_' + String(e.at || '').replace(/\D/g, '') + '_' + i; });
    return state;
  }

  /* Apply changes in place. Last writer wins per record. */
  function apply(state, ops) {
    ops.forEach(function (op) { applyOne(state, op); });
    return state;
  }
  function applyOne(state, op) {
    if (op.id !== undefined) {
      const list = Array.isArray(state[op.c]) ? state[op.c] : (state[op.c] = []);
      const i = list.findIndex(function (x) { return x.id === op.id; });
      if (op.del) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = clone(op.v);
      else list.push(clone(op.v));
    } else if (op.k !== undefined) {
      const m = state[op.c] || (state[op.c] = {});
      if (op.del) delete m[op.k]; else m[op.k] = clone(op.v);
    } else state[op.c] = clone(op.v);
  }

  /* ---------- who sees what ---------- */

  // Covering or being invited to a session opens that patient (as in the app, plus pending invitations so they can be answered).
  function grantsFor(user, s) {
    const g = {};
    (s.appointments || []).forEach(function (a) {
      if (a.coverBy === user.id || (a.observers || []).some(function (o) { return o.userId === user.id && o.status !== 'declined'; })) g[a.patientId] = true;
    });
    return g;
  }

  function visiblePatients(user, s) {
    const g = grantsFor(user, s), out = {};
    (s.patients || []).forEach(function (p) { if (L.canSeePatient(user, p, g)) out[p.id] = true; });
    return out;
  }

  function clinicianOf(a, patientsById) { return a.clinicianId || L.clinicianFor(a, patientsById[a.patientId]); }

  function isAttendee(e, uid) { return e.createdBy === uid || (e.attendees || []).indexOf(uid) >= 0; }

  /* Can this user see the full record? (Some records are shown as "busy" stubs otherwise.) */
  function canRead(user, c, rec, s, vis) {
    if (user.role === 'supervisor') return true;
    vis = vis || visiblePatients(user, s);
    switch (c) {
      case 'patients': return !!vis[rec.id];
      case 'appointments': return !!vis[rec.patientId] || rec.coverBy === user.id || (rec.observers || []).some(function (o) { return o.userId === user.id; });
      case 'messages': return rec.to === user.id || rec.from === user.id;
      case 'leave': return rec.userId === user.id;
      case 'events': return isAttendee(rec, user.id);
      case 'audit': case 'deletionReceipts': return false;
      // Files not yet filed under a patient: the person who added them (and supervisors).
      case 'attachments': return rec.patientId ? !!vis[rec.patientId] : rec.addedBy === user.id;
      case 'users': case 'materials': return true;
      default: return LINKED.indexOf(c) >= 0 ? !!vis[rec.patientId] : false;
    }
  }

  /* Enough for a team calendar, nothing about the patient or the reason for leave. */
  function stub(c, rec, s, pm) {
    if (c === 'appointments') {
      return { id: rec.id, date: rec.date, time: rec.time, duration: rec.duration, status: rec.status, room: rec.room || '', busy: true,
        clinicianId: clinicianOf(rec, pm), coverBy: rec.coverBy || '', coverNeeded: !!rec.coverNeeded,
        observers: (rec.observers || []).map(function (o) { return { userId: o.userId, role: o.role, status: o.status }; }) };
    }
    if (c === 'leave') return { id: rec.id, userId: rec.userId, from: rec.from, to: rec.to, status: rec.status, busy: true };
    if (c === 'events') return { id: rec.id, date: rec.date, time: rec.time, duration: rec.duration, attendees: (rec.attendees || []).slice(), createdBy: rec.createdBy, busy: true };
    return null;
  }

  function publicUser(u) {
    const x = clone(u);
    SECRET.forEach(function (k) { delete x[k]; });
    x.hasPassword = !!u.pwHash;
    return x;
  }

  /* What the server sends to one signed-in person. */
  function viewFor(user, s) {
    const out = {}, vis = visiblePatients(user, s), pm = {};
    (s.patients || []).forEach(function (p) { pm[p.id] = p; });
    Object.keys(s).forEach(function (c) {
      const v = s[c];
      if (c === 'users') out.users = v.map(publicUser);
      else if (Array.isArray(v)) {
        out[c] = [];
        v.forEach(function (rec) {
          if (canRead(user, c, rec, s, vis)) out[c].push(clone(rec));
          else { const st = stub(c, rec, s, pm); if (st) out[c].push(st); }
        });
      } else out[c] = clone(v);
    });
    return out;
  }

  /* ---------- who may change what ---------- */

  function find(s, c, id) { return (s[c] || []).find(function (x) { return x.id === id; }); }

  /* Returns '' if allowed, otherwise the reason. Checked against the server's full state before each change is applied. */
  function checkWrite(user, op, s) {
    const lead = user.role === 'supervisor';
    if (op.id !== undefined) {
      const old = find(s, op.c, op.id);
      if (old && old.busy) return 'Placeholder record';
      if (!op.del && op.v && op.v.busy) return 'Placeholder record';
      if (!op.del && (!op.v || op.v.id !== op.id)) return 'Malformed change';
      // The consent ledger is append-only: entries are added, never changed. Only erasure (a supervisor) removes them.
      if (op.c === 'consents' && old && !op.del) return 'Consent records cannot be changed; record a new decision instead';
      if (op.c === 'consents' && op.del && !lead) return 'Only a supervisor can erase consent records';
      if (op.c === 'users') {
        if (!lead) return 'Only a supervisor can change accounts';
        if (op.del && op.id === user.id) return 'You cannot delete your own account';
        return '';
      }
      if (lead) return '';
      if (op.c === 'deletionReceipts') return 'Only a supervisor can erase records';
      if (op.c === 'audit') return old || op.del ? 'The access log cannot be changed' : '';
      // Changing a record needs access to it as it stands (so it can be handed on, e.g. referred); adding one needs access to the new record.
      if (old && !canRead(user, op.c, old, s)) return 'No access to this record';
      if (!old && !op.del && !canRead(user, op.c, op.v, s)) return 'You would not have access to this record';
      if (op.c === 'messages' && !old && op.v.from !== user.id) return 'Messages must come from you';
      if (op.c === 'leave' && !op.del && op.v.userId !== user.id) return 'You can only enter your own leave';
      if (op.c === 'events' && ((old && old.createdBy !== user.id) || (!op.del && op.v.createdBy !== user.id))) return 'Only the organiser can change this event';
      if (op.c === 'attachments' && !old && !op.del && op.v.addedBy !== user.id) return 'Files must be added by you';
      if (['patients', 'appointments', 'messages', 'leave', 'events', 'materials', 'attachments'].concat(LINKED).indexOf(op.c) < 0) return 'Unknown record type';
      return '';
    }
    if (op.c === 'settings') {
      if (LOCAL_SETTINGS.indexOf(op.k) >= 0) return 'Per-device setting';
      return lead || SHARED_SETTINGS.indexOf(op.k) >= 0 ? '' : 'Only a supervisor can change clinic settings';
    }
    if (op.c === 'packed') return '';
    return lead ? '' : 'Only a supervisor can change this';
  }

  /*
   * Apply a batch from one person to the server's full state. Allowed changes are applied in order,
   * so a new patient and its goals can arrive together. Returns { applied, rejected:[{i, c, reason}], erased:[patient ids] }.
   */
  function applyFrom(user, s, ops) {
    const rejected = [], erased = [];
    let applied = 0;
    ops.forEach(function (op, i) {
      if (!op || typeof op.c !== 'string' || op.c === '__proto__' || op.c === 'constructor' || op.k === '__proto__') { rejected.push({ i: i, c: op && op.c, reason: 'Malformed change' }); return; }
      const why = checkWrite(user, op, s);
      if (why) { rejected.push({ i: i, c: op.c, reason: why }); return; }
      op = clone(op);
      if (op.c === 'users' && !op.del) {
        const old = find(s, 'users', op.id);
        delete op.v.hasPassword;
        // Passwords change only through the password endpoint; a supervisor may bring hashes in with a new account (restore, demo data).
        SECRET.forEach(function (k) { if (old) { if (old[k]) op.v[k] = old[k]; else delete op.v[k]; } });
      }
      if (op.c === 'audit' && !op.del) { op.v.userId = user.id; op.v.user = user.name; }
      if (op.c === 'settings' && op.k === 'nextCaseNo') op.v = Math.max(Number(op.v) || 0, Number(s.settings.nextCaseNo) || 0);
      if (op.c === 'patients' && op.del) erased.push(op.id);
      applyOne(s, op);
      applied++;
    });
    if (s.audit && s.audit.length > AUDIT_MAX) s.audit.splice(0, s.audit.length - AUDIT_MAX);
    return { applied: applied, rejected: rejected, erased: erased };
  }

  const api = {
    LOCAL_SETTINGS: LOCAL_SETTINGS, clone: clone, diff: diff, apply: apply, ensureIds: ensureIds, viewFor: viewFor, checkWrite: checkWrite,
    applyFrom: applyFrom, canRead: canRead, visiblePatients: visiblePatients, clinicianOf: clinicianOf, isAttendee: isAttendee, publicUser: publicUser
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sync = api;
})(typeof window !== 'undefined' ? window : this);

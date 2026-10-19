// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
/* Pure helpers with no DOM or storage access, so they can be unit-tested in Node. */
(function (root) {
  'use strict';

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return toISODate(new Date(y, m - 1, d + n));
  }

  function formatDate(iso, opts) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts || {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function formatTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    return ((h + 11) % 12 + 1) + ':' + pad(m) + ' ' + suffix;
  }

  /* Accuracy as a whole percentage, or null when there were no trials. */
  function accuracy(correct, trials) {
    const t = Number(trials), c = Number(correct);
    if (!t || t <= 0 || isNaN(c)) return null;
    return Math.round(Math.min(Math.max(c, 0), t) / t * 100);
  }

  function age(dobISO, onISO) {
    if (!dobISO) return '';
    const [y, m, d] = dobISO.split('-').map(Number);
    const [ty, tm, td] = (onISO || todayISO()).split('-').map(Number);
    let years = ty - y;
    if (tm < m || (tm === m && td < d)) years--;
    return years;
  }

  /* One-line SMART goal statement assembled from its parts. */
  function smartStatement(goal) {
    const parts = [goal.specific];
    if (goal.measurable) parts.push(goal.measurable);
    if (goal.timeBound) parts.push('by ' + formatDate(goal.timeBound, { month: 'short', day: 'numeric', year: 'numeric' }));
    return parts.filter(Boolean).join(', ') + '.';
  }

  /* Accuracy history for one goal, oldest first: [{date, accuracy, trials, correct, progress}] */
  function goalSeries(goalId, logs) {
    const points = [];
    logs.forEach(function (log) {
      (log.entries || []).forEach(function (e) {
        if (e.goalId !== goalId) return;
        const acc = e.accuracy != null ? e.accuracy : accuracy(e.correct, e.trials);
        if (acc == null) return;
        points.push({ date: log.date, accuracy: acc, trials: e.trials, correct: e.correct, progress: e.progress, note: e.note });
      });
    });
    return points.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* Summary stats for a goal's series. Trend compares the last 3 sessions with the 3 before. */
  function goalStats(series, target) {
    if (!series.length) return { sessions: 0, latest: null, average: null, trend: 'none', metTarget: false };
    const vals = series.map(function (p) { return p.accuracy; });
    const avg = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
    const recent = vals.slice(-3), prior = vals.slice(-6, -3);
    let trend = 'steady';
    if (prior.length) {
      const diff = avg(recent) - avg(prior);
      trend = diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'steady';
    } else if (vals.length >= 2) {
      const diff = vals[vals.length - 1] - vals[0];
      trend = diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'steady';
    }
    const latest = vals[vals.length - 1];
    return {
      sessions: vals.length,
      latest: latest,
      average: Math.round(avg(vals)),
      trend: trend,
      metTarget: target != null && target !== '' && latest >= Number(target)
    };
  }

  /*
   * Materials needed across a set of appointments.
   * Returns [{material, sessions:[{appointment, patient}], count}] sorted by count desc then name.
   */
  function materialsForDay(appointments, goalsById, materialsById, patientsById) {
    const map = {};
    appointments.forEach(function (appt) {
      if (appt.status === 'cancelled') return;
      const seen = {};
      (appt.goalIds || []).forEach(function (gid) {
        const goal = goalsById[gid];
        if (!goal) return;
        (goal.materialIds || []).forEach(function (mid) {
          if (seen[mid] || !materialsById[mid]) return;
          seen[mid] = true;
          if (!map[mid]) map[mid] = { material: materialsById[mid], sessions: [] };
          map[mid].sessions.push({ appointment: appt, patient: patientsById[appt.patientId] });
        });
      });
      (appt.extraMaterialIds || []).forEach(function (mid) {
        if (seen[mid] || !materialsById[mid]) return;
        seen[mid] = true;
        if (!map[mid]) map[mid] = { material: materialsById[mid], sessions: [] };
        map[mid].sessions.push({ appointment: appt, patient: patientsById[appt.patientId] });
      });
    });
    return Object.keys(map).map(function (k) {
      map[k].count = map[k].sessions.length;
      return map[k];
    }).sort(function (a, b) {
      return b.count - a.count || a.material.name.localeCompare(b.material.name);
    });
  }

  /* Material ids needed for a single appointment (goal materials + extras, de-duplicated). */
  function appointmentMaterialIds(appt, goalsById) {
    const ids = [];
    (appt.goalIds || []).forEach(function (gid) {
      const g = goalsById[gid];
      (g && g.materialIds || []).forEach(function (mid) { if (ids.indexOf(mid) < 0) ids.push(mid); });
    });
    (appt.extraMaterialIds || []).forEach(function (mid) { if (ids.indexOf(mid) < 0) ids.push(mid); });
    return ids;
  }

  function toMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function fromMinutes(mins) { return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60); }

  /*
   * Timetable layout for one day. Overlapping sessions sit side by side in lanes.
   * Returns { start, end, blocks:[{appt, start, end, lane, lanes}] } with times in minutes since midnight.
   * The visible range is at least dayStart–dayEnd and stretches to whole hours around any session outside it.
   */
  function layoutDay(appointments, dayStart, dayEnd) {
    const items = appointments.map(function (a) {
      const start = toMinutes(a.time);
      return { appt: a, start: start, end: start + (Number(a.duration) || 30), lane: 0, lanes: 1 };
    }).sort(function (a, b) { return a.start - b.start || b.end - a.end; });

    let cluster = [], laneEnds = [], clusterEnd = -1;
    function closeCluster() {
      cluster.forEach(function (it) { it.lanes = laneEnds.length; });
      cluster = []; laneEnds = [];
    }
    items.forEach(function (it) {
      if (it.start >= clusterEnd) closeCluster();
      let lane = laneEnds.findIndex(function (end) { return end <= it.start; });
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
      it.lane = lane;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
    });
    closeCluster();

    let start = toMinutes(dayStart || '08:00'), end = toMinutes(dayEnd || '17:00');
    items.forEach(function (it) {
      start = Math.min(start, Math.floor(it.start / 60) * 60);
      end = Math.max(end, Math.ceil(it.end / 60) * 60);
    });
    return { start: start, end: end, blocks: items };
  }

  /* Split sessions into before / after lunch by start time. */
  function splitByLunch(appointments, lunchStart) {
    const cut = toMinutes(lunchStart || '12:00');
    return {
      morning: appointments.filter(function (a) { return toMinutes(a.time) < cut; }),
      afternoon: appointments.filter(function (a) { return toMinutes(a.time) >= cut; })
    };
  }

  /* Case types: the condition picks a colour family so a day's mix is visible at a glance. */
  const CONDITIONS = {
    Child: ['DLD', 'Speech sound disorder', 'CLP', 'Childhood apraxia of speech', 'Autism', 'Stammering', 'Hearing loss', 'Feeding', 'Voice', 'Global developmental delay'],
    Adult: ['Stroke – aphasia', 'Stroke – dysarthria', 'Dysphagia', "Parkinson's", 'TBI', 'Head & neck cancer', 'Dementia', 'Voice', 'Stammering', 'MND']
  };
  const FAMILY_RULES = [
    ['swallow', /dysphag|feed|swallow/i],
    ['language', /dld|aphasia|language|dementia|tbi|developmental/i],
    ['speech', /clp|cleft|speech sound|ssd|apraxia|cas|dysarthria|parkinson|mnd|artic|phono|hearing/i],
    ['fluency', /stammer|stutter|fluen/i],
    ['social', /autis|asd|social|pragmat/i],
    ['voice', /voice|head & neck|laryn/i]
  ];
  function conditionFamily(condition) {
    for (let i = 0; i < FAMILY_RULES.length; i++) if (FAMILY_RULES[i][1].test(condition || '')) return FAMILY_RULES[i][0];
    return 'other';
  }
  function ageGroup(patient, onISO) {
    if (patient.ageGroup) return patient.ageGroup;
    if (!patient.dob) return '';
    return age(patient.dob, onISO) >= 18 ? 'Adult' : 'Child';
  }
  function caseLabel(patient) {
    return [ageGroup(patient), patient.condition].filter(Boolean).join(' · ');
  }

  /* ---------- people, privacy and workflow ---------- */

  const ROLES = {
    diagnostician: { label: 'Diagnostician', dept: 'Diagnostics' },
    therapist: { label: 'Speech therapist', dept: 'Therapy' },
    supervisor: { label: 'Clinical supervisor', dept: 'Therapy' },
    student: { label: 'Student clinician', dept: 'Therapy' }
  };

  function initials(name) {
    return (name || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0].toUpperCase() + '.'; }).join('');
  }

  function caseCode(year, n) { return 'SLT-' + String(year).slice(-2) + '-' + String(n).padStart(3, '0'); }

  /* Who may open a patient's record (need-to-know). */
  /*
   * Who may open a patient's record (need-to-know). Supervisors see everything.
   * Clinicians see their own patients, plus any in `grants` (sessions they cover or observe).
   */
  function canSeePatient(user, p, grants) {
    if (!user || !p) return false;
    if (grants && grants[p.id]) return true;
    switch (user.role) {
      case 'supervisor': return true;
      case 'diagnostician': return p.status === 'waiting' || p.assessedBy === user.id;
      case 'therapist':
      case 'student': return p.assignedTo === user.id;
      default: return false;
    }
  }

  /* Can this patient be allotted to this clinician? */
  function canAllot(p, assignee) {
    if (!assignee) return { ok: false, reason: 'Choose who will take the case.' };
    const c = p.consent || {};
    if (!c.therapy) return { ok: false, reason: 'Consent for therapy has not been recorded.' };
    if (assignee.role === 'student' && !c.students) return { ok: false, reason: 'No consent for student clinicians. Allot to a qualified therapist, or record consent first.' };
    return { ok: true };
  }

  function addYears(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return toISODate(new Date(y + n, m - 1, d));
  }

  /* Discharged records whose retention period has run out. */
  function isPastRetention(p, years, today) {
    return p.status === 'discharged' && !!p.dischargedAt && addYears(p.dischargedAt, Number(years) || 0) <= (today || todayISO());
  }

  const DOC_TYPES = {
    'pre-assessment': { label: 'Pre-assessment', perSession: false },
    'lesson-plan': { label: 'Lesson plan', perSession: true },
    'session-report': { label: 'Session report', perSession: true },
    'conclusion': { label: 'Conclusion report', perSession: false }
  };
  const DOC_FIELDS = {
    'pre-assessment': [
      ['background', 'Background & case history', 4], ['assessments', 'Assessments used', 3], ['findings', 'Findings & baseline', 4],
      ['impressions', 'Clinical impressions', 3], ['goals', 'Proposed long- and short-term goals', 4], ['plan', 'Intervention plan', 3]],
    'lesson-plan': [
      ['objectives', 'Objectives (SMART)', 4], ['procedure', 'Activities & procedure', 5], ['materials', 'Materials', 2],
      ['cueing', 'Cueing hierarchy & reinforcement', 3], ['carryover', 'Home practice / carry-over', 2], ['backup', 'Back-up plan', 2]],
    'session-report': [
      ['subjective', 'S – Subjective', 3], ['objective', 'O – Objective (data)', 5], ['assessment', 'A – Assessment', 3], ['plan', 'P – Plan', 3]],
    'conclusion': [
      ['summary', 'Summary of intervention', 4], ['outcomes', 'Goal outcomes', 5], ['recommendations', 'Recommendations', 3], ['discharge', 'Discharge or continuation plan', 2]]
  };
  const DOC_STATUS = { draft: 'Draft', submitted: 'Awaiting review', approved: 'Approved', returned: 'Changes requested' };

  /* Pre-filled starting text for each document, built from what the app already knows. */
  function prefillDoc(type, ctx) {
    const p = ctx.patient || {}, a = ctx.assessment || {};
    const goals = ctx.goals || [];
    const numbered = function (list) { return list.map(function (g, i) { return (i + 1) + '. ' + smartStatement(g); }).join('\n'); };
    if (type === 'pre-assessment') {
      return {
        background: [caseLabel(p), p.diagnosis, a.source ? 'Referred by ' + a.source + (a.reason ? ' for ' + a.reason : '') + '.' : '', a.history].filter(Boolean).join('. ').replace(/\.\./g, '.'),
        assessments: a.tests || '',
        findings: a.findings || '',
        impressions: [a.diagnosis, a.severity ? a.severity + ' severity' : ''].filter(Boolean).join(', '),
        goals: numbered(goals),
        plan: [a.recommendations, a.frequency ? 'Frequency: ' + a.frequency : ''].filter(Boolean).join('\n')
      };
    }
    if (type === 'lesson-plan') {
      return { objectives: numbered(goals), procedure: '', materials: (ctx.materials || []).map(function (m) { return m.name; }).join(', '), cueing: '', carryover: '', backup: '' };
    }
    if (type === 'session-report') {
      const log = ctx.log;
      const byId = {};
      goals.forEach(function (g) { byId[g.id] = g; });
      const objective = log ? (log.entries || []).map(function (e) {
        const g = byId[e.goalId];
        if (!g) return '';
        const acc = e.accuracy != null ? e.accuracy : accuracy(e.correct, e.trials);
        if (acc == null && !e.note) return '';
        return '• ' + g.title + ': ' + (e.trials ? e.correct + '/' + e.trials + ' ' : '') + (acc != null ? '(' + acc + '%)' : 'no score') + (e.cueing ? ', ' + e.cueing.toLowerCase() + ' cues' : '') + (e.note ? ' – ' + e.note : '');
      }).filter(Boolean).join('\n') : '';
      const assess = log ? (log.entries || []).filter(function (e) { return e.progress && byId[e.goalId]; })
        .map(function (e) { return byId[e.goalId].title + ': ' + PROGRESS_LABELS[e.progress].toLowerCase(); }).join('; ') : '';
      return { subjective: log ? log.notes || '' : '', objective: objective, assessment: assess, plan: log && log.homework ? 'Home practice: ' + log.homework : '' };
    }
    if (type === 'conclusion') {
      const logs = (ctx.logs || []).slice().sort(function (x, y) { return x.date < y.date ? -1 : 1; });
      const summary = logs.length ? logs.length + ' sessions between ' + formatDate(logs[0].date, { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' and ' + formatDate(logs[logs.length - 1].date, { day: 'numeric', month: 'short', year: 'numeric' }) + '.' : 'No sessions logged.';
      const outcomes = goals.map(function (g) {
        const series = goalSeries(g.id, logs);
        const st = goalStats(series, g.targetAccuracy);
        if (!series.length) return '• ' + g.title + ': no data';
        return '• ' + g.title + ': ' + series[0].accuracy + '% → ' + st.latest + '% (target ' + g.targetAccuracy + '%) – ' + (st.metTarget ? 'met' : 'not yet met');
      }).join('\n');
      return { summary: summary, outcomes: outcomes, recommendations: '', discharge: '' };
    }
    return {};
  }

  /* Coursework progress for one case: counts by document type and status, plus the next thing to do. */
  function caseProgress(docs, sessionsLogged) {
    const out = {};
    Object.keys(DOC_TYPES).forEach(function (t) { out[t] = { total: 0, approved: 0, submitted: 0, returned: 0, draft: 0 }; });
    docs.forEach(function (d) { if (out[d.type]) { out[d.type].total++; out[d.type][d.status]++; } });
    let next = 'Up to date';
    const returned = docs.filter(function (d) { return d.status === 'returned'; });
    if (returned.length) next = 'Revise ' + DOC_TYPES[returned[0].type].label.toLowerCase();
    else if (!out['pre-assessment'].approved) next = out['pre-assessment'].submitted ? 'Pre-assessment awaiting review' : 'Write pre-assessment';
    else if (out['session-report'].total < (sessionsLogged || 0)) next = 'Write session report';
    out.next = next;
    return out;
  }

  /* ---------- sessions, attendance, leave and cover ---------- */

  const RESCHEDULED_BY = ['Patient / family', 'Clinician', 'Supervisor', 'Other'];

  /* Session counts for one patient's appointments against the number allotted. */
  function sessionCounts(appts, allotted, today) {
    const t = today || todayISO();
    const c = { allotted: Number(allotted) || 0, attended: 0, missed: 0, cancelled: 0, upcoming: 0, rescheduled: 0 };
    appts.forEach(function (a) {
      c.rescheduled += (a.reschedules || []).length;
      if (a.status === 'attended' || a.status === 'completed') c.attended++;
      else if (a.status === 'missed') c.missed++;
      else if (a.status === 'cancelled') c.cancelled++;
      else if (a.date >= t) c.upcoming++;
    });
    c.remaining = Math.max(0, c.allotted - c.attended);
    c.attendanceRate = c.attended + c.missed ? Math.round(c.attended / (c.attended + c.missed) * 100) : null;
    return c;
  }

  function overlaps(a, b) {
    if (a.date !== b.date) return false;
    const s1 = toMinutes(a.time), e1 = s1 + (Number(a.duration) || 30);
    const s2 = toMinutes(b.time), e2 = s2 + (Number(b.duration) || 30);
    return s1 < e2 && s2 < e1;
  }

  function onLeave(userId, date, leaves) {
    return leaves.some(function (l) { return l.userId === userId && l.from <= date && date <= l.to; });
  }

  /* Who is actually seeing the patient in this session. */
  function clinicianFor(appt, patient) { return appt.coverBy || (patient && patient.assignedTo) || ''; }

  /* A user's sessions (own patients not covered by someone else, plus sessions they cover) in a date range. */
  function sessionsFor(userId, appts, patientsById, from, to) {
    return appts.filter(function (a) {
      if (a.status === 'cancelled' || (from && a.date < from) || (to && a.date > to)) return false;
      return clinicianFor(a, patientsById[a.patientId]) === userId;
    });
  }

  /*
   * Pick a cover clinician for one session: not on leave, free at that time, allowed to see this patient
   * (students only with consent), preferring the fewest sessions that day, then the lightest caseload.
   */
  function coverCandidates(appt, ctx) {
    const p = ctx.patientsById[appt.patientId];
    const busy = function (u) {
      return ctx.appts.some(function (b) {
        return b.id !== appt.id && b.status !== 'cancelled' && overlaps(appt, b) && clinicianFor(b, ctx.patientsById[b.patientId]) === u.id;
      });
    };
    const ranked = ctx.users.filter(function (u) {
      if (u.id === ctx.awayId || (u.role !== 'therapist' && u.role !== 'student')) return false;
      if (u.role === 'student' && !(p.consent && p.consent.students)) return false;
      return !onLeave(u.id, appt.date, ctx.leaves) && !busy(u);
    }).map(function (u) {
      return { user: u, day: sessionsFor(u.id, ctx.appts, ctx.patientsById, appt.date, appt.date).length, load: sessionsFor(u.id, ctx.appts, ctx.patientsById).length };
    }).sort(function (a, b) { return a.day - b.day || a.load - b.load || (a.user.role === 'therapist' ? -1 : 1); });
    return ranked.map(function (r) { return r.user; });
  }
  function pickCover(appt, ctx) { return coverCandidates(appt, ctx)[0] || null; }

  /* ---------- letters and emails after an assessment ---------- */

  const LETTER_KINDS = {
    'family-report': 'Assessment report to the family',
    'referrer-thanks': 'Thank you to the referrer',
    other: 'Other email'
  };

  function firstNameOf(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }

  /*
   * A first draft from what the assessment recorded. The clinician reads and edits it before sending.
   * Subjects carry no health details (they show in notifications and inbox lists).
   */
  function letterDraft(kind, c) {
    const a = c.assessment || {}, p = c.patient || {};
    const when = a.date ? formatDate(a.date, { day: 'numeric', month: 'long', year: 'numeric' }) : 'recently';
    const outcome = [a.diagnosis, a.severity ? '(' + a.severity.toLowerCase() + ')' : ''].filter(Boolean).join(' ');
    const next = c.referred ? 'We have referred ' + (kind === 'family-report' ? firstNameOf(p.name) : 'them') + ' to our therapy team, who will contact ' + (kind === 'family-report' ? 'you' : 'the family') + ' to arrange sessions.'
      : c.closed ? 'No therapy is needed at present.' : 'We will be in touch about the next steps.';
    const sign = ['', 'With best wishes,', c.assessor, c.clinic].filter(function (x, i) { return i < 2 || x; }).join('\n');
    if (kind === 'family-report') {
      const greet = p.guardian ? 'Dear ' + String(p.guardian).replace(/^.*?:\s*/, '') : 'Dear ' + (p.name || '');
      return {
        subject: 'Your assessment summary from ' + (c.clinic || 'the clinic'),
        body: [greet + ',', '',
          'Thank you for ' + (p.guardian ? 'bringing ' + firstNameOf(p.name) : 'coming') + ' for a speech and language assessment on ' + when + '. Here is a short summary.', '',
          a.tests ? 'What we did: ' + a.tests : '', a.findings ? 'What we found: ' + a.findings : '', outcome ? 'Outcome: ' + outcome : '',
          a.recommendations ? 'What we recommend: ' + a.recommendations + (a.frequency ? ' (' + a.frequency + ')' : '') : '', '', next, '',
          'Please reply or call us if you have any questions.', sign].filter(function (x, i, arr) { return x !== '' || arr[i - 1] !== ''; }).join('\n')
      };
    }
    if (kind === 'referrer-thanks') {
      return {
        subject: 'Thank you for your referral – ' + (p.caseCode || ''),
        body: ['Dear ' + (c.referrerName || 'colleague') + ',', '',
          'Thank you for referring ' + initials(p.name) + ' (our case ' + (p.caseCode || '') + ') to ' + (c.clinic || 'us') + '. We assessed them on ' + when + '.', '',
          outcome ? 'Outcome: ' + outcome : '', a.recommendations ? 'Plan: ' + a.recommendations + (a.frequency ? ' (' + a.frequency + ')' : '') : '', '', next, '',
          'Thank you again for thinking of us. Please contact us if you would like to discuss the case.', sign].filter(function (x, i, arr) { return x !== '' || arr[i - 1] !== ''; }).join('\n')
      };
    }
    return { subject: 'From ' + (c.clinic || 'the clinic'), body: ['Dear ,', '', '', sign].join('\n') };
  }

  /* A mailto: link opens the person's own email program with the draft filled in. Long texts are cut short by some programs. */
  function mailtoLink(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(String(body || '').replace(/\n/g, '\r\n'));
  }

  /* ---------- online sessions and calendars ---------- */

  /*
   * Video apps a session or meeting can be held on. TJS doesn't sign in to them: the clinician makes the meeting in the
   * app (newUrl opens its "new meeting" page) and pastes the join link back. Only https links on the app's own domains are kept.
   */
  const MEETING_APPS = {
    zoom: { label: 'Zoom', newUrl: 'https://zoom.us/meeting/schedule', host: /(^|\.)zoom\.(us|com)$/ },
    meet: { label: 'Google Meet', newUrl: 'https://meet.google.com/new', host: /^meet\.google\.com$/ },
    teams: { label: 'Microsoft Teams', newUrl: 'https://teams.microsoft.com/l/meeting/new', host: /^teams\.(microsoft|live)\.com$/ }
  };

  /* { app, url } for a join link from one of MEETING_APPS, or null (wrong app, not https, not a link at all). */
  function meetingLink(text, app) {
    let u;
    try { u = new URL(String(text || '').trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const found = Object.keys(MEETING_APPS).find(function (k) { return MEETING_APPS[k].host.test(host); });
    if (!found || (app && app !== found)) return null;
    return { app: found, url: u.href };
  }

  function icsStamp(date, time) { return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; }
  function icsText(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  /* Lines longer than 75 octets are folded, as the iCalendar format requires (counted in characters: close enough for ASCII). */
  function icsFold(line) {
    const out = [];
    while (line.length > 75) { out.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
    out.push(line);
    return out.join('\r\n');
  }
  function endOf(item) {
    const m = toMinutes(item.time) + (Number(item.duration) || 30);
    return { date: addDays(item.date, Math.floor(m / 1440)), time: fromMinutes(m % 1440) };
  }

  /*
   * An .ics file (Google Calendar, Outlook, Apple Calendar all import it). Items: { uid, date, time, duration, title, location, url, description }.
   * Times are "floating": the calendar shows them at the same clock time, in its own time zone.
   */
  function icsCalendar(items, now) {
    const stamp = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TJS//Speech therapy planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    (items || []).forEach(function (it) {
      const end = endOf(it);
      lines.push('BEGIN:VEVENT', 'UID:' + icsText(it.uid) + '@tjs', 'DTSTAMP:' + stamp, 'DTSTART:' + icsStamp(it.date, it.time), 'DTEND:' + icsStamp(end.date, end.time),
        'SUMMARY:' + icsText(it.title));
      if (it.location || it.url) lines.push('LOCATION:' + icsText(it.url || it.location));
      if (it.url) lines.push('URL:' + it.url);
      const desc = [it.description, it.url ? 'Join: ' + it.url : ''].filter(Boolean).join('\n');
      if (desc) lines.push('DESCRIPTION:' + icsText(desc));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  /* "Add to calendar" links that open Google Calendar or Outlook on the web with the event filled in (nothing is sent until the person saves it). */
  function calendarLinks(it) {
    const end = endOf(it);
    const desc = [it.description, it.url ? 'Join: ' + it.url : ''].filter(Boolean).join('\n');
    const where = it.url || it.location || '';
    const q = function (o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); };
    return {
      google: 'https://calendar.google.com/calendar/render?' + q({ action: 'TEMPLATE', text: it.title || '' }) + '&dates=' + icsStamp(it.date, it.time) + '/' + icsStamp(end.date, end.time) + '&' + q({ details: desc, location: where }),
      outlook: 'https://outlook.office.com/calendar/0/deeplink/compose?' + q({ path: '/calendar/action/compose', rru: 'addevent', subject: it.title || '',
        startdt: it.date + 'T' + it.time + ':00', enddt: end.date + 'T' + end.time + ':00', body: desc, location: where })
    };
  }

  /* ---------- team calendar ---------- */

  /* Monday of the week containing this date. */
  function weekStart(iso) {
    const d = new Date(iso + 'T00:00:00');
    return addDays(iso, -((d.getDay() + 6) % 7));
  }

  /*
   * Times when nobody in `busy` (intervals in minutes since midnight) is booked, within the working day,
   * leaving out lunch, keeping only gaps of at least `minMinutes`.
   */
  function freeSlots(busy, dayStart, dayEnd, minMinutes, lunch) {
    const start = toMinutes(dayStart || '08:00'), end = toMinutes(dayEnd || '17:00');
    const blocks = busy.slice();
    if (lunch && lunch.start && lunch.end) blocks.push({ start: toMinutes(lunch.start), end: toMinutes(lunch.end) });
    blocks.sort(function (a, b) { return a.start - b.start; });
    const out = [];
    let t = start;
    blocks.forEach(function (b) {
      if (b.end <= t) return;
      if (b.start > t) out.push({ start: t, end: Math.min(b.start, end) });
      t = Math.max(t, b.end);
    });
    if (t < end) out.push({ start: t, end: end });
    return out.filter(function (g) { return g.end - g.start >= (minMinutes || 30); });
  }

  /* ---------- per-patient backup bundles (for crypto-shredding) ---------- */

  const PATIENT_COLLECTIONS = ['goals', 'appointments', 'logs', 'assessments', 'referrals', 'documents', 'messages', 'audit', 'reminders', 'consents', 'attachments', 'letters'];

  /*
   * Split app data into what is shared (people, materials, settings, receipts) and one bundle per patient,
   * so each patient's bundle can be encrypted with that patient's own key.
   */
  function splitForBackup(state) {
    const shared = {};
    Object.keys(state).forEach(function (k) {
      if (k === 'patients') return;
      shared[k] = PATIENT_COLLECTIONS.indexOf(k) >= 0 ? (state[k] || []).filter(function (x) { return !x.patientId; }) : state[k];
    });
    const bundles = {};
    (state.patients || []).forEach(function (p) {
      const b = { patient: p };
      PATIENT_COLLECTIONS.forEach(function (k) { b[k] = (state[k] || []).filter(function (x) { return x.patientId === p.id; }); });
      bundles[p.id] = b;
    });
    return { shared: shared, bundles: bundles };
  }

  /* Rebuild app data from the shared part and whichever patient bundles could be decrypted. */
  function mergeBundles(shared, bundles) {
    const s = JSON.parse(JSON.stringify(shared));
    s.patients = [];
    PATIENT_COLLECTIONS.forEach(function (k) { s[k] = s[k] || []; });
    bundles.forEach(function (b) {
      s.patients.push(b.patient);
      PATIENT_COLLECTIONS.forEach(function (k) { s[k] = s[k].concat(b[k] || []); });
    });
    s.audit.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    return s;
  }

  /* ---------- appointment reminders: SMS or WhatsApp Business ---------- */

  const CHANNELS = { sms: 'SMS', whatsapp: 'WhatsApp Business' };
  // Reminder channels the server can also use on its own (history only; patients choose SMS or WhatsApp above).
  const CHANNEL_LABELS = { sms: 'SMS', whatsapp: 'WhatsApp Business', email: 'Email' };

  /*
   * Which channel to use for a patient, or null with a reason.
   * Clinic setting: 'sms', 'whatsapp' or 'both' (patient chooses). Patient preference: 'default', 'sms', 'whatsapp' or 'none'.
   */
  function reminderChannel(patient, messaging) {
    const pref = patient.reminders || {};
    if (!pref.optIn) return { channel: null, reason: 'No opt-in recorded' };
    if (!pref.phone) return { channel: null, reason: 'No mobile number' };
    if (pref.channel === 'none') return { channel: null, reason: 'Chose no reminders' };
    const clinic = (messaging && messaging.channel) || 'sms';
    let ch = pref.channel && pref.channel !== 'default' ? pref.channel : (clinic === 'both' ? (messaging.defaultChannel || 'sms') : clinic);
    if (clinic !== 'both' && ch !== clinic) ch = clinic; // the clinic only uses one channel
    return { channel: ch };
  }

  /* Fill a reminder template. Only neutral fields are available: no names, conditions or notes. */
  function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(clinic|day|date|time|link|meeting)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  /* Words that suggest health details leaked into a reminder template. */
  function templateWarnings(tpl) {
    const out = [];
    if (/\{(?!(clinic|day|date|time|link|meeting)\})[^}]*\}/.test(tpl)) out.push('Unknown placeholder – use {clinic}, {day}, {date}, {time}, {link} and {meeting} only.');
    if (/therap|speech|stammer|stutter|autis|aphasia|stroke|cleft|dysphag|diagnos|disorder|delay/i.test(tpl)) out.push('Avoid health words in reminders – a lock screen or shared phone can show them.');
    return out;
  }

  /* SMS length: 160 characters per part (70 if any non-GSM character such as Hindi or emoji). */
  function smsParts(text) {
    const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà]*$/.test(text);
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    return { chars: text.length, unicode: !gsm, parts: text.length <= single ? 1 : Math.ceil(text.length / multi) };
  }

  function maskPhone(phone) {
    const d = String(phone || '').replace(/\s+/g, '');
    return d.length > 4 ? d.slice(0, d.length - 7).replace(/./g, function (c, i) { return i < 3 ? c : '•'; }) + '•••' + d.slice(-4) : d;
  }

  const PROGRESS_LABELS = {
    improving: 'Improving',
    steady: 'Steady',
    emerging: 'Emerging',
    regressing: 'Needs more support',
    met: 'Goal criterion met'
  };

  /* Plain-language session summary to send to the client/family. */
  function clientReport(opts) {
    const p = opts.patient, log = opts.log, goalsById = opts.goalsById;
    const therapist = opts.therapist || 'Your speech therapist';
    const first = (p.name || '').split(' ')[0] || 'your child';
    const direct = ageGroup(p) === 'Adult' && !p.guardian;
    const lines = [];
    lines.push('Session summary for ' + p.name + ' — ' + formatDate(log.date));
    lines.push('');
    lines.push(('Hello ' + (direct ? first : p.guardian || '')).trim() + ',');
    lines.push('');
    lines.push('Here is a summary of ' + (direct ? 'your' : first + "'s") + ' speech therapy session today.');
    lines.push('');
    lines.push('What we worked on:');
    (log.entries || []).forEach(function (e) {
      const g = goalsById[e.goalId];
      if (!g) return;
      const acc = e.accuracy != null ? e.accuracy : accuracy(e.correct, e.trials);
      if (acc == null && !e.trials && !e.progress && !e.note) return; // not worked on this session
      let line = '• ' + (g.title || g.specific);
      const bits = [];
      if (acc != null) bits.push(acc + '% accuracy');
      if (e.trials) bits.push(e.correct + ' of ' + e.trials + ' attempts');
      if (e.cueing) bits.push(e.cueing.toLowerCase() + ' cues');
      if (bits.length) line += ': ' + bits.join(', ');
      if (e.progress && PROGRESS_LABELS[e.progress]) line += ' (' + PROGRESS_LABELS[e.progress] + ')';
      lines.push(line);
      if (e.note) lines.push('   ' + e.note);
    });
    if (log.notes) {
      lines.push('');
      lines.push('Session notes:');
      lines.push(log.notes);
    }
    if (log.homework) {
      lines.push('');
      lines.push('Practice at home:');
      lines.push(log.homework);
    }
    lines.push('');
    lines.push('Please reach out with any questions.');
    lines.push(therapist);
    return lines.join('\n');
  }

  const api = {
    uid: uid, toISODate: toISODate, todayISO: todayISO, addDays: addDays,
    formatDate: formatDate, formatTime: formatTime, accuracy: accuracy, age: age,
    smartStatement: smartStatement, goalSeries: goalSeries, goalStats: goalStats,
    materialsForDay: materialsForDay, appointmentMaterialIds: appointmentMaterialIds,
    clientReport: clientReport, PROGRESS_LABELS: PROGRESS_LABELS,
    toMinutes: toMinutes, fromMinutes: fromMinutes, layoutDay: layoutDay, splitByLunch: splitByLunch,
    CONDITIONS: CONDITIONS, conditionFamily: conditionFamily, ageGroup: ageGroup, caseLabel: caseLabel,
    ROLES: ROLES, initials: initials, caseCode: caseCode, canSeePatient: canSeePatient, canAllot: canAllot,
    addYears: addYears, isPastRetention: isPastRetention, DOC_TYPES: DOC_TYPES, DOC_FIELDS: DOC_FIELDS, DOC_STATUS: DOC_STATUS,
    prefillDoc: prefillDoc, caseProgress: caseProgress,
    RESCHEDULED_BY: RESCHEDULED_BY, sessionCounts: sessionCounts, overlaps: overlaps, onLeave: onLeave,
    clinicianFor: clinicianFor, sessionsFor: sessionsFor, pickCover: pickCover, coverCandidates: coverCandidates,
    PATIENT_COLLECTIONS: PATIENT_COLLECTIONS, splitForBackup: splitForBackup, mergeBundles: mergeBundles,
    weekStart: weekStart, freeSlots: freeSlots, CHANNEL_LABELS: CHANNEL_LABELS, LETTER_KINDS: LETTER_KINDS, letterDraft: letterDraft, mailtoLink: mailtoLink,
    MEETING_APPS: MEETING_APPS, meetingLink: meetingLink, icsCalendar: icsCalendar, calendarLinks: calendarLinks,
    CHANNELS: CHANNELS, reminderChannel: reminderChannel, fillTemplate: fillTemplate, templateWarnings: templateWarnings, smsParts: smsParts, maskPhone: maskPhone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);

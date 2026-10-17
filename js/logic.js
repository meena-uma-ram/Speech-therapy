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
  function canSeePatient(user, p) {
    if (!user || !p) return false;
    switch (user.role) {
      case 'supervisor': return true;
      case 'diagnostician': return p.status === 'waiting' || p.status === 'referred' || p.assessedBy === user.id;
      case 'therapist': return p.assignedTo === user.id || p.status === 'referred';
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
    prefillDoc: prefillDoc, caseProgress: caseProgress
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);

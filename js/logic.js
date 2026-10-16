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
    const lines = [];
    lines.push('Session summary for ' + p.name + ' — ' + formatDate(log.date));
    lines.push('');
    lines.push('Hello' + (p.guardian ? ' ' + p.guardian : '') + ',');
    lines.push('');
    lines.push('Here is a summary of ' + first + "'s speech therapy session today.");
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
    clientReport: clientReport, PROGRESS_LABELS: PROGRESS_LABELS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);

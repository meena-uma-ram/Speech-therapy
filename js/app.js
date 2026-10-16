/* UI: hash router, views and forms. */
(function () {
  'use strict';
  const L = window.Logic;
  const S = window.Store;
  const view = document.getElementById('view');
  const modal = document.getElementById('modal');

  const AREAS = ['Articulation', 'Phonology', 'Expressive language', 'Receptive language', 'Fluency', 'Voice', 'Pragmatics', 'AAC', 'Feeding / swallowing', 'Literacy', 'Other'];
  const CUEING = ['Independent', 'Minimal', 'Moderate', 'Maximal'];
  const PROGRESS = ['improving', 'steady', 'emerging', 'regressing', 'met'];
  const TREND = { up: '▲ Improving', down: '▼ Declining', steady: '► Steady', none: '—' };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function opt(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function maps() {
    const st = S.state;
    return { goals: S.byId(st.goals), materials: S.byId(st.materials), patients: S.byId(st.patients) };
  }
  function parseHash() {
    const raw = route.replace(/^#\/?/, '') || 'schedule';
    const [path, qs] = raw.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach(function (kv) {
      const [k, v] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { parts: path.split('/').filter(Boolean), params: params };
  }
  let route = location.hash || '#/schedule';
  function go(hash) {
    if (hash === route) return;
    route = hash;
    try { history.replaceState(null, '', hash); } catch (e) { /* sandboxed frame */ }
    render();
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function ask(message, okLabel) {
    const dlg = document.getElementById('confirm');
    dlg.innerHTML = '<form method="dialog" class="confirm-form"><p>' + esc(message) + '</p><div class="actions">' +
      '<button class="btn" value="no">Cancel</button> <button class="btn btn-danger-solid" value="yes">' + esc(okLabel || 'Delete') + '</button></div></form>';
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function done() { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'yes'); });
      dlg.returnValue = '';
      dlg.showModal();
      dlg.querySelector('[value=no]').focus();
    });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }, fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e) { toast('Copy failed – select and copy manually'); }
      ta.remove();
    }
  }
  function statusBadge(appt) {
    const log = S.logForAppointment(appt.id);
    if (appt.status === 'cancelled') return '<span class="badge badge-muted">Cancelled</span>';
    if (log && log.reportSent) return '<span class="badge badge-good">Report sent</span>';
    if (log) return '<span class="badge badge-info">Logged</span>';
    return '<span class="badge">Scheduled</span>';
  }
  function dateNav(base, date, extra) {
    return '<div class="date-nav">' +
      '<a class="btn btn-ghost" href="#/' + base + '?date=' + L.addDays(date, -1) + '" aria-label="Previous day">‹</a>' +
      '<input type="date" class="date-input" data-nav="' + base + '" value="' + date + '" aria-label="Choose date">' +
      '<a class="btn btn-ghost" href="#/' + base + '?date=' + L.addDays(date, 1) + '" aria-label="Next day">›</a>' +
      (date !== L.todayISO() ? '<a class="btn btn-ghost" href="#/' + base + '?date=' + L.todayISO() + '">Today</a>' : '') +
      (extra || '') + '</div>';
  }
  function tabs(baseHash, current, list) {
    return '<nav class="tabs" role="tablist">' + list.map(function (t) {
      return '<a role="tab" class="tab' + (t[0] === current ? ' active' : '') + '" href="' + baseHash + '?tab=' + t[0] + '"' +
        (t[0] === current ? ' aria-selected="true"' : '') + '>' + esc(t[1]) + '</a>';
    }).join('') + '</nav>';
  }
  function trendClass(t) { return t === 'up' ? 'good' : t === 'down' ? 'bad' : ''; }

  /* ---------- progress chart (inline SVG) ---------- */

  function chart(series, target) {
    if (!series.length) return '<p class="muted small">No data logged yet.</p>';
    const W = 560, H = 180, pl = 34, pr = 12, pt = 12, pb = 26;
    const iw = W - pl - pr, ih = H - pt - pb;
    const x = function (i) { return pl + (series.length === 1 ? iw / 2 : i * iw / (series.length - 1)); };
    const y = function (v) { return pt + ih - v / 100 * ih; };
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Accuracy over time">';
    [0, 25, 50, 75, 100].forEach(function (v) {
      svg += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    });
    if (target) {
      svg += '<line class="target" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(target) + '" y2="' + y(target) + '"/>' +
        '<text class="target-label" x="' + (W - pr) + '" y="' + (y(target) - 5) + '" text-anchor="end">Target ' + target + '%</text>';
    }
    const pts = series.map(function (p, i) { return x(i) + ',' + y(p.accuracy); }).join(' ');
    svg += '<polyline class="line" points="' + pts + '"/>';
    const step = Math.ceil(series.length / 8);
    series.forEach(function (p, i) {
      svg += '<circle class="dot" cx="' + x(i) + '" cy="' + y(p.accuracy) + '" r="4"><title>' +
        esc(L.formatDate(p.date, { month: 'short', day: 'numeric' }) + ': ' + p.accuracy + '%') + '</title></circle>';
      if (i % step === 0 || i === series.length - 1) {
        svg += '<text class="axis" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' +
          esc(L.formatDate(p.date, { month: 'numeric', day: 'numeric' })) + '</text>';
      }
    });
    return svg + '</svg>';
  }

  function goalProgressCard(goal, logs) {
    const series = L.goalSeries(goal.id, logs);
    const st = L.goalStats(series, goal.targetAccuracy);
    return '<article class="card">' +
      '<div class="card-head"><div><span class="chip">' + esc(goal.area) + '</span> <strong>' + esc(goal.title) + '</strong></div>' +
      (st.metTarget ? '<span class="badge badge-good">At target</span>' : '') + '</div>' +
      '<div class="stats">' +
      '<div><span class="stat">' + (st.latest != null ? st.latest + '%' : '—') + '</span><span class="muted small">Latest</span></div>' +
      '<div><span class="stat">' + (st.average != null ? st.average + '%' : '—') + '</span><span class="muted small">Average</span></div>' +
      '<div><span class="stat">' + st.sessions + '</span><span class="muted small">Sessions</span></div>' +
      '<div><span class="stat ' + trendClass(st.trend) + '">' + TREND[st.trend] + '</span><span class="muted small">Trend</span></div>' +
      '</div>' + chart(series, goal.targetAccuracy) + '</article>';
  }

  /* ---------- views ---------- */

  function viewSchedule(params) {
    const date = params.date || L.todayISO();
    const appts = S.appointmentsOn(date);
    const m = maps();
    const active = appts.filter(function (a) { return a.status !== 'cancelled'; });
    const logged = active.filter(function (a) { return S.logForAppointment(a.id); });
    const sent = logged.filter(function (a) { return S.logForAppointment(a.id).reportSent; });
    const common = L.materialsForDay(appts, m.goals, m.materials, m.patients).filter(function (x) { return x.count > 1; });

    let html = '<header class="page-head"><div><h1>Schedule</h1><p class="muted">' + esc(L.formatDate(date)) + '</p></div>' +
      '<button class="btn btn-primary" data-action="new-appt" data-date="' + date + '">+ Add session</button></header>' +
      dateNav('schedule', date);

    html += '<div class="summary">' +
      '<div><span class="stat">' + active.length + '</span><span class="muted small">Sessions</span></div>' +
      '<div><span class="stat">' + logged.length + '/' + active.length + '</span><span class="muted small">Logged</span></div>' +
      '<div><span class="stat">' + sent.length + '/' + logged.length + '</span><span class="muted small">Reports sent</span></div>' +
      '<a href="#/materials?date=' + date + '"><span class="stat">' + common.length + '</span><span class="muted small">Shared materials →</span></a>' +
      '</div>';

    if (!appts.length) {
      html += '<div class="empty"><p>No sessions scheduled for this day.</p></div>';
    } else {
      html += '<ol class="schedule">' + appts.map(function (a) {
        const p = m.patients[a.patientId] || { name: 'Unknown patient' };
        const goals = (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean);
        const mats = L.appointmentMaterialIds(a, m.goals).map(function (id) { return m.materials[id]; }).filter(Boolean);
        return '<li><a class="appt' + (a.status === 'cancelled' ? ' cancelled' : '') + '" href="#/session/' + a.id + '">' +
          '<div class="appt-time"><strong>' + esc(L.formatTime(a.time)) + '</strong><span class="muted small">' + esc(a.duration || 30) + ' min' + (a.room ? ' · ' + esc(a.room) : '') + '</span></div>' +
          '<div class="appt-body"><div class="appt-title"><strong>' + esc(p.name) + '</strong>' + statusBadge(a) + '</div>' +
          '<div class="muted small">' + esc(p.diagnosis || '') + '</div>' +
          '<div class="appt-meta"><span class="meta-label">Goals</span> <span>' + goals.map(function (g) { return esc(g.title); }).join(' · ') + '</span></div>' +
          '<div class="appt-meta muted small"><span class="meta-label">Materials</span> ' + (mats.length ? mats.map(function (x) { return esc(x.name); }).join(', ') : 'No materials listed') + '</div>' +
          '</div><span class="chev" aria-hidden="true">›</span></a></li>';
      }).join('') + '</ol>';
    }
    return html;
  }

  function viewSession(apptId, params) {
    const a = S.appointment(apptId);
    if (!a) return '<div class="empty"><p>Session not found.</p><a href="#/schedule">Back to schedule</a></div>';
    const m = maps();
    const p = m.patients[a.patientId] || { name: 'Unknown' };
    const tab = params.tab || 'prep';
    const base = '#/session/' + a.id;
    const log = S.logForAppointment(a.id);

    let html = '<a class="back" href="#/schedule?date=' + a.date + '">‹ Schedule</a>' +
      '<header class="page-head"><div><h1>' + esc(p.name) + '</h1><p class="muted">' +
      esc(L.formatDate(a.date, { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' + esc(L.formatTime(a.time)) +
      ' · ' + esc(a.duration || 30) + ' min' + (a.room ? ' · ' + esc(a.room) : '') + ' ' + statusBadge(a) + '</p>' +
      '<p class="small muted">' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</p></div>' +
      '<div class="head-actions"><a class="btn btn-ghost" href="#/patients/' + p.id + '">Patient file</a>' +
      '<button class="btn btn-ghost" data-action="edit-appt" data-id="' + a.id + '">Edit session</button></div></header>' +
      tabs(base, tab, [['prep', 'Goals & materials'], ['log', log ? 'Session log ✓' : 'Log session'], ['progress', 'Progress'], ['report', 'Report']]);

    const goals = (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean);

    if (tab === 'prep') {
      const matIds = L.appointmentMaterialIds(a, m.goals);
      const packed = S.state.packed[a.date] || {};
      html += '<section><h2>Goals for this session</h2>';
      if (!goals.length) html += '<p class="muted">No goals selected. <button class="link" data-action="edit-appt" data-id="' + a.id + '">Choose goals</button></p>';
      html += goals.map(function (g) {
        const st = L.goalStats(L.goalSeries(g.id, S.logsForPatient(p.id)), g.targetAccuracy);
        return '<article class="card goal-card"><div class="card-head"><div><span class="chip">' + esc(g.area) + '</span> <strong>' + esc(g.title) + '</strong></div>' +
          '<span class="small muted">Last: ' + (st.latest != null ? st.latest + '%' : '—') + ' · Target ' + esc(g.targetAccuracy || '—') + '%</span></div>' +
          '<p>' + esc(L.smartStatement(g)) + '</p>' + smartGrid(g) + '</article>';
      }).join('');
      html += '</section><section><h2>Materials to bring</h2>';
      html += matIds.length ? '<ul class="checklist">' + matIds.map(function (id) {
        const mat = m.materials[id];
        return '<li><label><input type="checkbox" data-action="pack" data-date="' + a.date + '" data-id="' + id + '"' + (packed[id] ? ' checked' : '') + '> ' +
          '<span>' + esc(mat.name) + '</span></label><span class="muted small">' + esc(mat.location || '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted">No materials linked to these goals.</p>';
      html += '</section><div class="actions"><a class="btn btn-primary" href="' + base + '?tab=log">Start session log →</a></div>';
    }

    if (tab === 'log') html += sessionLogForm(a, goals, log);

    if (tab === 'progress') {
      const logs = S.logsForPatient(p.id);
      html += goals.length ? goals.map(function (g) { return goalProgressCard(g, logs); }).join('') : '<p class="muted">No goals for this session.</p>';
      html += '<p><a href="#/patients/' + p.id + '?tab=progress">See all of ' + esc(p.name.split(' ')[0]) + '\'s goals →</a></p>';
    }

    if (tab === 'report') {
      if (!log) {
        html += '<div class="empty"><p>Log the session first, then the report is generated for you.</p><a class="btn btn-primary" href="' + base + '?tab=log">Log session</a></div>';
      } else {
        html += reportPanel(log, p, m);
      }
    }
    return html;
  }

  function smartGrid(g) {
    const rows = [['S', 'Specific', g.specific], ['M', 'Measurable', g.measurable], ['A', 'Achievable', g.achievable], ['R', 'Relevant', g.relevant],
      ['T', 'Time-bound', g.timeBound ? 'By ' + L.formatDate(g.timeBound, { month: 'short', day: 'numeric', year: 'numeric' }) : '']];
    return '<dl class="smart">' + rows.map(function (r) {
      return '<div><dt title="' + r[1] + '">' + r[0] + '</dt><dd><span class="muted small">' + r[1] + '</span> ' + esc(r[2] || '—') + '</dd></div>';
    }).join('') + '</dl>';
  }

  function sessionLogForm(a, goals, log) {
    const entries = {};
    (log ? log.entries : []).forEach(function (e) { entries[e.goalId] = e; });
    if (!goals.length) return '<p class="muted">Add goals to this session before logging.</p>';
    return '<form id="log-form" data-appt="' + a.id + '">' + goals.map(function (g) {
      const e = entries[g.id] || {};
      return '<fieldset class="card log-entry" data-goal="' + g.id + '"><legend><span class="chip">' + esc(g.area) + '</span> ' + esc(g.title) +
        ' <span class="muted small">target ' + esc(g.targetAccuracy || '—') + '%</span></legend>' +
        '<div class="grid-4">' +
        '<label>Times done (trials)<input type="number" min="0" inputmode="numeric" name="trials" value="' + esc(e.trials || '') + '"></label>' +
        '<label>Correct<input type="number" min="0" inputmode="numeric" name="correct" value="' + esc(e.correct != null ? e.correct : '') + '"></label>' +
        '<label>Accuracy %<input type="number" min="0" max="100" inputmode="numeric" name="accuracy" value="' + esc(e.accuracy != null ? e.accuracy : '') + '"></label>' +
        '<label>Cueing<select name="cueing">' + opt('', '—') + CUEING.map(function (c) { return opt(c, c, e.cueing === c); }).join('') + '</select></label>' +
        '</div>' +
        '<div class="field"><span class="label">Progress</span><div class="segmented">' + PROGRESS.map(function (k) {
          return '<label><input type="radio" name="progress-' + g.id + '" value="' + k + '"' + (e.progress === k ? ' checked' : '') + '><span>' + esc(L.PROGRESS_LABELS[k]) + '</span></label>';
        }).join('') + '</div></div>' +
        '<label>Notes for this goal<textarea name="note" rows="2" placeholder="e.g. Better with visual cue; errors on /sk/ blends">' + esc(e.note || '') + '</textarea></label>' +
        '</fieldset>';
    }).join('') +
      '<div class="card"><label>Session notes (SOAP / journal)<textarea name="notes" rows="4" placeholder="Behaviour, engagement, strategies used, plan for next session">' + esc(log ? log.notes : '') + '</textarea></label>' +
      '<label>Home practice<textarea name="homework" rows="2" placeholder="What the family can practise this week">' + esc(log ? log.homework : '') + '</textarea></label></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary">Save &amp; create report</button></div></form>';
  }

  function reportPanel(log, p, m) {
    const text = log.reportText || L.clientReport({ patient: p, log: log, goalsById: m.goals, therapist: S.state.settings.therapistName });
    const email = /@/.test(p.contact || '') ? p.contact : '';
    const subject = 'Speech therapy session summary – ' + L.formatDate(log.date, { month: 'short', day: 'numeric' });
    return '<section class="card"><div class="card-head"><h2>Client report</h2>' +
      (log.reportSent ? '<span class="badge badge-good">Sent</span>' : '<span class="badge">Not sent</span>') + '</div>' +
      '<p class="muted small">Edit freely; changes are saved with this session.</p>' +
      '<textarea id="report-text" data-log="' + log.id + '" rows="16">' + esc(text) + '</textarea>' +
      '<div class="actions wrap">' +
      '<button class="btn" data-action="copy-report">Copy</button>' +
      (email ? '<a class="btn" data-action="email-report" href="mailto:' + esc(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) + '">Email ' + esc(p.guardian || 'family') + '</a>' : '') +
      '<button class="btn" data-action="regen-report" data-log="' + log.id + '">Regenerate from log</button>' +
      '<button class="btn btn-primary" data-action="toggle-sent" data-log="' + log.id + '">' + (log.reportSent ? 'Mark as not sent' : 'Mark as sent') + '</button>' +
      '</div></section>';
  }

  function viewPatients() {
    const st = S.state;
    let html = '<header class="page-head"><div><h1>Patients</h1><p class="muted">' + st.patients.length + ' on caseload</p></div>' +
      '<button class="btn btn-primary" data-action="new-patient">+ Add patient</button></header>';
    if (!st.patients.length) return html + '<div class="empty"><p>No patients yet.</p></div>';
    html += '<ul class="list">' + st.patients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) {
      const goals = S.goalsForPatient(p.id).filter(function (g) { return g.status === 'active'; });
      const next = st.appointments.filter(function (a) { return a.patientId === p.id && a.date >= L.todayISO() && a.status !== 'cancelled'; })
        .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })[0];
      return '<li><a class="row" href="#/patients/' + p.id + '"><div><strong>' + esc(p.name) + '</strong>' +
        '<div class="muted small">' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</div></div>' +
        '<div class="right small"><div>' + goals.length + ' active goal' + (goals.length === 1 ? '' : 's') + '</div>' +
        '<div class="muted">' + (next ? 'Next: ' + esc(L.formatDate(next.date, { month: 'short', day: 'numeric' })) + ' ' + esc(L.formatTime(next.time)) : 'No upcoming session') + '</div></div></a></li>';
    }).join('') + '</ul>';
    return html;
  }

  function viewPatient(id, params) {
    const p = S.patient(id);
    if (!p) return '<div class="empty"><p>Patient not found.</p><a href="#/patients">Back</a></div>';
    const tab = params.tab || 'goals';
    const base = '#/patients/' + p.id;
    const goals = S.goalsForPatient(p.id);
    const logs = S.logsForPatient(p.id);
    const m = maps();

    let html = '<a class="back" href="#/patients">‹ Patients</a>' +
      '<header class="page-head"><div><h1>' + esc(p.name) + '</h1>' +
      '<p class="muted">' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</p>' +
      '<p class="small muted">' + esc([p.guardian, p.contact].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="head-actions"><button class="btn btn-ghost" data-action="edit-patient" data-id="' + p.id + '">Edit</button>' +
      '<button class="btn btn-ghost" data-action="new-appt" data-patient="' + p.id + '">+ Session</button></div></header>' +
      tabs(base, tab, [['goals', 'SMART goals'], ['progress', 'Progress'], ['history', 'Session journal']]);

    if (tab === 'goals') {
      html += '<div class="actions"><button class="btn btn-primary" data-action="new-goal" data-patient="' + p.id + '">+ Add SMART goal</button></div>';
      html += goals.length ? goals.map(function (g) { return goalCard(g, m, false); }).join('') : '<p class="muted">No goals yet.</p>';
    }
    if (tab === 'progress') {
      const active = goals.filter(function (g) { return g.status !== 'discontinued'; });
      html += active.length ? active.map(function (g) { return goalProgressCard(g, logs); }).join('') : '<p class="muted">No goals yet.</p>';
    }
    if (tab === 'history') {
      const sorted = logs.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
      html += sorted.length ? sorted.map(function (log) {
        return '<article class="card"><div class="card-head"><strong>' + esc(L.formatDate(log.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) + '</strong>' +
          (log.appointmentId ? '<a class="small" href="#/session/' + log.appointmentId + '?tab=log">Open</a>' : '') + '</div>' +
          '<table class="tbl"><thead><tr><th>Goal</th><th>Trials</th><th>Acc.</th><th>Cueing</th><th>Progress</th></tr></thead><tbody>' +
          log.entries.map(function (e) {
            const g = m.goals[e.goalId];
            return '<tr><td>' + esc(g ? g.title : '(deleted goal)') + (e.note ? '<div class="muted small">' + esc(e.note) + '</div>' : '') + '</td><td>' + esc(e.trials != null ? e.correct + '/' + e.trials : '') + '</td><td>' +
              esc(e.accuracy != null ? e.accuracy + '%' : '') + '</td><td>' + esc(e.cueing || '') + '</td><td>' + esc(L.PROGRESS_LABELS[e.progress] || '') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (log.notes ? '<p class="small"><strong>Notes:</strong> ' + esc(log.notes) + '</p>' : '') +
          (log.homework ? '<p class="small"><strong>Home practice:</strong> ' + esc(log.homework) + '</p>' : '') + '</article>';
      }).join('') : '<p class="muted">No sessions logged yet.</p>';
    }
    return html;
  }

  function goalCard(g, m, showPatient) {
    const p = m.patients[g.patientId];
    const mats = (g.materialIds || []).map(function (id) { return m.materials[id]; }).filter(Boolean);
    const statusCls = g.status === 'met' ? 'badge-good' : g.status === 'active' ? 'badge-info' : 'badge-muted';
    return '<article class="card goal-card"><div class="card-head"><div>' +
      (showPatient && p ? '<a class="small" href="#/patients/' + p.id + '">' + esc(p.name) + '</a><br>' : '') +
      '<span class="chip">' + esc(g.area) + '</span> <strong>' + esc(g.title) + '</strong></div>' +
      '<div class="head-actions"><span class="badge ' + statusCls + '">' + esc(g.status) + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="edit-goal" data-id="' + g.id + '">Edit</button></div></div>' +
      '<p>' + esc(L.smartStatement(g)) + '</p>' + smartGrid(g) +
      '<p class="small"><span class="muted">Materials:</span> ' + (mats.length ? mats.map(function (x) { return esc(x.name); }).join(', ') : '—') + '</p></article>';
  }

  function viewGoals(params) {
    const st = S.state, m = maps();
    const f = { patient: params.patient || '', area: params.area || '', status: 'status' in params ? params.status : 'active' };
    const list = st.goals.filter(function (g) {
      return (!f.patient || g.patientId === f.patient) && (!f.area || g.area === f.area) && (!f.status || g.status === f.status);
    });
    let html = '<header class="page-head"><div><h1>Goals</h1><p class="muted">SMART goals across your caseload</p></div>' +
      '<button class="btn btn-primary" data-action="new-goal">+ Add goal</button></header>' +
      '<div class="filters" id="goal-filters">' +
      '<select name="patient" aria-label="Patient">' + opt('', 'All patients') + st.patients.map(function (p) { return opt(p.id, p.name, f.patient === p.id); }).join('') + '</select>' +
      '<select name="area" aria-label="Area">' + opt('', 'All areas') + AREAS.map(function (a) { return opt(a, a, f.area === a); }).join('') + '</select>' +
      '<select name="status" aria-label="Status">' + opt('', 'Any status', !f.status) + ['active', 'met', 'paused', 'discontinued'].map(function (s) { return opt(s, s[0].toUpperCase() + s.slice(1), f.status === s); }).join('') + '</select>' +
      '</div>';
    html += list.length ? list.map(function (g) { return goalCard(g, m, true); }).join('') : '<div class="empty"><p>No goals match.</p></div>';
    return html;
  }

  function viewMaterials(params) {
    const tab = params.tab || 'day';
    const date = params.date || L.todayISO();
    const m = maps();
    let html = '<header class="page-head"><div><h1>Materials</h1><p class="muted">' +
      (tab === 'day' ? esc(L.formatDate(date)) : 'Your materials library') + '</p></div>' +
      (tab === 'library' ? '<button class="btn btn-primary" data-action="new-material">+ Add material</button>' : '<button class="btn" data-action="copy-picklist" data-date="' + date + '">Copy pick list</button>') +
      '</header>' +
      '<nav class="tabs"><a class="tab' + (tab === 'day' ? ' active' : '') + '" href="#/materials?tab=day&date=' + date + '">For the day</a>' +
      '<a class="tab' + (tab === 'library' ? ' active' : '') + '" href="#/materials?tab=library">Library</a></nav>';

    if (tab === 'library') {
      const used = {};
      S.state.goals.forEach(function (g) { (g.materialIds || []).forEach(function (id) { (used[id] = used[id] || []).push(g); }); });
      const mats = S.state.materials.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name); });
      if (!mats.length) return html + '<div class="empty"><p>No materials yet.</p></div>';
      return html + '<ul class="list">' + mats.map(function (x) {
        const goals = used[x.id] || [];
        return '<li><div class="row"><div><strong>' + esc(x.name) + '</strong><div class="muted small">' + esc([x.category, x.location].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="small">' + (goals.length ? 'Used for: ' + goals.map(function (g) { return esc((m.patients[g.patientId] || {}).name + ' – ' + g.title); }).join('; ') : '<span class="muted">Not linked to any goal</span>') + '</div></div>' +
          '<button class="btn btn-ghost btn-sm" data-action="edit-material" data-id="' + x.id + '">Edit</button></div></li>';
      }).join('') + '</ul>';
    }

    const appts = S.appointmentsOn(date).filter(function (a) { return a.status !== 'cancelled'; });
    const all = L.materialsForDay(appts, m.goals, m.materials, m.patients);
    const packed = S.state.packed[date] || {};
    const common = all.filter(function (x) { return x.count > 1; });
    const packedCount = all.filter(function (x) { return packed[x.material.id]; }).length;
    html += dateNav('materials', date);

    if (!appts.length) return html + '<div class="empty"><p>No sessions on this day.</p></div>';

    html += '<p class="muted small">' + packedCount + ' of ' + all.length + ' items ready. Ticks are shared across this day\'s views.</p>';
    const item = function (x, showWho) {
      return '<li><label><input type="checkbox" data-action="pack" data-date="' + date + '" data-id="' + x.material.id + '"' + (packed[x.material.id] ? ' checked' : '') + '> ' +
        '<span>' + esc(x.material.name) + '</span></label>' +
        '<span class="muted small">' + (showWho ? esc(x.sessions.map(function (s) { return (s.patient || {}).name; }).join(', ')) + (x.material.location ? ' · ' : '') : '') + esc(x.material.location || '') + '</span></li>';
    };
    html += '<section><h2>Common materials <span class="muted small">needed in 2+ sessions</span></h2>' +
      (common.length ? '<ul class="checklist">' + common.map(function (x) { return item(x, true); }).join('') + '</ul>' : '<p class="muted">No materials are shared between sessions today.</p>') + '</section>';
    html += '<section><h2>All materials for the day</h2><ul class="checklist">' + all.map(function (x) { return item(x, true); }).join('') + '</ul></section>';
    html += '<section><h2>By session</h2>' + appts.map(function (a) {
      const p = m.patients[a.patientId] || {};
      const ids = L.appointmentMaterialIds(a, m.goals);
      return '<article class="card"><div class="card-head"><strong>' + esc(L.formatTime(a.time)) + ' · ' + esc(p.name) + '</strong><a class="small" href="#/session/' + a.id + '">Open</a></div>' +
        (ids.length ? '<ul class="checklist">' + ids.map(function (id) {
          const x = m.materials[id];
          return '<li><label><input type="checkbox" data-action="pack" data-date="' + date + '" data-id="' + id + '"' + (packed[id] ? ' checked' : '') + '> <span>' + esc(x.name) + '</span></label><span class="muted small">' + esc(x.location || '') + '</span></li>';
        }).join('') + '</ul>' : '<p class="muted small">No materials.</p>') + '</article>';
    }).join('') + '</section>';
    return html;
  }

  function viewReports(params) {
    const date = params.date || L.todayISO();
    const m = maps();
    const appts = S.appointmentsOn(date).filter(function (a) { return a.status !== 'cancelled'; });
    let html = '<header class="page-head"><div><h1>Daily reports</h1><p class="muted">' + esc(L.formatDate(date)) + '</p></div></header>' + dateNav('reports', date);
    if (!appts.length) return html + '<div class="empty"><p>No sessions on this day.</p></div>';
    html += '<ul class="list">' + appts.map(function (a) {
      const p = m.patients[a.patientId] || {};
      const log = S.logForAppointment(a.id);
      let action;
      if (!log) action = '<a class="btn btn-sm" href="#/session/' + a.id + '?tab=log">Log session</a>';
      else action = '<button class="btn btn-sm" data-action="copy-log-report" data-log="' + log.id + '">Copy</button>' +
        '<a class="btn btn-sm ' + (log.reportSent ? '' : 'btn-primary') + '" href="#/session/' + a.id + '?tab=report">' + (log.reportSent ? 'View' : 'Review & send') + '</a>';
      return '<li><div class="row"><div><strong>' + esc(L.formatTime(a.time)) + ' · ' + esc(p.name) + '</strong> ' + statusBadge(a) +
        '<div class="muted small">' + esc([p.guardian, p.contact].filter(Boolean).join(' · ')) + '</div></div><div class="head-actions">' + action + '</div></div></li>';
    }).join('') + '</ul>';
    return html;
  }

  function viewSettings() {
    const st = S.state;
    return '<header class="page-head"><div><h1>Settings</h1><p class="muted">Data is stored only in this browser on this device.</p></div></header>' +
      '<form class="card" id="settings-form"><label>Your name (used to sign reports)<input name="therapistName" value="' + esc(st.settings.therapistName) + '"></label>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Save</button></div></form>' +
      '<section class="card"><h2>Backup</h2><p class="muted small">Download a backup regularly, and use it to move your data to another device.</p>' +
      '<div class="actions wrap"><button class="btn" data-action="export">Download backup</button><button class="btn" data-action="copy-backup">Copy backup as text</button>' +
      '<label class="btn">Restore from backup<input type="file" accept="application/json,.json" id="import-file" hidden></label></div></section>' +
      '<section class="card"><h2>Start over</h2><div class="actions wrap">' +
      '<button class="btn" data-action="reset-demo">Load demo data</button>' +
      '<button class="btn btn-danger" data-action="clear-all">Delete all data</button></div></section>';
  }

  /* ---------- forms in a modal ---------- */

  function openModal(title, body, onSubmit, onDelete) {
    modal.innerHTML = '<form method="dialog" class="modal-form"><header><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="btn btn-ghost" data-close aria-label="Close">✕</button></header>' +
      '<div class="modal-body">' + body + '</div><footer>' +
      (onDelete ? '<button type="button" class="btn btn-danger" data-delete>Delete</button>' : '<span></span>') +
      '<div><button type="button" class="btn" data-close>Cancel</button> <button type="submit" class="btn btn-primary">Save</button></div></footer></form>';
    const form = modal.querySelector('form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      if (onSubmit(new FormData(form), form) !== false) { modal.close(); render(); }
    });
    modal.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { modal.close(); }); });
    if (onDelete) modal.querySelector('[data-delete]').addEventListener('click', function () {
      ask('Delete this? This cannot be undone.').then(function (ok) { if (ok) { modal.close(); onDelete(); render(); } });
    });
    modal.showModal();
    const first = modal.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    if (first) first.focus();
    return form;
  }

  function patientForm(id) {
    const p = id ? S.patient(id) : {};
    openModal(id ? 'Edit patient' : 'New patient',
      '<label>Full name<input name="name" required value="' + esc(p.name) + '"></label>' +
      '<div class="grid-2"><label>Date of birth<input type="date" name="dob" value="' + esc(p.dob) + '"></label>' +
      '<label>Diagnosis / focus<input name="diagnosis" value="' + esc(p.diagnosis) + '"></label></div>' +
      '<div class="grid-2"><label>Parent / guardian<input name="guardian" value="' + esc(p.guardian) + '"></label>' +
      '<label>Email or phone<input name="contact" value="' + esc(p.contact) + '"></label></div>' +
      '<label>Notes<textarea name="notes" rows="3">' + esc(p.notes) + '</textarea></label>',
      function (fd) {
        const saved = S.upsert('patients', Object.assign({}, p, {
          name: fd.get('name').trim(), dob: fd.get('dob'), diagnosis: fd.get('diagnosis').trim(),
          guardian: fd.get('guardian').trim(), contact: fd.get('contact').trim(), notes: fd.get('notes')
        }));
        if (!id) go('#/patients/' + saved.id);
      },
      id ? function () { S.remove('patients', id); go('#/patients'); } : null);
  }

  function goalForm(id, patientId) {
    const g = id ? S.goal(id) : { patientId: patientId || '', status: 'active', targetAccuracy: 80, materialIds: [], area: AREAS[0] };
    const st = S.state;
    openModal(id ? 'Edit SMART goal' : 'New SMART goal',
      '<div class="grid-2"><label>Patient<select name="patientId" required>' + opt('', 'Choose…') +
      st.patients.map(function (p) { return opt(p.id, p.name, g.patientId === p.id); }).join('') + '</select></label>' +
      '<label>Area<select name="area">' + AREAS.map(function (a) { return opt(a, a, g.area === a); }).join('') + '</select></label></div>' +
      '<label>Short title<input name="title" required placeholder="e.g. /s/ in initial position" value="' + esc(g.title) + '"></label>' +
      '<label><b>S</b>pecific – who will do what<textarea name="specific" rows="2" required placeholder="Ava will produce /s/ in the initial position of words">' + esc(g.specific) + '</textarea></label>' +
      '<label><b>M</b>easurable – criterion<input name="measurable" placeholder="with 80% accuracy across 3 consecutive sessions" value="' + esc(g.measurable) + '"></label>' +
      '<label><b>A</b>chievable – current baseline<input name="achievable" placeholder="Currently 50% with visual cues" value="' + esc(g.achievable) + '"></label>' +
      '<label><b>R</b>elevant – why it matters<input name="relevant" placeholder="Improves intelligibility in class" value="' + esc(g.relevant) + '"></label>' +
      '<div class="grid-3"><label><b>T</b>ime-bound – target date<input type="date" name="timeBound" value="' + esc(g.timeBound) + '"></label>' +
      '<label>Target accuracy %<input type="number" min="0" max="100" name="targetAccuracy" value="' + esc(g.targetAccuracy) + '"></label>' +
      '<label>Status<select name="status">' + ['active', 'met', 'paused', 'discontinued'].map(function (s) { return opt(s, s, g.status === s); }).join('') + '</select></label></div>' +
      '<fieldset class="pick"><legend>Materials needed</legend>' + (st.materials.length ? st.materials.map(function (x) {
        return '<label class="check"><input type="checkbox" name="materialIds" value="' + x.id + '"' + ((g.materialIds || []).indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + '</label>';
      }).join('') : '<p class="muted small">Add materials in the Materials → Library tab.</p>') +
      '<label class="inline-new">Add a new material<input name="newMaterial" placeholder="e.g. Minimal pair cards"></label></fieldset>',
      function (fd) {
        const materialIds = fd.getAll('materialIds');
        const newMat = (fd.get('newMaterial') || '').trim();
        if (newMat) materialIds.push(S.upsert('materials', { name: newMat, category: '', location: '' }).id);
        const isNew = !g.id;
        const saved = S.upsert('goals', Object.assign({}, g, {
          patientId: fd.get('patientId'), area: fd.get('area'), title: fd.get('title').trim(),
          specific: fd.get('specific').trim(), measurable: fd.get('measurable').trim(), achievable: fd.get('achievable').trim(),
          relevant: fd.get('relevant').trim(), timeBound: fd.get('timeBound'),
          targetAccuracy: fd.get('targetAccuracy') === '' ? '' : Number(fd.get('targetAccuracy')),
          status: fd.get('status'), materialIds: materialIds, createdAt: g.createdAt || L.todayISO()
        }));
        // New active goals join the patient's upcoming sessions automatically.
        if (isNew && saved.status === 'active') {
          S.state.appointments.forEach(function (a) {
            if (a.patientId === saved.patientId && a.date >= L.todayISO() && a.status === 'scheduled' && !S.logForAppointment(a.id)) a.goalIds.push(saved.id);
          });
          S.save();
        }
      },
      id ? function () { S.remove('goals', id); } : null);
  }

  function materialForm(id) {
    const x = id ? S.state.materials.find(function (m) { return m.id === id; }) : {};
    openModal(id ? 'Edit material' : 'New material',
      '<label>Name<input name="name" required value="' + esc(x.name) + '"></label>' +
      '<div class="grid-2"><label>Category<input name="category" list="mat-cats" placeholder="Cards, Toys, Books…" value="' + esc(x.category) + '"></label>' +
      '<label>Where it is kept<input name="location" placeholder="Shelf A, bin 2" value="' + esc(x.location) + '"></label></div>' +
      '<datalist id="mat-cats">' + ['Cards', 'Books', 'Toys', 'Games', 'Reinforcers', 'Tools', 'AAC', 'Worksheets', 'Food / oral motor'].map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>',
      function (fd) {
        S.upsert('materials', Object.assign({}, x, { name: fd.get('name').trim(), category: fd.get('category').trim(), location: fd.get('location').trim() }));
      },
      id ? function () { S.remove('materials', id); } : null);
  }

  function apptForm(id, defaults) {
    const st = S.state;
    const a = id ? S.appointment(id) : Object.assign({ date: L.todayISO(), time: '09:00', duration: 30, room: '', goalIds: [], extraMaterialIds: [], status: 'scheduled', patientId: '' }, defaults || {});
    const goalChecks = function (pid, selected) {
      const goals = S.goalsForPatient(pid).filter(function (g) { return g.status === 'active' || selected.indexOf(g.id) >= 0; });
      if (!pid) return '<p class="muted small">Choose a patient first.</p>';
      if (!goals.length) return '<p class="muted small">This patient has no active goals yet.</p>';
      return goals.map(function (g) {
        return '<label class="check"><input type="checkbox" name="goalIds" value="' + g.id + '"' + (selected.indexOf(g.id) >= 0 ? ' checked' : '') + '> ' + esc(g.title) + '</label>';
      }).join('');
    };
    const form = openModal(id ? 'Edit session' : 'New session',
      '<label>Patient<select name="patientId" required>' + opt('', 'Choose…') + st.patients.map(function (p) { return opt(p.id, p.name, a.patientId === p.id); }).join('') + '</select></label>' +
      '<div class="grid-3"><label>Date<input type="date" name="date" required value="' + esc(a.date) + '"></label>' +
      '<label>Time<input type="time" name="time" required value="' + esc(a.time) + '"></label>' +
      '<label>Minutes<input type="number" min="5" step="5" name="duration" value="' + esc(a.duration) + '"></label></div>' +
      '<div class="grid-2"><label>Room / location<input name="room" value="' + esc(a.room) + '"></label>' +
      '<label>Status<select name="status">' + ['scheduled', 'completed', 'cancelled'].map(function (s) { return opt(s, s, a.status === s); }).join('') + '</select></label></div>' +
      '<fieldset class="pick"><legend>Goals to target</legend><div id="goal-checks">' + goalChecks(a.patientId, id ? a.goalIds : S.goalsForPatient(a.patientId).filter(function (g) { return g.status === 'active'; }).map(function (g) { return g.id; })) + '</div></fieldset>' +
      '<fieldset class="pick"><legend>Extra materials (beyond the goals\' own)</legend>' + st.materials.map(function (x) {
        return '<label class="check"><input type="checkbox" name="extraMaterialIds" value="' + x.id + '"' + ((a.extraMaterialIds || []).indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + '</label>';
      }).join('') + '</fieldset>' +
      (id ? '' : '<label>Repeat weekly for<select name="repeat">' + [1, 2, 4, 6, 8, 12].map(function (n) { return opt(n, n === 1 ? 'Just this once' : n + ' weeks'); }).join('') + '</select></label>'),
      function (fd) {
        const base = {
          patientId: fd.get('patientId'), time: fd.get('time'), duration: Number(fd.get('duration')) || 30,
          room: fd.get('room').trim(), status: fd.get('status'), goalIds: fd.getAll('goalIds'), extraMaterialIds: fd.getAll('extraMaterialIds')
        };
        if (id) { S.upsert('appointments', Object.assign({}, a, base, { date: fd.get('date') })); return; }
        const n = Number(fd.get('repeat')) || 1;
        for (let i = 0; i < n; i++) S.upsert('appointments', Object.assign({ notes: '' }, base, { id: null, date: L.addDays(fd.get('date'), 7 * i) }));
        toast(n > 1 ? n + ' sessions added' : 'Session added');
      },
      id ? function () {
        S.remove('appointments', id);
        go('#/schedule?date=' + a.date);
      } : null);
    form.querySelector('[name=patientId]').addEventListener('change', function (ev) {
      const pid = ev.target.value;
      form.querySelector('#goal-checks').innerHTML = goalChecks(pid, S.goalsForPatient(pid).filter(function (g) { return g.status === 'active'; }).map(function (g) { return g.id; }));
    });
  }

  /* ---------- router ---------- */

  function render() {
    const r = parseHash();
    const section = r.parts[0];
    let html;
    if (section === 'session') html = viewSession(r.parts[1], r.params);
    else if (section === 'patients' && r.parts[1]) html = viewPatient(r.parts[1], r.params);
    else if (section === 'patients') html = viewPatients();
    else if (section === 'goals') html = viewGoals(r.params);
    else if (section === 'materials') html = viewMaterials(r.params);
    else if (section === 'reports') html = viewReports(r.params);
    else if (section === 'settings') html = viewSettings();
    else html = viewSchedule(r.params);
    view.innerHTML = html;

    const navKey = section === 'session' ? 'schedule' : (section || 'schedule');
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === navKey);
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* ---------- events ---------- */

  document.addEventListener('click', function (ev) {
    const link = ev.target.closest('a[href^="#/"]');
    if (link && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); go(link.getAttribute('href')); return; }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    switch (act) {
      case 'new-appt': apptForm(null, { date: el.dataset.date || L.todayISO(), patientId: el.dataset.patient || '' }); break;
      case 'edit-appt': apptForm(id); break;
      case 'new-patient': patientForm(null); break;
      case 'edit-patient': patientForm(id); break;
      case 'new-goal': goalForm(null, el.dataset.patient || parseHash().params.patient); break;
      case 'edit-goal': goalForm(id); break;
      case 'new-material': materialForm(null); break;
      case 'edit-material': materialForm(id); break;
      case 'copy-picklist': {
        const d = el.dataset.date, mm = maps();
        const appts = S.appointmentsOn(d).filter(function (a) { return a.status !== 'cancelled'; });
        const list = L.materialsForDay(appts, mm.goals, mm.materials, mm.patients);
        copyText('Materials for ' + L.formatDate(d) + '\n' + list.map(function (x) {
          return '[ ] ' + x.material.name + (x.material.location ? ' (' + x.material.location + ')' : '') + ' – ' + x.sessions.map(function (s) { return (s.patient || {}).name; }).join(', ');
        }).join('\n'));
        break;
      }
      case 'copy-backup': copyText(S.exportJSON()); break;
      case 'copy-report': copyText(document.getElementById('report-text').value); break;
      case 'copy-log-report': {
        const log = S.state.logs.find(function (l) { return l.id === el.dataset.log; });
        const m = maps();
        copyText(log.reportText || L.clientReport({ patient: m.patients[log.patientId], log: log, goalsById: m.goals, therapist: S.state.settings.therapistName }));
        break;
      }
      case 'email-report': {
        // Refresh the mailto body with any edits made in the textarea.
        const text = document.getElementById('report-text').value;
        el.href = el.href.replace(/&body=.*$/, '&body=' + encodeURIComponent(text));
        break;
      }
      case 'regen-report': {
        const log = S.state.logs.find(function (l) { return l.id === el.dataset.log; });
        delete log.reportText; S.save(); render(); toast('Report regenerated');
        break;
      }
      case 'toggle-sent': {
        const log = S.state.logs.find(function (l) { return l.id === el.dataset.log; });
        log.reportText = document.getElementById('report-text').value;
        log.reportSent = !log.reportSent; S.save(); render();
        break;
      }
      case 'export': {
        const blob = new Blob([S.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'speech-therapy-backup-' + L.todayISO() + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        break;
      }
      case 'reset-demo':
        ask('Replace all current data with demo data?', 'Replace').then(function (ok) { if (ok) { S.resetDemo(); go('#/schedule'); render(); toast('Demo data loaded'); } });
        break;
      case 'clear-all':
        ask('Delete ALL patients, goals, sessions and materials from this browser?', 'Delete everything').then(function (ok) { if (ok) { S.clearAll(); go('#/schedule'); render(); toast('All data deleted'); } });
        break;
    }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.dataset.action === 'pack') {
      S.setPacked(t.dataset.date, t.dataset.id, t.checked);
      document.querySelectorAll('[data-action=pack][data-id="' + t.dataset.id + '"]').forEach(function (c) { c.checked = t.checked; });
    }
    if (t.dataset.nav && t.value) go('#/' + t.dataset.nav + '?date=' + t.value);
    if (t.closest('#goal-filters')) {
      const f = t.closest('#goal-filters');
      const qs = ['patient', 'area', 'status'].map(function (k) { return k + '=' + encodeURIComponent(f.querySelector('[name=' + k + ']').value); }).join('&');
      go('#/goals?' + qs);
    }
    if (t.id === 'report-text') {
      const log = S.state.logs.find(function (l) { return l.id === t.dataset.log; });
      log.reportText = t.value; S.save();
    }
    if (t.id === 'import-file' && t.files[0]) {
      t.files[0].text().then(function (text) {
        try { S.importJSON(text); render(); toast('Backup restored'); }
        catch (e) { toast('Could not restore: ' + e.message); }
      });
    }
  });

  // Auto-fill accuracy from trials/correct while logging.
  document.addEventListener('input', function (ev) {
    const t = ev.target;
    const fs = t.closest('.log-entry');
    if (!fs || (t.name !== 'trials' && t.name !== 'correct')) return;
    const acc = L.accuracy(fs.querySelector('[name=correct]').value, fs.querySelector('[name=trials]').value);
    if (acc != null) fs.querySelector('[name=accuracy]').value = acc;
  });

  document.addEventListener('submit', function (ev) {
    const form = ev.target;
    if (form.id === 'log-form') {
      ev.preventDefault();
      const a = S.appointment(form.dataset.appt);
      const existing = S.logForAppointment(a.id);
      const entries = Array.prototype.map.call(form.querySelectorAll('.log-entry'), function (fs) {
        const val = function (n) { return fs.querySelector('[name=' + n + ']').value; };
        const trials = val('trials') === '' ? null : Number(val('trials'));
        const correct = val('correct') === '' ? null : Number(val('correct'));
        let acc = val('accuracy') === '' ? null : Math.max(0, Math.min(100, Number(val('accuracy'))));
        if (acc == null) acc = L.accuracy(correct, trials);
        const prog = fs.querySelector('input[type=radio]:checked');
        return { goalId: fs.dataset.goal, trials: trials, correct: correct, accuracy: acc, cueing: val('cueing'), progress: prog ? prog.value : '', note: val('note').trim() };
      });
      const log = Object.assign(existing || { appointmentId: a.id, patientId: a.patientId }, {
        date: a.date, entries: entries,
        notes: form.querySelector('[name=notes]').value.trim(), homework: form.querySelector('[name=homework]').value.trim()
      });
      delete log.reportText; // regenerate from the updated log
      S.upsert('logs', log);
      a.status = 'completed';
      S.save();
      toast('Session saved');
      go('#/session/' + a.id + '?tab=report');
    }
    if (form.id === 'settings-form') {
      ev.preventDefault();
      S.state.settings.therapistName = form.querySelector('[name=therapistName]').value.trim();
      S.save(); toast('Saved');
    }
  });

  window.addEventListener('hashchange', function () { if (location.hash.indexOf('#/') === 0 && location.hash !== route) go(location.hash); });
  render();
})();

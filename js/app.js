// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/* UI: hash router, views and forms. */
(function () {
  'use strict';
  const L = window.Logic;
  const S = window.Store;
  const Sync = window.Sync;
  const C = window.Consent;
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
    const raw = route.replace(/^#\/?/, '');
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
    if (appt.status === 'missed') return '<span class="badge badge-warn">Did not attend</span>';
    if (appt.status === 'attended' || appt.status === 'completed') return '<span class="badge badge-good">Attended</span>';
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

  function caseTag(p) {
    const label = L.caseLabel(p || {});
    if (!label) return '';
    return '<span class="case fam-' + L.conditionFamily(p.condition) + '">' + esc(label) + '</span>';
  }

  const PX_PER_MIN = 2.4;

  function viewSchedule(params) {
    const date = params.date || L.todayISO();
    const st = S.state.settings;
    const appts = visibleAppts(S.appointmentsOn(date));
    const m = maps();
    const active = appts.filter(function (a) { return a.status !== 'cancelled'; });
    const logged = active.filter(function (a) { return S.logForAppointment(a.id); });
    const sent = logged.filter(function (a) { return S.logForAppointment(a.id).reportSent; });
    const common = L.materialsForDay(appts, m.goals, m.materials, m.patients).filter(function (x) { return x.count > 1; });
    const halves = L.splitByLunch(active, st.lunchStart);
    const mode = st.scheduleView || 'timetable';

    let html = '<header class="page-head"><div><h1>Schedule</h1><p class="muted">' + esc(L.formatDate(date)) + '</p></div>' +
      '<button class="btn btn-primary" data-action="new-appt" data-date="' + date + '">+ Add session</button></header>' +
      '<div class="toolbar">' + dateNav('schedule', date) +
      '<div class="seg-toggle" role="group" aria-label="Schedule layout">' +
      '<button class="' + (mode === 'timetable' ? 'on' : '') + '" data-action="sched-view" data-view="timetable" aria-pressed="' + (mode === 'timetable') + '">Timetable</button>' +
      '<button class="' + (mode === 'list' ? 'on' : '') + '" data-action="sched-view" data-view="list" aria-pressed="' + (mode === 'list') + '">List</button></div></div>';

    html += '<div class="summary">' +
      '<div><span class="stat">' + halves.morning.length + ' <span class="stat-sep">/</span> ' + halves.afternoon.length + '</span><span class="muted small">Before / after lunch</span></div>' +
      '<div><span class="stat">' + logged.length + '/' + active.length + '</span><span class="muted small">Logged</span></div>' +
      '<div><span class="stat">' + sent.length + '/' + logged.length + '</span><span class="muted small">Reports sent</span></div>' +
      '<a href="#/materials?date=' + date + '"><span class="stat">' + common.length + '</span><span class="muted small">Shared materials →</span></a>' +
      '</div>';

    if (date === L.todayISO()) html += newPatientsCard();
    html += mode === 'list' ? scheduleList(appts, m, st) : timetable(appts, m, st, date);
    return html;
  }

  function timetable(appts, m, st, date) {
    const lay = L.layoutDay(appts, st.dayStart, st.dayEnd);
    const y = function (mins) { return (mins - lay.start) * PX_PER_MIN; };
    const lunchS = L.toMinutes(st.lunchStart), lunchE = L.toMinutes(st.lunchEnd);
    let html = '<div class="tt" style="height:' + y(lay.end) + 'px">';

    // Half-hour rows double as "add a session here" targets.
    for (let t = lay.start; t < lay.end; t += 30) {
      const hhmm = L.fromMinutes(t);
      const onHour = t % 60 === 0;
      html += '<div class="tt-row' + (onHour ? ' hour' : '') + '" style="top:' + y(t) + 'px;height:' + 30 * PX_PER_MIN + 'px">' +
        (onHour ? '<span class="tt-label">' + esc(L.formatTime(hhmm).replace(':00', '')) + '</span>' : '') +
        '<button class="tt-slot" data-action="new-appt" data-date="' + date + '" data-time="' + hhmm + '" aria-label="Add session at ' + esc(L.formatTime(hhmm)) + '"><span>+ ' + esc(L.formatTime(hhmm)) + '</span></button></div>';
    }
    if (lunchE > lunchS && lunchE > lay.start && lunchS < lay.end) {
      const s0 = Math.max(lunchS, lay.start), e0 = Math.min(lunchE, lay.end);
      const halves = L.splitByLunch(appts.filter(function (a) { return a.status !== 'cancelled'; }), st.lunchStart);
      const n = function (k) { return halves[k].length + ' session' + (halves[k].length === 1 ? '' : 's'); };
      html += '<div class="tt-lunch" style="top:' + y(s0) + 'px;height:' + (e0 - s0) * PX_PER_MIN + 'px">' +
        '<span class="tt-half">▲ Morning · ' + n('morning') + '</span>' +
        '<strong>Lunch ' + esc(L.formatTime(st.lunchStart)) + '–' + esc(L.formatTime(st.lunchEnd)) + '</strong>' +
        '<span class="tt-half">▼ Afternoon · ' + n('afternoon') + '</span></div>';
    }

    if (date === L.todayISO()) {
      const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= lay.start && mins <= lay.end) html += '<div class="tt-now" style="top:' + y(mins) + 'px" aria-hidden="true"></div>';
    }

    html += lay.blocks.map(function (b) {
      const a = b.appt;
      const p = m.patients[a.patientId] || { name: 'Unknown patient' };
      const goals = (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean);
      const h = (b.end - b.start) * PX_PER_MIN;
      return '<a class="tt-block fam-' + L.conditionFamily(p.condition) + (a.status === 'cancelled' ? ' cancelled' : '') + (a.coverNeeded ? ' needs-cover' : '') + (h < 60 ? ' compact' : '') + '" href="#/session/' + a.id + '" ' +
        'style="top:' + (y(b.start) + 1) + 'px;height:' + (h - 2) + 'px;left:calc(var(--tt-gutter) + (100% - var(--tt-gutter)) * ' + b.lane + ' / ' + b.lanes + ');width:calc((100% - var(--tt-gutter)) / ' + b.lanes + ' - 4px)">' +
        '<div class="tt-line"><span class="tt-time">' + esc(L.formatTime(a.time)) + '–' + esc(L.formatTime(L.fromMinutes(b.end))) + '</span>' + statusBadge(a) + apptBadges(a, p) + '</div>' +
        '<div class="tt-line"><strong class="tt-name">' + esc(nm(p)) + '</strong>' + caseTag(p) + '</div>' +
        '<div class="tt-goals">' + (me().role === 'supervisor' && L.clinicianFor(a, p) ? esc(firstName(L.clinicianFor(a, p))) + ' · ' : '') + (a.room ? esc(a.room) + ' · ' : '') + goals.map(function (g) { return esc(g.title); }).join(' · ') + '</div>' +
        '</a>';
    }).join('');
    html += '</div>';
    if (!appts.length) html += '<p class="muted small tt-hint">No sessions yet. Tap a time slot to add one.</p>';
    return html;
  }

  function scheduleList(appts, m, st) {
    if (!appts.length) return '<div class="empty"><p>No sessions scheduled for this day.</p></div>';
    const halves = L.splitByLunch(appts, st.lunchStart);
    const item = function (a) {
      const p = m.patients[a.patientId] || { name: 'Unknown patient' };
      const goals = (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean);
      const mats = L.appointmentMaterialIds(a, m.goals).map(function (id) { return m.materials[id]; }).filter(Boolean);
      return '<li><a class="appt fam-' + L.conditionFamily(p.condition) + (a.status === 'cancelled' ? ' cancelled' : '') + (a.coverNeeded ? ' needs-cover' : '') + '" href="#/session/' + a.id + '">' +
        '<div class="appt-time"><strong>' + esc(L.formatTime(a.time)) + '</strong><span class="muted small">' + esc(a.duration || 30) + ' min' + (a.room ? ' · ' + esc(a.room) : '') + '</span></div>' +
        '<div class="appt-body"><div class="appt-title"><strong>' + esc(nm(p)) + '</strong>' + caseTag(p) + statusBadge(a) + '</div>' +
        '<div class="muted small">' + esc([me().role === 'supervisor' && L.clinicianFor(a, p) ? 'With ' + userName(L.clinicianFor(a, p)) : '', p.diagnosis].filter(Boolean).join(' · ')) + ' ' + apptBadges(a, p) + '</div>' +
        '<div class="appt-meta"><span class="meta-label">Goals</span> <span>' + goals.map(function (g) { return esc(g.title); }).join(' · ') + '</span></div>' +
        '<div class="appt-meta muted small"><span class="meta-label">Materials</span> ' + (mats.length ? mats.map(function (x) { return esc(x.name); }).join(', ') : 'No materials listed') + '</div>' +
        '</div><span class="chev" aria-hidden="true">›</span></a></li>';
    };
    let html = '<h2 class="half-head">Morning</h2>' + (halves.morning.length ? '<ol class="schedule">' + halves.morning.map(item).join('') + '</ol>' : '<p class="muted small">No morning sessions.</p>');
    html += '<div class="lunch-divider"><span>Lunch · ' + esc(L.formatTime(st.lunchStart)) + '–' + esc(L.formatTime(st.lunchEnd)) + '</span></div>';
    html += '<h2 class="half-head">Afternoon</h2>' + (halves.afternoon.length ? '<ol class="schedule">' + halves.afternoon.map(item).join('') + '</ol>' : '<p class="muted small">No afternoon sessions.</p>');
    return html;
  }

  function viewSession(apptId, params) {
    const a = S.appointment(apptId);
    if (!a) return '<div class="empty"><p>Session not found.</p><a href="#/schedule">Back to schedule</a></div>';
    const m = maps();
    const p = m.patients[a.patientId] || { name: 'Unknown' };
    if (!canSee(p)) return noAccess();
    const tab = params.tab || 'prep';
    const base = '#/session/' + a.id;
    const log = S.logForAppointment(a.id);

    let html = '<a class="back" href="#/schedule?date=' + a.date + '">‹ Schedule</a>' +
      '<header class="page-head"><div><h1>' + esc(nm(p)) + '</h1><p class="muted">' +
      esc(L.formatDate(a.date, { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' + esc(L.formatTime(a.time)) +
      ' · ' + esc(a.duration || 30) + ' min' + (a.room ? ' · ' + esc(a.room) : '') + ' ' + statusBadge(a) + '</p>' +
      '<p class="small muted">' + caseTag(p) + ' ' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</p></div>' +
      '<div class="head-actions"><a class="btn btn-ghost" href="#/patients/' + p.id + '">Patient file</a>' +
      (canRunSession(a, p) ? '<button class="btn btn-ghost" data-action="edit-appt" data-id="' + a.id + '">Edit session</button>' : '') + '</div></header>' +
      '<p class="small">' + apptBadges(a, p) + ' Clinician: ' + esc(userName(L.clinicianFor(a, p))) + '</p>' +
      sessionTools(a, p) +
      tabs(base, tab, [['prep', 'Goals & materials'], ['log', log ? 'Session log ✓' : 'Log session'], ['progress', 'Progress'], ['report', 'Report']]);

    const goals = (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean);

    if (tab === 'prep') {
      const matIds = L.appointmentMaterialIds(a, m.goals);
      const packed = S.state.packed[a.date] || {};
      html += courseworkPanel(a, p);
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
      html += '<p><a href="#/patients/' + p.id + '?tab=progress">See all of this patient\'s goals →</a></p>';
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
    const allowed = p.consent && p.consent.shareReports;
    return '<section class="card"><div class="card-head"><h2>Client report</h2>' +
      (log.reportSent ? '<span class="badge badge-good">Sent</span>' : '<span class="badge">Not sent</span>') + '</div>' +
      (allowed ? '' : '<div class="callout warn"><strong>No permission recorded to send session summaries to this family.</strong><span>Record consent in the patient\'s details before sharing.</span></div>') +
      '<p class="muted small">Edit freely; changes are saved with this session. Send it through your organisation\'s secure email or portal, not personal email or messaging apps.</p>' +
      '<textarea id="report-text" data-log="' + log.id + '" rows="16">' + esc(text) + '</textarea>' +
      '<div class="actions wrap">' +
      '<button class="btn" data-action="copy-report">Copy</button>' +
      '<button class="btn" data-action="regen-report" data-log="' + log.id + '">Regenerate from log</button>' +
      '<button class="btn btn-primary" data-action="toggle-sent" data-log="' + log.id + '">' + (log.reportSent ? 'Mark as not sent' : 'Mark as sent') + '</button>' +
      '</div></section>';
  }

  function viewPatients(params) {
    const st = S.state;
    const fAge = params.age || '', fCond = params.condition || '';
    const mine = visiblePatients();
    const conds = mine.map(function (p) { return p.condition; }).filter(function (c, i, arr) { return c && arr.indexOf(c) === i; }).sort();
    const shown = mine.filter(function (p) { return (!fAge || L.ageGroup(p) === fAge) && (!fCond || p.condition === fCond); });
    let html = '<header class="page-head"><div><h1>Patients</h1><p class="muted">' + mine.length + ' records you can access</p></div>' +
      (me().role !== 'student' ? '<button class="btn btn-primary" data-action="new-patient">' + (me().role === 'therapist' ? '+ Add patient' : '+ Register patient') + '</button>' : '') + '</header>';
    if (!mine.length) return html + '<div class="empty"><p>No patients yet.</p></div>';
    html += '<div class="filters" id="patient-filters">' +
      '<select name="age" aria-label="Adult or child">' + opt('', 'Adults & children') + opt('Child', 'Children', fAge === 'Child') + opt('Adult', 'Adults', fAge === 'Adult') + '</select>' +
      '<select name="condition" aria-label="Case type">' + opt('', 'All case types') + conds.map(function (c) { return opt(c, c, fCond === c); }).join('') + '</select></div>';
    if (!shown.length) return html + '<div class="empty"><p>No patients match.</p></div>';
    html += '<ul class="list">' + shown.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) {
      const goals = S.goalsForPatient(p.id).filter(function (g) { return g.status === 'active'; });
      const next = st.appointments.filter(function (a) { return a.patientId === p.id && a.date >= L.todayISO() && a.status !== 'cancelled'; })
        .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })[0];
      return '<li><a class="row" href="#/patients/' + p.id + '"><div><strong>' + esc(nm(p)) + '</strong> ' + caseTag(p) + statusPill(p) +
        '<div class="muted small">' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</div></div>' +
        '<div class="right small"><div>' + goals.length + ' active goal' + (goals.length === 1 ? '' : 's') + '</div>' +
        '<div class="muted">' + (next ? 'Next: ' + esc(L.formatDate(next.date, { month: 'short', day: 'numeric' })) + ' ' + esc(L.formatTime(next.time)) : 'No upcoming session') + '</div></div></a></li>';
    }).join('') + '</ul>';
    return html;
  }

  function viewPatient(id, params) {
    const p = S.patient(id);
    if (!p) return '<div class="empty"><p>Patient not found.</p><a href="#/patients">Back</a></div>';
    if (!canSee(p)) return noAccess();
    if (lastViewed !== p.id) { lastViewed = p.id; S.audit('Opened patient record', p.id); }
    const tab = params.tab || (p.status === 'active' ? 'goals' : 'record');
    const base = '#/patients/' + p.id;
    const goals = S.goalsForPatient(p.id);
    const logs = S.logsForPatient(p.id);
    const m = maps();

    let html = '<a class="back" href="#/patients">‹ Patients</a>' +
      '<header class="page-head"><div><h1>' + esc(nm(p)) + '</h1>' +
      '<p class="muted">' + esc(p.caseCode) + ' · ' + caseTag(p) + statusPill(p) + ' ' + esc(p.diagnosis || '') + (p.dob ? ' · Age ' + L.age(p.dob) : '') + '</p>' +
      '<p class="small muted">' + esc([p.guardian, p.contact].filter(Boolean).join(' · ')) + '</p>' +
      (p.status === 'active' || p.status === 'discharged' ? '<p class="small">' + countsLine(p) + '</p>' : '') + '</div>' +
      '<div class="head-actions">' + (canManage(p) ? '<button class="btn btn-ghost" data-action="edit-patient" data-id="' + p.id + '">Edit</button>' : '') +
      (p.status === 'active' && me().role !== 'diagnostician' ? '<button class="btn btn-ghost" data-action="new-appt" data-patient="' + p.id + '">+ Session</button>' : '') +
      (isStudentCase(p) ? '<a class="btn btn-ghost" href="#/cases/' + p.id + '">Coursework</a>' : '') + '</div></header>' +
      tabs(base, tab, [['goals', 'SMART goals'], ['progress', 'Progress'], ['history', 'Session journal'], ['files', 'Files (' + S.state.attachments.filter(function (a) { return a.patientId === p.id; }).length + ')'], ['record', 'Details & consent']]);
    if (tab === 'record') return html + recordTab(p);
    if (tab === 'files') return html + filesTab(p);

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
      (showPatient && p ? '<a class="small" href="#/patients/' + p.id + '">' + esc(nm(p)) + '</a><br>' : '') +
      '<span class="chip">' + esc(g.area) + '</span> <strong>' + esc(g.title) + '</strong></div>' +
      '<div class="head-actions"><span class="badge ' + statusCls + '">' + esc(g.status) + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="edit-goal" data-id="' + g.id + '">Edit</button></div></div>' +
      '<p>' + esc(L.smartStatement(g)) + '</p>' + smartGrid(g) +
      '<p class="small"><span class="muted">Materials:</span> ' + (mats.length ? mats.map(function (x) { return esc(x.name); }).join(', ') : '—') + '</p></article>';
  }

  function viewGoals(params) {
    const st = S.state, m = maps();
    const f = { patient: params.patient || '', area: params.area || '', status: 'status' in params ? params.status : 'active' };
    const seeable = S.byId(visiblePatients());
    const list = st.goals.filter(function (g) {
      return seeable[g.patientId] && (!f.patient || g.patientId === f.patient) && (!f.area || g.area === f.area) && (!f.status || g.status === f.status);
    });
    let html = '<header class="page-head"><div><h1>Goals</h1><p class="muted">SMART goals across your caseload</p></div>' +
      '<button class="btn btn-primary" data-action="new-goal">+ Add goal</button></header>' +
      '<div class="filters" id="goal-filters">' +
      '<select name="patient" aria-label="Patient">' + opt('', 'All patients') + visiblePatients().filter(function (p) { return p.status === 'active'; }).map(function (p) { return opt(p.id, nm(p), f.patient === p.id); }).join('') + '</select>' +
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
      S.state.goals.forEach(function (g) { if (!canSee(S.patient(g.patientId))) return; (g.materialIds || []).forEach(function (id) { (used[id] = used[id] || []).push(g); }); });
      const mats = S.state.materials.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name); });
      if (!mats.length) return html + '<div class="empty"><p>No materials yet.</p></div>';
      return html + '<ul class="list">' + mats.map(function (x) {
        const goals = used[x.id] || [];
        return '<li><div class="row"><div><strong>' + esc(x.name) + '</strong><div class="muted small">' + esc([x.category, x.location].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="small">' + (goals.length ? 'Used for: ' + goals.map(function (g) { return esc(nm(m.patients[g.patientId]) + ' – ' + g.title); }).join('; ') : '<span class="muted">Not linked to any goal</span>') + '</div></div>' +
          '<button class="btn btn-ghost btn-sm" data-action="edit-material" data-id="' + x.id + '">Edit</button></div></li>';
      }).join('') + '</ul>';
    }

    const appts = visibleAppts(S.appointmentsOn(date)).filter(function (a) { return a.status !== 'cancelled'; });
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
        '<span class="muted small">' + (showWho ? esc(x.sessions.map(function (s) { return nm(s.patient); }).join(', ')) + (x.material.location ? ' · ' : '') : '') + esc(x.material.location || '') + '</span></li>';
    };
    html += '<section><h2>Common materials <span class="muted small">needed in 2+ sessions</span></h2>' +
      (common.length ? '<ul class="checklist">' + common.map(function (x) { return item(x, true); }).join('') + '</ul>' : '<p class="muted">No materials are shared between sessions today.</p>') + '</section>';
    html += '<section><h2>All materials for the day</h2><ul class="checklist">' + all.map(function (x) { return item(x, true); }).join('') + '</ul></section>';
    html += '<section><h2>By session</h2>' + appts.map(function (a) {
      const p = m.patients[a.patientId] || {};
      const ids = L.appointmentMaterialIds(a, m.goals);
      return '<article class="card"><div class="card-head"><strong>' + esc(L.formatTime(a.time)) + ' · ' + esc(nm(p)) + '</strong><a class="small" href="#/session/' + a.id + '">Open</a></div>' +
        (ids.length ? '<ul class="checklist">' + ids.map(function (id) {
          const x = m.materials[id];
          return '<li><label><input type="checkbox" data-action="pack" data-date="' + date + '" data-id="' + id + '"' + (packed[id] ? ' checked' : '') + '> <span>' + esc(x.name) + '</span></label><span class="muted small">' + esc(x.location || '') + '</span></li>';
        }).join('') + '</ul>' : '<p class="muted small">No materials.</p>') + '</article>';
    }).join('') + '</section>';
    return html;
  }

  function viewReports(params) {
    if (params.tab === 'reminders') return viewReminders(params);
    const date = params.date || L.todayISO();
    const m = maps();
    const appts = visibleAppts(S.appointmentsOn(date)).filter(function (a) { return a.status !== 'cancelled'; });
    let html = '<header class="page-head"><div><h1>Reports &amp; reminders</h1><p class="muted">' + esc(L.formatDate(date)) + '</p></div></header>' +
      reportTabs('reports', date) + dateNav('reports', date);
    if (!appts.length) return html + '<div class="empty"><p>No sessions on this day.</p></div>';
    html += '<ul class="list">' + appts.map(function (a) {
      const p = m.patients[a.patientId] || {};
      const log = S.logForAppointment(a.id);
      let action;
      if (!log) action = '<a class="btn btn-sm" href="#/session/' + a.id + '?tab=log">Log session</a>';
      else action = '<button class="btn btn-sm" data-action="copy-log-report" data-log="' + log.id + '">Copy</button>' +
        '<a class="btn btn-sm ' + (log.reportSent ? '' : 'btn-primary') + '" href="#/session/' + a.id + '?tab=report">' + (log.reportSent ? 'View' : 'Review & send') + '</a>';
      return '<li><div class="row"><div><strong>' + esc(L.formatTime(a.time)) + ' · ' + esc(nm(p)) + '</strong> ' + statusBadge(a) +
        '<div class="muted small">' + esc([p.guardian, p.contact].filter(Boolean).join(' · ')) + '</div></div><div class="head-actions">' + action + '</div></div></li>';
    }).join('') + '</ul>';
    return html;
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
    const blocked = !id && patientsAllowed();
    if (blocked) { toast(blocked); go('#/privacy'); return; }
    openModal(id ? 'Edit patient' : 'New patient',
      '<label>Full name<input name="name" required value="' + esc(nm(p)) + '"></label>' +
      '<div class="grid-3"><label>Adult or child<select name="ageGroup">' + opt('Child', 'Child', (p.ageGroup || 'Child') === 'Child') + opt('Adult', 'Adult', p.ageGroup === 'Adult') + '</select></label>' +
      '<label class="span-2">Case type<input name="condition" list="conditions" placeholder="e.g. DLD, CLP, Stroke – aphasia" value="' + esc(p.condition) + '"></label></div>' +
      '<datalist id="conditions">' + L.CONDITIONS.Child.concat(L.CONDITIONS.Adult).filter(function (c, i, a) { return a.indexOf(c) === i; }).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      '<div class="grid-2"><label>Date of birth<input type="date" name="dob" value="' + esc(p.dob) + '"></label>' +
      '<label>Diagnosis details<input name="diagnosis" placeholder="e.g. Left MCA stroke, anomia" value="' + esc(p.diagnosis) + '"></label></div>' +
      '<div class="grid-2"><label>Parent / guardian / carer<input name="guardian" placeholder="Blank = address adult directly" value="' + esc(p.guardian) + '"></label>' +
      '<label>Email or phone<input name="contact" value="' + esc(p.contact) + '"></label></div>' +
      '<label>Notes<textarea name="notes" rows="2">' + esc(p.notes) + '</textarea></label>' +
      '<p class="small muted">' + (id ? 'Consent is recorded on its own page, with the notice, the person\u2019s answers and their signature: <strong>Details &amp; consent → Record consent</strong>.' : 'Next, you record consent with the notice, their answers and their signature.') + '</p>' +
      reminderFields(p),
      function (fd) {
        const u = me();
        const fresh = !id;
        const saved = S.upsert('patients', Object.assign({}, p, {
          name: fd.get('name').trim(), dob: fd.get('dob'), diagnosis: fd.get('diagnosis').trim(),
          ageGroup: fd.get('ageGroup'), condition: fd.get('condition').trim(),
          guardian: fd.get('guardian').trim(), contact: fd.get('contact').trim(), notes: fd.get('notes'), consent: p.consent || {},
          reminders: readReminderFields(fd, p)
        }, fresh ? { caseCode: S.nextCaseCode(), status: u.role === 'therapist' ? 'active' : 'waiting', assignedTo: u.role === 'therapist' ? u.id : '', registeredAt: new Date().toISOString(), allottedAt: u.role === 'therapist' ? L.todayISO() : '' } : {}));
        if (fresh) {
          S.audit('Registered patient', saved.id);
          let next = '#/patients/' + saved.id + '?tab=record';
          if (saved.status === 'waiting') next = '#/assessment/' + S.upsert('assessments', { patientId: saved.id, assessorId: u.role === 'diagnostician' ? u.id : '', date: L.todayISO(), status: 'draft' }).id;
          go('#/consent/' + saved.id + '?next=' + encodeURIComponent(next));
        } else S.audit('Edited patient details', saved.id);
      },
      id && me().role === 'supervisor' ? function () { const r = S.erasePatient(id, 'Erasure request'); toast('Erased · receipt ' + r.id); go('#/patients'); } : null);
  }

  function goalForm(id, patientId) {
    const g = id ? S.goal(id) : { patientId: patientId || '', status: 'active', targetAccuracy: 80, materialIds: [], area: AREAS[0] };
    const st = S.state;
    openModal(id ? 'Edit SMART goal' : 'New SMART goal',
      '<div class="grid-2"><label>Patient<select name="patientId" required>' + opt('', 'Choose…') +
      visiblePatients().filter(function (p) { return p.status === 'active' || p.id === g.patientId; }).map(function (p) { return opt(p.id, nm(p), g.patientId === p.id); }).join('') + '</select></label>' +
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
      '<label>Patient<select name="patientId" required>' + opt('', 'Choose…') + visiblePatients().filter(function (p) { return p.status === 'active' || p.id === a.patientId; }).map(function (p) { const c = L.caseLabel(p); return opt(p.id, nm(p) + (c ? ' (' + c + ')' : ''), a.patientId === p.id); }).join('') + '</select></label>' +
      '<div class="grid-3"><label>Date<input type="date" name="date" required value="' + esc(a.date) + '"' + (id ? ' readonly title="Use Reschedule to move a session"' : '') + '></label>' +
      '<label>Time<input type="time" name="time" required value="' + esc(a.time) + '"' + (id ? ' readonly title="Use Reschedule to move a session"' : '') + '></label>' +
      (id ? '<p class="small muted span-3">To move this session, use Reschedule on the session page so the reason is recorded.</p>' : '') +
      '<label>Minutes<input type="number" min="5" step="5" name="duration" value="' + esc(a.duration) + '"></label></div>' +
      '<div class="grid-2"><label>Room / location<input name="room" value="' + esc(a.room) + '"></label>' +
      '<label>Status<select name="status">' + [['scheduled', 'Scheduled'], ['attended', 'Attended'], ['missed', 'Did not attend'], ['cancelled', 'Cancelled']].map(function (s) { return opt(s[0], s[1], a.status === s[0] || (s[0] === 'attended' && a.status === 'completed')); }).join('') + '</select></label></div>' +
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

  /* ---------- people, access and privacy helpers ---------- */

  const NAV_ROLES = {
    schedule: ['supervisor', 'therapist', 'student'],
    team: ['supervisor', 'therapist', 'student', 'diagnostician'],
    diagnostics: ['supervisor', 'diagnostician'],
    cases: ['supervisor', 'therapist', 'student'],
    patients: ['supervisor', 'therapist', 'student', 'diagnostician'],
    goals: ['supervisor', 'therapist', 'student'],
    materials: ['supervisor', 'therapist', 'student'],
    reports: ['supervisor', 'therapist', 'student'],
    privacy: ['supervisor', 'therapist', 'student', 'diagnostician'],
    inbox: ['supervisor', 'therapist', 'student', 'diagnostician'],
    leave: ['supervisor', 'therapist', 'student']
  };
  const SEVERITY = ['Mild', 'Mild–moderate', 'Moderate', 'Moderate–severe', 'Severe', 'Profound'];
  const PRIORITY = ['Routine', 'Soon', 'Urgent'];

  function me() { return S.currentUser() || { id: '', role: 'supervisor', name: '' }; }
  function canSee(p) { return L.canSeePatient(me(), p, grants()); }
  function canManage(p) {
    const u = me();
    return u.role === 'supervisor' || (u.role === 'therapist' && p.assignedTo === u.id) || (u.role === 'diagnostician' && p.status === 'waiting');
  }
  function nm(p) {
    if (!p) return 'Unknown';
    return S.state.settings.hideNames ? p.caseCode + ' · ' + L.initials(p.name) : p.name;
  }
  function pseud(p) { return p ? p.caseCode + ' (' + L.initials(p.name) + ')' : '—'; }
  function userName(id) { const u = S.user(id); return u ? u.name : '—'; }
  function firstName(id) { return userName(id).replace(/^Dr\.\s*/, '').split(' ')[0]; }
  function visiblePatients() { return S.state.patients.filter(canSee); }
  function visibleAppts(list) {
    const u = me(), pm = S.byId(S.state.patients);
    if (u.role === 'supervisor') return list;
    return list.filter(function (a) {
      const p = pm[a.patientId];
      return p && (L.clinicianFor(a, p) === u.id || p.assignedTo === u.id || observing(a, u.id));
    });
  }
  function noAccess() {
    return '<div class="empty"><p><strong>You don\'t have access to this.</strong></p><p class="small">Records are shown on a need-to-know basis for your role (' + esc(L.ROLES[me().role].label) + ').</p></div>';
  }
  function isStudentCase(p) { const u = S.user(p.assignedTo); return !!u && u.role === 'student'; }
  function docChip(d) {
    return '<a class="doc-chip st-' + d.status + '" href="#/doc/' + d.id + '">' + esc(L.DOC_STATUS[d.status]) + '</a>';
  }
  function tick(v) { return v ? '<span class="yes">✓</span>' : '<span class="no">✗</span>'; }
  function fmtStamp(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- role bar ---------- */

  function quickLinks(u) {
    const st = S.state;
    const pending = st.referrals.filter(function (r) { return r.status === 'pending'; }).length;
    const since = L.addDays(L.todayISO(), -14);
    if (u.role === 'supervisor') {
      const cover = st.appointments.filter(function (a) { return a.coverNeeded && a.date >= L.todayISO(); }).length;
      const moved = st.appointments.reduce(function (n, a) { return n + (a.reschedules || []).filter(function (r) { return r.at.slice(0, 10) >= since; }).length; }, 0);
      return [
        { label: 'To allot', n: pending, href: '#/cases?tab=allot', alert: pending > 0 },
        { label: 'Reminders to send', n: remindersToSend(L.addDays(L.todayISO(), 1)), href: '#/reports?tab=reminders' },
        { label: 'To review', n: st.documents.filter(function (d) { return d.status === 'submitted'; }).length, href: '#/cases?tab=review' },
        { label: 'Needs cover', n: cover, href: '#/leave', alert: cover > 0 },
        { label: 'Rescheduled', n: moved, href: '#/cases?tab=reschedules' }
      ];
    }
    if (u.role === 'therapist') {
      const invites = st.appointments.filter(function (a) { return (a.observers || []).some(function (o) { return o.userId === u.id && o.status === 'invited'; }); }).length;
      return [
        { label: 'My cases', n: st.patients.filter(function (p) { return p.assignedTo === u.id && p.status === 'active'; }).length, href: '#/cases' },
        { label: 'Covering', n: st.appointments.filter(function (a) { return a.coverBy === u.id && a.date >= L.todayISO(); }).length, href: '#/schedule' },
        { label: 'Reminders to send', n: remindersToSend(L.addDays(L.todayISO(), 1)), href: '#/reports?tab=reminders' },
        { label: 'Invitations', n: invites, href: '#/inbox', alert: invites > 0 }
      ];
    }
    if (u.role === 'student') {
      const mine = st.patients.filter(function (p) { return p.assignedTo === u.id; });
      const returned = st.documents.filter(function (d) { return d.authorId === u.id && d.status === 'returned'; }).length;
      return [
        { label: 'Allotted cases', n: mine.length, href: '#/cases' },
        { label: 'Changes requested', n: returned, href: '#/cases', alert: returned > 0 }
      ];
    }
    return [
      { label: 'Waiting list', n: st.patients.filter(function (p) { return p.status === 'waiting'; }).length, href: '#/diagnostics' },
      { label: 'Letters to send', n: lettersDue().length, href: '#/diagnostics?tab=letters', alert: lettersDue().length > 0 },
      { label: 'Referred', n: st.referrals.filter(function (r) { return r.fromId === u.id && r.status === 'pending'; }).length, href: '#/diagnostics?tab=done' }
    ];
  }

  function rolebar() {
    const u = me(), st = S.state;
    const toFile = unfiled().length;
    return '<div class="rb-left"><span class="rb-dept">' + esc(L.ROLES[u.role].dept) + '</span>' +
      quickLinks(u).concat(toFile ? [{ label: 'Files to file', n: toFile, href: '#/files-to-file', alert: true }] : []).map(function (l) {
        return '<a class="rb-link' + (l.alert ? ' alert' : '') + '" href="' + l.href + '">' + esc(l.label) + ' <span class="rb-count">' + l.n + '</span></a>';
      }).join('') + '</div>' +
      '<div class="rb-right">' + (S.isServer() ? syncPill() : '') +
      '<button class="rb-btn" data-action="toggle-names" aria-pressed="' + !!st.settings.hideNames + '">' + (st.settings.hideNames ? 'Show names' : 'Hide names') + '</button>' +
      (S.hasPassphrase() ? '<button class="rb-btn" data-action="lock-now">Lock</button>' : '') +
      '<span class="rb-me"><strong>' + esc(u.name) + '</strong><span class="muted"> · ' + esc(L.ROLES[u.role].label) + '</span></span>' +
      '<button class="rb-btn" data-action="sign-out">Sign out</button></div>';
  }

  const SYNC_LABEL = { synced: ['Live', 'Connected to the clinic server. Changes are shared as you make them.'], saving: ['Saving…', 'Sending your change to the clinic server.'],
    offline: ['Offline', 'Can\u2019t reach the clinic server. Keep this tab open: your changes are sent when it is back.'], connecting: ['Connecting…', ''] };
  function syncPill() {
    const k = S.syncStatus(), l = SYNC_LABEL[k] || SYNC_LABEL.connecting;
    return '<span class="sync-pill" id="sync-pill" data-state="' + esc(k) + '" title="' + esc(l[1]) + '" role="status"><span class="dot" aria-hidden="true"></span>' + esc(l[0]) + '</span>';
  }

  function serverScreen(kind) {
    if (kind === 'connecting') return '<div class="lock"><div class="card lock-card"><h1>Connecting to the clinic server…</h1></div></div>';
    return '<div class="lock"><div class="card lock-card"><h1>Can\u2019t reach the clinic server</h1>' +
      '<p class="muted">TJS keeps your clinic\u2019s records on one computer. This device can\u2019t reach it right now.</p>' +
      '<ul class="small plain"><li>Check that the clinic computer is switched on and the server is running.</li><li>Away from the clinic, connect to the clinic VPN (for example Tailscale) first.</li></ul>' +
      '<div class="actions"><button class="btn btn-primary" data-action="reconnect">Try again</button></div></div></div>';
  }

  function lockScreen() {
    return '<div class="lock"><form id="unlock-form" class="card lock-card">' +
      '<h1>TJS is locked</h1><p class="muted">Patient data on this device is encrypted. Enter the passphrase to continue.</p>' +
      '<label>Passphrase<input type="password" name="pass" id="unlock-pass" autocomplete="current-password" required></label>' +
      '<p class="form-error" id="unlock-error" hidden></p>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Unlock</button></div>' +
      '<p class="muted small">If the passphrase is lost, the data cannot be recovered. Restore from a backup instead.</p></form></div>';
  }

  /* ---------- diagnostics department ---------- */

  function viewDiagnostics(params) {
    const tab = params.tab || 'waiting';
    const st = S.state;
    const waiting = st.patients.filter(function (p) { return p.status === 'waiting'; });
    const done = st.assessments.filter(function (a) { return a.status === 'completed' && (me().role === 'supervisor' || a.assessorId === me().id); }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    let html = '<header class="page-head"><div><h1>Diagnostics</h1><p class="muted">Assess new patients and refer them to the therapy department</p></div>' +
      '<button class="btn btn-primary" data-action="new-patient">+ Register patient</button></header>' +
      tabs('#/diagnostics', tab, [['waiting', 'Waiting list (' + waiting.length + ')'], ['done', 'Assessed (' + done.length + ')'], ['letters', 'Letters to send (' + lettersDue().length + ')']]) + (tab === 'waiting' ? newPatientsCard() : '');
    if (tab === 'letters') return html + viewLettersDue();

    if (tab === 'waiting') {
      if (!waiting.length) return html + '<div class="empty"><p>No one is waiting for assessment.</p></div>';
      return html + '<ul class="list">' + waiting.map(function (p) {
        const a = S.state.assessments.find(function (x) { return x.patientId === p.id && x.status === 'draft'; });
        return '<li><div class="row"><div><strong>' + esc(nm(p)) + '</strong> ' + caseTag(p) +
          '<div class="muted small">' + esc(p.caseCode) + (a && a.source ? ' · Referred by ' + esc(a.source) : '') + (a && a.reason ? ' – ' + esc(a.reason) : '') + '</div></div>' +
          (a ? '<a class="btn btn-sm btn-primary" href="#/assessment/' + a.id + '">Continue assessment</a>'
            : '<button class="btn btn-sm btn-primary" data-action="start-assessment" data-patient="' + p.id + '">Start assessment</button>') + '</div></li>';
      }).join('') + '</ul>';
    }
    if (!done.length) return html + '<div class="empty"><p>No completed assessments yet.</p></div>';
    return html + '<ul class="list">' + done.map(function (a) {
      const p = S.patient(a.patientId);
      if (!p) return '';
      const r = S.state.referrals.find(function (x) { return x.assessmentId === a.id; });
      const status = !r ? '<span class="badge badge-muted">Not referred</span>'
        : r.status === 'pending' ? '<span class="badge badge-warn">Awaiting allotment</span>'
          : '<span class="badge badge-good">Allotted to ' + esc(firstName(r.allottedTo)) + '</span>';
      return '<li><a class="row" href="#/assessment/' + a.id + '"><div><strong>' + esc(nm(p)) + '</strong> ' + caseTag(p) +
        '<div class="muted small">' + esc(L.formatDate(a.date, { day: 'numeric', month: 'short' })) + ' · ' + esc(a.diagnosis || '') + (a.severity ? ' · ' + esc(a.severity) : '') + '</div></div>' + status + '</a></li>';
    }).join('') + '</ul>';
  }

  function viewAssessment(id) {
    const a = S.assessment(id);
    const p = a && S.patient(a.patientId);
    if (!a || !p) return '<div class="empty"><p>Assessment not found.</p></div>';
    const u = me();
    if (!(u.role === 'supervisor' || u.role === 'diagnostician' || canSee(p))) return noAccess();
    const editable = a.status === 'draft' && (u.role === 'diagnostician' || u.role === 'supervisor');
    const r = S.state.referrals.find(function (x) { return x.assessmentId === a.id; });
    let html = '<a class="back" href="#/diagnostics' + (a.status === 'draft' ? '' : '?tab=done') + '">‹ Diagnostics</a>' +
      '<header class="page-head"><div><h1>Assessment · ' + esc(nm(p)) + '</h1><p class="muted">' + esc(p.caseCode) + ' · ' + caseTag(p) +
      (p.dob ? ' · Age ' + L.age(p.dob) : '') + ' · ' + (a.status === 'draft' ? '<span class="badge">Draft</span>' : '<span class="badge badge-good">Completed</span>') + '</p></div>' +
      '<div class="head-actions"><a class="btn btn-ghost" href="#/patients/' + p.id + '?tab=record">Details & consent</a></div></header>';

    const F = [['source', 'Referred by (who or where)', 1], ['reason', 'Reason for referral', 2], ['history', 'Case history', 3], ['tests', 'Tests & tools used', 2],
      ['findings', 'Findings', 4], ['diagnosis', 'Diagnosis', 1], ['recommendations', 'Recommendations', 3], ['frequency', 'Recommended frequency', 1]];

    if (!editable) {
      html += '<section class="card"><dl class="kv">' +
        '<div><dt>Date</dt><dd>' + esc(L.formatDate(a.date)) + '</dd></div><div><dt>Assessed by</dt><dd>' + esc(userName(a.assessorId)) + '</dd></div>' +
        F.map(function (f) { return '<div><dt>' + esc(f[1]) + '</dt><dd class="pre">' + esc(a[f[0]] || '—') + '</dd></div>'; }).join('') +
        '<div><dt>Severity</dt><dd>' + esc(a.severity || '—') + '</dd></div></dl></section>';
      if (r) html += '<section class="card"><h2>Referral to therapy</h2><p>' + esc(r.priority) + ' priority · sent ' + esc(L.formatDate(r.at, { day: 'numeric', month: 'short' })) + ' · ' +
        (r.status === 'pending' ? 'awaiting allotment' : 'allotted to ' + esc(userName(r.allottedTo))) + '</p>' + (r.notes ? '<p class="muted">' + esc(r.notes) + '</p>' : '') + '</section>';
      html += '<section class="card"><h2>Emails after the assessment</h2><p>' + letterChips(a) + '</p>' +
        (a.referrerName || a.referrerEmail ? '<p class="small muted">Referrer: ' + esc([a.referrerName, a.referrerEmail].filter(Boolean).join(' · ')) + '</p>' : '') +
        '<div class="actions wrap"><button class="btn btn-primary" data-action="letter-new" data-assessment="' + a.id + '" data-kind="family-report">Email the report to the family</button>' +
        '<button class="btn" data-action="letter-new" data-assessment="' + a.id + '" data-kind="referrer-thanks">Thank the referrer</button>' +
        '<button class="btn btn-ghost" data-action="letter-new" data-assessment="' + a.id + '" data-kind="other">Other email</button></div></section>';
      return html;
    }

    const field = function (f) {
      return f[2] > 1 ? '<label>' + esc(f[1]) + '<textarea name="' + f[0] + '" rows="' + f[2] + '">' + esc(a[f[0]] || '') + '</textarea></label>'
        : '<label>' + esc(f[1]) + '<input name="' + f[0] + '" value="' + esc(a[f[0]] || '') + '"></label>';
    };
    html += '<form id="assessment-form" data-id="' + a.id + '" class="card">' +
      '<div class="grid-3"><label>Date<input type="date" name="date" value="' + esc(a.date) + '" required></label>' + field(F[0]) +
      '<label>Adult or child<select name="ageGroup">' + opt('Child', 'Child', p.ageGroup !== 'Adult') + opt('Adult', 'Adult', p.ageGroup === 'Adult') + '</select></label></div>' +
      '<div class="grid-2"><label>Referrer\u2019s name<input name="referrerName" value="' + esc(a.referrerName || '') + '" placeholder="e.g. Dr. Kumar, class teacher"></label>' +
      '<label>Referrer\u2019s email<input name="referrerEmail" type="email" value="' + esc(a.referrerEmail || '') + '" placeholder="for the thank-you email"></label></div>' +
      F.slice(1, 5).map(field).join('') +
      '<div class="grid-3"><label>Case type<input name="condition" list="conditions-dx" value="' + esc(p.condition) + '"></label>' + field(F[5]) +
      '<label>Severity<select name="severity">' + opt('', '—') + SEVERITY.map(function (s) { return opt(s, s, a.severity === s); }).join('') + '</select></label></div>' +
      '<datalist id="conditions-dx">' + L.CONDITIONS.Child.concat(L.CONDITIONS.Adult).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      field(F[6]) + field(F[7]) +
      '<fieldset class="refer"><legend>Refer to therapy department</legend>' +
      '<div class="grid-2"><label>Priority<select name="priority">' + PRIORITY.map(function (x) { return opt(x, x); }).join('') + '</select></label>' +
      '<label>Note for the therapy team<input name="refNotes" placeholder="e.g. aspiration risk, family preferences"></label></div>' +
      '<p class="small muted">Consent for therapy: ' + tick(p.consent && p.consent.therapy) + ' · Student clinicians: ' + tick(p.consent && p.consent.students) +
      ' <a class="link" href="#/consent/' + p.id + '?next=' + encodeURIComponent('#/assessment/' + a.id) + '">Record consent</a></p></fieldset>' +
      '<div class="actions wrap end"><button class="btn" name="intent" value="draft">Save draft</button>' +
      '<button class="btn" name="intent" value="close">Complete – no therapy needed</button>' +
      '<button class="btn btn-primary" name="intent" value="refer">Complete &amp; refer to therapy</button></div></form>';
    return html;
  }

  function submitAssessment(form, intent) {
    const a = S.assessment(form.dataset.id), p = S.patient(a.patientId);
    const v = function (n) { const el = form.querySelector('[name=' + n + ']'); return el ? el.value.trim() : ''; };
    ['date', 'source', 'referrerName', 'referrerEmail', 'reason', 'history', 'tests', 'findings', 'diagnosis', 'severity', 'recommendations', 'frequency'].forEach(function (k) { a[k] = v(k); });
    p.ageGroup = v('ageGroup'); p.condition = v('condition');
    if (intent === 'draft') { S.save(); toast('Draft saved'); return; }
    if (intent === 'refer' && !(p.consent && p.consent.therapy)) { toast('Record consent for therapy before referring.'); S.save(); return; }
    a.status = 'completed';
    p.assessedBy = a.assessorId;
    if (intent === 'refer') {
      S.upsert('referrals', { patientId: p.id, assessmentId: a.id, fromId: me().id, at: L.todayISO(), priority: v('priority'), notes: v('refNotes'), status: 'pending' });
      p.status = 'referred'; p.referredAt = L.todayISO();
      S.audit('Referred to therapy', p.id, v('priority') + ' priority');
      S.send(supervisorsFor(null), { kind: 'referral', patientId: p.id, link: '#/cases?tab=allot',
        subject: 'New referral (' + v('priority') + ') – ' + pseud(p), body: [a.diagnosis, a.severity, v('refNotes')].filter(Boolean).join(' · ') });
      toast('Referred to the therapy department');
    } else {
      p.status = 'discharged'; p.dischargedAt = L.todayISO();
      S.audit('Assessment completed, no therapy', p.id);
      toast('Assessment completed');
    }
    S.save();
    go('#/diagnostics?tab=done');
  }

  /* ---------- therapy department: cases ---------- */

  function viewCases(params) {
    const u = me();
    if (u.role === 'student') return studentCases();
    if (u.role === 'diagnostician') return noAccess();
    const st = S.state;
    const tab = u.role === 'therapist' ? 'allotted' : params.tab || 'allot';
    const pending = st.referrals.filter(function (r) { return r.status === 'pending'; });
    const allotted = st.patients.filter(function (p) { return p.status === 'active' && p.assignedTo && canSee(p); });
    const review = st.documents.filter(function (d) { return d.status === 'submitted'; });
    const moves = [];
    st.appointments.forEach(function (a) { (a.reschedules || []).forEach(function (r) { moves.push({ a: a, r: r }); }); });
    const t = u.role === 'therapist' ? [['allotted', 'My cases (' + allotted.length + ')']]
      : [['allot', 'To allot (' + pending.length + ')'], ['allotted', 'Allotted cases (' + allotted.length + ')'], ['review', 'To review (' + review.length + ')'], ['reschedules', 'Reschedules (' + moves.length + ')'], ['consent', 'Consent to ask again (' + consentDue().length + ')']];
    let html = '<header class="page-head"><div><h1>' + (u.role === 'therapist' ? 'My cases' : 'Cases') + '</h1><p class="muted">' +
      (u.role === 'therapist' ? 'Patients allotted to you' : 'Referrals from diagnostics, allotment, coursework and reschedules') + '</p></div></header>' + tabs('#/cases', tab, t);

    if (tab === 'consent') {
      const due = consentDue();
      if (!due.length) return html + '<div class="empty"><p>No one needs to be asked for consent again.</p></div>';
      return html + '<ul class="list">' + due.map(function (x) {
        return '<li><a class="row" href="#/patients/' + x.p.id + '?tab=record"><div><strong>' + esc(nm(x.p)) + '</strong> · ' + esc(x.p.caseCode) + '<div class="muted small">' + x.reasons.map(function (r) { return esc(r.text); }).join(' · ') + '</div></div><span class="btn btn-sm">Open</span></a></li>';
      }).join('') + '</ul>';
    }

    if (tab === 'reschedules') {
      if (!moves.length) return html + '<div class="empty"><p>No sessions have been rescheduled.</p></div>';
      moves.sort(function (x, y) { return y.r.at.localeCompare(x.r.at); });
      const byWho = {};
      moves.forEach(function (x) { byWho[x.r.by] = (byWho[x.r.by] || 0) + 1; });
      return html + '<p class="small">' + Object.keys(byWho).map(function (k) { return '<span class="badge">' + esc(k) + ': ' + byWho[k] + '</span>'; }).join(' ') + '</p>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>Recorded</th><th>Patient</th><th>Clinician</th><th>Moved</th><th>By</th><th>Reason</th></tr></thead><tbody>' +
        moves.map(function (x) {
          const p = S.patient(x.a.patientId);
          return '<tr><td class="nowrap">' + esc(fmtStamp(x.r.at)) + '</td><td><a href="#/session/' + x.a.id + '">' + esc(nm(p)) + '</a></td><td>' + esc(userName(L.clinicianFor(x.a, p))) + '</td>' +
            '<td class="nowrap">' + esc(L.formatDate(x.r.fromDate, { day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(x.r.fromTime)) + ' → ' + esc(L.formatDate(x.r.toDate, { day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(x.r.toTime)) + '</td>' +
            '<td><strong>' + esc(x.r.by) + '</strong></td><td>' + esc(x.r.reason || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    if (tab === 'allot') {
      if (!pending.length) return html + '<div class="empty"><p>No referrals are waiting.</p></div>';
      return html + pending.sort(function (a, b) { return PRIORITY.indexOf(b.priority) - PRIORITY.indexOf(a.priority) || a.at.localeCompare(b.at); }).map(function (r) {
        const p = S.patient(r.patientId), a = S.assessment(r.assessmentId) || {};
        const c = p.consent || {};
        return '<article class="card referral"><div class="card-head"><div><strong>' + esc(nm(p)) + '</strong> ' + caseTag(p) +
          '<div class="muted small">' + esc(p.caseCode) + (p.dob ? ' · Age ' + L.age(p.dob) : '') + ' · referred ' + esc(L.formatDate(r.at, { day: 'numeric', month: 'short' })) + ' by ' + esc(userName(r.fromId)) + '</div></div>' +
          '<span class="badge prio-' + r.priority.toLowerCase() + '">' + esc(r.priority) + '</span></div>' +
          '<p><strong>' + esc(a.diagnosis || '') + '</strong>' + (a.severity ? ' · ' + esc(a.severity) : '') + '</p>' +
          (a.recommendations ? '<p class="small">' + esc(a.recommendations) + (a.frequency ? ' <span class="muted">(' + esc(a.frequency) + ')</span>' : '') + '</p>' : '') +
          (r.notes ? '<p class="small note">' + esc(r.notes) + '</p>' : '') +
          '<p class="small consent-line">Therapy ' + tick(c.therapy) + ' · Student clinicians ' + tick(c.students) + ' · Reports to family ' + tick(c.shareReports) +
          (C.reviewNeeded(p, S.state.consents, L.todayISO()).length ? ' <a class="badge badge-warn" href="#/patients/' + p.id + '?tab=record">Consent: ask again</a>' : '') + '</p>' +
          '<div class="actions wrap"><a class="btn btn-sm" href="#/assessment/' + a.id + '">Assessment</a>' +
          (u.role === 'supervisor' ? '<button class="btn btn-sm btn-primary" data-action="allot" data-patient="' + p.id + '">Allot</button>'
            : '<button class="btn btn-sm btn-primary" data-action="take-case" data-patient="' + p.id + '">Take on this case</button>') +
          '</div></article>';
      }).join('');
    }

    if (tab === 'review') {
      if (!review.length) return html + '<div class="empty"><p>Nothing is waiting for review.</p></div>';
      return html + '<ul class="list">' + review.sort(function (a, b) { return a.submittedAt.localeCompare(b.submittedAt); }).map(function (d) {
        const p = S.patient(d.patientId), ap = d.appointmentId && S.appointment(d.appointmentId);
        return '<li><a class="row" href="#/doc/' + d.id + '"><div><strong>' + esc(L.DOC_TYPES[d.type].label) + '</strong> · ' + esc(pseud(p)) +
          '<div class="muted small">' + esc(userName(d.authorId)) + (ap ? ' · session ' + esc(L.formatDate(ap.date, { day: 'numeric', month: 'short' })) : '') + ' · submitted ' + esc(fmtStamp(d.submittedAt)) + '</div></div>' +
          '<span class="btn btn-sm btn-primary">Review</span></a></li>';
      }).join('') + '</ul>';
    }

    if (!allotted.length) return html + '<div class="empty"><p>No allotted cases.</p></div>';
    return html + '<div class="table-wrap"><table class="tbl cases-tbl"><thead><tr><th>Case</th><th>Clinician</th><th>Sessions</th><th>Pre-assessment</th><th>Lesson plans</th><th>Session reports</th><th>Conclusion</th><th>Next step</th></tr></thead><tbody>' +
      allotted.map(function (p) {
        const student = isStudentCase(p);
        const docs = S.docsForPatient(p.id);
        const prog = L.caseProgress(docs, S.logsForPatient(p.id).filter(function (l) { return l.appointmentId; }).length);
        const cell = function (type) {
          if (!student) return '<td class="muted">—</td>';
          const c = prog[type];
          if (!c.total) return '<td class="muted">None</td>';
          return '<td><span class="doc-count">' + c.approved + '/' + c.total + ' approved</span>' + (c.submitted ? ' <span class="doc-chip st-submitted">' + c.submitted + ' to review</span>' : '') +
            (c.returned ? ' <span class="doc-chip st-returned">' + c.returned + ' returned</span>' : '') + '</td>';
        };
        return '<tr><td><a href="#/cases/' + p.id + '"><strong>' + esc(nm(p)) + '</strong></a><div>' + caseTag(p) + '</div></td>' +
          '<td>' + esc(userName(p.assignedTo)) + (student ? '<div class="muted small">Student · supervisor ' + esc(firstName(p.supervisorId)) + '</div>' : '') + '</td>' + sessionsCell(p) +
          cell('pre-assessment') + cell('lesson-plan') + cell('session-report') + cell('conclusion') +
          '<td class="small">' + (student ? esc(prog.next) : '<span class="muted">Qualified clinician</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* Patients whose consent should be asked for again (turned 18, guardian changed, new purpose, new notice, nothing recorded). */
  function consentDue() {
    return visiblePatients().filter(function (p) { return p.status !== 'discharged'; }).map(function (p) {
      return { p: p, reasons: C.reviewNeeded(p, S.state.consents, L.todayISO()) };
    }).filter(function (x) { return x.reasons.length; });
  }

  function sessionsCell(p) {
    const c = L.sessionCounts(S.appointmentsFor(p.id), p.sessionsAllotted);
    return '<td class="nowrap"><strong>' + c.attended + '/' + c.allotted + '</strong> attended' + (c.missed ? '<div class="small bad">' + c.missed + ' did not attend</div>' : '') +
      (c.rescheduled ? '<div class="small muted">' + c.rescheduled + ' rescheduled</div>' : '') + '</td>';
  }

  function studentCases() {
    const u = me();
    const mine = S.state.patients.filter(function (p) { return p.assignedTo === u.id; });
    let html = '<header class="page-head"><div><h1>My cases</h1><p class="muted">Cases allotted to you by your supervisor</p></div></header>';
    if (!mine.length) return html + '<div class="empty"><p>No cases have been allotted to you yet.</p></div>';
    return html + mine.map(function (p) {
      const docs = S.docsForPatient(p.id);
      const prog = L.caseProgress(docs, S.logsForPatient(p.id).filter(function (l) { return l.appointmentId; }).length);
      const returned = docs.filter(function (d) { return d.status === 'returned'; });
      return '<article class="card"><div class="card-head"><div><a href="#/cases/' + p.id + '"><strong>' + esc(nm(p)) + '</strong></a> ' + caseTag(p) +
        '<div class="muted small">' + esc(p.caseCode) + ' · Supervisor: ' + esc(userName(p.supervisorId)) + '</div></div>' +
        '<a class="btn btn-sm btn-primary" href="#/cases/' + p.id + '">Open case</a></div>' +
        '<div class="progress-row">' + Object.keys(L.DOC_TYPES).map(function (t) {
          const c = prog[t];
          return '<div><span class="muted small">' + esc(L.DOC_TYPES[t].label) + '</span><strong>' + c.approved + '/' + c.total + '</strong></div>';
        }).join('') + '</div>' +
        '<p class="small">' + countsLine(p) + '</p>' +
        '<p class="small"><span class="meta-label">Next</span> ' + esc(prog.next) + '</p>' +
        returned.map(function (d) {
          const fb = (d.history || []).filter(function (h) { return h.action === 'returned'; }).slice(-1)[0];
          return '<a class="callout warn" href="#/doc/' + d.id + '"><strong>' + esc(L.DOC_TYPES[d.type].label) + ': changes requested</strong>' + (fb ? '<span>' + esc(fb.note) + '</span>' : '') + '</a>';
        }).join('') + '</article>';
    }).join('');
  }

  function viewCase(pid) {
    const p = S.patient(pid);
    if (!p) return '<div class="empty"><p>Case not found.</p></div>';
    if (!canSee(p)) return noAccess();
    const u = me();
    const author = u.role === 'student' && p.assignedTo === u.id;
    const docs = S.docsForPatient(pid);
    const ofType = function (t) { return docs.filter(function (d) { return d.type === t; }); };
    const newBtn = function (type, apptId, label) {
      return author ? '<button class="btn btn-sm" data-action="new-doc" data-type="' + type + '" data-patient="' + pid + '"' + (apptId ? ' data-appt="' + apptId + '"' : '') + '>' + esc(label || 'Write') + '</button>' : '<span class="muted small">Not started</span>';
    };
    const single = function (type) {
      const list = ofType(type);
      return '<div class="doc-row"><div><strong>' + esc(L.DOC_TYPES[type].label) + '</strong></div><div class="head-actions">' +
        (list.length ? list.map(docChip).join(' ') : newBtn(type, null)) + '</div></div>';
    };
    const appts = S.state.appointments.filter(function (a) { return a.patientId === pid && a.status !== 'cancelled'; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });

    let html = '<a class="back" href="#/cases' + (u.role === 'student' ? '' : '?tab=allotted') + '">‹ Cases</a>' +
      '<header class="page-head"><div><h1>' + esc(nm(p)) + '</h1><p class="muted">' + esc(p.caseCode) + ' · ' + caseTag(p) + '</p>' +
      '<p class="small muted">Clinician: ' + esc(userName(p.assignedTo)) + (p.supervisorId ? ' · Supervisor: ' + esc(userName(p.supervisorId)) : '') + '</p></div>' +
      '<div class="head-actions"><a class="btn btn-ghost" href="#/patients/' + p.id + '">Patient file</a></div></header>';

    if (!isStudentCase(p)) return html + '<div class="empty"><p>This case is held by a qualified clinician, so there is no coursework to submit.</p></div>';

    html += '<section><h2>Before therapy</h2><div class="card">' + single('pre-assessment') + '</div></section>';
    html += '<section><h2>Sessions</h2>' + (appts.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Session</th><th>Lesson plan</th><th>Session report</th></tr></thead><tbody>' +
      appts.map(function (a) {
        const lp = docs.filter(function (d) { return d.type === 'lesson-plan' && d.appointmentId === a.id; });
        const sr = docs.filter(function (d) { return d.type === 'session-report' && d.appointmentId === a.id; });
        const past = a.date <= L.todayISO();
        return '<tr><td><a href="#/session/' + a.id + '">' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + esc(L.formatTime(a.time)) + '</a></td>' +
          '<td>' + (lp.length ? lp.map(docChip).join(' ') : newBtn('lesson-plan', a.id)) + '</td>' +
          '<td>' + (sr.length ? sr.map(docChip).join(' ') : past ? newBtn('session-report', a.id) : '<span class="muted small">After the session</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No sessions booked yet.</p>') +
      (ofType('session-report').filter(function (d) { return !d.appointmentId; }).length ? '<p class="small">Other reports: ' + ofType('session-report').filter(function (d) { return !d.appointmentId; }).map(docChip).join(' ') + '</p>' : '') +
      '</section>';
    html += '<section><h2>End of therapy</h2><div class="card">' + single('conclusion') + '</div></section>';
    return html;
  }

  function newDoc(type, pid, apptId) {
    const p = S.patient(pid);
    const a = apptId && S.appointment(apptId);
    const m = maps();
    const goals = a ? (a.goalIds || []).map(function (id) { return m.goals[id]; }).filter(Boolean)
      : S.goalsForPatient(pid).filter(function (g) { return g.status !== 'discontinued'; });
    const fields = L.prefillDoc(type, {
      patient: p, assessment: S.latestAssessment(pid), goals: goals,
      materials: a ? L.appointmentMaterialIds(a, m.goals).map(function (id) { return m.materials[id]; }).filter(Boolean) : [],
      log: a ? S.logForAppointment(a.id) : null, logs: S.logsForPatient(pid)
    });
    const d = S.upsert('documents', {
      type: type, patientId: pid, authorId: me().id, reviewerId: p.supervisorId || '', appointmentId: apptId || null,
      status: 'draft', fields: fields, createdAt: new Date().toISOString(), submittedAt: null, history: []
    });
    S.audit('Started ' + L.DOC_TYPES[type].label.toLowerCase(), pid);
    go('#/doc/' + d.id);
  }

  function docText(d) {
    const p = S.patient(d.patientId), a = d.appointmentId && S.appointment(d.appointmentId);
    return [L.DOC_TYPES[d.type].label + ' – ' + pseud(p) + (a ? ' – session ' + L.formatDate(a.date) : ''),
      'Student clinician: ' + userName(d.authorId) + ' · Supervisor: ' + userName(d.reviewerId), '']
      .concat(L.DOC_FIELDS[d.type].map(function (f) { return f[1].toUpperCase() + '\n' + (d.fields[f[0]] || '—') + '\n'; })).join('\n');
  }

  function viewDoc(id) {
    const d = S.doc(id);
    const p = d && S.patient(d.patientId);
    if (!d || !p) return '<div class="empty"><p>Document not found.</p></div>';
    if (!canSee(p)) return noAccess();
    const u = me();
    const editable = d.authorId === u.id && (d.status === 'draft' || d.status === 'returned');
    const reviewing = u.role === 'supervisor' && d.status === 'submitted';
    const a = d.appointmentId && S.appointment(d.appointmentId);
    const lastReturn = (d.history || []).filter(function (h) { return h.action === 'returned'; }).slice(-1)[0];

    let html = '<a class="back" href="#/cases/' + p.id + '">‹ ' + esc(pseud(p)) + '</a>' +
      '<header class="page-head"><div><h1>' + esc(L.DOC_TYPES[d.type].label) + '</h1>' +
      '<p class="muted">' + esc(pseud(p)) + ' · ' + caseTag(p) + (a ? ' · Session ' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) : '') +
      ' <span class="doc-chip st-' + d.status + '">' + esc(L.DOC_STATUS[d.status]) + '</span></p>' +
      '<p class="small muted">By ' + esc(userName(d.authorId)) + ' · Reviewer: ' + esc(userName(d.reviewerId)) + '</p></div>' +
      '<div class="head-actions">' + (p.consent && p.consent.teaching ? '<button class="btn btn-ghost" data-action="copy-doc" data-id="' + d.id + '">Copy for coursework</button>' : '<span class="small muted">No teaching consent: can\u2019t be copied out</span>') + '</div></header>' +
      '<p class="small muted privacy-note">Coursework is pseudonymised: the case code and initials only. Someone who knows the case could still recognise it, so don\'t add names, addresses or other identifiers.</p>';

    if (d.status === 'returned' && lastReturn) html += '<div class="callout warn"><strong>Changes requested by ' + esc(userName(lastReturn.by)) + '</strong><span>' + esc(lastReturn.note) + '</span></div>';

    if (editable) {
      html += '<form id="doc-form" data-id="' + d.id + '" class="card">' + L.DOC_FIELDS[d.type].map(function (f) {
        return '<label>' + esc(f[1]) + '<textarea name="' + f[0] + '" rows="' + f[2] + '">' + esc(d.fields[f[0]] || '') + '</textarea></label>';
      }).join('') + '<div class="actions wrap end"><button class="btn" name="intent" value="save">Save draft</button>' +
        '<button class="btn btn-primary" name="intent" value="submit">Submit to ' + esc(firstName(d.reviewerId)) + ' for review</button></div></form>';
    } else {
      html += '<section class="card doc-read">' + L.DOC_FIELDS[d.type].map(function (f) {
        return '<h3>' + esc(f[1]) + '</h3><p class="pre">' + esc(d.fields[f[0]] || '—') + '</p>';
      }).join('') + '</section>';
    }

    if (reviewing) {
      html += '<form id="review-form" data-id="' + d.id + '" class="card"><h2>Your review</h2>' +
        '<label>Feedback for ' + esc(firstName(d.authorId)) + '<textarea name="feedback" rows="3" placeholder="Required when requesting changes"></textarea></label>' +
        '<div class="actions wrap end"><button class="btn" name="intent" value="return">Request changes</button>' +
        '<button class="btn btn-primary" name="intent" value="approve">Approve</button></div></form>';
    }

    if ((d.history || []).length) {
      html += '<section><h2>History</h2><ol class="timeline">' + d.history.slice().reverse().map(function (h) {
        return '<li><span class="muted small">' + esc(fmtStamp(h.at)) + '</span> <strong>' + esc(userName(h.by)) + '</strong> ' +
          esc({ submitted: 'submitted for review', approved: 'approved', returned: 'requested changes' }[h.action] || h.action) +
          (h.note ? '<div class="small">' + esc(h.note) + '</div>' : '') + '</li>';
      }).join('') + '</ol></section>';
    }
    return html;
  }

  function submitDoc(form, intent) {
    const d = S.doc(form.dataset.id);
    L.DOC_FIELDS[d.type].forEach(function (f) { d.fields[f[0]] = form.querySelector('[name=' + f[0] + ']').value; });
    if (intent === 'submit') {
      d.status = 'submitted'; d.submittedAt = new Date().toISOString();
      d.history.push({ at: d.submittedAt, by: me().id, action: 'submitted' });
      S.audit('Submitted ' + L.DOC_TYPES[d.type].label.toLowerCase(), d.patientId);
      S.send(d.reviewerId, { kind: 'submitted', patientId: d.patientId, link: '#/doc/' + d.id,
        subject: L.DOC_TYPES[d.type].label + ' submitted – ' + pseud(S.patient(d.patientId)), body: 'Ready for your review.' });
      toast('Submitted for review');
    } else toast('Draft saved');
    S.save();
    render();
  }

  function submitReview(form, intent) {
    const d = S.doc(form.dataset.id);
    const note = form.querySelector('[name=feedback]').value.trim();
    if (intent === 'return' && !note) { toast('Add feedback so the student knows what to change.'); return; }
    d.status = intent === 'approve' ? 'approved' : 'returned';
    d.reviewedAt = new Date().toISOString();
    d.history.push({ at: d.reviewedAt, by: me().id, action: d.status, note: note });
    S.audit((intent === 'approve' ? 'Approved ' : 'Returned ') + L.DOC_TYPES[d.type].label.toLowerCase(), d.patientId);
    S.send(d.authorId, { kind: 'review', patientId: d.patientId, link: '#/doc/' + d.id,
      subject: L.DOC_TYPES[d.type].label + (intent === 'approve' ? ' approved' : ' returned with comments') + ' – ' + pseud(S.patient(d.patientId)),
      body: note || 'Approved – no further comments.' });
    S.save();
    toast(intent === 'approve' ? 'Approved' : 'Sent back with feedback');
    go('#/cases?tab=review');
  }

  function allotForm(pid) {
    const p = S.patient(pid);
    const st = S.state;
    const load = function (uid) { return st.patients.filter(function (x) { return x.assignedTo === uid && x.status === 'active'; }).length; };
    const people = st.users.filter(function (x) { return x.role === 'student' || x.role === 'therapist'; });
    const c = p.consent || {};
    const form = openModal('Allot ' + pseud(p),
      '<p class="small">' + caseTag(p) + ' · Consent for student clinicians: ' + tick(c.students) + '</p>' +
      '<label>Allot to<select name="assignee" required>' + opt('', 'Choose…') + people.map(function (x) {
        const blocked = x.role === 'student' && !c.students;
        return '<option value="' + x.id + '"' + (blocked ? ' disabled' : '') + '>' + esc(x.name + ' – ' + L.ROLES[x.role].label + (x.year ? ', ' + x.year : '') + ' (' + load(x.id) + ' cases)' + (blocked ? ' – no consent' : '')) + '</option>';
      }).join('') + '</select></label>' +
      '<label>Sessions allotted<input type="number" name="sessions" min="1" max="100" value="' + (p.sessionsAllotted || 12) + '" required></label>' +
      '<label>Supervisor (for student clinicians)<select name="supervisor">' + st.users.filter(function (x) { return x.role === 'supervisor'; })
        .map(function (x) { return opt(x.id, x.name, x.id === me().id); }).join('') + '</select></label>' +
      '<p class="form-error" id="allot-error" hidden></p>',
      function (fd) {
        const who = S.user(fd.get('assignee'));
        const check = L.canAllot(p, who);
        if (!check.ok) { const e = document.getElementById('allot-error'); e.textContent = check.reason; e.hidden = false; return false; }
        p.sessionsAllotted = Number(fd.get('sessions')) || 12;
        assignCase(p, who, who.role === 'student' ? fd.get('supervisor') : '');
      });
    form.querySelector('[type=submit]').textContent = 'Allot case';
  }

  function assignCase(p, who, supervisorId) {
    p.assignedTo = who.id; p.supervisorId = supervisorId || ''; p.status = 'active';
    const r = S.state.referrals.find(function (x) { return x.patientId === p.id && x.status === 'pending'; });
    if (r) { r.status = 'allotted'; r.allottedTo = who.id; r.allottedBy = me().id; r.allottedAt = L.todayISO(); }
    S.audit('Allotted case', p.id, 'to ' + who.name);
    const a = S.latestAssessment(p.id) || {};
    if (who.id !== me().id) S.send(who.id, { kind: 'allotted', patientId: p.id, link: isStudentCase(p) ? '#/cases/' + p.id : '#/patients/' + p.id,
      subject: 'New case allotted – ' + pseud(p), body: [L.caseLabel(p), a.diagnosis, a.recommendations, (p.sessionsAllotted || 12) + ' sessions allotted.'].filter(Boolean).join('\n') });
    toast('Allotted to ' + who.name);
  }

  /* ---------- privacy & settings ---------- */

  const SOURCE_URL = 'https://github.com/meena-uma-ram/Speech-therapy';

  /* AGPL section 13: everyone who uses the app over a network can get its source code. */
  function licenceSection() {
    const src = S.serverInfo().source || SOURCE_URL;
    return '<section class="card"><h2>Licence &amp; source code</h2>' +
      '<p class="small">TJS is free software under the <strong>GNU Affero General Public License v3 or later</strong> (AGPL-3.0-or-later). You may use, study, change and share it. ' +
      'If you change it and let others use it, including over a network, you must offer them your changed source code under the same licence.</p>' +
      '<p class="small">Source code: <a href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">' + esc(src) + '</a> · <a href="LICENSE" target="_blank" rel="noopener">Full licence text</a></p>' +
      '<p class="small muted">It comes with no warranty. The licence covers the software, not your clinic\u2019s records: those stay yours, and your obligations for them are set by data protection law.</p></section>';
  }

  function viewPrivacy() {
    const st = S.state, set = st.settings, u = me();
    const lockOn = S.hasPassphrase();
    const due = st.patients.filter(function (p) { return L.isPastRetention(p, set.retentionYears); });
    const isLead = u.role === 'supervisor';
    const srv = S.isServer(), info = S.serverInfo();
    let html = '<header class="page-head"><div><h1>Privacy &amp; settings</h1><p class="muted">GDPR safeguards for patient data ' + (srv ? 'on your clinic\u2019s server' : 'on this device') + '</p></div></header>';

    html += storageSection();
    if (isLead) html += messagingSection();
    html += '<section class="card"><h2>How patient data is protected</h2><ul class="safeguards">' +
      (srv ? '<li>' + tick(true) + '<div><strong>Stays on your clinic\u2019s server.</strong> Records go only between this browser and the clinic computer, never to the app\u2019s makers or other websites. This device keeps nothing once you sign out.</div></li>' +
        '<li>' + tick(info.encryptedAtRest) + '<div><strong>Encrypted at rest on the server</strong> ' + (info.encryptedAtRest ? '(AES-256-GCM).' : '– not yet. Start the server with THERAPY_DATA_PASSPHRASE set, and turn on full-disk encryption.') + '</div></li>' +
        '<li>' + tick(info.https) + '<div><strong>Encrypted in transit</strong> ' + (info.https ? 'with HTTPS.' : '– only if you connect through the clinic VPN (Tailscale/WireGuard encrypt everything). Add HTTPS for the browser too.') + '</div></li>' +
        '<li>' + tick(true) + '<div><strong>Checked on the server.</strong> The server sends each person only the records their role may see and refuses changes they may not make.</div></li>'
      : '<li>' + tick(true) + '<div><strong>Stays on this device.</strong> Nothing is uploaded, and the app makes no requests to other websites (no web fonts, analytics or trackers).</div></li>' +
        '<li>' + tick(lockOn) + '<div><strong>Encrypted at rest</strong> ' + (lockOn ? 'with your passphrase (AES-256). Locks after ' + esc(set.autoLockMinutes) + ' minutes idle.' : '– not yet. Set a passphrase below.') + '</div></li>') +
      (srv ? '<li>' + tick(true) + '<div><strong>Individual sign-in and need-to-know access, enforced by the server.</strong> Supervisors see all diagnostics and therapy patients; each clinician receives only their own patients, plus sessions they cover or are invited to.</div></li>'
        : '<li>' + tick(false) + '<div><strong>Individual sign-in and need-to-know screens – not a security barrier.</strong> Each person\u2019s screens show only their own patients. But on one device all records are stored together, and anyone who can unlock this browser, or use its developer tools, can read them. For real separation between staff, run the clinic server.</div></li>') +
      '<li>' + tick(true) + '<div><strong>Pseudonymised coursework.</strong> Lesson plans and reports use the case code and initials.</div></li>' +
      '<li>' + tick(true) + '<div><strong>Consent ledger.</strong> Each answer per purpose, who gave it, in which language and notice version, how they confirmed it. Entries are sealed and never edited; withdrawal takes effect straight away.</div></li>' +
      '<li>' + tick(true) + '<div><strong>Access log</strong> of who opened, changed, shared or erased each record.</div></li>' +
      '<li>' + tick(due.length === 0) + '<div><strong>Retention:</strong> discharged records ' + (set.autoErase ? 'are erased automatically' : 'are flagged for erasure') + ' ' + esc(set.retentionYears) + ' years after therapy ends' + (due.length ? ' – <strong>' + due.length + ' due now</strong>' : '') + '.</div></li>' +
      '<li>' + tick(true) + '<div><strong>Crypto-shredding.</strong> Each patient has their own key, and backups store each patient encrypted with it. Erasing a patient destroys the key, so every earlier backup becomes unreadable for that patient. Each erasure leaves a deletion receipt.</div></li>' +
      '</ul><p class="small muted">Everyone signs in with their own password, stored only as a salted hash, and is signed out after ' + esc(set.autoLockMinutes) + ' minutes idle. ' +
      (srv ? 'Sign-ins, record views and changes are also logged on the server (access.log), out of reach of this browser.' : 'This protects records on a shared clinic computer. For staff on separate devices, run the clinic server (see docs/SERVER-SETUP.md).') + '</p></section>';

    html += '<section class="card"><h2>Encryption &amp; lock</h2>';
    if (srv) html += '<p class="small">Nothing is stored on this device, so there is nothing to encrypt here. Encryption of the records is set on the clinic server ' + (info.encryptedAtRest ? '(on).' : '(<strong>off</strong>).') + ' You are signed out after ' + esc(set.autoLockMinutes) + ' minutes idle.</p>';
    else if (!S.cryptoAvailable()) html += '<p class="muted">This browser cannot encrypt data here. Open the app over https or from a file in an up-to-date browser.</p>';
    else if (!lockOn) {
      html += '<form id="pass-form"><p class="small">Choose a passphrase of at least 10 characters. If it is lost, the data cannot be recovered, so keep a backup.</p>' +
        '<div class="grid-2"><label>Passphrase<input type="password" name="pass" minlength="10" autocomplete="new-password" required></label>' +
        '<label>Repeat passphrase<input type="password" name="pass2" minlength="10" autocomplete="new-password" required></label></div>' +
        '<p class="form-error" id="pass-error" hidden></p><div class="actions"><button class="btn btn-primary" type="submit">Encrypt data on this device</button></div></form>';
    } else {
      html += '<div class="actions wrap"><button class="btn" data-action="lock-now">Lock now</button><button class="btn btn-danger" data-action="remove-pass">Remove encryption</button></div>';
    }
    html += '</section>';

    html += '<form class="card" id="settings-form"><h2>Settings</h2>' +
      '<label class="check"><input type="checkbox" name="hideNames"' + (set.hideNames ? ' checked' : '') + '> Hide patient names on screen (show case code and initials)</label>' +
      (srv && !isLead ? '<p class="small muted">Clinic-wide settings are shared by everyone, so only a supervisor can change them.</p>' : '') +
      '<div class="grid-3"><label>Sign out / lock after (minutes idle)<input type="number" min="1" max="120" name="autoLockMinutes" value="' + esc(set.autoLockMinutes) + '"' + (srv && !isLead ? ' disabled' : '') + '></label>' +
      '<label>Keep records after therapy ends (years)<input type="number" min="0" max="30" name="retentionYears" value="' + esc(set.retentionYears) + '"' + (isLead ? '' : ' disabled') + '></label>' +
      '<label>Name used to sign family reports<input name="therapistName" value="' + esc(set.therapistName) + '"' + (srv && !isLead ? ' disabled' : '') + '></label></div>' +
      '<div class="grid-4">' + [['dayStart', 'Day starts'], ['lunchStart', 'Lunch from'], ['lunchEnd', 'Lunch until'], ['dayEnd', 'Day ends']].map(function (f) {
        return '<label>' + f[1] + '<input type="time" name="' + f[0] + '" value="' + esc(set[f[0]]) + '"' + (srv && !isLead ? ' disabled' : '') + '></label>';
      }).join('') + '</div>' +
      (isLead ? '<label class="check"><input type="checkbox" name="autoErase"' + (set.autoErase ? ' checked' : '') + '> Erase records automatically when the retention period ends (checked daily; each erasure issues a receipt)</label>' : '') +
      '<div class="actions"><button class="btn btn-primary" type="submit">Save settings</button></div></form>';

    if (due.length && isLead) {
      html += '<section class="card"><h2>Due for erasure</h2><ul class="list flat">' + due.map(function (p) {
        return '<li><div class="row"><div><strong>' + esc(pseud(p)) + '</strong><div class="muted small">Discharged ' + esc(L.formatDate(p.dischargedAt)) + '</div></div>' +
          '<button class="btn btn-sm btn-danger" data-action="erase" data-reason="Retention period ended" data-id="' + p.id + '">Erase</button></div></li>';
      }).join('') + '</ul></section>';
    }

    const vis = visiblePatients();
    html += '<section class="card"><h2>Requests from patients</h2><p class="small muted">Right of access and portability: copy everything held about a person. Right to erasure: delete the record and all linked notes.</p>' +
      '<div class="filters"><select id="sar-patient" aria-label="Patient">' + vis.map(function (p) { return opt(p.id, pseud(p) + ' – ' + nm(p)); }).join('') + '</select>' +
      '<button class="btn" data-action="copy-record">Copy full record</button>' +
      (isLead ? '<button class="btn btn-danger" data-action="erase-selected">Erase record</button>' : '') + '</div></section>';

    if (isLead) html += peopleSection();

    const log = st.audit.slice(-80).reverse();
    html += '<section class="card"><div class="card-head"><h2>Access log</h2><button class="btn btn-sm" data-action="copy-audit">Copy log</button></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead><tbody>' +
      log.map(function (e) {
        return '<tr><td class="nowrap">' + esc(fmtStamp(e.at)) + '</td><td>' + esc(e.user) + '</td><td>' + esc(e.action) + (e.detail ? ' <span class="muted">(' + esc(e.detail) + ')</span>' : '') + '</td><td>' + esc(e.target || '') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">Showing the latest ' + log.length + ' of ' + st.audit.length + ' entries.</p></section>';

    if (!srv || isLead) html += '<section class="card"><h2>Backups &amp; keys</h2>' +
      (srv ? '<p class="small"><strong>On the clinic server</strong>, back up with this button rather than by copying the data folder: copies of the folder hold every patient, and keep erased patients readable.</p>' : '') +
      (staleKeyFile() ? '<div class="callout warn"><strong>Replace your key file.</strong><span>A patient was erased after your last key file was made. Make a new key file now and destroy the old ones, or the erased patient can still be opened from old backups.</span></div>' : '') +
      '<p class="small">The <strong>whole backup is encrypted</strong> with a backup password you choose. Inside, <strong>each patient is encrypted again with their own key</strong>. The keys are never put in a backup: they stay ' + (srv ? 'on the server' : 'on this device') + ', with the key file as the recovery copy. Erasing a patient destroys their key, so later restores can\u2019t read them – as long as no key file made before the erasure is kept.</p>' +
      '<div class="actions wrap"><button class="btn btn-primary" data-action="make-backup">Create backup</button><button class="btn" data-action="export">Download backup</button>' +
      '<label class="btn">Restore backup or key file<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>' +
      '<div id="backup-out"></div>' +
      '<p class="small muted">Patient keys ' + (srv ? 'on the clinic server' : 'on this device') + ': ' + S.keyCount() + '. To restore on another device you also need the <strong>key file</strong>. It is the master copy of the keys, like a cloud key management service, so keep it in one secure place separate from backups. Replace it after every erasure: an old key file can still open erased patients in old backups.</p>' +
      (isLead ? '<div class="actions wrap"><button class="btn btn-sm" data-action="copy-keys">Copy key file</button></div>' : '') + '</section>';

    if (isLead) {
      const receipts = (st.deletionReceipts || []).slice().reverse();
      html += '<section class="card"><div class="card-head"><h2>Deletion receipts</h2>' + (receipts.length ? '<button class="btn btn-sm" data-action="copy-receipts">Copy receipts</button>' : '') + '</div>' +
        '<p class="small muted">Proof of each erasure without keeping the data: receipt number, case code, date, who erased it and why.</p>' +
        (receipts.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Receipt</th><th>Case</th><th>Erased</th><th>By</th><th>Reason</th><th>Backups</th></tr></thead><tbody>' + receipts.map(function (r) {
          return '<tr><td class="nowrap"><code>' + esc(r.id) + '</code>' + (r.test ? ' <span class="badge">Test</span>' : '') + '</td><td class="nowrap">' + esc(r.caseCode) + '</td><td class="nowrap">' + esc(fmtStamp(r.erasedAt)) + '</td><td>' + esc(r.erasedBy) + '</td><td>' + esc(r.reason) + '</td><td class="small">' + esc(r.keyDestroyed) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted small">No erasures yet.</p>') +
        '<div class="actions wrap"><button class="btn" data-action="deletion-test">Run deletion test</button>' + (set.autoErase ? '' : '<button class="btn" data-action="run-retention">Apply retention rule now</button>') + '</div>' +
        '<div id="deletion-test-out"></div></section>';
    }

    html += '<section class="card"><h2>Your organisation\'s part</h2><p class="small">The app supports GDPR compliance but cannot provide it alone. Your clinic or university, as data controller, still needs to:</p><ul class="small plain">' +
      '<li>Record the lawful basis for processing health data (usually Article 6(1)(e) or (b) with Article 9(2)(h)), and complete a DPIA.</li>' +
      '<li>Give patients a privacy notice explaining how their data is used, including by student clinicians.</li>' +
      '<li>Use encrypted, managed devices, and send reports only through a secure channel (not personal email or messaging apps).</li>' +
      '<li>Have a process for access and erasure requests (one month to respond) and for reporting breaches (within 72 hours).</li>' +
      '<li>Where a law requires records to be kept for a set number of years, set the retention period to match. Keep only what the law requires, for as long as it requires, with minimal access. Delete everything else on schedule.</li></ul>' +
      '<p class="small"><strong>What you can truthfully say:</strong> “Patient data is erased from live systems on request or at the end of the retention period, and made permanently unreadable in backups through per-patient encryption keys.”</p></section>';

    if (S.isDemo() && !srv) {
      html += '<section class="card"><h2>Demo</h2><p class="small">This is the demo workspace: fake data only, kept apart from your clinic\u2019s real records.</p><div class="actions wrap">' +
        '<button class="btn" data-action="fake-patients">+ Generate fake patients</button><button class="btn" data-action="reset-demo">Reset demo</button>' +
        '<button class="btn" data-action="choose-workspace" data-ws="clinic">Go to my clinic</button></div></section>';
    } else if (isLead && !srv) {
      html += '<section class="card"><h2>Start over</h2><div class="actions wrap">' +
        '<button class="btn btn-danger" data-action="clear-all">Delete all patient data</button>' +
        '<button class="btn btn-danger" data-action="clean-start">Clean start: delete everything, including all accounts</button></div>' +
        '<p class="small muted">To show TJS to someone, use the demo instead: <button class="link" data-action="choose-workspace" data-ws="demo">open the demo</button>. It never touches these records.</p></section>';
    } else if (isLead && srv && S.isDemo()) {
      html += '<section class="card"><h2>Demo server</h2><p class="small"><strong>This server runs the demo: fake data only.</strong></p><div class="actions wrap"><button class="btn" data-action="fake-patients">+ Generate fake patients</button></div></section>';
    }
    html += licenceSection();
    return html;
  }

  /* ---------- actions & form handlers for the workflow ---------- */

  const ACTIONS = {
    'start-assessment': function (el) {
      const a = S.upsert('assessments', { patientId: el.dataset.patient, assessorId: me().id, date: L.todayISO(), status: 'draft' });
      go('#/assessment/' + a.id);
    },
    'allot': function (el) { allotForm(el.dataset.patient); },
    'take-case': function (el) {
      const p = S.patient(el.dataset.patient);
      const check = L.canAllot(p, me());
      if (!check.ok) { toast(check.reason); return; }
      assignCase(p, me(), ''); S.save(); render();
    },
    'new-doc': function (el) { newDoc(el.dataset.type, el.dataset.patient, el.dataset.appt); },
    'copy-doc': function (el) {
      const d = S.doc(el.dataset.id), p = S.patient(d.patientId);
      // Taking coursework out of TJS (portfolio, university submission) is a teaching use, so it needs teaching consent.
      if (!(p.consent && p.consent.teaching)) { toast('No consent for teaching use: this coursework can be reviewed here but not copied out.'); return; }
      S.audit('Copied coursework for teaching use', p.id, L.DOC_TYPES[d.type].label);
      copyText(docText(d));
    },
    'toggle-names': function () { S.state.settings.hideNames = !S.state.settings.hideNames; S.save(); render(); },
    'lock-now': function () { S.audit('Locked'); S.lock().then(render); },
    'remove-pass': function () {
      ask('Remove encryption? Patient data will be stored unencrypted on this device.', 'Remove encryption').then(function (ok) {
        if (!ok) return;
        S.removePassphrase().then(function () { S.audit('Removed encryption'); render(); toast('Encryption removed'); });
      });
    },
    'copy-record': function () {
      const pid = document.getElementById('sar-patient').value;
      if (!pid) return;
      S.audit('Copied full record (access request)', pid);
      copyText(JSON.stringify(S.patientRecord(pid), null, 2));
    },
    'erase-selected': function () { eraseRecord(document.getElementById('sar-patient').value); },
    'erase': function (el) { eraseRecord(el.dataset.id, el.dataset.reason); },
    'discharge': function (el) {
      const p = S.patient(el.dataset.id);
      if (p.status === 'discharged') { p.status = 'active'; p.dischargedAt = null; S.audit('Reopened case', p.id); }
      else { p.status = 'discharged'; p.dischargedAt = L.todayISO(); S.audit('Discharged', p.id); }
      S.save(); render();
    },
    'remove-user': function (el) { S.remove('users', el.dataset.id); render(); },
    'copy-audit': function () {
      copyText(S.state.audit.map(function (e) { return [e.at, e.user, e.action, e.target, e.detail].join('\t'); }).join('\n'));
    }
  };

  Object.assign(ACTIONS, {
    'make-backup': function () {
      backupPassword(function (pw) {
        return S.exportBackup(pw).then(function (text) {
          S.audit('Created backup');
          document.getElementById('backup-out').innerHTML = '<p class="small">Backup created and encrypted with your backup password; ' + S.state.patients.length + ' patients inside, each also encrypted with their own key. Copy it into your organisation\'s secure storage.</p>' +
            '<textarea id="backup-text" rows="5" readonly>' + esc(text) + '</textarea><div class="actions wrap"><button class="btn btn-sm" data-action="copy-backup">Copy backup</button></div>';
        });
      });
    },
    'copy-keys': function () { S.audit('Copied key file'); copyText(S.exportKeyFile()); render(); },
    'copy-receipts': function () {
      copyText(S.state.deletionReceipts.map(function (r) { return [r.id, r.caseCode, r.erasedAt, r.erasedBy, r.reason, r.keyDestroyed].join('\t'); }).join('\n'));
    },
    'run-retention': function () {
      const r = S.runRetention();
      toast(r.length ? r.length + ' record' + (r.length === 1 ? '' : 's') + ' erased by the retention rule' : 'No records have passed the retention period');
      render();
    },
    'deletion-test': function () { runDeletionTest(); }
  });

  /*
   * Deletion test: create a fake patient, back it up, erase it, then check every place data lives on this device
   * and confirm the earlier backup can no longer be read for that patient.
   */
  /* Ask for the backup password (twice when making a backup), then run `then(password)`, which returns a promise. */
  function backupPassword(then, restoring) {
    openModal(restoring ? 'Open encrypted backup' : 'Backup password',
      '<p class="small">' + (restoring ? 'Enter the password this backup was made with.' : 'The whole backup file is encrypted with this password. Keep it apart from the backup and from the key file. Without it, the backup cannot be opened.') + '</p>' +
      '<label>Backup password<input type="password" name="b1" minlength="' + (restoring ? 1 : 10) + '" required autocomplete="' + (restoring ? 'current-password' : 'new-password') + '"></label>' +
      (restoring ? '' : '<label>Repeat password<input type="password" name="b2" minlength="10" required autocomplete="new-password"></label>'),
    function (fd) {
      if (!restoring && fd.get('b1') !== fd.get('b2')) { toast('The passwords don\u2019t match.'); return false; }
      then(fd.get('b1')).catch(function (e) { toast((restoring ? 'Could not restore: ' : 'Could not make the backup: ') + e.message); });
    });
  }

  /* A patient was erased after the last key file was made, so that key file may hold an erased patient's key. */
  function staleKeyFile() {
    const ex = S.state.settings.keyFileExports || [];
    const last = ex[ex.length - 1];
    return !!last && (last.version || 0) < (S.state.settings.keysetVersion || 0);
  }

  function runDeletionTest() {
    const out = document.getElementById('deletion-test-out');
    out.innerHTML = '<p class="small muted">Running…</p>';
    const marker = 'Deletion-Test ' + Math.random().toString(36).slice(2, 8);
    const pid = 'p_test_' + Date.now().toString(36);
    S.upsert('patients', { id: pid, name: marker, caseCode: 'TEST-' + pid.slice(-4).toUpperCase(), status: 'discharged', ageGroup: 'Adult', condition: 'Test',
      consent: { therapy: true }, sessionsAllotted: 1, dischargedAt: L.todayISO(), notes: marker });
    S.upsert('goals', { patientId: pid, title: marker, specific: marker, status: 'active', materialIds: [] });
    S.upsert('appointments', { patientId: pid, date: L.todayISO(), time: '07:00', duration: 30, goalIds: [], status: 'attended', reschedules: [], observers: [] });
    S.upsert('logs', { patientId: pid, date: L.todayISO(), entries: [], notes: marker, homework: '' });
    S.send(me().id, { kind: 'note', patientId: pid, subject: 'Test message', body: marker });
    S.audit('Deletion test: created test patient', pid);
    let backup, file, receipt, testFile;
    const pw = 'test-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    S.addFile(new File(['%PDF-1.4 ' + marker], 'deletion-test.pdf', { type: 'application/pdf' }), { patientId: pid, category: 'Scanned report', note: marker }).then(function (m) {
      testFile = m;
      return S.exportBackup(pw);
    }).then(function (text) {
      file = text;
      return S.openBackup(text, pw);
    }).then(function (inner) {
      backup = inner;
      receipt = S.erasePatient(pid, 'Deletion test', null, true);
      return S.flush();
    }).then(function () {
      const bundle = backup.patients.find(function (b) { return b.pid === pid; });
      let stored = false;
      return (S.isServer() ? Promise.resolve(false) : new Promise(function (r) { setTimeout(r, 300); }).then(function () { return S.fileStoredHere(testFile.id); })).then(function (x) { stored = x; return S.openBundle(bundle); }).then(function (readable) {
        const live = JSON.stringify(Object.assign({}, S.state, { deletionReceipts: [] }));
        const checks = [
          ['Test patient was in the backup before erasure', !!bundle],
          ['Gone from live records (patients, goals, sessions, logs, messages, access log)', live.indexOf(pid) < 0 && live.indexOf(marker) < 0],
          ['Not in this device\'s stored data', S.rawStorage().indexOf(marker) < 0],
          ['Patient key destroyed', !S.hasKey(pid)],
          ['Attached file removed from the file store', !stored],
          ['The earlier backup can no longer be read for this patient', readable === null],
          ['Name not readable anywhere in the backup, even after opening it with the backup password', JSON.stringify(backup).indexOf(marker) < 0],
          ['The backup file itself is encrypted (no names or case codes readable without the password)', file.indexOf(marker) < 0 && file.indexOf('TEST-') < 0],
          ['Deletion receipt issued (' + receipt.id + ')', S.state.deletionReceipts.some(function (r) { return r.id === receipt.id; })]
        ];
        const pass = checks.every(function (c) { return c[1]; });
        S.audit('Deletion test ' + (pass ? 'passed' : 'FAILED'));
        out.innerHTML = '<div class="callout ' + (pass ? 'ok' : 'warn') + '"><strong>Deletion test ' + (pass ? 'passed' : 'failed') + '</strong><ul class="plain">' +
          checks.map(function (c) { return '<li>' + tick(c[1]) + ' ' + esc(c[0]) + '</li>'; }).join('') + '</ul></div>';
      });
    }).catch(function (e) { out.innerHTML = '<p class="form-error">The test could not run: ' + esc(e.message) + '</p>'; });
  }

  function eraseRecord(pid, reason) {
    const p = S.patient(pid);
    if (!p) return;
    ask('Erase all data for ' + pseud(p) + '? This removes the record, assessments, sessions, notes, coursework and files from this device and destroys the patient\'s key, so earlier backups can no longer be read for this patient. It cannot be undone.', 'Erase').then(function (ok) {
      if (!ok) return;
      const r = S.erasePatient(pid, reason || 'Erasure request');
      toast('Erased · deletion receipt ' + r.id);
      go('#/patients');
      render();
    });
  }

  const SUBMITS = {
    'assessment-form': function (form, intent) { submitAssessment(form, intent); },
    'doc-form': function (form, intent) { submitDoc(form, intent); },
    'review-form': function (form, intent) { submitReview(form, intent); },
    'unlock-form': function (form) {
      const err = document.getElementById('unlock-error');
      S.unlock(form.querySelector('[name=pass]').value).then(function () {
        S.audit('Unlocked'); lastActivity = Date.now(); render();
      }, function (e) { err.textContent = e.message; err.hidden = false; });
    },
    'pass-form': function (form) {
      const a = form.querySelector('[name=pass]').value, b = form.querySelector('[name=pass2]').value;
      const err = document.getElementById('pass-error');
      if (a !== b) { err.textContent = 'The passphrases don\'t match.'; err.hidden = false; return; }
      S.setPassphrase(a).then(function () { S.audit('Turned on encryption'); render(); toast('Data is now encrypted on this device'); });
    },
    'user-form': function (form) {
      const name = form.querySelector('[name=name]').value.trim();
      if (!name) return;
      S.upsert('users', { name: name, role: form.querySelector('[name=role]').value, year: form.querySelector('[name=year]').value.trim() });
      render(); toast(name + ' added');
    }
  };

  /* Auto-lock after inactivity when encryption is on. */
  let lastActivity = Date.now();
  ['click', 'keydown', 'pointermove', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, function () { lastActivity = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (S.isLocked() || !S.currentUser()) return;
    const mins = Number(S.state.settings.autoLockMinutes) || 10;
    if (Date.now() - lastActivity < mins * 60000) return;
    if (modal.open) modal.close();
    Promise.resolve(S.signOut()).then(function () { if (S.hasPassphrase()) return S.lock(); }).then(render);
  }, 20000);

  let lastViewed = null;

  function statusPill(p) {
    const map = { waiting: ['Awaiting assessment', 'badge-warn'], referred: ['Referred – not allotted', 'badge-warn'], discharged: ['Discharged', 'badge-muted'] };
    const s = map[p.status];
    return s ? ' <span class="badge ' + s[1] + '">' + s[0] + '</span>' : '';
  }

  /* Lesson plan / session report status for a session held by a student. */
  function courseworkPanel(a, p) {
    if (!isStudentCase(p)) return '';
    const u = me();
    const author = u.id === p.assignedTo;
    const docs = S.docsForPatient(p.id).filter(function (d) { return d.appointmentId === a.id; });
    const cell = function (type, allowed, wait) {
      const list = docs.filter(function (d) { return d.type === type; });
      if (list.length) return list.map(docChip).join(' ');
      if (author && allowed) return '<button class="btn btn-sm" data-action="new-doc" data-type="' + type + '" data-patient="' + p.id + '" data-appt="' + a.id + '">Write</button>';
      return '<span class="muted small">' + (allowed ? 'Not started' : wait) + '</span>';
    };
    return '<section class="card coursework"><div class="card-head"><h2>Coursework for this session</h2><span class="muted small">' + esc(userName(p.assignedTo)) + ' · supervisor ' + esc(firstName(p.supervisorId)) + '</span></div>' +
      '<div class="doc-row"><strong>Lesson plan</strong><div>' + cell('lesson-plan', true) + '</div></div>' +
      '<div class="doc-row"><strong>Session report</strong><div>' + cell('session-report', a.date <= L.todayISO(), 'After the session') + '</div></div></section>';
  }

  function recordTab(p) {
    const a = S.latestAssessment(p.id);
    const r = S.referralFor(p.id);
    const manage = canManage(p) && me().role !== 'diagnostician';
    return '<section class="card"><h2>Case</h2><dl class="kv">' +
      '<div><dt>Case code</dt><dd>' + esc(p.caseCode) + '</dd></div>' +
      '<div><dt>Status</dt><dd>' + esc({ waiting: 'Awaiting assessment', referred: 'Referred, not yet allotted', active: 'In therapy', discharged: 'Discharged ' + (p.dischargedAt ? L.formatDate(p.dischargedAt) : '') }[p.status] || p.status) + '</dd></div>' +
      '<div><dt>Clinician</dt><dd>' + esc(p.assignedTo ? userName(p.assignedTo) : '—') + '</dd></div>' +
      '<div><dt>Supervisor</dt><dd>' + esc(p.supervisorId ? userName(p.supervisorId) : '—') + '</dd></div>' +
      '<div><dt>Assessment</dt><dd>' + (a ? '<a href="#/assessment/' + a.id + '">' + esc(L.formatDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' })) + ' · ' + esc(a.diagnosis || 'draft') + '</a> by ' + esc(userName(a.assessorId)) : '—') + '</dd></div>' +
      '<div><dt>Referral</dt><dd>' + (r ? esc(r.priority) + ', ' + esc(L.formatDate(r.at, { day: 'numeric', month: 'short' })) + (r.status === 'pending' ? ' – awaiting allotment' : ' – allotted') : '—') + '</dd></div>' +
      '</dl></section>' +
      consentSection(p) + lettersSection(p) +
      (manage ? '<section class="card"><h2>Data requests</h2><div class="actions wrap"><button class="btn" data-action="copy-record-one" data-id="' + p.id + '">Copy full record</button>' +
        '<button class="btn" data-action="discharge" data-id="' + p.id + '">' + (p.status === 'discharged' ? 'Reopen case' : 'Discharge') + '</button>' +
        (me().role === 'supervisor' ? '<button class="btn btn-danger" data-action="erase" data-id="' + p.id + '">Erase record</button>' : '') + '</div></section>' : '');
  }
  ACTIONS['copy-record-one'] = function (el) {
    S.audit('Copied full record (access request)', el.dataset.id);
    copyText(JSON.stringify(S.patientRecord(el.dataset.id), null, 2));
  };

  /* ---------- sign-in ---------- */

  let pendingNotice = false;
  let lastInvite = null;

  function loginScreen() {
    const info = S.serverInfo();
    const accounts = S.isServer() ? info.demoAccounts : S.state.seeded && S.state.users.map(function (u) { return { login: u.email || u.name, name: u.name, role: u.role }; });
    const demo = !!accounts;
    return '<div class="lock"><form id="login-form" class="card lock-card">' +
      '<h1>Sign in to TJS</h1><p class="muted">Each person signs in with their own account and sees only the patients they need.</p>' +
      (S.isServer() ? '<p class="small muted">Connected to ' + esc(info.clinic || 'your clinic') + '\u2019s server at ' + esc(location.host) + (info.https ? '' : ' (use only inside the clinic VPN)') + '.</p>' : '') +
      '<label>Email or name<input name="login" id="login-name" autocomplete="username" required></label>' +
      '<label>Password<input type="password" name="pass" autocomplete="current-password"></label>' +
      '<p class="form-error" id="login-error" hidden></p>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Sign in</button></div>' +
      (demo ? '<div class="demo-accounts"><p class="small"><strong>Demo accounts</strong> (password <code>' + esc(S.demoPassword) + '</code>):</p><ul class="small">' +
        accounts.map(function (u) {
          return '<li><button type="button" class="link" data-action="demo-login" data-login="' + esc(u.login) + '">' + esc(u.login) + '</button> – ' + esc(u.name) + ', ' + esc(L.ROLES[u.role].label.toLowerCase()) + '</li>';
        }).join('') + '</ul></div>' : '<p class="muted small">Forgotten your password? Ask your clinical supervisor to reset it.</p>') +
      (S.isServer() ? '' : '<p class="small"><button type="button" class="link" data-action="choose-workspace" data-ws="' + (S.isDemo() ? 'clinic' : 'demo') + '">' + (S.isDemo() ? 'Go to my clinic (real data) ›' : 'Open the demo (fake data) ›') + '</button></p>') +
      '</form></div>';
  }

  function newPasswordScreen(u) {
    return '<div class="lock"><form id="newpw-form" class="card lock-card">' +
      '<h1>Choose your password</h1><p class="muted">Welcome, ' + esc(u.name) + '. Set a password only you know before continuing.</p>' +
      '<label>New password<input type="password" name="p1" minlength="8" autocomplete="new-password" required></label>' +
      '<label>Repeat password<input type="password" name="p2" minlength="8" autocomplete="new-password" required></label>' +
      '<p class="form-error" id="newpw-error" hidden></p>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Save and continue</button></div></form></div>';
  }

  /* Unread messages pop up after signing in. */
  function showNotices() {
    const u = S.currentUser();
    if (!u) return;
    const unread = S.inbox(u.id).filter(function (m) { return !m.read; });
    if (!unread.length) return;
    const dlg = document.getElementById('notice');
    if (dlg.open) return;
    dlg.innerHTML = '<form method="dialog" class="confirm-form"><header class="notice-head"><h2>You have ' + unread.length + ' new message' + (unread.length === 1 ? '' : 's') + '</h2>' +
      '<button class="btn btn-ghost" value="later" aria-label="Close">✕</button></header>' +
      '<ul class="notice-list">' + unread.slice(0, 5).map(function (m) {
        return '<li><span class="kind kind-' + esc(m.kind) + '">' + esc(KIND_LABEL[m.kind] || 'Message') + '</span> <strong>' + esc(m.subject) + '</strong><div class="muted small">' + esc(userName(m.from)) + ' · ' + esc(fmtStamp(m.at)) + '</div></li>';
      }).join('') + '</ul><div class="actions"><button class="btn" value="later">Later</button> <button class="btn btn-primary" value="open">Open inbox</button></div></form>';
    // One handler at a time; closes with ✕, Later, Escape or a click outside.
    dlg.onclose = function () { dlg.onclose = null; if (dlg.returnValue === 'open') go('#/inbox'); };
    dlg.onclick = function (ev) { if (ev.target === dlg) dlg.close('later'); };
    dlg.returnValue = '';
    dlg.showModal();
    const later = dlg.querySelector('.actions [value=later]');
    if (later) later.focus();
  }

  /* ---------- access for covering and observing ---------- */

  function grants() {
    const u = S.currentUser();
    const g = {};
    if (!u) return g;
    S.state.appointments.forEach(function (a) {
      if (a.coverBy === u.id || (a.observers || []).some(function (o) { return o.userId === u.id && o.status === 'accepted'; })) g[a.patientId] = true;
    });
    return g;
  }
  function observing(a, uid) { return (a.observers || []).some(function (o) { return o.userId === uid && o.status === 'accepted'; }); }
  function supervisorsFor(p) {
    if (p && p.supervisorId) return [p.supervisorId];
    return S.state.users.filter(function (u) { return u.role === 'supervisor'; }).map(function (u) { return u.id; });
  }
  function canRunSession(a, p) {
    const u = me();
    return u.role === 'supervisor' || L.clinicianFor(a, p) === u.id || p.assignedTo === u.id;
  }

  function apptBadges(a, p) {
    const u = me();
    let h = '';
    if (a.coverNeeded) h += '<span class="badge badge-warn">Needs cover</span>';
    if (a.coverBy) h += '<span class="badge badge-info">' + (a.coverBy === u.id ? 'You are covering' : 'Cover: ' + esc(firstName(a.coverBy))) + '</span>';
    if (observing(a, u.id)) h += '<span class="badge">Observing</span>';
    if ((a.reschedules || []).length) h += '<span class="badge">Rescheduled</span>';
    return h;
  }

  function countsLine(p) {
    const c = L.sessionCounts(S.appointmentsFor(p.id), p.sessionsAllotted);
    return '<span class="counts"><strong>' + c.attended + '</strong> of ' + c.allotted + ' sessions attended' +
      (c.missed ? ' · <span class="bad">' + c.missed + ' did not attend</span>' : '') +
      (c.cancelled ? ' · ' + c.cancelled + ' cancelled' : '') +
      (c.rescheduled ? ' · ' + c.rescheduled + ' rescheduled' : '') +
      ' · ' + c.upcoming + ' booked</span>';
  }

  /* ---------- session tools: attendance, reschedule, invite ---------- */

  function sessionTools(a, p) {
    const run = canRunSession(a, p);
    const obs = (a.observers || []);
    const st = a.status;
    let h = '<section class="card session-tools"><div class="st-row"><div>' + countsLine(p) + '</div>' +
      (run ? '<div class="head-actions"><button class="btn btn-sm" data-action="reschedule" data-id="' + a.id + '">Reschedule</button>' +
        '<button class="btn btn-sm" data-action="invite" data-id="' + a.id + '">Invite to observe</button></div>' : '') + '</div>';
    if (run) {
      h += '<div class="st-row"><span class="meta-label">Attendance</span><div class="seg-toggle" role="group" aria-label="Attendance">' +
        [['attended', 'Attended'], ['missed', 'Did not attend'], ['cancelled', 'Cancelled'], ['scheduled', 'Not yet']].map(function (x) {
          return '<button class="' + (st === x[0] || (x[0] === 'attended' && st === 'completed') ? 'on' : '') + '" data-action="attend" data-id="' + a.id + '" data-status="' + x[0] + '">' + x[1] + '</button>';
        }).join('') + '</div></div>';
    }
    if (a.coverBy || a.coverNeeded) {
      h += '<p class="small">' + (a.coverBy ? 'Covered by <strong>' + esc(userName(a.coverBy)) + '</strong> while ' + esc(userName(p.assignedTo)) + ' is on leave.' : '<span class="badge badge-warn">Needs cover</span> ' + esc(userName(p.assignedTo)) + ' is on leave.') + '</p>';
    }
    if (obs.length) {
      h += '<p class="small"><span class="meta-label">Invited</span> ' + obs.map(function (o) {
        return esc(userName(o.userId)) + ' (' + esc(o.role.toLowerCase()) + ', ' + esc({ invited: 'awaiting reply', accepted: 'accepted', declined: 'declined' }[o.status]) + ')';
      }).join(' · ') + '</p>';
    }
    if ((a.reschedules || []).length) {
      h += '<details class="small"><summary>Rescheduled ' + a.reschedules.length + ' time' + (a.reschedules.length === 1 ? '' : 's') + '</summary><ul class="plain">' +
        a.reschedules.map(function (r) {
          return '<li>' + esc(L.formatDate(r.fromDate, { day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(r.fromTime)) + ' → ' + esc(L.formatDate(r.toDate, { day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(r.toTime)) +
            ' · by <strong>' + esc(r.by) + '</strong>' + (r.reason ? ' – ' + esc(r.reason) : '') + ' <span class="muted">(recorded by ' + esc(userName(r.userId)) + ')</span></li>';
        }).join('') + '</ul></details>';
    }
    return h + '</section>';
  }

  function rescheduleForm(id) {
    const a = S.appointment(id), p = S.patient(a.patientId);
    const u = me();
    const defBy = u.role === 'supervisor' ? 'Supervisor' : 'Clinician';
    openModal('Reschedule session',
      '<p class="small">' + esc(pseud(p)) + ' · now ' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(a.time)) + '</p>' +
      '<div class="grid-2"><label>New date<input type="date" name="date" required value="' + esc(a.date) + '"></label>' +
      '<label>New time<input type="time" name="time" required value="' + esc(a.time) + '"></label></div>' +
      '<label>Rescheduled by<select name="by">' + L.RESCHEDULED_BY.map(function (b) { return opt(b, b, b === defBy); }).join('') + '</select></label>' +
      '<label>Reason<input name="reason" required placeholder="e.g. child unwell, clinician in training, room unavailable"></label>' +
      '<p class="small muted">The supervisor is told about every reschedule.</p>',
      function (fd) {
        const entry = { at: new Date().toISOString(), userId: u.id, by: fd.get('by'), reason: fd.get('reason').trim(),
          fromDate: a.date, fromTime: a.time, toDate: fd.get('date'), toTime: fd.get('time') };
        a.reschedules = (a.reschedules || []).concat([entry]);
        a.date = entry.toDate; a.time = entry.toTime;
        if (a.status !== 'cancelled') a.status = 'scheduled';
        S.audit('Rescheduled session', p.id, entry.by + ': ' + entry.reason);
        S.send(supervisorsFor(p).filter(function (x) { return x !== u.id; }), {
          kind: 'reschedule', patientId: p.id, link: '#/session/' + a.id,
          subject: 'Session rescheduled by ' + entry.by + ' – ' + pseud(p),
          body: L.formatDate(entry.fromDate) + ' ' + L.formatTime(entry.fromTime) + ' → ' + L.formatDate(entry.toDate) + ' ' + L.formatTime(entry.toTime) + '\nReason: ' + entry.reason
        });
        toast('Session moved; supervisor informed');
      });
  }

  function inviteForm(id) {
    const a = S.appointment(id), p = S.patient(a.patientId);
    const u = me();
    const taken = (a.observers || []).map(function (o) { return o.userId; }).concat([u.id, L.clinicianFor(a, p)]);
    const people = S.state.users.filter(function (x) { return x.role !== 'diagnostician' && taken.indexOf(x.id) < 0; });
    const form = openModal('Invite to this session',
      '<p class="small">' + esc(pseud(p)) + ' · ' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(a.time)) + '</p>' +
      (people.length ? '<label>Invite<select name="who" required>' + opt('', 'Choose…') + people.map(function (x) { return opt(x.id, x.name + ' – ' + L.ROLES[x.role].label); }).join('') + '</select></label>' +
        '<label>As<select name="role">' + ['Observe', 'Co-treat', 'Supervise'].map(function (r) { return opt(r, r); }).join('') + '</select></label>' +
        '<label>Message<textarea name="note" rows="2" placeholder="What would you like them to look at?"></textarea></label>' +
        '<p class="small muted">If they accept, they can open this patient\'s record for the session.</p>' : '<p class="muted">Everyone has already been invited.</p>'),
      function (fd) {
        if (!fd.get('who')) return false;
        a.observers = (a.observers || []).concat([{ userId: fd.get('who'), role: fd.get('role'), status: 'invited', by: u.id }]);
        S.send(fd.get('who'), {
          kind: 'invite', apptId: a.id, patientId: p.id, link: '#/session/' + a.id,
          subject: 'Invitation to ' + fd.get('role').toLowerCase() + ' – ' + pseud(p) + ', ' + L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + L.formatTime(a.time),
          body: fd.get('note').trim() || 'Would you join this session?'
        });
        S.audit('Invited ' + userName(fd.get('who')) + ' to ' + fd.get('role').toLowerCase(), p.id);
        toast('Invitation sent');
      });
    form.querySelector('[type=submit]').textContent = 'Send invitation';
  }

  /* ---------- inbox ---------- */

  const KIND_LABEL = { review: 'Review', submitted: 'To review', referral: 'Referral', allotted: 'New case', leave: 'Leave', cover: 'Cover', reschedule: 'Reschedule', invite: 'Invitation', attendance: 'Attendance', note: 'Message' };

  function viewInbox(id) {
    const u = me();
    const list = S.inbox(u.id);
    let html = '<header class="page-head"><div><h1>Inbox</h1><p class="muted">' + S.unread(u.id) + ' unread · review comments, allotments, cover and reschedules</p></div>' +
      '<div class="head-actions"><a class="btn" href="#/files-to-file">Files to file (' + unfiled().length + ')</a><button class="btn btn-primary" data-action="compose">New message</button></div></header>';
    if (id) {
      const m = list.find(function (x) { return x.id === id; });
      if (!m) return html + '<div class="empty"><p>Message not found.</p></div>';
      if (!m.read) { m.read = true; S.save(); }
      const a = m.apptId && S.appointment(m.apptId);
      const mine = a && (a.observers || []).find(function (o) { return o.userId === u.id; });
      html = '<a class="back" href="#/inbox">‹ Inbox</a><article class="card message"><div class="card-head"><div><span class="kind kind-' + esc(m.kind) + '">' + esc(KIND_LABEL[m.kind] || 'Message') + '</span>' +
        '<h1 class="msg-subject">' + esc(m.subject) + '</h1><p class="muted small">From ' + esc(userName(m.from)) + ' · ' + esc(fmtStamp(m.at)) + '</p></div></div>' +
        '<p class="pre">' + esc(m.body) + '</p><div class="actions wrap">' +
        (m.kind === 'invite' && mine && mine.status === 'invited' ? '<button class="btn btn-primary" data-action="invite-reply" data-appt="' + a.id + '" data-answer="accepted">Accept</button><button class="btn" data-action="invite-reply" data-appt="' + a.id + '" data-answer="declined">Decline</button>' : '') +
        (mine && mine.status !== 'invited' ? '<span class="badge">' + (mine.status === 'accepted' ? 'You accepted' : 'You declined') + '</span>' : '') +
        (m.link && (m.kind !== 'invite' || (mine && mine.status === 'accepted')) ? '<a class="btn btn-primary" href="' + esc(m.link) + '">Open</a>' : '') +
        (m.from ? '<button class="btn" data-action="compose" data-to="' + esc(m.from) + '" data-subject="' + esc('Re: ' + m.subject) + '">Reply</button>' : '') +
        '</div></article>';
      return html;
    }
    if (!list.length) return html + '<div class="empty"><p>No messages yet.</p></div>';
    return html + '<ul class="list inbox">' + list.map(function (m) {
      return '<li><a class="row' + (m.read ? '' : ' unread') + '" href="#/inbox/' + m.id + '"><div class="msg-main"><span class="kind kind-' + esc(m.kind) + '">' + esc(KIND_LABEL[m.kind] || 'Message') + '</span> ' +
        '<strong>' + esc(m.subject) + '</strong><div class="muted small msg-preview">' + esc(userName(m.from)) + ' – ' + esc((m.body || '').split('\n')[0]) + '</div></div>' +
        '<span class="muted small nowrap">' + esc(fmtStamp(m.at)) + '</span></a></li>';
    }).join('') + '</ul>';
  }

  function composeForm(to, subject) {
    const u = me();
    openModal('New message',
      '<label>To<select name="to" required>' + opt('', 'Choose…') + S.state.users.filter(function (x) { return x.id !== u.id; })
        .map(function (x) { return opt(x.id, x.name + ' – ' + L.ROLES[x.role].label, x.id === to); }).join('') + '</select></label>' +
      '<label>Subject<input name="subject" required value="' + esc(subject || '') + '"></label>' +
      '<label>Message<textarea name="body" rows="5" required></textarea></label>' +
      '<p class="small muted">Refer to patients by case code and initials only.</p>',
      function (fd) {
        S.send(fd.get('to'), { kind: 'note', subject: fd.get('subject').trim(), body: fd.get('body').trim() });
        toast('Message sent');
      });
    modal.querySelector('[type=submit]').textContent = 'Send';
  }

  /* ---------- leave & cover ---------- */

  const LEAVE_REASONS = ['Annual leave', 'Sick leave', 'Study / exam', 'Conference / training', 'Placement elsewhere', 'Other'];

  function coverCtx(awayId) {
    return { users: S.state.users, patientsById: S.byId(S.state.patients), appts: S.state.appointments, leaves: S.state.leave, awayId: awayId };
  }

  function viewLeave() {
    const u = me(), st = S.state;
    const isSup = u.role === 'supervisor';
    let html = '<header class="page-head"><div><h1>Leave &amp; cover</h1><p class="muted">' +
      (isSup ? 'Cover the sessions of clinicians who are away' : 'Tell your supervisor when you are away, so your patients are covered') + '</p></div></header>';
    if (isSup) {
      html += '<form class="card" id="autocover-form"><label class="check"><input type="checkbox" name="autoCover"' + (st.settings.autoCover ? ' checked' : '') + '> ' +
        'Assign cover automatically as soon as leave is requested (free clinicians with the lightest day; students only with patient consent)</label>' +
        '<div class="actions"><button class="btn btn-sm" type="submit">Save</button></div></form>';
      const reqs = st.leave.slice().sort(function (a, b) { return (a.status === 'covered') - (b.status === 'covered') || a.from.localeCompare(b.from); });
      if (!reqs.length) return html + '<div class="empty"><p>No leave requests.</p></div>';
      return html + reqs.map(function (l) { return leaveCard(l, true); }).join('');
    }
    html += '<form id="leave-form" class="card"><h2>Request leave</h2><div class="grid-3">' +
      '<label>From<input type="date" name="from" required value="' + L.addDays(L.todayISO(), 1) + '"></label>' +
      '<label>To<input type="date" name="to" required value="' + L.addDays(L.todayISO(), 1) + '"></label>' +
      '<label>Reason<select name="reason">' + LEAVE_REASONS.map(function (r) { return opt(r, r); }).join('') + '</select></label></div>' +
      '<label>Note for your supervisor<input name="note" placeholder="Optional"></label>' +
      '<div id="leave-preview">' + leavePreview(L.addDays(L.todayISO(), 1), L.addDays(L.todayISO(), 1)) + '</div>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Send to supervisor for cover</button></div></form>';
    const mine = st.leave.filter(function (l) { return l.userId === u.id; }).sort(function (a, b) { return b.from.localeCompare(a.from); });
    if (mine.length) html += '<h2>Your leave</h2>' + mine.map(function (l) { return leaveCard(l, false); }).join('');
    return html;
  }

  function leavePreview(from, to) {
    const u = me();
    if (!from || !to || to < from) return '<p class="small muted">Choose the dates you will be away.</p>';
    const list = L.sessionsFor(u.id, S.state.appointments, S.byId(S.state.patients), from, to);
    if (!list.length) return '<p class="small muted">You have no sessions in these dates.</p>';
    return '<p class="small"><strong>' + list.length + ' session' + (list.length === 1 ? '' : 's') + ' will need cover:</strong></p><ul class="plain needs-cover">' + list.map(function (a) {
      const p = S.patient(a.patientId);
      return '<li>' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(a.time)) + ' · ' + esc(nm(p)) + ' ' + caseTag(p) + '</li>';
    }).join('') + '</ul>';
  }

  function leaveCard(l, manage) {
    const appts = l.apptIds.map(function (id) { return S.appointment(id); }).filter(Boolean);
    const open = appts.filter(function (a) { return !a.coverBy; }).length;
    const ctx = coverCtx(l.userId);
    return '<article class="card leave-card"><div class="card-head"><div><strong>' + esc(userName(l.userId)) + '</strong> · ' +
      esc(L.formatDate(l.from, { weekday: 'short', day: 'numeric', month: 'short' })) + (l.to !== l.from ? ' – ' + esc(L.formatDate(l.to, { weekday: 'short', day: 'numeric', month: 'short' })) : '') +
      '<div class="muted small">' + esc(l.reason) + (l.note ? ' · ' + esc(l.note) : '') + '</div></div>' +
      (open ? '<span class="badge badge-warn">' + open + ' need' + (open === 1 ? 's' : '') + ' cover</span>' : '<span class="badge badge-good">Covered</span>') + '</div>' +
      (appts.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Session</th><th>Patient</th><th>Cover</th></tr></thead><tbody>' + appts.map(function (a) {
        const p = S.patient(a.patientId);
        let cover;
        if (manage) {
          const cands = L.coverCandidates(a, ctx);
          if (a.coverBy && !cands.some(function (c) { return c.id === a.coverBy; })) cands.unshift(S.user(a.coverBy));
          cover = '<select class="cover-select" data-appt="' + a.id + '" data-leave="' + l.id + '" aria-label="Cover clinician">' + opt('', a.coverBy ? 'Remove cover' : 'Choose cover…') +
            cands.map(function (c, i) { return opt(c.id, c.name + ' – ' + L.ROLES[c.role].label + (i === 0 && !a.coverBy ? ' (suggested)' : ''), c.id === a.coverBy); }).join('') + '</select>' +
            (cands.length ? '' : '<div class="small bad">No one is free at this time.</div>');
        } else cover = a.coverBy ? esc(userName(a.coverBy)) : '<span class="badge badge-warn">Waiting for supervisor</span>';
        return '<tr class="' + (a.coverBy ? '' : 'row-warn') + '"><td class="nowrap"><a href="#/session/' + a.id + '">' + esc(L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(a.time)) + '</a></td>' +
          '<td>' + esc(manage ? nm(p) : pseud(p)) + ' ' + caseTag(p) + '</td><td>' + cover + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="small muted">No sessions in these dates.</p>') +
      (manage && open ? '<div class="actions"><button class="btn btn-primary btn-sm" data-action="auto-cover" data-id="' + l.id + '">Auto-assign cover</button></div>' : '') +
      '</article>';
  }

  function setCover(a, uid, leave) {
    const p = S.patient(a.patientId);
    a.coverBy = uid || null;
    a.coverNeeded = !uid;
    if (uid) {
      S.send(uid, { kind: 'cover', patientId: p.id, apptId: a.id, link: '#/session/' + a.id,
        subject: 'You are covering ' + pseud(p) + ' – ' + L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + L.formatTime(a.time),
        body: userName(p.assignedTo) + ' is on leave. The session plan, goals and materials are in the session page.' });
      S.audit('Assigned cover', p.id, 'to ' + userName(uid));
    }
    const all = leave.apptIds.map(function (id) { return S.appointment(id); }).filter(Boolean);
    const done = all.every(function (x) { return x.coverBy; });
    if (done && leave.status !== 'covered') {
      leave.status = 'covered';
      S.send(leave.userId, { kind: 'cover', link: '#/leave', subject: 'Cover arranged for your leave',
        body: all.map(function (x) { return L.formatDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + L.formatTime(x.time) + ' – ' + userName(x.coverBy); }).join('\n') });
    } else if (!done) leave.status = 'requested';
    S.save();
  }

  function autoCover(leave) {
    let n = 0;
    leave.apptIds.forEach(function (id) {
      const a = S.appointment(id);
      if (!a || a.coverBy) return;
      const who = L.pickCover(a, coverCtx(leave.userId));
      if (who) { setCover(a, who.id, leave); n++; }
    });
    return n;
  }

  /* ---------- people: invite & reset ---------- */

  function tempPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint8Array(10));
    return Array.prototype.map.call(r, function (x) { return chars[x % chars.length]; }).join('');
  }

  function peopleSection() {
    const st = S.state, u = me();
    let html = '<section class="card"><h2>People &amp; sign-in</h2>';
    if (lastInvite) {
      html += '<div class="callout"><strong>Sign-in details for ' + esc(lastInvite.name) + '</strong><span>Email: <code>' + esc(lastInvite.email) + '</code> · Temporary password: <code>' + esc(lastInvite.pass) + '</code></span>' +
        '<span class="small muted">Share these in person or through your organisation\'s secure channel. They must choose a new password when they first sign in. This is shown only once.</span></div>';
      lastInvite = null;
    }
    html += '<ul class="list flat">' + st.users.map(function (x) {
      const n = st.patients.filter(function (p) { return p.assignedTo === x.id; }).length;
      return '<li><div class="row"><div><strong>' + esc(x.name) + '</strong><div class="muted small">' + esc(L.ROLES[x.role].label) + (x.year ? ' · ' + esc(x.year) : '') + (x.email ? ' · ' + esc(x.email) : '') + ' · ' + n + ' cases' +
        (x.mustChange ? ' · <span class="badge badge-warn">Invited</span>' : '') + '</div></div><div class="head-actions">' +
        (x.id !== u.id ? '<button class="btn btn-sm btn-ghost" data-action="reset-pw" data-id="' + x.id + '">Reset password</button>' : '') +
        (x.id !== u.id && !n ? '<button class="btn btn-sm btn-ghost" data-action="remove-user" data-id="' + x.id + '">Remove</button>' : '') + '</div></div></li>';
    }).join('') + '</ul><form id="user-form" class="add-user"><h3>Invite someone</h3><div class="grid-4"><label>Name<input name="name" required></label>' +
      '<label>Email<input type="email" name="email" required></label>' +
      '<label>Role<select name="role">' + Object.keys(L.ROLES).map(function (k) { return opt(k, L.ROLES[k].label, k === 'student'); }).join('') + '</select></label>' +
      '<label>Year / group<input name="year" placeholder="Students, e.g. Year 3"></label></div><div class="actions"><button class="btn" type="submit">Create account</button></div></form></section>';
    return html;
  }

  /* ---------- extra actions & forms ---------- */

  Object.assign(ACTIONS, {
    'demo-login': function (el) { document.getElementById('login-name').value = el.dataset.login; document.querySelector('#login-form [name=pass]').value = S.demoPassword; },
    'sign-out': function () { route = '#/'; lastViewed = null; Promise.resolve(S.signOut()).then(render); },
    'reconnect': function () { S.reconnect().then(render); render(); },
    'compose': function (el) { composeForm(el.dataset.to, el.dataset.subject); },
    'reschedule': function (el) { rescheduleForm(el.dataset.id); },
    'invite': function (el) { inviteForm(el.dataset.id); },
    'attend': function (el) {
      const a = S.appointment(el.dataset.id), p = S.patient(a.patientId);
      a.status = el.dataset.status;
      S.audit('Marked ' + ({ attended: 'attended', missed: 'did not attend', cancelled: 'cancelled', scheduled: 'not yet held' }[a.status]), p.id);
      if (a.status === 'missed') {
        S.send(supervisorsFor(p).filter(function (x) { return x !== me().id; }), { kind: 'attendance', patientId: p.id, link: '#/session/' + a.id,
          subject: 'Did not attend – ' + pseud(p) + ', ' + L.formatDate(a.date, { day: 'numeric', month: 'short' }), body: 'Marked by ' + me().name + '.' });
      }
      render();
    },
    'invite-reply': function (el) {
      const a = S.appointment(el.dataset.appt), p = S.patient(a.patientId);
      const o = a.observers.find(function (x) { return x.userId === me().id; });
      o.status = el.dataset.answer;
      S.send(o.by, { kind: 'invite', patientId: p.id, link: '#/session/' + a.id,
        subject: me().name + ' ' + o.status + ' your invitation – ' + pseud(p), body: o.role + ' · ' + L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + L.formatTime(a.time) });
      S.audit((o.status === 'accepted' ? 'Accepted' : 'Declined') + ' invitation to ' + o.role.toLowerCase(), p.id);
      toast(o.status === 'accepted' ? 'Accepted – the session is on your schedule' : 'Declined');
      render();
    },
    'auto-cover': function (el) {
      const l = S.state.leave.find(function (x) { return x.id === el.dataset.id; });
      const n = autoCover(l);
      toast(n ? 'Cover assigned for ' + n + ' session' + (n === 1 ? '' : 's') : 'No one is free for the remaining sessions');
      render();
    },
    'reset-pw': function (el) {
      const x = S.user(el.dataset.id), pass = tempPassword();
      S.setPassword(x.id, pass, true).then(function () {
        S.audit('Reset password', null, x.name);
        lastInvite = { name: x.name, email: x.email || x.name, pass: pass };
        render();
      });
    }
  });

  Object.assign(SUBMITS, {
    'login-form': function (form) {
      const err = document.getElementById('login-error');
      S.signIn(form.querySelector('[name=login]').value, form.querySelector('[name=pass]').value).then(function () {
        lastActivity = Date.now(); lastViewed = null; route = '#/'; pendingNotice = true; render();
      }, function (e) { err.textContent = e.message; err.hidden = false; });
    },
    'newpw-form': function (form) {
      const a = form.querySelector('[name=p1]').value, b = form.querySelector('[name=p2]').value;
      const err = document.getElementById('newpw-error');
      if (a !== b) { err.textContent = 'The passwords don\'t match.'; err.hidden = false; return; }
      S.setPassword(me().id, a, false).then(function () { S.audit('Set own password'); pendingNotice = true; render(); });
    },
    'user-form': function (form) {
      const v = function (n) { return form.querySelector('[name=' + n + ']').value.trim(); };
      if (S.state.users.some(function (x) { return (x.email || '').toLowerCase() === v('email').toLowerCase(); })) { toast('Someone already uses that email.'); return; }
      const x = S.upsert('users', { name: v('name'), email: v('email'), role: v('role'), year: v('year') });
      const pass = tempPassword();
      S.setPassword(x.id, pass, true).then(function () {
        S.audit('Created account', null, x.name);
        lastInvite = { name: x.name, email: x.email, pass: pass };
        render();
      });
    },
    'leave-form': function (form) {
      const u = me();
      const v = function (n) { return form.querySelector('[name=' + n + ']').value.trim(); };
      if (v('to') < v('from')) { toast('The end date is before the start date.'); return; }
      const appts = L.sessionsFor(u.id, S.state.appointments, S.byId(S.state.patients), v('from'), v('to'));
      appts.forEach(function (a) { a.coverNeeded = true; });
      const l = S.upsert('leave', { userId: u.id, from: v('from'), to: v('to'), reason: v('reason'), note: v('note'), status: 'requested', createdAt: new Date().toISOString(), apptIds: appts.map(function (a) { return a.id; }) });
      S.audit('Requested leave', null, v('from') + ' to ' + v('to'));
      const sups = S.state.users.filter(function (x) { return x.role === 'supervisor'; }).map(function (x) { return x.id; });
      S.send(sups, { kind: 'leave', link: '#/leave', subject: 'Leave request – ' + u.name + ', ' + L.formatDate(l.from, { weekday: 'short', day: 'numeric', month: 'short' }) + (l.to !== l.from ? ' to ' + L.formatDate(l.to, { weekday: 'short', day: 'numeric', month: 'short' }) : ''),
        body: l.reason + (l.note ? ' – ' + l.note : '') + '\n' + appts.length + ' session' + (appts.length === 1 ? '' : 's') + ' need cover.' });
      if (S.state.settings.autoCover && appts.length) {
        const n = autoCover(l);
        S.send(sups, { kind: 'cover', link: '#/leave', subject: 'Cover assigned automatically – ' + u.name, body: n + ' of ' + appts.length + ' sessions covered.' });
      }
      toast(appts.length ? 'Sent to your supervisor – ' + appts.length + ' session' + (appts.length === 1 ? '' : 's') + ' flagged for cover' : 'Leave recorded');
      render();
    },
    'autocover-form': function (form) {
      S.state.settings.autoCover = form.querySelector('[name=autoCover]').checked;
      S.save(); toast('Saved');
    }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.classList.contains('cover-select')) {
      const l = S.state.leave.find(function (x) { return x.id === t.dataset.leave; });
      setCover(S.appointment(t.dataset.appt), t.value, l);
      toast(t.value ? 'Cover assigned to ' + userName(t.value) : 'Cover removed');
      render();
    }
    if (t.closest('#leave-form') && (t.name === 'from' || t.name === 'to')) {
      const f = t.closest('#leave-form');
      document.getElementById('leave-preview').innerHTML = leavePreview(f.querySelector('[name=from]').value, f.querySelector('[name=to]').value);
    }
  });

  /* ---------- appointment reminders (SMS or WhatsApp Business) ---------- */

  function msgSettings() { return S.state.settings.messaging; }

  function reminderFields(p) {
    const r = p.reminders || { channel: 'default' };
    const ms = msgSettings();
    const clinicLabel = ms.channel === 'both' ? 'Clinic default (' + L.CHANNELS[ms.defaultChannel] + ')' : 'Clinic default (' + L.CHANNELS[ms.channel] + ')';
    const choices = [['default', clinicLabel]].concat(ms.channel === 'both' ? [['sms', 'SMS'], ['whatsapp', 'WhatsApp Business']] : []).concat([['none', 'No reminders']]);
    return '<fieldset class="pick consent"><legend>Appointment reminders</legend>' +
      '<div class="grid-2"><label>Mobile number<input type="tel" name="r_phone" placeholder="+91 98xxx xxxxx" value="' + esc(r.phone || '') + '"></label>' +
      '<label>Send by<select name="r_channel">' + choices.map(function (c) { return opt(c[0], c[1], (r.channel || 'default') === c[0]); }).join('') + '</select></label></div>' +
      (ms.channel !== 'both' ? '<p class="small muted">Your clinic sends reminders by ' + esc(L.CHANNELS[ms.channel]) + ' only. A supervisor can allow both in Privacy &amp; settings.</p>' : '') +
      '<p class="small">' + (r.optIn ? '✓ Agreed to reminders ' + esc(fmtStamp(r.optInAt)) : 'No agreement to reminders yet') + ' <span class="muted">– recorded with consent, not here.</span></p>' +
      '<p class="small muted">Reminders contain only the clinic name, date, time and a link – never names or health details.</p></fieldset>';
  }

  function readReminderFields(fd, p) {
    const old = p.reminders || {};
    return { phone: (fd.get('r_phone') || '').trim(), channel: fd.get('r_channel') || 'default', optIn: !!old.optIn, optInAt: old.optInAt || '', optInBy: old.optInBy || '' };
  }

  function reminderLine(p) {
    const pick = L.reminderChannel(p, msgSettings());
    return '<span class="meta-label">Reminders</span> ' + (pick.channel ? '<span class="chan chan-' + pick.channel + '">' + esc(L.CHANNELS[pick.channel]) + '</span> to ' + esc(L.maskPhone(p.reminders.phone)) +
      ' · opted in ' + esc(fmtStamp(p.reminders.optInAt)) : '<span class="muted">' + esc(pick.reason) + '</span>');
  }

  function reportTabs(current, date) {
    return '<nav class="tabs"><a class="tab' + (current === 'reports' ? ' active' : '') + '" href="#/reports?date=' + date + '">Family reports</a>' +
      '<a class="tab' + (current === 'reminders' ? ' active' : '') + '" href="#/reports?tab=reminders&date=' + date + '">Appointment reminders</a></nav>';
  }

  function reminderText(a, channel) {
    const ms = msgSettings();
    return L.fillTemplate(channel === 'whatsapp' ? ms.waTemplate : ms.smsTemplate, {
      clinic: ms.clinicName, day: L.formatDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' }), date: L.formatDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' }),
      time: L.formatTime(a.time), link: ms.portalLink
    });
  }

  function viewReminders(params) {
    const date = params.date || L.addDays(L.todayISO(), 1);
    const ms = msgSettings();
    const appts = visibleAppts(S.appointmentsOn(date)).filter(function (a) { return a.status === 'scheduled'; });
    const rows = appts.map(function (a) {
      const p = S.patient(a.patientId);
      const pick = L.reminderChannel(p, ms);
      const rec = S.state.reminders.filter(function (r) { return r.apptId === a.id && r.date === a.date && r.time === a.time; }).slice(-1)[0];
      return { a: a, p: p, channel: pick.channel, reason: pick.reason, rec: rec, text: pick.channel ? reminderText(a, pick.channel) : '' };
    });
    const count = function (ch) { return rows.filter(function (r) { return r.channel === ch; }).length; };
    const skipped = rows.filter(function (r) { return !r.channel; }).length;
    const sent = rows.filter(function (r) { return r.rec && r.rec.status === 'sent'; }).length;
    let html = '<header class="page-head"><div><h1>Reports &amp; reminders</h1><p class="muted">Reminders for ' + esc(L.formatDate(date)) + '</p></div></header>' +
      reportTabs('reminders', date) + dateNav('reports', date).replace(/#\/reports\?date=/g, '#/reports?tab=reminders&date=').replace('data-nav="reports"', 'data-nav="reports-reminders"');
    html += '<div class="summary">' +
      '<div><span class="stat">' + count('sms') + '</span><span class="muted small">By SMS</span></div>' +
      '<div><span class="stat">' + count('whatsapp') + '</span><span class="muted small">By WhatsApp Business</span></div>' +
      '<div><span class="stat">' + skipped + '</span><span class="muted small">Not sent (no opt-in, number or choice)</span></div>' +
      '<div><span class="stat">' + sent + '/' + (rows.length - skipped) + '</span><span class="muted small">Marked sent</span></div></div>';
    html += '<p class="small muted">Clinic setting: <strong>' + esc(ms.channel === 'both' ? 'SMS or WhatsApp Business – each patient chooses' : L.CHANNELS[ms.channel] + ' only') + '</strong>' +
      (ms.provider ? ' via ' + esc(ms.provider) : '') + '. Sending needs the server version; until then, copy the list into your SMS or WhatsApp Business provider.</p>';
    if (!rows.length) return html + '<div class="empty"><p>No scheduled sessions on this day.</p></div>' + remindersHistory();
    html += '<div class="actions wrap">' +
      (count('sms') ? '<button class="btn" data-action="copy-reminders" data-channel="sms" data-date="' + date + '">Copy SMS list (' + count('sms') + ')</button>' : '') +
      (count('whatsapp') ? '<button class="btn" data-action="copy-reminders" data-channel="whatsapp" data-date="' + date + '">Copy WhatsApp list (' + count('whatsapp') + ')</button>' : '') +
      '<button class="btn btn-primary" data-action="mark-reminders" data-date="' + date + '">Mark all as sent</button></div>' +
      '<p class="small callout"><strong>The copied list holds patients\u2019 phone numbers.</strong> Paste it only into your SMS or WhatsApp Business provider. Don\u2019t paste it into chats, email or documents, and copy something else afterwards to clear the clipboard (on some devices the clipboard syncs to other devices or keeps a history).</p>';
    html += '<ul class="list reminders">' + rows.map(function (r) {
      const parts = r.channel === 'sms' ? L.smsParts(r.text) : null;
      return '<li><div class="row"><div class="msg-main"><strong>' + esc(L.formatTime(r.a.time)) + ' · ' + esc(nm(r.p)) + '</strong> ' +
        (r.channel ? '<span class="chan chan-' + r.channel + '">' + esc(L.CHANNELS[r.channel]) + '</span> <span class="muted small">' + esc(L.maskPhone(r.p.reminders.phone)) + '</span>' : '<span class="badge badge-muted">' + esc(r.reason) + '</span>') +
        (r.text ? '<div class="small reminder-text">' + esc(r.text) + (parts ? ' <span class="muted">(' + parts.chars + ' characters, ' + parts.parts + ' SMS)</span>' : '') + '</div>' : '') + '</div>' +
        '<div class="head-actions">' + (r.rec && r.rec.status === 'sent' ? '<span class="badge badge-good">Sent ' + esc(fmtStamp(r.rec.sentAt)) + '</span>' : r.channel ? '<button class="btn btn-sm" data-action="mark-reminder" data-id="' + r.a.id + '">Mark sent</button>' : '') +
        '</div></div></li>';
    }).join('') + '</ul>';
    return html + remindersHistory();
  }

  function recordReminder(a, channel) {
    const p = S.patient(a.patientId);
    S.state.reminders.push({ id: L.uid('rem'), patientId: p.id, apptId: a.id, date: a.date, time: a.time, channel: channel,
      status: 'sent', sentAt: new Date().toISOString(), by: me().id });
  }

  function messagingSection() {
    const ms = msgSettings();
    const warnS = L.templateWarnings(ms.smsTemplate), warnW = L.templateWarnings(ms.waTemplate);
    const sample = { date: L.addDays(L.todayISO(), 1), time: '10:30' };
    const prevS = reminderText(sample, 'sms'), prevW = reminderText(sample, 'whatsapp');
    const parts = L.smsParts(prevS);
    const radio = function (v, label, hint) {
      return '<label class="check radio"><input type="radio" name="channel" value="' + v + '"' + (ms.channel === v ? ' checked' : '') + '> <span><strong>' + label + '</strong><br><span class="muted small">' + hint + '</span></span></label>';
    };
    return '<form class="card" id="messaging-form"><h2>Appointment reminders</h2>' +
      '<p class="small">Choose how your clinic sends reminders. Reminders contain only the clinic name, date, time and a link to the secure portal.</p>' +
      '<fieldset class="pick channels"><legend>Send reminders by</legend>' +
      radio('sms', 'SMS only', 'Works on every phone. Needs TRAI DLT registration: sender ID and approved template.') +
      radio('whatsapp', 'WhatsApp Business only', 'Through a WhatsApp Business provider, with an approved template. Not personal WhatsApp.') +
      radio('both', 'Both – each patient chooses', 'Patients pick SMS or WhatsApp in their details; others get the default below.') +
      '<label>Default when a patient hasn\'t chosen<select name="defaultChannel">' + opt('sms', 'SMS', ms.defaultChannel === 'sms') + opt('whatsapp', 'WhatsApp Business', ms.defaultChannel === 'whatsapp') + '</select></label></fieldset>' +
      '<div class="grid-3"><label>Clinic name in messages<input name="clinicName" value="' + esc(ms.clinicName) + '"></label>' +
      '<label>Portal link<input name="portalLink" value="' + esc(ms.portalLink) + '"></label>' +
      '<label>Provider (optional)<input name="provider" placeholder="e.g. your SMS or WhatsApp provider" value="' + esc(ms.provider) + '"></label></div>' +
      '<div class="grid-2 channel-cols"><div><h3>SMS</h3><div class="grid-2"><label>Sender ID (DLT header)<input name="smsSenderId" maxlength="6" value="' + esc(ms.smsSenderId) + '"></label>' +
      '<label>DLT template ID<input name="smsTemplateId" value="' + esc(ms.smsTemplateId) + '"></label></div>' +
      '<label>SMS template<textarea name="smsTemplate" rows="3">' + esc(ms.smsTemplate) + '</textarea></label>' +
      '<p class="small preview"><span class="meta-label">Preview</span> ' + esc(prevS) + ' <span class="muted">(' + parts.chars + ' characters, ' + parts.parts + ' SMS' + (parts.unicode ? ', Unicode' : '') + ')</span></p>' +
      warnS.map(function (w) { return '<p class="small bad">' + esc(w) + '</p>'; }).join('') + '</div>' +
      '<div><h3>WhatsApp Business</h3><label>Approved template name<input name="waTemplateName" value="' + esc(ms.waTemplateName) + '"></label>' +
      '<label>WhatsApp template<textarea name="waTemplate" rows="3">' + esc(ms.waTemplate) + '</textarea></label>' +
      '<p class="small preview"><span class="meta-label">Preview</span> ' + esc(prevW) + '</p>' +
      warnW.map(function (w) { return '<p class="small bad">' + esc(w) + '</p>'; }).join('') + '</div></div>' +
      '<p class="small muted">Placeholders: {clinic}, {day}, {date}, {time}, {link}. The SMS wording must match your DLT-approved template exactly, and the WhatsApp wording must match your approved template.</p>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Save reminder settings</button></div></form>';
  }

  function storageSection() {
    const rows = S.storageReport();
    const kb = function (n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; };
    const srv = S.isServer();
    return '<section class="card"><h2>Where your data is stored</h2>' +
      (srv ? '<p class="small">The records are stored <strong>on your clinic\u2019s server</strong> (' + esc(location.host) + '), one shared copy for everyone. This browser holds what you may see only while you are signed in. Nothing goes to the app\u2019s makers or anyone else.</p>'
        : '<p class="small">Everything is stored <strong>only in this browser on this device</strong>. Nothing is sent to a server, to the app\'s makers, or to anyone else.</p>') +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>What</th><th>Where</th><th>Size</th><th>Encrypted</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.what) + '</td><td class="small">' + esc(r.where) + '<div class="muted"><code>' + esc(r.key) + '</code></div></td><td class="nowrap">' + kb(r.bytes) + '</td><td>' + tick(r.encrypted) + '</td></tr>'; }).join('') +
      '<tr><td>Backups and the key file</td><td class="small">Wherever you save them. Keep them apart: patients in a backup can only be read with the key file.</td><td>—</td><td>' + tick(true) + ' <span class="small muted">patients</span></td></tr>' +
      '</tbody></table></div>' +
      (srv ? '<ul class="small plain"><li>Signing out, or closing the tab, clears the records from this device.</li><li>The server keeps an access log of sign-ins, record views and changes.</li></ul></section>'
        : '<ul class="small plain"><li>Each browser and device has its <strong>own separate copy</strong>: the downloaded file, the online link, Chrome and Edge on the same computer are all different.</li>' +
      '<li>Clearing this browser\'s site data deletes it. Make backups.</li>' +
      '<li>To share one set of records across staff devices, run the clinic server on one computer (see docs/SERVER-SETUP.md).</li></ul></section>');
  }

  Object.assign(ACTIONS, {
    'copy-reminders': function (el) {
      const date = el.dataset.date, ch = el.dataset.channel;
      const lines = visibleAppts(S.appointmentsOn(date)).filter(function (a) { return a.status === 'scheduled'; }).map(function (a) {
        const p = S.patient(a.patientId);
        return L.reminderChannel(p, msgSettings()).channel === ch ? '"' + p.reminders.phone + '","' + reminderText(a, ch).replace(/"/g, '""') + '"' : null;
      }).filter(Boolean);
      S.audit('Copied ' + L.CHANNELS[ch] + ' reminder list', null, lines.length + ' numbers');
      copyText('phone,message\n' + lines.join('\n'));
    },
    'mark-reminder': function (el) {
      const a = S.appointment(el.dataset.id);
      recordReminder(a, L.reminderChannel(S.patient(a.patientId), msgSettings()).channel);
      S.save(); render();
    },
    'mark-reminders': function (el) {
      let n = 0;
      visibleAppts(S.appointmentsOn(el.dataset.date)).filter(function (a) { return a.status === 'scheduled'; }).forEach(function (a) {
        const ch = L.reminderChannel(S.patient(a.patientId), msgSettings()).channel;
        const done = S.state.reminders.some(function (r) { return r.apptId === a.id && r.date === a.date && r.time === a.time && r.status === 'sent'; });
        if (ch && !done) { recordReminder(a, ch); n++; }
      });
      S.audit('Marked reminders sent', null, n + ' for ' + el.dataset.date);
      S.save(); toast(n + ' reminder' + (n === 1 ? '' : 's') + ' marked as sent'); render();
    }
  });

  Object.assign(SUBMITS, {
    'messaging-form': function (form) {
      const ms = msgSettings();
      const v = function (n) { const el = form.querySelector('[name=' + n + ']'); return el ? el.value.trim() : ''; };
      ms.channel = (form.querySelector('[name=channel]:checked') || {}).value || ms.channel;
      ['defaultChannel', 'clinicName', 'portalLink', 'provider', 'smsSenderId', 'smsTemplateId', 'smsTemplate', 'waTemplateName', 'waTemplate'].forEach(function (k) { ms[k] = v(k); });
      S.audit('Changed reminder settings', null, ms.channel === 'both' ? 'SMS or WhatsApp Business' : L.CHANNELS[ms.channel] + ' only');
      S.save(); toast('Reminder settings saved'); render();
    }
  });

  /* ---------- team calendar: colleagues' schedules side by side ---------- */

  const TEAM_PREF = 'speech-therapy-planner-team-';
  const TEAM_PX = 2;
  const ROLE_GROUPS = [['supervisor', 'Supervisors'], ['therapist', 'Therapists'], ['student', 'Students'], ['diagnostician', 'Diagnosticians']];

  // Who to show is remembered per person on this device.
  function teamPref() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(TEAM_PREF + me().id) || 'null'); } catch (e) { /* storage blocked */ }
    o = o || {};
    const ids = S.state.users.map(function (u) { return u.id; });
    let picked = Array.isArray(o.picked) ? o.picked.filter(function (id) { return ids.indexOf(id) >= 0; }) : (ids.length <= 6 ? ids : [me().id]);
    if (!picked.length) picked = [me().id];
    return { picked: picked, mode: o.mode === 'week' ? 'week' : 'day' };
  }
  function setTeamPref(p) { try { localStorage.setItem(TEAM_PREF + me().id, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }
  function personClass(uid) { const i = S.state.users.findIndex(function (u) { return u.id === uid; }); return 'who-' + ((i < 0 ? 0 : i) % 8); }

  function awayOn(uid, date) {
    return S.state.leave.find(function (l) { return l.userId === uid && l.from <= date && date <= l.to && l.status !== 'declined' && l.status !== 'cancelled'; });
  }
  function canSeeEvent(e) { return me().role === 'supervisor' || (!e.busy && Sync.isAttendee(e, me().id)); }

  /* One person's day: sessions they run or observe, and meetings they attend. */
  function teamItems(uid, date) {
    const pm = S.byId(S.state.patients), items = [];
    S.state.appointments.forEach(function (a) {
      if (a.date !== date || a.status === 'cancelled') return;
      const runs = Sync.clinicianOf(a, pm) === uid;
      const obs = (a.observers || []).some(function (o) { return o.userId === uid && o.status === 'accepted'; });
      if (runs || obs) items.push({ kind: 'session', rec: a, time: a.time, duration: Number(a.duration) || 30, observing: !runs });
    });
    S.state.events.forEach(function (e) {
      if (e.date === date && (e.attendees || []).indexOf(uid) >= 0) items.push({ kind: 'event', rec: e, time: e.time, duration: Number(e.duration) || 30 });
    });
    return items;
  }

  function itemLabel(it) {
    if (it.kind === 'event') {
      const open = canSeeEvent(it.rec);
      return { title: open ? it.rec.title : 'Busy', sub: open ? 'Meeting' : '', cls: 'tm-event', link: open && (it.rec.createdBy === me().id || me().role === 'supervisor') ? 'edit-event' : '' };
    }
    const a = it.rec, p = !a.busy && S.patient(a.patientId);
    if (p && canSee(p)) return { title: nm(p), sub: (it.observing ? 'Observing · ' : '') + L.caseLabel(p), cls: 'fam-' + L.conditionFamily(p.condition), href: '#/session/' + a.id };
    return { title: it.observing ? 'Observing' : 'Session', sub: a.room || '', cls: 'tm-busy' };
  }

  function viewTeam(params) {
    const date = params.date || L.todayISO();
    const pref = teamPref();
    const users = S.state.users;
    const picked = users.filter(function (u) { return pref.picked.indexOf(u.id) >= 0; });
    const step = pref.mode === 'week' ? 7 : 1;
    const from = pref.mode === 'week' ? L.weekStart(date) : date;

    let html = '<header class="page-head"><div><h1>Team calendar</h1><p class="muted">' + esc(pref.mode === 'week' ? 'Week of ' + L.formatDate(from) : L.formatDate(date)) +
      (S.isServer() ? ' · live from the clinic server' : '') + '</p></div>' +
      '<button class="btn btn-primary" data-action="new-event" data-date="' + date + '" data-with="' + esc(pref.picked.join(',')) + '">+ Add meeting</button></header>';

    html += '<div class="toolbar"><div class="date-nav">' +
      '<a class="btn btn-ghost" href="#/team?date=' + L.addDays(date, -step) + '" aria-label="Previous">‹</a>' +
      '<input type="date" class="date-input" data-nav="team" value="' + date + '" aria-label="Choose date">' +
      '<a class="btn btn-ghost" href="#/team?date=' + L.addDays(date, step) + '" aria-label="Next">›</a>' +
      (date !== L.todayISO() ? '<a class="btn btn-ghost" href="#/team?date=' + L.todayISO() + '">Today</a>' : '') + '</div>' +
      '<div class="seg-toggle" role="group" aria-label="Calendar layout">' +
      ['day', 'week'].map(function (m) { return '<button class="' + (pref.mode === m ? 'on' : '') + '" data-action="team-mode" data-mode="' + m + '" aria-pressed="' + (pref.mode === m) + '">' + (m === 'day' ? 'Day' : 'Week') + '</button>'; }).join('') + '</div></div>';

    html += '<section class="card team-pick"><div class="card-head"><h2>Show schedules for</h2><div class="actions wrap">' +
      '<button class="btn btn-sm" data-action="team-set" data-ids="' + esc(users.map(function (u) { return u.id; }).join(',')) + '">Everyone</button>' +
      '<button class="btn btn-sm" data-action="team-set" data-ids="' + esc(me().id) + '">Only me</button>' +
      ROLE_GROUPS.filter(function (g) { return users.some(function (u) { return u.role === g[0]; }); }).map(function (g) {
        return '<button class="btn btn-sm" data-action="team-set" data-ids="' + esc(users.filter(function (u) { return u.role === g[0]; }).map(function (u) { return u.id; }).join(',')) + '">' + esc(g[1]) + '</button>';
      }).join('') + '</div></div><div class="pchips">' +
      users.map(function (u) {
        const on = pref.picked.indexOf(u.id) >= 0;
        return '<button class="pchip ' + personClass(u.id) + (on ? ' on' : '') + '" data-action="team-toggle" data-id="' + u.id + '" aria-pressed="' + on + '"><span class="dot" aria-hidden="true"></span>' +
          esc(u.id === me().id ? u.name + ' (you)' : u.name) + ' <span class="muted small">' + esc(L.ROLES[u.role].label) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="small muted">You see the details of sessions for your own patients. Colleagues\' other sessions show only as <em>Session</em>, and the reason for leave only as <em>Away</em>.</p></section>';

    html += pref.mode === 'week' ? teamWeek(picked, from) : teamDay(picked, date);
    return html;
  }

  function teamDay(people, date) {
    const st = S.state.settings;
    const cols = people.map(function (u) {
      const items = teamItems(u.id, date);
      return { u: u, away: awayOn(u.id, date), lay: L.layoutDay(items, st.dayStart, st.dayEnd), items: items };
    });
    let start = L.toMinutes(st.dayStart), end = L.toMinutes(st.dayEnd);
    cols.forEach(function (c) { start = Math.min(start, c.lay.start); end = Math.max(end, c.lay.end); });
    const y = function (m) { return (m - start) * TEAM_PX; };
    const lunchS = L.toMinutes(st.lunchStart), lunchE = L.toMinutes(st.lunchEnd);
    const hours = [];
    for (let t = Math.ceil(start / 60) * 60; t < end; t += 60) hours.push(t);

    // Common free time for everyone shown who isn't away.
    const present = cols.filter(function (c) { return !c.away; });
    const busy = [];
    present.forEach(function (c) { c.lay.blocks.forEach(function (b) { busy.push({ start: b.start, end: b.end }); }); });
    const free = present.length ? L.freeSlots(busy, st.dayStart, st.dayEnd, 30, { start: st.lunchStart, end: st.lunchEnd }) : [];
    const withIds = present.map(function (c) { return c.u.id; }).join(',');
    let html = '<section class="card free-slots"><h2>Free for ' + (present.length === people.length ? 'everyone shown' : present.length + ' of ' + people.length + ' (others away)') + '</h2>' +
      (free.length ? '<div class="pchips">' + free.map(function (g) {
        return '<button class="slot-chip" data-action="new-event" data-date="' + date + '" data-time="' + L.fromMinutes(g.start) + '" data-end="' + L.fromMinutes(Math.min(g.end, g.start + 60)) + '" data-with="' + esc(withIds) + '">' +
          esc(L.formatTime(L.fromMinutes(g.start)) + '–' + L.formatTime(L.fromMinutes(g.end))) + '</button>';
      }).join('') + '</div><p class="small muted">Tap a time to book a meeting with everyone shown.</p>' : '<p class="small muted">No common free time of 30 minutes or more.</p>') + '</section>';

    html += '<div class="team-scroll"><div class="team-day" style="--cols:' + Math.max(cols.length, 1) + '">' +
      '<div class="team-gutter-head"></div>' +
      cols.map(function (c) {
        return '<div class="team-col-head ' + personClass(c.u.id) + '"><span class="dot" aria-hidden="true"></span><strong>' + esc(c.u.name) + '</strong>' +
          '<span class="muted small">' + esc(L.ROLES[c.u.role].label) + ' · ' + c.items.length + ' booked</span>' + (c.away ? '<span class="badge badge-warn">Away</span>' : '') + '</div>';
      }).join('') +
      '<div class="team-gutter" style="height:' + y(end) + 'px">' + hours.map(function (t) { return '<span style="top:' + y(t) + 'px">' + esc(L.formatTime(L.fromMinutes(t)).replace(':00', '')) + '</span>'; }).join('') + '</div>';
    html += cols.map(function (c) {
      let col = '<div class="team-col' + (c.away ? ' away' : '') + '" style="height:' + y(end) + 'px">' +
        hours.map(function (t) { return '<div class="team-hour" style="top:' + y(t) + 'px"></div>'; }).join('');
      if (lunchE > lunchS) col += '<div class="team-lunch" style="top:' + y(Math.max(lunchS, start)) + 'px;height:' + (Math.min(lunchE, end) - Math.max(lunchS, start)) * TEAM_PX + 'px"><span>Lunch</span></div>';
      if (c.away) col += '<div class="team-away"><span>Away' + (c.away.reason && (c.u.id === me().id || me().role === 'supervisor') ? ' · ' + esc(c.away.reason) : '') + '</span></div>';
      col += c.lay.blocks.map(function (b) {
        const it = b.appt, lab = itemLabel(it), h = (b.end - b.start) * TEAM_PX;
        const style = 'top:' + (y(b.start) + 1) + 'px;height:' + (h - 2) + 'px;left:calc(100% * ' + b.lane + ' / ' + b.lanes + ' + 2px);width:calc(100% / ' + b.lanes + ' - 4px)';
        const inner = '<span class="tm-time">' + esc(L.formatTime(L.fromMinutes(b.start))) + '–' + esc(L.formatTime(L.fromMinutes(b.end))) + '</span>' +
          '<strong class="tm-title">' + esc(lab.title) + '</strong>' + (lab.sub && h >= 70 ? '<span class="tm-sub">' + esc(lab.sub) + '</span>' : '');
        const cls = 'tm-block ' + lab.cls + (it.observing ? ' observing' : '') + (h < 56 ? ' compact' : '');
        if (lab.href) return '<a class="' + cls + '" href="' + lab.href + '" style="' + style + '">' + inner + '</a>';
        if (lab.link) return '<button class="' + cls + '" data-action="' + lab.link + '" data-id="' + it.rec.id + '" style="' + style + '">' + inner + '</button>';
        return '<div class="' + cls + '" style="' + style + '" title="Details are shown only to the people involved">' + inner + '</div>';
      }).join('');
      if (date === L.todayISO()) {
        const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
        if (mins >= start && mins <= end) col += '<div class="tt-now team-now" style="top:' + y(mins) + 'px" aria-hidden="true"></div>';
      }
      return col + '</div>';
    }).join('');
    html += '</div></div>';
    if (!people.length) html += '<p class="muted">Choose people above to see their schedules.</p>';
    return html;
  }

  function teamWeek(people, from) {
    const days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return L.addDays(from, i); });
    let html = '<div class="table-wrap"><table class="tbl team-week"><thead><tr><th>Person</th>' + days.map(function (d) {
      return '<th class="' + (d === L.todayISO() ? 'today' : '') + '"><button class="link" data-action="team-day" data-date="' + d + '">' + esc(L.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })) + '</button></th>';
    }).join('') + '</tr></thead><tbody>';
    html += people.map(function (u) {
      return '<tr><th class="' + personClass(u.id) + '"><span class="dot" aria-hidden="true"></span> ' + esc(u.name) + '</th>' + days.map(function (d) {
        const away = awayOn(u.id, d);
        const items = teamItems(u.id, d).sort(function (a, b) { return a.time.localeCompare(b.time); });
        return '<td class="' + (away ? 'away' : '') + '">' + (away ? '<span class="badge badge-warn">Away</span>' : '') + items.map(function (it) {
          const lab = itemLabel(it);
          const inner = '<span class="tm-time">' + esc(L.formatTime(it.time)) + '</span> ' + esc(lab.title);
          if (lab.href) return '<a class="tw-chip ' + lab.cls + '" href="' + lab.href + '">' + inner + '</a>';
          if (lab.link) return '<button class="tw-chip ' + lab.cls + '" data-action="' + lab.link + '" data-id="' + it.rec.id + '">' + inner + '</button>';
          return '<span class="tw-chip ' + lab.cls + '">' + inner + '</span>';
        }).join('') + (!away && !items.length ? '<span class="muted small">Free</span>' : '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return html + '</tbody></table></div>';
  }

  function eventForm(id, d) {
    const e = id ? S.state.events.find(function (x) { return x.id === id; }) : null;
    const v = e || { title: '', date: d.date, time: d.time || '10:00', duration: d.duration || 30, attendees: d.with || [me().id], note: '' };
    const endT = L.fromMinutes(L.toMinutes(v.time) + (Number(v.duration) || 30));
    const body = '<label>What<input name="title" required maxlength="120" value="' + esc(v.title) + '" placeholder="e.g. Case conference, supervision, team meeting"></label>' +
      '<div class="grid-3"><label>Date<input type="date" name="date" required value="' + esc(v.date) + '"></label>' +
      '<label>From<input type="time" name="time" required value="' + esc(v.time) + '"></label>' +
      '<label>Until<input type="time" name="end" required value="' + esc(d.end || endT) + '"></label></div>' +
      '<fieldset class="checks"><legend>Who</legend>' + S.state.users.map(function (u) {
        return '<label class="check"><input type="checkbox" name="attendees" value="' + u.id + '"' + ((v.attendees || []).indexOf(u.id) >= 0 ? ' checked' : '') + '> ' + esc(u.name) + ' <span class="muted small">' + esc(L.ROLES[u.role].label) + '</span></label>';
      }).join('') + '</fieldset>' +
      '<label>Note<textarea name="note" rows="2" placeholder="Agenda or room. No patient details: use the case code.">' + esc(v.note || '') + '</textarea></label>' +
      '<p class="small muted">People not invited see this only as <em>Busy</em>.</p>';
    openModal(e ? 'Edit meeting' : 'New meeting', body, function (fd) {
      const start = L.toMinutes(fd.get('time')), stop = L.toMinutes(fd.get('end'));
      if (stop <= start) { toast('The end time is before the start time.'); return false; }
      const who = fd.getAll('attendees');
      if (!who.length) { toast('Choose at least one person.'); return false; }
      const saved = S.upsert('events', Object.assign({}, e || { createdBy: me().id, createdAt: new Date().toISOString() }, {
        title: fd.get('title').trim(), date: fd.get('date'), time: fd.get('time'), duration: stop - start, attendees: who, note: fd.get('note').trim()
      }));
      const when = L.formatDate(saved.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + L.formatTime(saved.time);
      const added = who.filter(function (uid) { return uid !== me().id && (!e || (e.attendees || []).indexOf(uid) < 0); });
      if (added.length) S.send(added, { kind: 'invite', link: '#/team?date=' + saved.date, subject: 'Meeting: ' + saved.title + ', ' + when, body: (saved.note || '') + '\nFrom ' + me().name + '.' });
      const clashes = who.filter(function (uid) {
        return teamItems(uid, saved.date).some(function (it) { return !(it.kind === 'event' && it.rec.id === saved.id) && L.overlaps({ time: saved.time, duration: saved.duration }, { time: it.time, duration: it.duration }); });
      });
      toast(clashes.length ? 'Saved – clashes with ' + clashes.map(firstName).join(', ') : 'Meeting saved');
    }, e ? function () { S.remove('events', e.id); toast('Meeting deleted'); } : null);
  }

  Object.assign(ACTIONS, {
    'team-toggle': function (el) {
      const p = teamPref(), i = p.picked.indexOf(el.dataset.id);
      if (i >= 0) p.picked.splice(i, 1); else p.picked.push(el.dataset.id);
      setTeamPref(p); render();
    },
    'team-set': function (el) { const p = teamPref(); p.picked = el.dataset.ids.split(',').filter(Boolean); setTeamPref(p); render(); },
    'team-mode': function (el) { const p = teamPref(); p.mode = el.dataset.mode; setTeamPref(p); render(); },
    'team-day': function (el) { const p = teamPref(); p.mode = 'day'; setTeamPref(p); go('#/team?date=' + el.dataset.date); },
    'new-event': function (el) {
      eventForm(null, { date: el.dataset.date || L.todayISO(), time: el.dataset.time, end: el.dataset.end, with: (el.dataset.with || me().id).split(',').filter(Boolean) });
    },
    'edit-event': function (el) { eventForm(el.dataset.id, {}); }
  });

  /* ---------- consent: notice, per-purpose answers, confirmation, seal, receipt, withdrawal ---------- */

  const PICTO = {
    treatment: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
    records: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    students: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    reports: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
    reminders: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l3 2M9 3h6"/>',
    teaching: '<path d="M4 5h16v10H4z"/><path d="M8 19h8M12 15v4"/>'
  };
  function picto(id) { return '<svg class="picto" viewBox="0 0 24 24" aria-hidden="true">' + (PICTO[id] || '') + '</svg>'; }

  function noticeVars() {
    const set = S.state.settings;
    return { clinic: set.messaging.clinicName || 'Our clinic', years: set.retentionYears, contact: set.privacyContact || set.messaging.clinicName || 'the clinic' };
  }
  function canRecordConsent(p) { const u = me(); return canSee(p) && u.role !== 'student'; }
  function consentStatus(p) { return C.current(S.state.consents, p.id); }

  function viewConsent(pid, params) {
    const p = S.patient(pid);
    if (!p) return '<div class="empty"><p>Patient not found.</p></div>';
    if (!canRecordConsent(p)) return noAccess();
    const lang = C.LANGUAGES[params.lang] ? params.lang : 'en';
    const access = params.access === '1';
    const n = C.notice(lang, null, noticeVars());
    const q = function (o) { const x = Object.assign({ lang: lang, access: access ? '1' : '' }, o); return '#/consent/' + p.id + '?' + Object.keys(x).filter(function (k) { return x[k]; }).map(function (k) { return k + '=' + encodeURIComponent(x[k]); }).join('&') + (params.next ? '&next=' + encodeURIComponent(params.next) : ''); };
    const child = p.ageGroup === 'Child' || (p.dob && C.ageOn(p.dob) < 18);
    const draft = n.status !== 'approved';
    const answer = function (pp) {
      const t = n.purposes[pp.id];
      return '<fieldset class="purpose' + (access ? ' big' : '') + '"><legend>' + (access ? picto(pp.id) : '') + '<span>' + esc(t.label) + '</span></legend>' +
        '<p>' + esc(access ? t.simple : t.text) + '</p>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-action="consent-read" data-lang="' + lang + '" data-text="' + esc(t.label + '. ' + (access ? t.simple : t.text)) + '">▶ Read aloud</button>' +
        '<div class="yesno" role="radiogroup">' +
        '<label class="choice yes"><input type="radio" name="p_' + pp.id + '" value="grant" required> ' + (access ? '👍 ' : '') + 'Yes, I agree</label>' +
        '<label class="choice no"><input type="radio" name="p_' + pp.id + '" value="refuse"> ' + (access ? '👎 ' : '') + 'No</label></div></fieldset>';
    };
    let html = '<a class="back no-print" href="#/patients/' + p.id + '?tab=record">‹ ' + esc(pseud(p)) + '</a>' +
      '<header class="page-head"><div><h1>Consent</h1><p class="muted">' + esc(nm(p)) + ' · ' + esc(p.caseCode) + ' · notice v' + esc(n.version) + '</p></div>' +
      '<div class="head-actions no-print"><button class="btn btn-ghost" data-action="print">Print this form</button></div></header>';
    html += '<section class="card no-print"><h2>1. Language and format</h2><div class="pchips">' + Object.keys(C.LANGUAGES).map(function (k) {
      return '<a class="pchip' + (k === lang ? ' on who-7' : '') + '" href="' + q({ lang: k }) + '" lang="' + k + '">' + esc(C.LANGUAGES[k].name) + '</a>';
    }).join('') + '</div>' +
      '<a class="btn btn-sm' + (access ? ' btn-primary' : '') + '" href="' + q({ access: access ? '' : '1' }) + '">' + (access ? '✓ ' : '') + 'Accessible mode: pictures, simple words, read aloud, witness</a>' +
      '<p class="small muted">Use accessible mode for aphasia, dementia, low literacy or low vision. A witness then confirms that the information was explained.</p></section>';
    if (draft) html += '<div class="callout warn"><strong>' + esc(n.statusLabel) + '</strong><span>' + (S.isDemo() ? 'Fine for the demo.' : 'Have it reviewed before relying on it with patients.') + (n.status === 'draft-translation' ? ' The clinician must confirm it was explained in this language.' : '') + '</span></div>';

    html += '<form id="consent-form" class="consent-form' + (access ? ' accessible' : '') + '" data-pid="' + p.id + '" data-lang="' + lang + '" data-access="' + (access ? 1 : 0) + '" data-next="' + esc(params.next || '') + '" lang="' + lang + '">';
    html += '<section class="card"><h2>2. Who is giving consent</h2>' +
      (child ? '<p class="small muted">' + esc(nm(p)) + ' is a child: a parent or guardian gives consent. Involve the child as far as they can understand.</p>' : '') +
      '<div class="grid-2"><label>Full name<input name="giverName" required autocomplete="off" placeholder="' + esc(child ? (p.guardian || 'Parent or guardian') : nm(p)) + '"></label>' +
      '<label>Relationship to the patient<select name="relationship" required>' + opt('', 'Choose…', true) +
      Object.keys(C.RELATIONSHIPS).map(function (k) { return opt(k, C.RELATIONSHIPS[k]); }).join('') + '</select></label></div>' +
      '<div class="guardian-basis" hidden><div class="grid-2"><label>Legal basis for deciding for this adult<select name="basis">' + opt('', 'Choose…', true) +
      C.GUARDIAN_BASIS.map(function (b) { return opt(b, b); }).join('') + '</select></label>' +
      '<label>Reference (order number, date, issuing court or board)<input name="basisRef"></label></div>' +
      '<p class="small muted">Keep a copy of the document with the paper records, or attach a photo below.</p></div></section>';
    html += '<section class="card notice-text"><h2>3. ' + esc(n.title) + '</h2><p>' + esc(n.intro) + '</p>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-action="consent-read" data-lang="' + lang + '" data-text="' + esc(n.title + '. ' + n.intro) + '">▶ Read aloud</button>' +
      '<h3>' + esc(n.clinicalHead) + '</h3>' + answer(C.PURPOSES[0]) +
      '<h3>' + esc(n.dataHead) + '</h3>' + C.PURPOSES.slice(1).map(answer).join('') +
      '<p class="small">' + esc(n.rights) + '</p></section>';
    html += '<section class="card"><h2>4. How they confirm</h2><div class="method-pick">' +
      [['signature', 'Sign on this screen'], ['otp', 'One-time code to their phone'], ['paper', 'Signed paper form (photo)'], ['thumbprint', 'Thumbprint on paper, with a witness']].map(function (m) {
        const off = m[0] === 'otp' && !S.isDemo();
        return '<label class="choice"><input type="radio" name="method" value="' + m[0] + '" required' + (off ? ' disabled' : '') + '> ' + esc(m[1]) + (off ? ' <span class="muted small">(needs the online version with an SMS provider)</span>' : '') + '</label>';
      }).join('') + '</div>' +
      '<div class="method-panel" data-method="signature" hidden><p class="small">' + esc(n.signHere) + '</p><canvas id="sig" width="600" height="180" aria-label="Signature pad"></canvas>' +
      '<button type="button" class="btn btn-sm" data-action="sig-clear">Clear</button></div>' +
      '<div class="method-panel" data-method="otp" hidden><div class="grid-2"><label>Mobile number<input name="otpPhone" type="tel" value="' + esc(p.reminders && p.reminders.phone || '') + '"></label>' +
      '<div><button type="button" class="btn" data-action="otp-send">Send code</button></div></div><p class="small" id="otp-note"></p>' +
      '<label>Code they received<input name="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label></div>' +
      '<div class="method-panel" data-method="paper thumbprint" hidden><label>Photo or scan of the signed form<input type="file" name="scanFile" accept="image/*" capture="environment"></label>' +
      '<input type="hidden" name="scan"><img class="scan-preview" alt="" hidden></div>' +
      '<div class="witness"' + (access ? '' : ' hidden') + '><h3>Witness</h3><p class="small muted">Someone independent of the treating clinician, who saw the information explained and the answers given.</p>' +
      '<div class="grid-2"><label>Witness name<input name="witnessName"></label><label>Witness role or relationship<input name="witnessRole" placeholder="e.g. nurse, family member, interpreter"></label></div></div>' +
      (draft && n.status === 'draft-translation' ? '<label class="check"><input type="checkbox" name="interpreter"> I explained this in ' + esc(C.LANGUAGES[lang].name) + ' (or an interpreter did) and checked it was understood</label>' : '') +
      '<p class="form-error" id="consent-error" hidden></p>' +
      '<div class="actions end"><button class="btn btn-primary" type="submit">Seal consent</button></div></section></form>';
    return html;
  }

  /* Wire up the signature pad after the page is drawn. */
  function initConsentPage() {
    const c = document.getElementById('sig');
    if (!c || c.dataset.ready) return;
    c.dataset.ready = '1';
    const g = c.getContext('2d');
    g.lineWidth = 2.5; g.lineCap = 'round'; g.strokeStyle = getComputedStyle(document.body).color;
    let down = false;
    const pos = function (e) { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', function (e) { down = true; c.setPointerCapture(e.pointerId); const p = pos(e); g.beginPath(); g.moveTo(p[0], p[1]); });
    c.addEventListener('pointermove', function (e) { if (!down) return; const p = pos(e); g.lineTo(p[0], p[1]); g.stroke(); c.dataset.signed = '1'; });
    c.addEventListener('pointerup', function () { down = false; });
  }

  function consentFormState(form) {
    const m = (form.querySelector('[name=method]:checked') || {}).value || '';
    form.querySelectorAll('.method-panel').forEach(function (el) { el.hidden = el.dataset.method.split(' ').indexOf(m) < 0; });
    const rel = form.querySelector('[name=relationship]').value;
    form.querySelector('.guardian-basis').hidden = !(rel === 'legal-guardian' || rel === 'nominated-rep');
    form.querySelector('.witness').hidden = !(form.dataset.access === '1' || m === 'thumbprint');
    if (m === 'signature') initConsentPage();
  }

  /* Shrink a photo of a paper form so it fits in the record. */
  function readScan(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { reject(new Error('That file is not a picture.')); };
      img.src = url;
    });
  }

  /*
   * What a decision changes, applied straight away: no students on the case, no new sessions without consent to treatment,
   * reminders stop (handled in the store). Returns lines for the receipt.
   */
  function consentEffects(p, before) {
    const after = p.consent || {}, out = [], today = L.todayISO();
    const sups = supervisorsFor(p).filter(function (x) { return x !== me().id; });
    const future = S.appointmentsFor(p.id).filter(function (a) { return a.date >= today && a.status === 'scheduled'; });
    if (before.therapy && !after.therapy) {
      future.forEach(function (a) { a.status = 'cancelled'; a.cancelReason = 'Consent to treatment withdrawn'; });
      out.push(future.length + ' upcoming session' + (future.length === 1 ? '' : 's') + ' cancelled');
      S.send(sups.concat(p.assignedTo && p.assignedTo !== me().id ? [p.assignedTo] : []), { kind: 'note', patientId: p.id, link: '#/patients/' + p.id + '?tab=record', subject: 'Consent to treatment withdrawn – ' + pseud(p), body: 'Upcoming sessions were cancelled.' });
    }
    if (before.students && !after.students) {
      const stu = S.user(p.assignedTo);
      if (stu && stu.role === 'student') {
        p.assignedTo = ''; p.status = 'referred';
        future.forEach(function (a) { if (a.status === 'scheduled') a.coverNeeded = true; });
        S.upsert('referrals', { patientId: p.id, fromId: me().id, at: today, priority: 'Soon', status: 'pending', notes: 'Student consent withdrawn: allot to a qualified therapist.' });
        S.send([stu.id], { kind: 'note', patientId: p.id, subject: 'Case reassigned – ' + p.caseCode, body: 'The family withdrew consent for student clinicians. Your supervisor will reassign the case.' });
        S.send(sups, { kind: 'referral', patientId: p.id, link: '#/cases?tab=allot', subject: 'Reallot ' + pseud(p) + ': student consent withdrawn', body: 'Back on the "To allot" list. Upcoming sessions are flagged for cover.' });
        out.push('Case taken off ' + stu.name + ' and put back on the allotment list');
      }
      S.appointmentsFor(p.id).forEach(function (a) {
        if (a.date < today) return;
        const n = (a.observers || []).length;
        a.observers = (a.observers || []).filter(function (o) { const u = S.user(o.userId); return !u || u.role !== 'student'; });
        if (a.observers.length < n) out.push('Students removed as observers from upcoming sessions');
      });
    }
    if (before.shareReports && !after.shareReports) out.push('Reports to the family are blocked');
    if (before.reminders && !after.reminders) out.push('Appointment reminders stopped');
    if (before.teaching && !after.teaching) out.push('Coursework from this case can no longer be copied out of TJS');
    if (before.records && !after.records) {
      S.send(sups, { kind: 'note', patientId: p.id, link: '#/patients/' + p.id + '?tab=record', subject: 'Records consent withdrawn – ' + pseud(p), body: 'Review whether the record can be erased, or must be kept for a legal retention period.' });
      out.push('Supervisor asked to review the record for erasure (legal retention may apply)');
    }
    S.save();
    return out.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }

  let lastEffects = {};

  function submitConsent(form) {
    const p = S.patient(form.dataset.pid);
    const err = form.querySelector('#consent-error');
    const v = function (n) { const el = form.querySelector('[name=' + n + ']'); return el ? el.value.trim() : ''; };
    const fail = function (m) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };
    const decisions = C.PURPOSES.map(function (pp) { const x = form.querySelector('[name=p_' + pp.id + ']:checked'); return x ? { purpose: pp.id, action: x.value } : null; });
    if (decisions.some(function (d) { return !d; })) return fail('Answer yes or no for every item.');
    const rel = v('relationship'), method = (form.querySelector('[name=method]:checked') || {}).value;
    if ((rel === 'legal-guardian' || rel === 'nominated-rep') && !v('basis')) return fail('Choose the legal basis for deciding for this adult.');
    const ev = {};
    if (method === 'signature') {
      const c = document.getElementById('sig');
      if (!c.dataset.signed) return fail('Ask them to sign in the box.');
      ev.signature = c.toDataURL('image/png');
    }
    if (method === 'otp') {
      if (!form.dataset.otpSent) return fail('Send the code first.');
      if (v('otpCode') !== '123456') return fail('That code is not correct.');
      ev.otpVerified = true; ev.otpPhone = L.maskPhone(v('otpPhone')); ev.otpSimulated = true;
    }
    if (method === 'paper' || method === 'thumbprint') {
      if (!v('scan')) return fail('Add a photo of the signed form.');
      ev.scan = v('scan');
    }
    const needWitness = form.dataset.access === '1' || method === 'thumbprint';
    if (needWitness) {
      if (!v('witnessName') || !v('witnessRole')) return fail('A witness name and role are needed.');
      ev.witness = { name: v('witnessName'), role: v('witnessRole') };
    }
    const interp = form.querySelector('[name=interpreter]');
    if (interp) { if (!interp.checked) return fail('Confirm that the notice was explained in this language.'); ev.explainedInLanguage = true; }
    const before = Object.assign({}, p.consent);
    const e = S.recordConsent({ patientId: p.id, decisions: decisions, giver: { name: v('giverName'), relationship: rel, basis: v('basis'), basisRef: v('basisRef') },
      noticeVersion: C.NOTICES.current, language: form.dataset.lang, method: form.dataset.access === '1' && method !== 'thumbprint' ? method : method, accessible: form.dataset.access === '1', evidence: ev });
    lastEffects[e.id] = consentEffects(p, before);
    go('#/consent-receipt/' + e.id + (form.dataset.next ? '?next=' + encodeURIComponent(form.dataset.next) : ''));
  }

  function viewConsentReceipt(id, params) {
    const e = S.state.consents.find(function (x) { return x.id === id; });
    const p = e && S.patient(e.patientId);
    if (!e || !p) return '<div class="empty"><p>Receipt not found.</p></div>';
    if (!canSee(p)) return noAccess();
    const n = C.notice(e.language, e.notice.version, noticeVars()), en = C.notice('en', e.notice.version, noticeVars());
    const ver = C.verify(S.state.consents, p.id);
    const fx = lastEffects[e.id] || [];
    const text = C.receiptText(e, n, { clinic: noticeVars().clinic, patient: p.caseCode + ' (' + L.initials(p.name) + ')' });
    return '<div class="no-print"><a class="back" href="#/patients/' + p.id + '?tab=record">‹ ' + esc(pseud(p)) + '</a></div>' +
      '<article class="card receipt" lang="' + esc(e.language) + '"><header class="card-head"><div><h1>Consent receipt</h1><p class="muted">' + esc(noticeVars().clinic) + ' · <code>' + esc(e.receiptId) + '</code></p></div>' +
      (e.demo ? '<span class="badge badge-warn">Demo</span>' : '') + '</header>' +
      '<dl class="kv"><div><dt>Patient</dt><dd>' + esc(p.caseCode + ' (' + L.initials(p.name) + ')') + '</dd></div>' +
      '<div><dt>Given by</dt><dd>' + esc(e.giver.name || '—') + ' · ' + esc(C.RELATIONSHIPS[e.giver.relationship] || e.giver.relationship) + (e.giver.basis ? '<div class="small">' + esc(e.giver.basis) + (e.giver.basisRef ? ' · ' + esc(e.giver.basisRef) : '') + '</div>' : '') + '</dd></div>' +
      '<div><dt>When</dt><dd>' + esc(fmtStamp(e.at)) + '</dd></div>' +
      '<div><dt>Notice</dt><dd>Version ' + esc(e.notice.version) + ' · ' + esc((C.LANGUAGES[e.language] || C.LANGUAGES.en).name) + (e.accessible ? ' · accessible format' : '') + '</dd></div>' +
      '<div><dt>How</dt><dd>' + esc(C.METHODS[e.method] || e.method) + (e.evidence && e.evidence.witness ? '<div class="small">Witness: ' + esc(e.evidence.witness.name) + ', ' + esc(e.evidence.witness.role) + '</div>' : '') +
      (e.evidence && e.evidence.otpSimulated ? '<div class="small muted">Demo: simulated code, no SMS sent</div>' : '') + '</dd></div>' +
      '<div><dt>Recorded by</dt><dd>' + esc(userName(e.recordedBy)) + '</dd></div></dl>' +
      '<table class="tbl"><tbody>' + e.decisions.map(function (d) {
        return '<tr><td>' + esc(n.purposes[d.purpose].label) + (e.language !== 'en' ? '<div class="small muted" lang="en">' + esc(en.purposes[d.purpose].label) + '</div>' : '') + '</td>' +
          '<td class="nowrap"><span class="badge ' + (d.action === 'grant' ? 'badge-good' : 'badge-muted') + '">' + esc(C.ACTIONS[d.action]) + '</span></td></tr>';
      }).join('') + '</tbody></table>' +
      (e.evidence && e.evidence.signature ? '<p class="small muted">Signature</p><img class="sig-img" src="' + esc(e.evidence.signature) + '" alt="Signature">' : '') +
      (fx.length ? '<div class="callout"><strong>Applied straight away</strong><ul class="plain small">' + fx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p class="small">' + esc(n.rights) + '</p>' +
      '<p class="small muted">Seal <code class="hash">' + esc(e.hash) + '</code> · ledger ' + (ver.ok ? '✓ intact (' + ver.count + ' entries)' : '⚠ ' + esc(ver.problems[0])) + '</p></article>' +
      '<div class="actions wrap no-print"><button class="btn btn-primary" data-action="print">Print or save as PDF</button>' +
      '<button class="btn" data-action="copy-consent-receipt" data-id="' + e.id + '" data-text="' + esc(text) + '">Copy as text</button>' +
      (params.next ? '<a class="btn" href="' + esc(params.next) + '">Continue ›</a>' : '') + '</div>' +
      '<p class="small muted no-print">Give the family a copy: print it, or copy the text into a message. Sending it to their phone directly comes with the online version.</p>';
  }

  /* The consent part of a patient's record: where each purpose stands, what needs asking again, and the ledger. */
  function consentSection(p) {
    const cur = consentStatus(p), chain = C.forPatient(S.state.consents, p.id), review = C.reviewNeeded(p, S.state.consents, L.todayISO());
    const ver = C.verify(S.state.consents, p.id), en = C.notice('en', null, noticeVars());
    const can = canRecordConsent(p);
    let html = '<section class="card"><div class="card-head"><h2>Consent</h2>' + (can ? '<a class="btn btn-sm btn-primary" href="#/consent/' + p.id + '">Record consent</a>' : '') + '</div>';
    if (review.length) html += '<div class="callout warn"><strong>Ask again</strong><ul class="plain small">' + review.map(function (r) { return '<li>' + esc(r.text) + '</li>'; }).join('') + '</ul></div>';
    html += '<div class="table-wrap"><table class="tbl"><thead><tr><th>Purpose</th><th>Now</th><th>Since</th><th></th></tr></thead><tbody>' + C.PURPOSES.map(function (pp) {
      const c = cur[pp.id];
      return '<tr><td>' + esc(en.purposes[pp.id].label) + (pp.kind === 'clinical' ? ' <span class="badge">Clinical</span>' : '') + '</td>' +
        '<td>' + (c ? '<span class="badge ' + (c.action === 'grant' ? 'badge-good' : 'badge-muted') + '">' + esc(C.ACTIONS[c.action]) + '</span>' : '<span class="muted small">Not asked</span>') + '</td>' +
        '<td class="small nowrap">' + (c ? esc(L.formatDate(c.at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })) : '') + '</td>' +
        '<td>' + (can && c && c.action === 'grant' ? '<button class="btn btn-sm btn-ghost" data-action="withdraw-consent" data-id="' + p.id + '" data-purpose="' + pp.id + '">Withdraw</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    html += '<p class="small">' + reminderLine(p) + '</p>';
    if (chain.length) {
      html += '<details><summary class="small">Consent ledger: ' + chain.length + ' entr' + (chain.length === 1 ? 'y' : 'ies') + ' · ' + (ver.ok ? 'seals intact ✓' : '<strong>⚠ ' + esc(ver.problems.join('; ')) + '</strong>') + '</summary><ol class="timeline">' +
        chain.slice().reverse().map(function (e) {
          return '<li><span class="muted small">' + esc(fmtStamp(e.at)) + '</span> <a href="#/consent-receipt/' + e.id + '">' + esc(e.receiptId) + '</a> · ' + esc(e.giver.name || '—') + ' (' + esc(C.RELATIONSHIPS[e.giver.relationship] || '') + ') · ' +
            esc(C.METHODS[e.method] || e.method) + '<div class="small">' + e.decisions.map(function (d) { return esc(en.purposes[d.purpose].label) + ': ' + esc(C.ACTIONS[d.action]); }).join(' · ') + '</div></li>';
        }).join('') + '</ol><p class="small muted">Entries are never edited. A change of mind is a new entry, and each entry’s seal includes the one before it, so any later change shows up here.</p></details>';
    }
    return html + '</section>';
  }

  function withdrawForm(pid, purpose) {
    const p = S.patient(pid), label = C.notice('en', null, noticeVars()).purposes[purpose].label;
    openModal('Withdraw: ' + label, '<p class="small">Withdrawing stops this from now on. It does not undo what was done before.</p>' +
      '<div class="grid-2"><label>Who is withdrawing<input name="giverName" required></label><label>Relationship<select name="relationship" required>' + opt('', 'Choose…', true) +
      Object.keys(C.RELATIONSHIPS).map(function (k) { return opt(k, C.RELATIONSHIPS[k]); }).join('') + '</select></label></div>' +
      '<label>How they told us<select name="method" required>' + opt('', 'Choose…', true) + ['in-person', 'phone', 'written'].map(function (k) { return opt(k, C.METHODS[k]); }).join('') + '</select></label>' +
      '<label>Note<textarea name="note" rows="2"></textarea></label>' +
      (purpose === 'treatment' ? '<p class="small"><strong>Upcoming sessions will be cancelled.</strong></p>' : purpose === 'students' ? '<p class="small"><strong>If a student has this case, it goes back on the allotment list.</strong></p>' : ''),
    function (fd) {
      const before = Object.assign({}, p.consent);
      const e = S.recordConsent({ patientId: p.id, decisions: [{ purpose: purpose, action: 'withdraw' }], giver: { name: fd.get('giverName').trim(), relationship: fd.get('relationship') },
        method: fd.get('method'), note: fd.get('note').trim(), language: 'en' });
      lastEffects[e.id] = consentEffects(p, before);
      toast('Withdrawn · ' + (lastEffects[e.id].join('; ') || 'recorded'));
    });
  }

  function speak(text, lang) {
    if (!('speechSynthesis' in window)) { toast('Reading aloud is not available in this browser.'); return; }
    const code = (C.LANGUAGES[lang] || C.LANGUAGES.en).voice;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(function (v) { return v.lang === code; }) || voices.find(function (v) { return v.lang.indexOf(code.slice(0, 2)) === 0; });
    if (voices.length && !voice) toast('No ' + C.LANGUAGES[lang].name + ' voice on this device: please read it to them.');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = code; if (voice) u.voice = voice; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  Object.assign(ACTIONS, {
    'consent-read': function (el) { speak(el.dataset.text, el.dataset.lang); },
    'sig-clear': function () { const c = document.getElementById('sig'); c.getContext('2d').clearRect(0, 0, c.width, c.height); delete c.dataset.signed; },
    'otp-send': function () {
      const form = document.getElementById('consent-form');
      if (!S.isDemo()) { toast('Codes need the online version with an SMS provider.'); return; }
      form.dataset.otpSent = '1';
      document.getElementById('otp-note').innerHTML = '<strong>Demo code: 123456</strong> <span class="muted">(in the demo no SMS is sent)</span>';
    },
    'withdraw-consent': function (el) { withdrawForm(el.dataset.id, el.dataset.purpose); },
    'copy-consent-receipt': function (el) { copyText(el.dataset.text); },
    'print': function () { window.print(); }
  });
  Object.assign(SUBMITS, { 'consent-form': function (form) { submitConsent(form); } });

  document.addEventListener('change', function (ev) {
    const form = ev.target.closest('#consent-form');
    if (!form) return;
    consentFormState(form);
    if (ev.target.name === 'scanFile' && ev.target.files[0]) {
      readScan(ev.target.files[0]).then(function (url) {
        form.querySelector('[name=scan]').value = url;
        const img = form.querySelector('.scan-preview'); img.src = url; img.hidden = false;
      }, function (e) { toast(e.message); });
    }
  });

  /* ---------- workspaces: demo (fake data) and clinic (real data) ---------- */

  function welcomeScreen() {
    return '<div class="lock"><div class="card lock-card welcome"><h1>Welcome to TJS</h1>' +
      '<p class="muted">Speech diagnostics and therapy: referrals, timetable, goals, sessions, consent and reports.</p>' +
      '<div class="ws-choice"><button class="ws-btn" data-action="choose-workspace" data-ws="demo"><strong>Try the demo</strong><span>A full fake clinic with demo accounts. Nothing real goes in.</span></button>' +
      '<button class="ws-btn" data-action="choose-workspace" data-ws="clinic"><strong>Set up my clinic</strong><span>Starts empty. You create the first supervisor account and an encryption passphrase.</span></button></div>' +
      '<p class="small muted">The two are kept apart on this device. You can switch at any time from the sign-in screen.</p></div></div>';
  }

  function setupScreen() {
    return '<div class="lock"><form id="setup-form" class="card lock-card"><h1>Set up your clinic</h1>' +
      '<p class="muted">You will be the first clinical supervisor. You then create everyone else’s accounts.</p>' +
      '<label>Clinic name<input name="clinic" required value=""></label>' +
      '<div class="grid-2"><label>Your name<input name="name" required autocomplete="name"></label><label>Your email<input name="email" type="email" required autocomplete="username"></label></div>' +
      '<div class="grid-2"><label>Your password<input type="password" name="p1" minlength="10" required autocomplete="new-password"></label><label>Repeat password<input type="password" name="p2" minlength="10" required autocomplete="new-password"></label></div>' +
      '<h2>Encrypt this device’s data</h2><p class="small">Patients can only be added once the data is encrypted. Choose a passphrase of at least 10 characters, different from your password. <strong>If it is lost, the data cannot be recovered</strong>, so keep it somewhere safe and make backups.</p>' +
      '<div class="grid-2"><label>Passphrase<input type="password" name="k1" minlength="10" required autocomplete="new-password"></label><label>Repeat passphrase<input type="password" name="k2" minlength="10" required autocomplete="new-password"></label></div>' +
      '<p class="form-error" id="setup-error" hidden></p>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">Create clinic</button></div>' +
      '<p class="small"><button type="button" class="link" data-action="choose-workspace" data-ws="demo">Open the demo instead</button></p></form></div>';
  }

  function demoBanner() {
    return '<div class="demo-banner" role="note"><strong>Demo – fake data only.</strong> <span>Don’t enter real patients here.</span>' +
      '<span class="demo-actions">' + (me().role === 'supervisor' || !S.isServer() ? '<button class="btn btn-sm" data-action="fake-patients">+ Generate fake patients</button>' : '') +
      (!S.isServer() ? '<button class="btn btn-sm" data-action="reset-demo">Reset demo</button><button class="btn btn-sm" data-action="choose-workspace" data-ws="clinic">Go to my clinic</button>' : '') + '</span></div>';
  }

  /* Patients can be added only once the data is encrypted (the demo is fake data). */
  function patientsAllowed() {
    if (S.isDemo()) return '';
    if (S.isServer()) return S.serverInfo().encryptedAtRest ? '' : 'The clinic server is not encrypting its data. Start it with THERAPY_DATA_PASSPHRASE set before adding patients.';
    return S.hasPassphrase() ? '' : 'Set an encryption passphrase in Privacy & settings before adding patients.';
  }

  /* Newly registered or newly allotted patients, shown where each role starts its day. */
  function newPatientsCard() {
    const u = me(), since = L.addDays(L.todayISO(), -14);
    const fresh = visiblePatients().filter(function (p) {
      const at = (p.allottedAt || '').slice(0, 10) || (p.registeredAt || '').slice(0, 10) || (p.referredAt || '');
      if (!at || at < since) return false;
      if (u.role === 'therapist' || u.role === 'student') return p.assignedTo === u.id;
      if (u.role === 'diagnostician') return p.status === 'waiting';
      return true;
    }).sort(function (a, b) { return String(b.registeredAt || b.allottedAt || '').localeCompare(String(a.registeredAt || a.allottedAt || '')); });
    if (!fresh.length) return '';
    const label = { supervisor: 'New patients (last 14 days)', therapist: 'Newly allotted to you', student: 'Newly allotted to you', diagnostician: 'New on the waiting list' }[u.role];
    return '<section class="card new-patients"><div class="card-head"><h2>' + esc(label) + ' <span class="rb-count">' + fresh.length + '</span></h2></div><ul class="list flat">' +
      fresh.slice(0, 6).map(function (p) {
        return '<li><a class="row" href="#/patients/' + p.id + '"><div><strong>' + esc(nm(p)) + '</strong> ' + caseTag(p) + statusPill(p) + '<div class="muted small">' + esc(p.caseCode) + (p.assignedTo ? ' · ' + esc(userName(p.assignedTo)) : '') + '</div></div><span class="chev" aria-hidden="true">›</span></a></li>';
      }).join('') + '</ul>' + (fresh.length > 6 ? '<p class="small"><a href="#/patients">All patients ›</a></p>' : '') + '</section>';
  }

  Object.assign(ACTIONS, {
    'choose-workspace': function (el) { S.chooseWorkspace(el.dataset.ws); },
    'fake-patients': function () {
      try {
        const made = S.generateFake(6);
        toast(made.length + ' fake patients added: waiting list, to allot, in therapy and discharged');
        render();
      } catch (e) { toast(e.message); }
    },
    'clean-start': function () {
      ask('Clean start: delete every patient, every account (including yours) and all settings on this device? Deletion receipts are kept. You then create a new first supervisor.', 'Delete everything').then(function (ok) {
        if (!ok) return;
        S.cleanStart().then(function () { route = '#/'; render(); toast('Clean start: create the first supervisor'); });
      });
    }
  });
  Object.assign(SUBMITS, {
    'setup-form': function (form) {
      const v = function (n) { return form.querySelector('[name=' + n + ']').value; };
      const err = document.getElementById('setup-error');
      const fail = function (m) { err.textContent = m; err.hidden = false; };
      if (v('p1') !== v('p2')) return fail('The passwords don’t match.');
      if (v('k1') !== v('k2')) return fail('The passphrases don’t match.');
      if (v('k1') === v('p1')) return fail('Use a passphrase that is different from your password.');
      if (!S.cryptoAvailable()) return fail('This browser cannot encrypt data here. Open TJS from a file or over https in an up-to-date browser.');
      S.createFirstSupervisor(v('name').trim(), v('email').trim(), v('p1'), v('clinic').trim())
        .then(function () { return S.setPassphrase(v('k1')); })
        .then(function () { S.audit('Turned on encryption'); lastActivity = Date.now(); route = '#/'; render(); toast('Your clinic is ready. Add people under Privacy → People & sign-in.'); }, function (e) { fail(e.message); });
    }
  });

  /* ---------- files: scanned reports, letters, photos, voice notes, videos ---------- */

  const FILE_CATEGORIES = ['Scanned report', 'Referral letter', 'Hearing test / audiogram', 'Previous therapy report', 'School report', 'Medical report',
    'Consent form (paper)', 'Photo', 'Voice recording', 'Video', 'Other'];
  const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,audio/*,video/*,.pdf,.ogg,.opus,.m4a,.mp3,.mp4';
  const SOURCE_LABEL = { upload: 'Added here', camera: 'Photo taken here', share: 'Shared from another app', email: 'From email', whatsapp: 'From WhatsApp' };

  function fileIcon(type) { return /^image/.test(type) ? '🖼' : /pdf/.test(type) ? '📄' : /^audio/.test(type) ? '🎙' : /^video/.test(type) ? '🎬' : '📎'; }
  function fileSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function guessCategory(type) { return /^audio/.test(type) ? 'Voice recording' : /^video/.test(type) ? 'Video' : /^image/.test(type) ? 'Scanned report' : 'Scanned report'; }
  function canChangeFile(a) { return me().role === 'supervisor' || a.addedBy === me().id; }
  function unfiled() { return S.state.attachments.filter(function (a) { return !a.patientId && (me().role === 'supervisor' || a.addedBy === me().id); }); }

  function addZone(pid) {
    return '<section class="card dropzone" data-patient="' + esc(pid || '') + '"><h2>Add files</h2>' +
      '<p class="small">Scanned reports, letters, audiograms, photos, voice notes and videos, up to 25 MB each. <strong>Drag files here</strong> – also straight out of your email – or:</p>' +
      '<div class="actions wrap"><label class="btn btn-primary">Choose files<input type="file" class="file-pick" data-patient="' + esc(pid || '') + '" multiple accept="' + FILE_ACCEPT + '" hidden></label>' +
      '<label class="btn">Take a photo<input type="file" class="file-pick" data-patient="' + esc(pid || '') + '" data-source="camera" accept="image/*" capture="environment" hidden></label></div>' +
      '<div class="grid-2"><label>What is it<select id="file-cat">' + opt('', 'Work it out from the file', true) + FILE_CATEGORIES.map(function (c) { return opt(c, c); }).join('') + '</select></label>' +
      '<label>Note (optional)<input id="file-note" maxlength="200" placeholder="e.g. ENT report, March 2026"></label></div>' +
      '<p class="small muted">Files are encrypted ' + (S.isServer() ? 'on the clinic server' : 'on this device, with this patient’s own key') + ', and erased with the patient. Voice notes and videos of a patient need the family’s agreement: note it in their consent.</p></section>';
  }

  function fileRow(a, withPatient) {
    const p = a.patientId && S.patient(a.patientId);
    return '<li class="file-row"><span class="file-icon" aria-hidden="true">' + fileIcon(a.type) + '</span><div class="file-main"><strong>' + esc(a.name) + '</strong>' +
      '<div class="muted small">' + esc(a.category) + ' · ' + esc(fileSize(a.size)) + ' · ' + esc(fmtStamp(a.addedAt)) + ' · ' + esc(userName(a.addedBy)) +
      (a.source !== 'upload' ? ' · ' + esc(SOURCE_LABEL[a.source] || a.source) : '') + (withPatient && p ? ' · ' + esc(pseud(p)) : '') + '</div>' +
      (a.note ? '<div class="small">' + esc(a.note) + '</div>' : '') + '</div>' +
      '<div class="file-actions"><button class="btn btn-sm" data-action="file-view" data-id="' + a.id + '">Open</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="file-save" data-id="' + a.id + '">Save a copy</button>' +
      (canChangeFile(a) && a.patientId ? '<button class="btn btn-sm btn-ghost" data-action="file-move" data-id="' + a.id + '">Move</button>' : '') +
      (canChangeFile(a) ? '<button class="btn btn-sm btn-ghost" data-action="file-delete" data-id="' + a.id + '">Delete</button>' : '') + '</div></li>';
  }

  function filesTab(p) {
    const list = S.state.attachments.filter(function (a) { return a.patientId === p.id; }).sort(function (a, b) { return b.addedAt.localeCompare(a.addedAt); });
    return addZone(p.id) + '<section class="card"><h2>Files (' + list.length + ')</h2>' +
      (list.length ? '<ul class="list flat files">' + list.map(function (a) { return fileRow(a, false); }).join('') + '</ul>' : '<p class="muted small">No files yet.</p>') + '</section>';
  }

  function viewFilesToFile(params) {
    const list = unfiled().sort(function (a, b) { return b.addedAt.localeCompare(a.addedAt); });
    const pats = visiblePatients().filter(function (p) { return p.status !== 'discharged'; });
    let html = '<header class="page-head"><div><h1>Files to file</h1><p class="muted">Files that arrived without a patient: shared from WhatsApp or another app, or added here. Choose whose they are.</p></div></header>';
    if (params.shared === 'failed') html += '<div class="callout warn"><strong>The shared file could not be received.</strong><span>Try again, or save it on the phone and add it below.</span></div>';
    html += list.length ? '<section class="card"><ul class="list flat files">' + list.map(function (a) {
      return '<li class="file-row unfiled"><span class="file-icon" aria-hidden="true">' + fileIcon(a.type) + '</span><div class="file-main"><strong>' + esc(a.name) + '</strong>' +
        '<div class="muted small">' + esc(fileSize(a.size)) + ' · ' + esc(fmtStamp(a.addedAt)) + ' · ' + esc(SOURCE_LABEL[a.source] || a.source) + (a.from ? ' · from ' + esc(a.from) : '') + '</div>' +
        (a.note ? '<div class="small">' + esc(a.note) + '</div>' : '') +
        '<div class="grid-2 file-to"><label>Patient<select data-file-patient="' + a.id + '">' + opt('', 'Choose…', true) + pats.map(function (p) { return opt(p.id, p.caseCode + ' · ' + nm(p)); }).join('') + '</select></label>' +
        '<label>What is it<select data-file-cat="' + a.id + '">' + FILE_CATEGORIES.map(function (c) { return opt(c, c, c === (a.category === 'Other' ? guessCategory(a.type) : a.category)); }).join('') + '</select></label></div></div>' +
        '<div class="file-actions"><button class="btn btn-sm btn-primary" data-action="file-file" data-id="' + a.id + '">File it</button>' +
        '<button class="btn btn-sm" data-action="file-view" data-id="' + a.id + '">Open</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="file-delete" data-id="' + a.id + '">Delete</button></div></li>';
    }).join('') + '</ul></section>' : '<div class="empty"><p>Nothing waiting to be filed.</p></div>';
    html += addZone('');
    html += '<section class="card"><h2>How files get here</h2><ul class="small plain how-files">' +
      '<li><strong>WhatsApp (Android):</strong> install TJS (browser menu → <em>Install app</em>). In WhatsApp, open the chat, press and hold the photo, PDF or voice note → <em>Share</em> → <strong>TJS</strong>. It appears here.</li>' +
      '<li><strong>iPhone:</strong> in WhatsApp, <em>Share → Save to Files</em>, then <em>Choose files</em> above.</li>' +
      '<li><strong>Email:</strong> on a computer, drag the attachment from Gmail or Outlook onto the box above, or save it and choose it.</li>' +
      '<li><strong>Scanner or phone camera:</strong> scan to PDF or JPG and add it, or use <em>Take a photo</em>.</li>' +
      '<li><strong>Automatically from the clinic’s email address or WhatsApp Business number:</strong> comes with the online version (it needs a server to receive them).</li></ul>' +
      '<p class="small muted">After sharing, delete the file from the phone’s gallery and downloads, and from the chat if your clinic’s policy says so: TJS keeps the encrypted copy.</p></section>';
    return html;
  }

  /* Add picked or dropped files one by one, then say what happened. */
  function addFiles(files, pid, source) {
    const cat = document.getElementById('file-cat'), note = document.getElementById('file-note');
    const list = Array.prototype.slice.call(files);
    if (!list.length) return;
    const blocked = pid && patientsAllowed();
    if (blocked) { toast(blocked); return; }
    toast('Adding ' + list.length + ' file' + (list.length === 1 ? '' : 's') + '…');
    let ok = 0, dup = 0;
    const errors = [];
    list.reduce(function (p, f) {
      return p.then(function () {
        return S.addFile(f, { patientId: pid, category: (cat && cat.value) || guessCategory(f.type), note: note ? note.value.trim() : '', source: source || 'upload' })
          .then(function (m) { ok++; if (m.duplicate) dup++; }, function (e) { errors.push(e.message); });
      });
    }, Promise.resolve()).then(function () {
      render();
      toast((ok ? ok + ' file' + (ok === 1 ? '' : 's') + ' added' + (dup ? ' (' + dup + ' already here before)' : '') : 'Nothing added') + (errors.length ? '. ' + errors.join(' ') : ''));
    });
  }

  let viewerUrl = null;
  function showFile(id) {
    const a = S.state.attachments.find(function (x) { return x.id === id; });
    S.openFile(id).then(function (blob) {
      const dlg = document.getElementById('viewer');
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = URL.createObjectURL(blob);
      const body = /^image/.test(a.type) ? '<img src="' + viewerUrl + '" alt="' + esc(a.name) + '">'
        : /^audio/.test(a.type) ? '<audio controls src="' + viewerUrl + '"></audio>'
        : /^video/.test(a.type) ? '<video controls src="' + viewerUrl + '"></video>'
        : '<p>PDFs open in a new tab.</p><a class="btn btn-primary" href="' + viewerUrl + '" target="_blank" rel="noopener">Open PDF</a>';
      dlg.innerHTML = '<div class="viewer"><header class="notice-head"><div><h2>' + esc(a.name) + '</h2><p class="muted small">' + esc(a.category) + ' · ' + esc(fileSize(a.size)) + '</p></div>' +
        '<button class="btn btn-ghost" data-action="viewer-close" aria-label="Close">✕</button></header><div class="viewer-body">' + body + '</div></div>';
      dlg.onclose = function () { dlg.innerHTML = ''; if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; } };
      dlg.onclick = function (ev) { if (ev.target === dlg) dlg.close(); };
      dlg.showModal();
    }, function (e) { toast(e.message); });
  }

  function saveFile(id) {
    const a = S.state.attachments.find(function (x) { return x.id === id; });
    S.openFile(id).then(function (blob) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = a.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
      S.audit('Saved a copy of a file', a.patientId, a.category);
      toast('Saved. The copy on this computer is not encrypted: delete it when you are done.');
    }, function (e) { toast(e.message); });
  }

  function moveFileForm(id) {
    const a = S.state.attachments.find(function (x) { return x.id === id; });
    openModal('Move file', '<p class="small">' + esc(a.name) + '</p><label>Move to<select name="pid" required>' + opt('', 'Choose…', true) +
      visiblePatients().filter(function (p) { return p.id !== a.patientId; }).map(function (p) { return opt(p.id, p.caseCode + ' · ' + nm(p)); }).join('') + '</select></label>',
    function (fd) { S.fileTo(id, fd.get('pid')).then(function () { toast('Moved'); render(); }, function (e) { toast(e.message); }); });
  }

  Object.assign(ACTIONS, {
    'file-view': function (el) { showFile(el.dataset.id); },
    'file-save': function (el) { saveFile(el.dataset.id); },
    'file-move': function (el) { moveFileForm(el.dataset.id); },
    'viewer-close': function () { document.getElementById('viewer').close(); },
    'file-delete': function (el) {
      ask('Delete this file? It cannot be undone.', 'Delete').then(function (ok) { if (ok) S.deleteFile(el.dataset.id).then(function () { toast('File deleted'); render(); }); });
    },
    'file-file': function (el) {
      const pid = document.querySelector('[data-file-patient="' + el.dataset.id + '"]').value;
      if (!pid) { toast('Choose the patient first.'); return; }
      S.fileTo(el.dataset.id, pid, document.querySelector('[data-file-cat="' + el.dataset.id + '"]').value)
        .then(function () { toast('Filed under ' + pseud(S.patient(pid))); render(); }, function (e) { toast(e.message); });
    }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.classList && t.classList.contains('file-pick') && t.files.length) { addFiles(t.files, t.dataset.patient || '', t.dataset.source); t.value = ''; }
  });
  document.addEventListener('dragover', function (ev) {
    const z = ev.target.closest && ev.target.closest('.dropzone');
    if (!z) return;
    ev.preventDefault(); z.classList.add('over');
  });
  document.addEventListener('dragleave', function (ev) { const z = ev.target.closest && ev.target.closest('.dropzone'); if (z && !z.contains(ev.relatedTarget)) z.classList.remove('over'); });
  document.addEventListener('drop', function (ev) {
    const z = ev.target.closest && ev.target.closest('.dropzone');
    if (!z) return;
    ev.preventDefault(); z.classList.remove('over');
    if (ev.dataTransfer && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files, z.dataset.patient || '', 'upload');
  });

  /* Files shared into TJS from WhatsApp or another app: take them in once someone is signed in. */
  let takingShared = false;
  function collectShared() {
    if (takingShared || !S.currentUser() || S.isLocked()) return;
    takingShared = true;
    S.takeSharedFiles().then(function (list) {
      takingShared = false;
      const ok = list.filter(function (x) { return !x.error; });
      if (!list.length) return;
      toast(ok.length + ' shared file' + (ok.length === 1 ? '' : 's') + ' received' + (list.length > ok.length ? '; ' + (list.length - ok.length) + ' not accepted (type or size)' : '') + '. Choose the patient.');
      if (route.indexOf('#/files-to-file') === 0) render(); else go('#/files-to-file');
    }, function () { takingShared = false; });
  }

  /* ---------- letters and emails: report to the family, thanks to the referrer ---------- */

  function lettersFor(pid) { return S.state.letters.filter(function (l) { return l.patientId === pid; }).sort(function (a, b) { return b.at.localeCompare(a.at); }); }
  function letterSent(a, kind) { return S.state.letters.some(function (l) { return l.assessmentId === a.id && l.kind === kind && l.status === 'sent'; }); }
  function emailOf(text) { const m = /[^\s<>,;]+@[^\s<>,;]+\.[a-z]{2,}/i.exec(text || ''); return m ? m[0] : ''; }

  /* Completed assessments still waiting for the family report or the referrer's thank-you. */
  function lettersDue() {
    const u = me(), out = [];
    S.state.assessments.filter(function (a) { return a.status === 'completed' && (u.role === 'supervisor' || a.assessorId === u.id); }).forEach(function (a) {
      const p = S.patient(a.patientId);
      if (!p) return;
      if (!letterSent(a, 'family-report') && !a.noFamilyLetter) out.push({ a: a, p: p, kind: 'family-report' });
      if (!letterSent(a, 'referrer-thanks') && !a.noReferrerLetter) out.push({ a: a, p: p, kind: 'referrer-thanks' });
    });
    return out;
  }

  function letterChips(a) {
    return ['family-report', 'referrer-thanks'].map(function (k) {
      const sent = letterSent(a, k), skipped = k === 'family-report' ? a.noFamilyLetter : a.noReferrerLetter;
      return '<button class="badge ' + (sent ? 'badge-good' : skipped ? 'badge-muted' : 'badge-warn') + '" data-action="letter-new" data-assessment="' + a.id + '" data-kind="' + k + '">' +
        (k === 'family-report' ? 'Report to family' : 'Thanks to referrer') + ': ' + (sent ? 'sent ✓' : skipped ? 'not needed' : 'to send') + '</button>';
    }).join(' ');
  }

  function letterForm(opts) {
    const a = opts.assessmentId && S.assessment(opts.assessmentId);
    const p = S.patient(opts.patientId || (a && a.patientId));
    const old = opts.id && S.state.letters.find(function (l) { return l.id === opts.id; });
    const kind = old ? old.kind : opts.kind || 'other';
    const r = a && S.state.referrals.find(function (x) { return x.assessmentId === a.id; });
    const draft = old || L.letterDraft(kind, { clinic: S.state.settings.messaging.clinicName, assessor: a ? userName(a.assessorId) : me().name, patient: p, assessment: a,
      referrerName: a && a.referrerName, referred: !!r, closed: p.status === 'discharged' });
    const to = old ? old.to : kind === 'family-report' ? emailOf(p.contact) : kind === 'referrer-thanks' ? (a && a.referrerEmail) || '' : '';
    const needs = kind === 'family-report' ? (p.consent && p.consent.shareReports ? '' : 'No consent to send reports to the family. Record it first (Details & consent).')
      : kind === 'referrer-thanks' ? (p.consent && p.consent.records ? '' : 'No consent to keep records and share a summary with the referrer yet. Record consent first.') : '';
    openModal(L.LETTER_KINDS[kind] + ' – ' + pseud(p),
      (needs ? '<div class="callout warn"><strong>' + esc(needs) + '</strong></div>' : '') +
      '<label>To (email)<input name="to" type="email" value="' + esc(to) + '" placeholder="' + (kind === 'referrer-thanks' ? 'Referrer’s email – add it to the assessment to fill it in next time' : 'name@example.com') + '"></label>' +
      '<label>Subject<input name="subject" required value="' + esc(draft.subject) + '"></label>' +
      '<label>Message<textarea name="body" rows="14" required>' + esc(draft.body) + '</textarea></label>' +
      '<p class="small muted">Check the address twice. Ordinary email is not end-to-end encrypted, so send only what the person needs; the subject has no health details. ' +
      (kind === 'referrer-thanks' ? 'The draft uses initials and the case code: add the full name only if your clinic’s policy allows. ' : '') + '</p>' +
      '<div class="actions wrap"><button type="button" class="btn btn-primary" data-action="letter-mail">Open in my email program</button><button type="button" class="btn" data-action="letter-copy">Copy the text</button></div>' +
      '<label class="check"><input type="checkbox" name="sent"' + (old && old.status === 'sent' ? ' checked' : '') + '> I have sent it</label>' +
      (kind !== 'other' && a && !old ? '<label class="check"><input type="checkbox" name="notNeeded"> Not needed for this patient</label>' : ''),
    function (fd) {
      if (needs && fd.get('sent')) { toast(needs); return false; }
      if (fd.get('notNeeded')) {
        if (kind === 'family-report') a.noFamilyLetter = true; else a.noReferrerLetter = true;
        S.audit('Marked letter not needed', p.id, L.LETTER_KINDS[kind]); S.save(); toast('Marked as not needed'); return;
      }
      const sent = !!fd.get('sent');
      const l = S.upsert('letters', Object.assign({}, old || { patientId: p.id, assessmentId: a ? a.id : '', kind: kind, by: me().id, at: new Date().toISOString() },
        { to: fd.get('to').trim(), subject: fd.get('subject').trim(), body: fd.get('body'), status: sent ? 'sent' : 'draft', sentAt: sent ? (old && old.sentAt) || new Date().toISOString() : '' }));
      S.audit(sent ? 'Sent email' : 'Saved email draft', p.id, L.LETTER_KINDS[kind] + (l.to ? ' to ' + l.to.replace(/^(.).*@/, '$1…@') : ''));
      toast(sent ? 'Recorded as sent' : 'Draft saved – it stays on "Letters to send"');
    });
  }

  function viewLettersDue() {
    const due = lettersDue();
    let html = '';
    if (!due.length) return html + '<div class="empty"><p>All assessment reports and thank-you emails are sent.</p></div>';
    return html + '<ul class="list">' + due.map(function (x) {
      const draft = S.state.letters.find(function (l) { return l.assessmentId === x.a.id && l.kind === x.kind && l.status === 'draft'; });
      return '<li><div class="row"><div><strong>' + esc(L.LETTER_KINDS[x.kind]) + '</strong> · ' + esc(pseud(x.p)) + ' · ' + esc(nm(x.p)) +
        '<div class="muted small">Assessed ' + esc(L.formatDate(x.a.date, { day: 'numeric', month: 'short' })) + (x.kind === 'referrer-thanks' ? ' · referred by ' + esc(x.a.referrerName || x.a.source || '—') : '') + (draft ? ' · draft saved' : '') + '</div></div>' +
        '<button class="btn btn-sm btn-primary" data-action="letter-new" data-assessment="' + x.a.id + '" data-kind="' + x.kind + '"' + (draft ? ' data-id="' + draft.id + '"' : '') + '>' + (draft ? 'Continue' : 'Write') + '</button></div></li>';
    }).join('') + '</ul>';
  }

  function lettersSection(p) {
    const list = lettersFor(p.id);
    const rem = S.state.reminders.filter(function (r) { return r.patientId === p.id; }).slice(-8).reverse();
    return '<section class="card"><div class="card-head"><h2>Letters, emails &amp; reminders</h2><button class="btn btn-sm" data-action="letter-new" data-patient="' + p.id + '" data-kind="other">+ Email</button></div>' +
      (list.length ? '<ul class="list flat">' + list.map(function (l) {
        return '<li><div class="row"><div><strong>' + esc(L.LETTER_KINDS[l.kind]) + '</strong> <span class="badge ' + (l.status === 'sent' ? 'badge-good' : 'badge-warn') + '">' + (l.status === 'sent' ? 'Sent ' + esc(fmtStamp(l.sentAt)) : 'Draft') + '</span>' +
          '<div class="muted small">' + esc(l.subject) + (l.to ? ' · to ' + esc(l.to) : '') + ' · ' + esc(userName(l.by)) + '</div></div>' +
          '<button class="btn btn-sm btn-ghost" data-action="letter-new" data-id="' + l.id + '" data-patient="' + p.id + '">Open</button></div></li>';
      }).join('') + '</ul>' : '<p class="muted small">No letters or emails yet.</p>') +
      '<h3>Appointment reminders</h3>' + (rem.length ? '<ul class="plain small">' + rem.map(function (r) {
        return '<li>' + esc(L.CHANNELS[r.channel] || r.channel) + ' for ' + esc(L.formatDate(r.date, { day: 'numeric', month: 'short' })) + ' ' + esc(L.formatTime(r.time)) + ' · marked sent ' + esc(fmtStamp(r.sentAt)) + ' by ' + esc(userName(r.by)) + '</li>';
      }).join('') + '</ul>' : '<p class="muted small">None sent yet.</p>') + '</section>';
  }

  /* Reminders to send for one day: scheduled sessions with a channel and an opt-in, not yet marked sent. */
  function remindersToSend(date) {
    return visibleAppts(S.appointmentsOn(date)).filter(function (a) {
      if (a.status !== 'scheduled') return false;
      const p = S.patient(a.patientId);
      return p && L.reminderChannel(p, msgSettings()).channel && !S.state.reminders.some(function (r) { return r.apptId === a.id && r.date === a.date && r.time === a.time && r.status === 'sent'; });
    }).length;
  }

  function remindersHistory() {
    const since = L.addDays(L.todayISO(), -30);
    const list = S.state.reminders.filter(function (r) { return r.status === 'sent' && (r.sentAt || '').slice(0, 10) >= since; }).filter(function (r) { const p = S.patient(r.patientId); return p && canSee(p); })
      .sort(function (a, b) { return b.sentAt.localeCompare(a.sentAt); });
    return '<section class="card"><h2>Sent in the last 30 days (' + list.length + ')</h2>' + (list.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Marked sent</th><th>Patient</th><th>Appointment</th><th>By</th><th>Channel</th><th>Who</th></tr></thead><tbody>' +
      list.slice(0, 100).map(function (r) {
        const p = S.patient(r.patientId);
        return '<tr><td class="nowrap">' + esc(fmtStamp(r.sentAt)) + '</td><td>' + esc(pseud(p)) + '</td><td class="nowrap">' + esc(L.formatDate(r.date, { day: 'numeric', month: 'short' }) + ' ' + L.formatTime(r.time)) + '</td><td>' + esc(L.CHANNELS[r.channel] || r.channel) + '</td><td>' + esc(userName(r.by)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted small">Nothing marked as sent yet. After sending from your SMS or WhatsApp Business provider, press <em>Mark all as sent</em> so it is tracked here.</p>') + '</section>';
  }

  Object.assign(ACTIONS, {
    'letter-new': function (el) { letterForm({ id: el.dataset.id, assessmentId: el.dataset.assessment, patientId: el.dataset.patient, kind: el.dataset.kind }); },
    'letter-mail': function (el) {
      const f = el.closest('form');
      const link = L.mailtoLink(f.querySelector('[name=to]').value.trim(), f.querySelector('[name=subject]').value, f.querySelector('[name=body]').value);
      if (link.length > 1900) toast('The message is long: if your email program cuts it short, use "Copy the text" and paste it.');
      window.location.href = link;
    },
    'letter-copy': function (el) { copyText(el.closest('form').querySelector('[name=body]').value); }
  });

  /* ---------- router ---------- */

  function render() {
    const bar = document.getElementById('rolebar');
    if (S.isLocked()) {
      document.body.classList.add('locked');
      bar.innerHTML = '';
      view.innerHTML = lockScreen();
      const f = document.getElementById('unlock-pass');
      if (f) f.focus();
      return;
    }
    const cur = S.currentUser();
    document.body.classList.toggle('demo-mode', S.isDemo());
    if (!S.isServer() && !S.workspace()) { document.body.classList.add('locked'); bar.innerHTML = ''; view.innerHTML = welcomeScreen(); return; }
    if (!S.isServer() && !S.state.users.length) { document.body.classList.add('locked'); bar.innerHTML = ''; view.innerHTML = setupScreen(); const f = view.querySelector('input'); if (f) f.focus(); return; }
    if (!cur && S.isServer() && (S.syncStatus() === 'connecting' || S.syncStatus() === 'unreachable')) {
      document.body.classList.add('locked');
      bar.innerHTML = '';
      view.innerHTML = serverScreen(S.syncStatus());
      return;
    }
    if (!cur || cur.mustChange) {
      document.body.classList.add('locked');
      bar.innerHTML = '';
      view.innerHTML = (S.isDemo() ? '<div class="demo-banner" role="note"><strong>Demo – fake data only.</strong> <span>Sign in with any demo account below.</span></div>' : '') + (cur ? newPasswordScreen(cur) : loginScreen());
      const f = view.querySelector('input');
      if (f) f.focus();
      return;
    }
    document.body.classList.remove('locked');
    const u = me();
    const r = parseHash();
    let section = r.parts[0];
    if (section === 'settings') section = 'privacy';
    if (!section) section = u.role === 'diagnostician' ? 'diagnostics' : 'schedule';
    bar.innerHTML = (S.isDemo() ? demoBanner() : '') + rolebar();
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.hidden = NAV_ROLES[a.dataset.nav].indexOf(u.role) < 0;
      if (a.dataset.nav === 'cases') a.lastChild.textContent = u.role === 'student' || u.role === 'therapist' ? ' My cases' : ' Cases';
    });
    const unread = S.unread(u.id);
    const badge = document.querySelector('.nav-count');
    badge.textContent = unread; badge.hidden = !unread;
    let html;
    if (NAV_ROLES[section] && NAV_ROLES[section].indexOf(u.role) < 0) html = noAccess();
    else if (section === 'diagnostics') html = viewDiagnostics(r.params);
    else if (section === 'assessment') html = viewAssessment(r.parts[1]);
    else if (section === 'cases' && r.parts[1]) html = viewCase(r.parts[1]);
    else if (section === 'cases') html = viewCases(r.params);
    else if (section === 'doc') html = viewDoc(r.parts[1]);
    else if (section === 'privacy') html = viewPrivacy();
    else if (section === 'inbox') html = viewInbox(r.parts[1]);
    else if (section === 'leave') html = viewLeave();
    else if (section === 'team') html = viewTeam(r.params);
    else if (section === 'consent') html = viewConsent(r.parts[1], r.params);
    else if (section === 'files-to-file') html = viewFilesToFile(r.params);
    else if (section === 'consent-receipt') html = viewConsentReceipt(r.parts[1], r.params);
    else if (section === 'session') html = viewSession(r.parts[1], r.params);
    else if (section === 'patients' && r.parts[1]) html = viewPatient(r.parts[1], r.params);
    else if (section === 'patients') html = viewPatients(r.params);
    else if (section === 'goals') html = viewGoals(r.params);
    else if (section === 'materials') html = viewMaterials(r.params);
    else if (section === 'reports') html = viewReports(r.params);
    else html = viewSchedule(r.params);
    view.innerHTML = html;
    const cf = document.getElementById('consent-form');
    if (cf) consentFormState(cf);

    const navKey = { session: 'schedule', assessment: 'diagnostics', doc: 'cases', consent: 'patients', 'consent-receipt': 'patients', 'files-to-file': 'inbox' }[section] || section;
    collectShared();
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === navKey);
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (pendingNotice) { pendingNotice = false; showNotices(); }
    if (S.state.settings.autoErase && S.state.settings.lastRetentionRun !== L.todayISO() && (!S.isServer() || u.role === 'supervisor')) {
      const erased = S.runRetention();
      if (erased.length) toast(erased.length + ' record' + (erased.length === 1 ? '' : 's') + ' erased by the retention rule – see Privacy → Deletion receipts');
    }
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
      case 'new-appt': apptForm(null, { date: el.dataset.date || L.todayISO(), time: el.dataset.time || '09:00', patientId: el.dataset.patient || '' }); break;
      case 'sched-view': S.state.settings.scheduleView = el.dataset.view; S.save(); render(); break;
      case 'edit-appt': apptForm(id); break;
      case 'new-patient': patientForm(null); break;
      case 'edit-patient': patientForm(id); break;
      case 'new-goal': goalForm(null, el.dataset.patient || parseHash().params.patient); break;
      case 'edit-goal': goalForm(id); break;
      case 'new-material': materialForm(null); break;
      case 'edit-material': materialForm(id); break;
      case 'copy-picklist': {
        const d = el.dataset.date, mm = maps();
        const appts = visibleAppts(S.appointmentsOn(d)).filter(function (a) { return a.status !== 'cancelled'; });
        const list = L.materialsForDay(appts, mm.goals, mm.materials, mm.patients);
        copyText('Materials for ' + L.formatDate(d) + '\n' + list.map(function (x) {
          return '[ ] ' + x.material.name + (x.material.location ? ' (' + x.material.location + ')' : '') + ' – ' + x.sessions.map(function (s) { return nm(s.patient); }).join(', ');
        }).join('\n'));
        break;
      }
      case 'copy-backup': copyText(document.getElementById('backup-text').value); break;
      case 'copy-report': {
        const log = S.state.logs.find(function (l) { return l.id === document.getElementById('report-text').dataset.log; });
        S.audit('Copied family report', log && log.patientId);
        copyText(document.getElementById('report-text').value);
        break;
      }
      case 'copy-log-report': {
        const log = S.state.logs.find(function (l) { return l.id === el.dataset.log; });
        const m = maps();
        copyText(log.reportText || L.clientReport({ patient: m.patients[log.patientId], log: log, goalsById: m.goals, therapist: S.state.settings.therapistName }));
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
        backupPassword(function (pw) { return S.exportBackup(pw).then(function (text) {
          S.audit('Downloaded backup');
          const blob = new Blob([text], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'tjs-backup-' + L.todayISO() + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }); });
        break;
      }
      case 'reset-demo':
        ask('Replace all current data with demo data?', 'Replace').then(function (ok) { if (ok) { S.resetDemo(); go('#/schedule'); render(); toast('Demo data loaded'); } });
        break;
      case 'clear-all':
        ask('Delete ALL patient data from this device? People and settings are kept.', 'Delete everything').then(function (ok) { if (ok) { S.clearAll(); S.audit('Deleted all patient data'); go('#/schedule'); render(); toast('All patient data deleted'); } });
        break;
      default:
        if (ACTIONS[act]) ACTIONS[act](el, ev);
    }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.dataset.action === 'pack') {
      S.setPacked(t.dataset.date, t.dataset.id, t.checked);
      document.querySelectorAll('[data-action=pack][data-id="' + t.dataset.id + '"]').forEach(function (c) { c.checked = t.checked; });
    }
    if (t.dataset.nav === 'reports-reminders' && t.value) { go('#/reports?tab=reminders&date=' + t.value); return; }
    if (t.dataset.nav && t.value) go('#/' + t.dataset.nav + '?date=' + t.value);
    if (t.closest('#patient-filters')) {
      const f = t.closest('#patient-filters');
      go('#/patients?age=' + encodeURIComponent(f.querySelector('[name=age]').value) + '&condition=' + encodeURIComponent(f.querySelector('[name=condition]').value));
    }
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
        let fmt = '';
        try { fmt = JSON.parse(text).format; } catch (e) { toast('That is not a TJS backup or key file.'); return; }
        const restore = function (pw) { return S.importBackup(text, pw).then(function (r) {
          if (r.keysAdded != null) {
            S.audit('Restored key file', null, r.keysAdded + ' keys');
            toast(r.keysAdded + ' keys restored' + (r.keysRefused ? '; ' + r.keysRefused + ' refused (erased patients)' : ''));
          } else {
            S.audit('Restored backup', null, r.restored + ' patients' + (r.shredded.length ? ', ' + r.shredded.length + ' unreadable' : ''));
            toast('Restored ' + r.restored + ' patients' + (r.shredded.length ? '. ' + r.shredded.length + ' could not be read (erased or key missing): ' + r.shredded.join(', ') : ''));
          }
          render();
        }); };
        if (fmt === 'tjs-backup') backupPassword(restore, true);
        else restore().catch(function (e) { toast('Could not restore: ' + e.message); });
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
      a.status = 'attended';
      S.save();
      toast('Session saved');
      go('#/session/' + a.id + '?tab=report');
    }
    if (SUBMITS[form.id]) {
      ev.preventDefault();
      SUBMITS[form.id](form, ev.submitter ? ev.submitter.value : '');
      return;
    }
    if (form.id === 'settings-form') {
      ev.preventDefault();
      const set = S.state.settings;
      set.hideNames = form.querySelector('[name=hideNames]').checked;
      set.autoLockMinutes = Number(form.querySelector('[name=autoLockMinutes]').value) || 10;
      const ae = form.querySelector('[name=autoErase]');
      if (ae) set.autoErase = ae.checked;
      if (!form.querySelector('[name=retentionYears]').disabled) set.retentionYears = Number(form.querySelector('[name=retentionYears]').value) || 0;
      S.state.settings.therapistName = form.querySelector('[name=therapistName]').value.trim();
      ['dayStart', 'lunchStart', 'lunchEnd', 'dayEnd'].forEach(function (k) {
        const v = form.querySelector('[name=' + k + ']').value;
        if (v) S.state.settings[k] = v;
      });
      S.save(); toast('Saved'); render();
    }
  });

  // Installable app: register the offline worker when served from a website (not from a file or an embedded preview).
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.self === window.top) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ }); });
  }

  window.addEventListener('hashchange', function () { if (location.hash.indexOf('#/') === 0 && location.hash !== route) go(location.hash); });

  /* Clinic server: colleagues' changes arrive while you work. Never redraw under an open form or a field being typed in. */
  S.setBusyCheck(function () {
    const a = document.activeElement;
    return modal.open || document.getElementById('confirm').open ||
      !!(a && view.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|date)$/.test(a.type))));
  });
  S.onSync(function (type, detail) {
    if (type === 'status') {
      const pill = document.getElementById('sync-pill');
      if (pill) pill.outerHTML = syncPill();
      else if (S.isServer() && !S.currentUser()) render();
    } else if (type === 'rejected') {
      toast('Not saved: ' + (detail[0] && detail[0].reason || 'refused by the server') + '. The latest records have been reloaded.');
    } else if (type === 'signedout') {
      if (modal.open) modal.close();
      render();
      toast('Signed out by the clinic server. Please sign in again.');
    } else render();
  });

  render();
  S.ready.then(function () { if (S.isServer()) { pendingNotice = !!S.currentUser(); render(); } });
})();

// SPDX-License-Identifier: AGPL-3.0-or-later
// TJS Pay: the therapist's screen.
(function () {
  'use strict';
  let S = null, M = null;
  const V = { tab: 'week', filter: 'all', patient: null, month: null, ask: '', plan: null, busy: false, results: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const gbp = (p) => (p < 0 ? '−' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m = (p) => `<span class="m">${gbp(p)}</span>`;
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const first = (name) => String(name || '').trim().split(/\s+/)[0];
  const PAID = ['PAID', 'MARKED_AS_PAID'];
  const outstanding = (i) => Math.max(0, i.total_pence - i.paid_pence);
  const isOpen = (i) => ['SENT', 'PARTIALLY_PAID'].includes(i.status) && outstanding(i) > 0;
  const isLate = (i) => isOpen(i) && i.due_date && i.due_date < S.today;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}${y !== +S.today.slice(0, 4) ? ' ' + y : ''}`; };
  const days = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
  function when(iso) {
    const d = days(iso, S.today);
    if (d <= 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7) return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long' });
    return day(iso);
  }
  const svc = (id) => S.services.find((s) => s.id === id);
  const pat = (id) => S.patients.find((p) => p.id === id);
  const billTo = (p) => p.payer.type === 'family' ? (p.caregivers.find((c) => c.invoices) || p.caregivers[0]) : { name: p.payer.name, relation: '' };
  const toName = (t) => t.org ? t.name : first(t.name);
  const how = (m) => ({ bank: 'by bank transfer', cash: 'in cash', cheque: 'by cheque', other: 'another way', paypal: 'through PayPal' })[m];
  const howShort = (m) => ({ bank: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other', paypal: 'PayPal' })[m];

  // ---------- talking to the server ----------
  async function api(path, body) {
    const headers = { 'content-type': 'application/json' };
    const pass = sessionStorage.getItem('tjs-pay-passcode');
    if (pass) headers['x-passcode'] = pass;
    const res = await fetch('/api/pay/' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { const p = window.prompt('TJS Pay passcode'); if (p) { sessionStorage.setItem('tjs-pay-passcode', p); return api(path, body); } }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'That didn’t work. Try again.');
    return data;
  }
  window.TJSPayAPI = window.TJSPayAPI || api;
  async function act(btn, path, body, done) {
    if (btn) btn.disabled = true;
    try {
      const d = await window.TJSPayAPI(path, body);
      if (d && d.patients) { S = d; if (!path.startsWith('expenses')) M = null; }
      if (d && d.paidIn !== undefined) M = d;
      if (done) await done(d);
      render();
      return d;
    } catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  let tt;
  function toast(text, err) { const t = $('toast'); t.textContent = text; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => { t.className = ''; }, err ? 6000 : 3000); }

  // ---------- what's going on with a patient ----------
  function look(p) {
    const ses = S.sessions.filter((s) => s.patient_id === p.id);
    const invs = S.invoices.filter((i) => i.patient_id === p.id);
    const toInvoice = ses.filter((s) => !s.invoice_id);
    const drafts = invs.filter((i) => i.status === 'DRAFT');
    const open = invs.filter(isOpen);
    const late = open.filter(isLate);
    const owed = open.reduce((t, i) => t + outstanding(i), 0);
    const reported = S.claims.filter((c) => c.patient_id === p.id && c.status === 'pending');
    return { ses, invs, toInvoice, drafts, open, late, owed, reported, paidUp: !toInvoice.length && !drafts.length && !open.length };
  }
  function tagsFor(p, L) {
    const t = [];
    if (L.toInvoice.length) t.push(`<span class="tag todo">${L.toInvoice.length} to invoice</span>`);
    if (L.drafts.length) t.push(`<span class="tag todo">Draft to check</span>`);
    if (L.reported.length) t.push(`<span class="tag todo">Says they’ve paid</span>`);
    if (L.late.length) t.push(`<span class="tag late">Overdue</span>`);
    else if (L.open.length) t.push(`<span class="tag">Waiting</span>`);
    if (L.paidUp) t.push(`<span class="tag paid">Paid up</span>`);
    return t.join('');
  }
  function planText(p) {
    const s = svc(p.service_id);
    if (p.plan === 'block') return `Block of ${S.settings.block_size}, ${m(S.blockPrices[p.id])}`;
    if (p.plan === 'monthly') return `Monthly, ${m(s.price_pence)} a session`;
    return `Per session, ${m(s.price_pence)}`;
  }
  function payerText(p) {
    if (p.payer.type !== 'family') return esc(p.payer.name);
    const c = billTo(p);
    return esc(c.name) + (c.relation ? ` <span class="muted">(${esc(c.relation.toLowerCase())})</span>` : '');
  }
  function blockInfo(p) {
    const blocks = S.invoices.filter((i) => i.patient_id === p.id && i.kind === 'block').sort((a, b) => a.created_at.localeCompare(b.created_at) || (parseInt(a.period.replace(/\D+/g, ''), 10) || 0) - (parseInt(b.period.replace(/\D+/g, ''), 10) || 0));
    const used = (b) => S.sessions.filter((s) => s.invoice_id === b.id).length;
    const cur = blocks.find((b) => used(b) < b.block_size) || blocks[blocks.length - 1];
    if (!cur) return '';
    const u = used(cur), at = Math.min(S.settings.renew_at, cur.block_size), next = blocks[blocks.indexOf(cur) + 1];
    const note = next ? (PAID.includes(next.status) ? 'Next block paid' : 'Next block invoiced') : `Next block invoiced at session ${at}`;
    return `<div class="bar" role="img" aria-label="${u} of ${cur.block_size} used">${Array.from({ length: cur.block_size }, (_, k) => `<i class="${k < u ? 'on' : ''}${k + 1 === at && !next ? ' mark' : ''}"></i>`).join('')}</div>
      <p class="block-note">${esc(cur.period)}: ${u} of ${cur.block_size} used. ${esc(note)}.</p>`;
  }

  // ---------- rendering ----------
  function render() {
    if (!S) return;
    $('practice').textContent = S.settings.practice;
    const needs = needsYou().length;
    document.querySelectorAll('.tab').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === V.tab));
      if (t.dataset.tab === 'week') t.innerHTML = 'Overview' + (needs ? `<span class="count">${needs}</span>` : '');
    });
    $('demo-note').textContent = S.mode === 'review' ? 'Review copy: made-up patients, PayPal simulated in your browser. The real app uses the PayPal sandbox.' : S.mode === 'mock' ? 'Test mode: PayPal is simulated. Made-up patients only.' : 'PayPal sandbox demo: made-up patients, no real money.';
    const view = $('view');
    if (V.tab === 'week') view.innerHTML = weekView();
    if (V.tab === 'patients') view.innerHTML = V.patient ? patientView(pat(V.patient)) : patientsView();
    if (V.tab === 'money') { view.innerHTML = M ? moneyView() : '<p class="muted">Adding it up…</p>'; if (!M) loadMoney(); }
    if (V.tab === 'settings') view.innerHTML = settingsView();
  }

  // ----- this week -----
  function needsYou() {
    const out = [];
    S.claims.filter((c) => c.status === 'pending').forEach((c) => {
      const p = pat(c.patient_id), i = S.invoices.find((x) => x.id === c.invoice_id);
      out.push({ html: `<p><b>${esc(p.known_as)}</b>: ${esc(toName(billTo(p)) )} says ${m(c.amount_pence)} was paid ${esc(how(c.method))}${i ? ` for ${esc(i.period)}` : ''}.</p><p class="muted">Check it has arrived${c.reference ? `, ref ${esc(c.reference)}` : ''}.</p>`,
        actions: `<button class="btn small" data-act="confirm" data-id="${esc(c.id)}">Received</button><button class="btn small line" data-act="reject" data-id="${esc(c.id)}">Not received</button>` });
    });
    S.invoices.filter((i) => i.status === 'DRAFT').forEach((i) => {
      const p = pat(i.patient_id);
      out.push({ html: `<p><b>${esc(p.known_as)}</b>: draft invoice, ${esc(i.kind === 'block' ? 'next block' : i.period)}, ${m(i.total_pence)}.</p><p class="muted">Not sent yet.</p>`, actions: `<button class="btn small" data-act="review" data-id="${esc(i.id)}">Review and send</button>` });
    });
    S.patients.forEach((p) => {
      const L = look(p);
      if (!L.toInvoice.length || L.drafts.length) return;
      out.push({ html: `<p><b>${esc(p.known_as)}</b>: ${count(L.toInvoice.length, 'session', 'sessions')} to invoice, ${m(L.toInvoice.reduce((t, s) => t + s.price_pence, 0))}.</p><p class="muted">${p.plan === 'monthly' ? 'Monthly statement' : 'Per session'} to ${esc(billTo(p).name)}.</p>`, actions: `<button class="btn small" data-act="draft" data-id="${esc(p.id)}">Create invoice</button>` });
    });
    return out;
  }
  function nextReminder(i) {
    const d = S.settings.reminder_days[i.reminder_count];
    if (d == null) return 'None left';
    const dt = new Date(Date.parse(i.sent_at) + d * 864e5).toISOString().slice(0, 10);
    return dt <= S.today ? 'Today' : day(dt);
  }
  function weekView() {
    const needs = needsYou();
    const open = S.invoices.filter(isOpen).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const ym = S.today.slice(0, 7);
    const monthIn = S.payments.filter((p) => p.date.slice(0, 7) === ym).reduce((t, p) => t + p.pence, 0);
    const owed = open.reduce((t, i) => t + outstanding(i), 0), late = open.filter(isLate).reduce((t, i) => t + outstanding(i), 0);
    return `<div class="page-h"><h1>Overview</h1><span class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
    ${assistantView()}
    <div class="two-col"><div>
      <section class="panel" aria-labelledby="h-todo"><div class="panel-h"><h2 id="h-todo">To do</h2><span class="muted">${needs.length}</span></div>
        ${needs.length ? `<ul class="rows">${needs.map((n) => `<li class="todo"><div>${n.html}</div><div class="actions">${n.actions}</div></li>`).join('')}</ul>` : '<p class="empty">Nothing to do.</p>'}</section>
      <section class="panel" aria-labelledby="h-unpaid"><div class="panel-h"><h2 id="h-unpaid">Unpaid invoices</h2><span class="muted">${m(owed)}</span></div>
        ${open.length ? `<div class="tbl"><table><thead><tr><th>Patient</th><th>Invoice</th><th class="num">Owed</th><th>Due</th><th>Reminders</th><th>Next</th><th></th></tr></thead><tbody>${open.map((i) => { const p = pat(i.patient_id); return `<tr>
          <td><button class="link" data-act="open-patient" data-id="${esc(p.id)}">${esc(p.known_as)}</button><div class="muted">${esc(i.to.name)}</div></td>
          <td>${esc(i.kind === 'block' ? i.period : i.period)}</td><td class="num">${m(outstanding(i))}</td>
          <td>${isLate(i) ? `<span class="tag late">${days(i.due_date, S.today)} days late</span>` : esc(day(i.due_date))}</td>
          <td>${i.reminder_count} of ${S.settings.reminder_days.length}</td><td>${esc(nextReminder(i))}${i.next_reminder ? ' <span class="tag todo">edited</span>' : ''}</td>
          <td class="num"><button class="btn small line" data-act="nudge" data-id="${esc(i.id)}">Reminder</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">No unpaid invoices.</p>'}</section>
      <section class="panel" aria-labelledby="h-act"><div class="panel-h"><h2 id="h-act">Recent activity</h2></div>
        <ul class="rows activity">${S.events.slice(0, 8).map((e) => `<li><span class="when">${esc(when(e.at))}</span><span>${esc(e.text)}</span></li>`).join('') || '<li>Nothing yet.</li>'}</ul></section>
    </div>
    <aside>
      <section class="panel" aria-labelledby="h-month"><div class="panel-h"><h2 id="h-month">This month</h2><button class="btn text" data-act="tab" data-id="money">Details</button></div>
        <ul class="stat-list"><li><span>Paid in</span><b class="m">${gbp(monthIn)}</b></li><li><span>Owed</span><b class="m">${gbp(owed)}</b></li><li class="${late ? 'late' : ''}"><span>Overdue</span><b class="m">${gbp(late)}</b></li></ul></section>
      <section class="panel record" aria-labelledby="pw-h"><div class="panel-h"><h2 id="pw-h">Record a payment</h2></div><div class="panel-b">
        <p class="muted">For money that came outside PayPal. Type it as you’d say it.</p>
        <label class="sr" for="pw">Payment</label>
        <textarea id="pw" maxlength="600" placeholder="Liam paid 135 cash"></textarea>
        <div class="actions" style="margin-top:8px"><button class="btn small" data-act="parse">Check</button></div>
        <div id="pw-out" aria-live="polite"></div></div></section>
      <section class="panel"><div class="panel-b"><p class="muted" style="font-size:.85rem">Reminders go out automatically each morning. To send any that are due right now:</p><div class="actions" style="margin-top:8px"><button class="btn small line" data-act="reminders">Send due reminders</button></div></div></section>
    </aside></div>`;
  }

  // ----- the billing assistant -----
  const EXAMPLES = ['Who owes me money? Chase anyone more than two weeks late.', 'Invoice everything that’s waiting.', 'Has anyone paid since yesterday?', 'How is this month going?'];
  function assistantView() {
    const P = V.plan;
    let out = '';
    if (V.busy) out = `<div class="asst-out"><p class="muted"><span class="spin" aria-hidden="true"></span> Looking at your invoices and checking PayPal…</p></div>`;
    else if (P) {
      const done = P.status === 'done' || V.results;
      const res = (n) => (V.results || []).find((r) => r.n === n);
      out = `<div class="asst-out">
        ${P.steps.length ? `<ul class="asst-steps">${P.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <p class="asst-text">${esc(P.text).replace(/\n+/g, '<br>')}</p>
        ${P.actions.length ? `<ol class="asst-actions">${P.actions.map((a) => { const r = res(a.n); return `<li>
          ${done ? `<span class="tag ${r ? (r.ok ? 'paid' : 'late') : ''}">${r ? (r.ok ? 'Done' : 'Not done') : 'Skipped'}</span>` : `<input type="checkbox" id="aa-${a.n}" data-n="${a.n}" checked>`}
          <label for="aa-${a.n}"><b>${a.n}.</b> ${esc(a.summary)}${a.reason ? `<span class="muted"> · ${esc(a.reason)}</span>` : ''}${r && !r.ok ? `<span class="muted"> · ${esc(r.text)}</span>` : ''}</label></li>`; }).join('')}</ol>
          ${done ? '' : `<div class="actions"><button class="btn small" data-act="approve">Approve selected</button><button class="btn small line" data-act="dismiss">Dismiss</button><span class="muted asst-note">Nothing is sent until you approve.</span></div>`}` : ''}
        ${!P.by_ai ? '<p class="muted asst-note">Answered with the built-in rules (AI not used).</p>' : ''}
      </div>`;
    }
    return `<section class="panel asst" aria-labelledby="h-asst"><div class="panel-h"><h2 id="h-asst">Billing assistant</h2><span class="muted asst-note">${S.ai ? 'AI plans, you approve' : 'Built-in rules'}</span></div><div class="panel-b">
      <form id="asst-f" class="asst-row"><label class="sr" for="asst-q">Ask the billing assistant</label>
        <input id="asst-q" maxlength="600" autocomplete="off" placeholder="${esc(EXAMPLES[0])}" value="${esc(V.ask)}">
        <button class="btn" type="submit"${V.busy ? ' disabled' : ''}>Ask</button></form>
      <div class="asst-ex">${EXAMPLES.map((e) => `<button class="filter" type="button" data-act="ask-ex" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      ${out}</div></section>`;
  }
  async function ask(q) {
    q = String(q || '').trim();
    if (!q) return toast('Type a question first.', true);
    V.ask = q; V.busy = true; V.plan = null; V.results = null; render();
    try { const d = await window.TJSPayAPI('assistant', { request: q }); V.plan = d.plan; S = await window.TJSPayAPI('state'); }
    catch (e) { toast(e.message, true); }
    finally { V.busy = false; render(); }
  }
  async function approve(btn) {
    const numbers = [...document.querySelectorAll('.asst-actions input[type=checkbox]:checked')].map((c) => Number(c.dataset.n));
    if (!numbers.length) return toast('Tick at least one action, or press Dismiss.', true);
    await act(btn, 'assistant/approve', { plan_id: V.plan.id, numbers }, (d) => {
      V.results = d.results; V.plan.status = 'done';
      const ok = d.results.filter((r) => r.ok).length;
      toast(ok === d.results.length ? `${count(ok, 'action', 'actions')} done.` : `${ok} of ${d.results.length} done. See the notes.`, ok !== d.results.length);
    });
  }

  // ----- patients -----
  function patientsView() {
    const all = S.patients.map((p) => ({ p, L: look(p) }));
    const groups = {
      all: ['All', () => true],
      invoice: ['To invoice', ({ L }) => L.toInvoice.length || L.drafts.length],
      waiting: ['Waiting for payment', ({ L }) => L.open.length && !L.late.length],
      late: ['Overdue', ({ L }) => L.late.length],
      paid: ['Paid up', ({ L }) => L.paidUp],
    };
    const shown = all.filter(groups[V.filter][1]).sort((a, b) => a.p.name.localeCompare(b.p.name));
    return `<div class="page-h"><h1>Patients</h1><button class="btn" data-act="add-patient">Add patient</button></div>
    <div class="filters" role="group" aria-label="Show">${Object.entries(groups).map(([k, [label, fn]]) => `<button class="filter" aria-pressed="${V.filter === k}" data-act="filter" data-id="${k}">${label}<b>${all.filter(fn).length}</b></button>`).join('')}</div>
    <div class="panel">${shown.length ? `<div class="tbl"><table class="plist"><thead><tr><th>Patient</th><th>Invoices go to</th><th>Billing</th><th>Status</th><th class="num">Owed</th></tr></thead><tbody>${shown.map(({ p, L }) => `<tr data-act="open-patient" data-id="${esc(p.id)}">
        <td><button class="link" data-act="open-patient" data-id="${esc(p.id)}">${esc(p.name)}</button>${p.known_as !== first(p.name) ? `<div class="muted">Known as ${esc(p.known_as)}</div>` : ''}</td>
        <td>${payerText(p)}</td>
        <td>${planText(p)}${p.plan === 'block' ? blockInfo(p) : ''}</td>
        <td><div class="tags">${tagsFor(p, L)}</div></td>
        <td class="num">${L.owed ? m(L.owed) : '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No patients in this list.</p>'}</div>`;
  }

  function invoiceLine(i) {
    const p = pat(i.patient_id);
    let tag = '<span class="tag">Waiting</span>';
    if (i.status === 'DRAFT') tag = '<span class="tag todo">Draft</span>';
    else if (i.kind === 'block' && PAID.includes(i.status)) { const u = S.sessions.filter((s) => s.invoice_id === i.id).length; tag = `<span class="tag paid">Paid, ${u} of ${i.block_size} used</span>`; }
    else if (i.status === 'PAID') tag = '<span class="tag paid">Paid through PayPal</span>';
    else if (i.status === 'MARKED_AS_PAID') tag = '<span class="tag paid">Paid, recorded in PayPal</span>';
    else if (i.status === 'PARTIALLY_PAID') tag = `<span class="tag">${m(i.paid_pence)} of ${m(i.total_pence)} paid</span>`;
    else if (isLate(i)) tag = '<span class="tag late">Overdue</span>';
    const sub = i.status === 'DRAFT' ? 'Not sent yet' : `Sent to ${toName(i.to)} ${day(i.sent_at)}${isOpen(i) && i.reminder_count ? `, ${count(i.reminder_count, 'reminder', 'reminders')} since` : ''}${i.paid_at ? `, paid ${day(i.paid_at)}` : ''}`;
    const a = [];
    if (i.status === 'DRAFT') a.push(`<button class="btn small" data-act="review" data-id="${esc(i.id)}">Review and send</button>`);
    if (isOpen(i)) a.push(`<button class="btn small line" data-act="family" data-id="${esc(i.id)}">What ${esc(i.to.org ? 'they' : toName(i.to))} see${i.to.org ? '' : 's'}</button>`);
    if (isOpen(i)) a.push(`<button class="btn small line" data-act="nudge" data-id="${esc(i.id)}">Reminder</button>`);
    if (isOpen(i) && i.view_url) a.push(`<a class="btn small line" href="${esc(i.view_url)}" target="_blank" rel="noopener">Open in PayPal</a>`);
    if (isOpen(i) && (S.mode === 'sandbox' || S.mode === 'live')) a.push(`<button class="btn small line" data-act="refresh" data-id="${esc(i.id)}">Check PayPal</button>`);
    if (isOpen(i) && S.mode !== 'sandbox' && S.mode !== 'live') a.push(`<button class="btn small line" data-act="mock-pay" data-id="${esc(i.id)}">Simulate PayPal payment</button>`);
    return `<div class="invrow"><div><p class="line1"><b>${esc(i.kind === 'block' ? i.period + ' (' + i.block_size + ' sessions)' : i.period)}</b><span class="m">${gbp(i.total_pence)}</span>${tag}</p><p class="muted">${esc(sub)}</p></div><div class="actions">${a.join('')}</div></div>`;
  }

  function patientView(p) {
    const L = look(p);
    const pays = S.payments.filter((x) => x.patient_id === p.id).sort((a, b) => b.date.localeCompare(a.date));
    const invById = Object.fromEntries(S.invoices.map((i) => [i.id, i]));
    const sesStatus = (s) => { if (!s.invoice_id) return '<span class="tag todo">To invoice</span>'; const i = invById[s.invoice_id]; if (PAID.includes(i.status)) return '<span class="tag paid">Paid</span>'; if (i.status === 'DRAFT') return '<span class="tag todo">Draft</span>'; return isLate(i) ? '<span class="tag late">Overdue</span>' : '<span class="tag">Invoiced</span>'; };
    const paidTotal = pays.reduce((t, x) => t + x.pence, 0);
    const sessions = L.ses.slice().sort((a, b) => b.date.localeCompare(a.date));
    const invs = L.invs.slice().sort((a, b) => (b.sent_at || b.created_at).localeCompare(a.sent_at || a.created_at));
    return `<button class="btn text back" data-act="all-patients">‹ Patients</button>
    <div class="p-head"><div><h1>${esc(p.name)}</h1>${p.known_as !== p.name ? `<p class="muted">Known as ${esc(p.known_as)}</p>` : ''}<div class="tags">${tagsFor(p, L)}</div></div>
      <div class="figs"><div class="fig"><span>Paid</span><b class="m">${gbp(paidTotal)}</b></div><div class="fig ${L.late.length ? 'late' : ''}"><span>Owed</span><b class="m">${gbp(L.owed)}</b></div>${p.credit_pence ? `<div class="fig"><span>Credit</span><b class="m">${gbp(p.credit_pence)}</b></div>` : ''}</div></div>
    <div class="p-grid">
      <section class="panel"><div class="panel-h"><h2>Details</h2></div><dl class="facts">
        <dt>Caregivers</dt><dd>${p.caregivers.map((c) => `<div class="person">${esc(c.name)}${c.invoices && p.payer.type === 'family' ? '<span class="gets">receives invoices</span>' : ''}<div class="muted">${esc([c.relation, c.email].filter(Boolean).join(', '))}</div></div>`).join('')}</dd>
        <dt>Paid by</dt><dd>${p.payer.type === 'family' ? 'Family' : `${esc(p.payer.name)}<div class="muted">${esc(p.payer.email || '')}</div>`}</dd>
        <dt>Billing</dt><dd>${planText(p)}${p.plan === 'block' ? blockInfo(p) : ''}</dd></dl></section>
      <div>
        <section class="panel"><div class="panel-h"><h2>Log a session</h2>${L.toInvoice.length && !L.drafts.length && p.plan !== 'block' ? `<button class="btn small" data-act="draft" data-id="${esc(p.id)}">Invoice ${count(L.toInvoice.length, 'session', 'sessions')}</button>` : ''}</div>
          <div class="logform">
            <label>Date<input type="date" id="ls-date" value="${esc(S.today)}" max="${esc(S.today)}"></label>
            <label>Service<select id="ls-svc">${S.services.map((s) => `<option value="${esc(s.id)}"${s.id === p.service_id ? ' selected' : ''}>${esc(s.name)}${s.minutes ? `, ${s.minutes} min` : ''} (${esc(gbp(s.price_pence))})</option>`).join('')}</select></label>
            <label>Where<select id="ls-where"><option>in person</option><option>online</option><option>at school</option><option>at home</option></select></label>
            <button class="btn" data-act="log" data-id="${esc(p.id)}">Log</button>
          </div></section>
        <section class="panel"><div class="panel-h"><h2>Invoices</h2></div>${invs.length ? `<ul class="rows">${invs.map((i) => `<li>${invoiceLine(i)}</li>`).join('')}</ul>` : '<p class="empty">No invoices yet.</p>'}</section>
        <section class="panel"><div class="panel-h"><h2>Payments</h2></div>${pays.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Method</th><th>For</th><th class="num">Amount</th></tr></thead><tbody>${pays.map((x) => `<tr><td>${esc(day(x.date))}</td><td>${esc(howShort(x.method))}${x.reference ? `<div class="muted">Ref ${esc(x.reference)}</div>` : ''}</td><td>${esc(invById[x.invoice_id] ? invById[x.invoice_id].period : '')}</td><td class="num">${m(x.pence)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No payments yet.</p>'}</section>
        <section class="panel"><div class="panel-h"><h2>Sessions</h2><span class="muted">${sessions.length}</span></div>${sessions.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Service</th><th>Where</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>${sessions.map((s) => `<tr><td>${esc(day(s.date))}</td><td>${esc(svc(s.service_id).name)}</td><td>${esc(s.minutes ? s.where : '')}</td><td class="num">${m(s.price_pence)}</td><td>${sesStatus(s)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No sessions yet.</p>'}</section>
      </div>
    </div>`;
  }

  // ----- money -----
  const PIE = ['#1e3a6b', '#4f7cc4', '#8fb0ea', '#2f8a6b', '#e0a43a', '#b0657a', '#7a8597'];
  function pie(list) {
    const total = list.reduce((t, x) => t + x.pence, 0);
    if (!total) return '';
    let a0 = -Math.PI / 2;
    const r = 80, c = 85;
    const paths = list.map((x, k) => {
      const frac = x.pence / total, a1 = a0 + frac * 2 * Math.PI;
      const d = frac >= 0.9999 ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z` : `M ${c} ${c} L ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${PIE[k % PIE.length]}" stroke="var(--surface)" stroke-width="2"><title>${esc(x.name)}: ${esc(gbp(x.pence))}</title></path>`;
    }).join('');
    return `<div class="pie-wrap"><svg class="pie" viewBox="0 0 170 170" role="img" aria-label="Work by service">${paths}</svg>
      <ul class="legend">${list.map((x, k) => `<li><span class="sw" style="background:${PIE[k % PIE.length]}"></span><span>${esc(x.name)} <span class="muted">(${x.count})</span></span><span class="v">${m(x.pence)}<small>${Math.round(x.pence / total * 100)}%</small></span></li>`).join('')}</ul></div>`;
  }
  function moneyView() {
    const mo = M, thisMonth = S.today.slice(0, 7);
    const mini = (arr) => arr.length ? `<ul class="mini">${arr.map((x) => `<li><span>${esc(x.name)}</span><span class="m">${gbp(x.pence)}</span></li>`).join('')}</ul>` : '<p class="empty">Nothing paid in.</p>';
    return `<div class="page-h"><h1>Finances: ${esc(mo.label)}</h1>
      <div class="month-nav"><button class="btn small line" data-act="month" data-id="-1" aria-label="Previous month">‹ Previous</button><button class="btn small line" data-act="month" data-id="1"${mo.month >= thisMonth ? ' disabled' : ''}>Next ›</button></div></div>
    <div class="money-grid"><div>
      <section class="panel"><div class="panel-h"><h2>Profit</h2><button class="btn small line" data-act="csv">Export CSV</button></div>
        <table class="pl"><tbody>
          <tr><td>Paid in <span class="muted">(${count(mo.payments, 'payment', 'payments')})</span></td><td class="num">${m(mo.paidIn)}</td></tr>
          <tr><td>PayPal fees <span class="muted">(estimated)</span></td><td class="num">${m(-mo.fees)}</td></tr>
          <tr><td>Expenses</td><td class="num">${m(-mo.spent)}</td></tr>
          <tr class="total"><td>Profit</td><td class="num">${m(mo.profit)}</td></tr>
        </tbody></table>
        <p class="note">Cash received in the month, less estimated fees (${S.settings.fee_percent}% + ${esc(gbp(S.settings.fee_fixed_pence))} per PayPal payment) and expenses. A guide only, not tax advice.${mo.month === thisMonth ? ' This month is still in progress.' : ''}</p></section>
      <section class="panel"><div class="panel-h"><h2>Expenses</h2><span class="muted">${m(mo.spent)}</span></div>
        ${mo.expenses.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Item</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>${mo.expenses.map((e) => `<tr><td>${esc(day(e.date))}</td><td>${esc(e.what)}</td><td>${esc(e.category)}</td><td class="num">${m(e.pence)}</td><td class="num"><button class="del" data-act="del-exp" data-id="${esc(e.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No expenses this month.</p>'}
        <div class="xform">
          <label>Date<input type="date" id="ex-date" value="${esc(mo.month === thisMonth ? S.today : mo.month + '-01')}"></label>
          <label>Item<input id="ex-what" maxlength="80" placeholder="Room hire"></label>
          <label>Category<select id="ex-cat"><option>Rent</option><option>Materials</option><option>Travel</option><option>Professional</option><option>Software</option><option>Other</option></select></label>
          <label>Amount (£)<input id="ex-amt" inputmode="decimal"></label>
          <button class="btn" data-act="add-exp">Add</button>
        </div></section>
    </div><div>
      <section class="panel"><div class="panel-h"><h2>Work done</h2><span class="muted">${count(mo.sessionCount, 'session', 'sessions')}, ${mo.hours} h</span></div>
        ${mo.byService.length ? pie(mo.byService) : '<p class="empty">No sessions logged.</p>'}</section>
      <section class="panel"><div class="panel-h"><h2>Paid by</h2></div>${mini(mo.byPayer)}</section>
      <section class="panel"><div class="panel-h"><h2>Payment method</h2></div>${mini(mo.byMethod)}</section>
    </div></div>`;
  }
  async function loadMoney() { M = await window.TJSPayAPI('money', { month: V.month }); render(); }
  function csv() {
    const rows = [['Type', 'Date', 'Patient or item', 'Method or category', 'Reference', 'Amount (GBP)']];
    S.payments.filter((p) => p.date.slice(0, 7) === V.month).forEach((p) => rows.push(['Payment in', p.date, pat(p.patient_id).name, howShort(p.method), p.reference || '', (p.pence / 100).toFixed(2)]));
    M.expenses.forEach((e) => rows.push(['Expense', e.date, e.what, e.category, '', (-e.pence / 100).toFixed(2)]));
    rows.push(['PayPal fees (estimate)', '', '', '', '', (-M.fees / 100).toFixed(2)]);
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' }));
    a.download = `tjs-pay-${V.month}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  // ----- settings -----
  function settingsView() {
    const s = S.settings;
    const texts = s.reminder_days.map((d, k) => s.reminder_texts[Math.min(k, s.reminder_texts.length - 1)]);
    return `<div class="page-h"><h1>Settings</h1><div class="actions"><button class="btn" data-act="save-settings">Save</button></div></div>
    <div class="settings-grid">
      <section class="panel"><div class="panel-h"><h2>Practice</h2></div><div class="form">
        <label>Practice name<input id="st-practice" value="${esc(s.practice)}" maxlength="80"></label>
        <label>Your name<input id="st-therapist" value="${esc(s.therapist)}" maxlength="40"></label></div></section>
      <section class="panel"><div class="panel-h"><h2>Services and prices</h2></div><div class="form">
        ${S.services.map((v) => `<div class="svc-row" data-svc="${esc(v.id)}"><input aria-label="Name" value="${esc(v.name)}"><input aria-label="Minutes" value="${v.minutes ? v.minutes + ' min' : '–'}" disabled><input aria-label="Price in pounds" value="${(v.price_pence / 100).toFixed(2)}" inputmode="decimal"></div>`).join('')}
        <p class="muted">New prices apply to sessions logged from now on.</p></div></section>
      <section class="panel"><div class="panel-h"><h2>Blocks</h2></div><div class="form">
        <label>Sessions per block<input id="st-block" value="${s.block_size}" inputmode="numeric"></label>
        <label>Discount (%)<input id="st-disc" value="${s.block_discount}" inputmode="numeric"></label>
        <label>Invoice the next block at session<input id="st-renew" value="${s.renew_at}" inputmode="numeric"></label>
        <label>Then<select id="st-action"><option value="send"${s.renew_action === 'send' ? ' selected' : ''}>Send it automatically</option><option value="draft"${s.renew_action === 'draft' ? ' selected' : ''}>Save as a draft for me to review</option></select></label></div></section>
      <section class="panel"><div class="panel-h"><h2>PayPal fees</h2></div><div class="form">
        <label>Percentage per payment<input id="st-fee" value="${s.fee_percent}" inputmode="decimal"></label>
        <label>Fixed fee per payment (£)<input id="st-fixed" value="${(s.fee_fixed_pence / 100).toFixed(2)}" inputmode="decimal"></label>
        <p class="muted">Used for the profit estimate only. Check your PayPal account for your rate.</p></div></section>
      <section class="panel" style="grid-column: 1 / -1"><div class="panel-h"><h2>Reminders</h2></div><div class="form">
        <label>Send reminders this many days after the invoice<input id="st-days" value="${esc(s.reminder_days.join(', '))}"></label>
        ${texts.map((t, k) => `<label>Reminder ${k + 1} <span class="muted">(day ${s.reminder_days[k]})</span><textarea data-reminder="${k}" maxlength="1200">${esc(t)}</textarea></label>`).join('')}
        <p class="muted chips">These fill in automatically: <code>{name}</code> the person paying, <code>{child}</code>, <code>{amount}</code>, <code>{period}</code>, <code>{practice}</code>. A “tell us you paid another way” link is added at the end. You can also change the next reminder for one invoice from Overview.</p></div></section>
    </div>
    <div class="actions" style="margin-top:16px"><button class="btn" data-act="save-settings">Save</button><button class="btn warn" data-act="seed">Reset demo data</button></div>`;
  }

  // ---------- dialogs ----------
  const dlg = () => $('dlg');
  function openDraft(id) {
    const i = S.invoices.find((x) => x.id === id), p = pat(i.patient_id);
    dlg().innerHTML = `<form class="dlg" method="dialog"><div class="head"><h2>Invoice: ${esc(p.known_as)}, ${esc(i.kind === 'block' ? 'next block' : i.period)}</h2><button class="btn text" value="close">Close</button></div>
      <p class="to">To ${esc(i.to.name)}${i.to.email ? ', ' + esc(i.to.email) : ''}</p>
      <ul class="items">${i.items.map((it) => `<li><span>${esc(it.name)}</span><span>${m(it.pence)}</span></li>`).join('')}<li class="sum"><span>Total</span><span>${m(i.total_pence)}</span></li></ul>
      <label>Email subject<input id="d-subject" maxlength="100" value="${esc(i.subject)}"></label>
      <label>Message<textarea id="d-note" rows="4" maxlength="1500">${esc(i.note)}</textarea></label>
      <p class="hint">Written from billing details only. Edit as needed.</p>
      <div class="actions"><button class="btn" id="d-send" type="button">Send through PayPal</button><button class="btn line" id="d-discard" type="button">Delete draft</button></div></form>`;
    dlg().showModal();
    $('d-send').onclick = (e) => act(e.currentTarget, `invoices/${id}/send`, { subject: $('d-subject').value, note: $('d-note').value }, () => { dlg().close(); toast(`Sent to ${toName(i.to)}.`); });
    $('d-discard').onclick = (e) => act(e.currentTarget, `invoices/${id}/discard`, {}, () => { dlg().close(); toast('Draft deleted.'); });
  }
  async function openNudge(id) {
    const i = S.invoices.find((x) => x.id === id), p = pat(i.patient_id);
    const r = await window.TJSPayAPI(`invoices/${id}/reminder-text`, {});
    const left = r.number <= S.settings.reminder_days.length;
    dlg().innerHTML = `<form class="dlg" method="dialog"><div class="head"><h2>Reminder ${r.number}: ${esc(p.known_as)}, ${esc(i.period)}</h2><button class="btn text" value="close">Close</button></div>
      <p class="to">To ${esc(i.to.name)}. ${left ? `Goes out automatically: ${esc(nextReminder(i))}.` : 'All automatic reminders have been sent.'}</p>
      <label>Message<textarea id="n-text" rows="6" maxlength="1200">${esc(r.custom ? r.text : r.filled)}</textarea></label>
      ${S.mode !== 'review' ? '<div class="actions" style="margin-top:8px"><span class="muted" style="font-size:.82rem">Rewrite with AI:</span><button class="btn small line" type="button" data-rw="warmer">Warmer</button><button class="btn small line" type="button" data-rw="shorter">Shorter</button><button class="btn small line" type="button" data-rw="firmer">Firmer</button></div>' : ''}
      <p class="hint">Changes apply to this invoice’s next reminder only. To change the wording for everyone, go to Settings.</p>
      <div class="actions"><button class="btn" id="n-now" type="button">Send now</button>${left ? '<button class="btn line" id="n-save" type="button">Save for the automatic reminder</button>' : ''}</div></form>`;
    dlg().showModal();
    dlg().querySelectorAll('[data-rw]').forEach((btn) => { btn.onclick = async () => {
      btn.disabled = true;
      try { const r = await window.TJSPayAPI(`invoices/${id}/reminder-rewrite`, { text: $('n-text').value, style: btn.dataset.rw }); $('n-text').value = r.text; }
      catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    }; });
    $('n-now').onclick = (e) => act(e.currentTarget, `invoices/${id}/reminder-now`, { text: $('n-text').value }, () => { dlg().close(); toast('Reminder sent.'); });
    if ($('n-save')) $('n-save').onclick = (e) => act(e.currentTarget, `invoices/${id}/reminder-save`, { text: $('n-text').value }, () => { dlg().close(); toast('Saved.'); });
  }
  async function openFamily(id) {
    if (!window.ReviewBackend) {
      try { const r = await window.TJSPayAPI(`invoices/${id}/family-link`, {}); if (r.url) window.open(r.url, '_blank', 'noopener'); } catch (e) { toast(e.message, true); }
      return;
    }
    const d = window.ReviewBackend.family(id);
    if (!d) return;
    const body = d.paid ? `<h2>All settled</h2><p>${esc(d.child)}’s invoice for ${esc(d.period)} is paid. Thank you.</p>`
      : d.reported ? `<h2>Thanks, ${esc(d.to)}</h2><p>You’ve already told us. ${esc(d.practice)} will check and confirm.</p>`
      : `<h2>Paid another way?</h2><p>Tell ${esc(d.practice)} and they’ll mark ${esc(d.child)}’s invoice for <b>${esc(d.period)}</b> (${esc(d.outstanding)}) as paid once they’ve checked.</p>
        <fieldset><legend>How did you pay?</legend>${[['bank', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['other', 'Something else']].map(([v, l], k) => `<label class="choice"><input type="radio" name="fm" value="${v}"${k ? '' : ' checked'}> ${l}</label>`).join('')}</fieldset>
        <label>How much<input id="f-amt" inputmode="decimal" value="${esc(d.outstanding.replace('£', ''))}"></label>
        <label>Reference, if you used one<input id="f-ref" maxlength="80"></label>
        <button class="btn" id="f-send" type="button">Let them know</button>`;
    dlg().innerHTML = `<div class="dlg"><div class="head"><p class="muted">Family view (what ${esc(d.to)} sees)</p><button class="btn text" id="f-close" type="button">Close</button></div>
      ${d.reminder ? `<div class="mail"><b>Latest reminder</b>${esc(d.reminder)}<br><u>Tell us you’ve paid</u></div>` : ''}
      <div class="phone">${body}</div></div>`;
    dlg().showModal();
    $('f-close').onclick = () => dlg().close();
    if ($('f-send')) $('f-send').onclick = () => { window.ReviewBackend.familyClaim(id, { method: dlg().querySelector('input[name=fm]:checked').value, amount: $('f-amt').value, reference: $('f-ref').value }); dlg().close(); act(null, 'state', undefined, () => toast('Payment reported. It’s in To do.')); };
  }
  function openAddPatient() {
    dlg().innerHTML = `<form class="dlg" method="dialog"><div class="head"><h2>Add patient</h2><button class="btn text" value="close">Close</button></div>
      <label>Full name<input id="a-name" maxlength="80" placeholder="e.g. Tomás Silva Pereira"></label>
      <label>Known as<input id="a-known" maxlength="40" placeholder="e.g. Tomás"></label>
      <div class="two"><label>Caregiver’s name<input id="a-cg" maxlength="80"></label><label>Relationship<input id="a-rel" maxlength="40" placeholder="Mum, grandad, foster carer…"></label></div>
      <label>Caregiver’s email<input id="a-email" type="email" maxlength="120"></label>
      <label>Paid by<select id="a-payer"><option value="family">The family</option><option value="school">A school</option><option value="council">A local authority</option><option value="charity">A charity or other funder</option></select></label>
      <div class="two" id="a-org" hidden><label>Organisation<input id="a-orgname" maxlength="80"></label><label>Their invoice email<input id="a-orgemail" type="email" maxlength="120"></label></div>
      <div class="two"><label>Billing<select id="a-plan"><option value="session">After each session</option><option value="monthly">Monthly statement</option><option value="block">Pay ahead in blocks</option></select></label>
      <label>Usual service<select id="a-svc">${S.services.filter((s) => s.minutes).map((s) => `<option value="${esc(s.id)}"${s.id === 'svc_45' ? ' selected' : ''}>${esc(s.name)} (${m(s.price_pence)})</option>`).join('')}</select></label></div>
      <div class="actions"><button class="btn" id="a-save" type="button">Add patient</button></div></form>`;
    dlg().showModal();
    $('a-payer').onchange = (e) => { $('a-org').hidden = e.target.value === 'family'; };
    $('a-save').onclick = (e) => act(e.currentTarget, 'patients/add', { name: $('a-name').value.trim(), known_as: $('a-known').value.trim(), caregiver_name: $('a-cg').value.trim(), relation: $('a-rel').value.trim(), email: $('a-email').value.trim(), payer_type: $('a-payer').value, payer_name: $('a-orgname').value.trim(), payer_email: $('a-orgemail').value.trim(), plan: $('a-plan').value, service_id: $('a-svc').value },
      (d) => { dlg().close(); V.tab = 'patients'; V.patient = d.added; toast('Patient added.'); });
  }

  // ---------- plain words ----------
  async function parse(btn) {
    const text = $('pw').value.trim();
    if (!text) return toast('Type the payment first.', true);
    btn.disabled = true;
    try {
      const r = await window.TJSPayAPI('claims/parse', { text });
      const out = $('pw-out');
      if (r.unclear) { out.innerHTML = `<div class="understood">${esc(r.unclear)}</div>`; return; }
      const methods = [['cash', 'Cash'], ['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']];
      out.innerHTML = `<div class="understood"><p><b>${esc(r.who)}</b>: ${m(r.pence)}${r.assumed ? ' <span class="muted">(the amount owed)</span>' : ''}${r.reference ? `, ref ${esc(r.reference)}` : ''}</p>
        <label class="sr" for="pw-m">Method</label><select id="pw-m">${methods.map(([v, l]) => `<option value="${v}"${v === r.method ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${r.lines.length ? `<ul>${r.lines.map((l) => `<li>${m(l.pence)} to ${esc(l.period)}</li>`).join('')}</ul>` : ''}${r.credit ? `<p>${m(r.credit)} kept as credit.</p>` : ''}
        <div class="actions"><button class="btn small" id="pw-ok">Record in PayPal</button><button class="btn small line" id="pw-no">Cancel</button></div></div>`;
      $('pw-no').onclick = () => { out.innerHTML = ''; };
      $('pw-ok').onclick = (e) => act(e.currentTarget, 'claims/record', { patient_id: r.patient_id, pence: r.pence, method: $('pw-m').value, reference: r.reference }, () => { toast('Recorded in PayPal.'); });
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
  }

  // ---------- wiring ----------
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'tab': V.tab = id || b.dataset.tab; V.patient = null; render(); window.scrollTo(0, 0); break;
      case 'filter': V.filter = id; render(); break;
      case 'open-patient': ev.stopPropagation(); V.tab = 'patients'; V.patient = id; render(); window.scrollTo(0, 0); break;
      case 'all-patients': V.patient = null; render(); break;
      case 'draft': act(b, 'invoices/draft', { patient_id: id }, (d) => openDraft(d.draft)); break;
      case 'review': openDraft(id); break;
      case 'family': openFamily(id); break;
      case 'nudge': openNudge(id); break;
      case 'refresh': act(b, `invoices/${id}/refresh`, {}, () => toast('Checked with PayPal.')); break;
      case 'mock-pay': act(b, `invoices/${id}/mock-pay`, {}, () => toast('Payment received through PayPal.')); break;
      case 'confirm': act(b, `claims/${id}/confirm`, {}, () => toast('Recorded in PayPal.')); break;
      case 'reject': act(b, `claims/${id}/reject`, {}, () => toast('Marked as not received.')); break;
      case 'reminders': act(b, 'reminders', {}, (d) => toast(d.sent ? `${count(d.sent, 'reminder', 'reminders')} sent.` : 'No reminders due.')); break;
      case 'parse': parse(b); break;
      case 'ask-ex': ask(b.dataset.q); break;
      case 'approve': approve(b); break;
      case 'dismiss': V.plan = null; V.results = null; render(); break;
      case 'log': act(b, 'sessions', { patient_id: id, date: $('ls-date').value, service_id: $('ls-svc').value, where: $('ls-where').value }, () => toast('Logged.')); break;
      case 'add-patient': openAddPatient(); break;
      case 'month': { const [y, m] = V.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(id), 1)); V.month = d.toISOString().slice(0, 7); M = null; render(); break; }
      case 'add-exp': act(b, 'expenses', { month: V.month, date: $('ex-date').value, what: $('ex-what').value.trim(), category: $('ex-cat').value, amount: $('ex-amt').value }, () => toast('Added.')); break;
      case 'del-exp': act(b, 'expenses/delete', { id, month: V.month }); break;
      case 'csv': csv(); break;
      case 'save-settings': act(b, 'settings', {
        practice: $('st-practice').value, therapist: $('st-therapist').value, block_size: $('st-block').value, block_discount: $('st-disc').value, renew_at: $('st-renew').value, renew_action: $('st-action').value,
        reminder_days: $('st-days').value, reminder_texts: [...document.querySelectorAll('[data-reminder]')].map((t) => t.value), fee_percent: $('st-fee').value, fee_fixed: $('st-fixed').value,
        services: [...document.querySelectorAll('[data-svc]')].map((r) => ({ id: r.dataset.svc, name: r.children[0].value, price: r.children[2].value })),
      }, () => { M = null; toast('Saved.'); }); break;
      case 'seed': if (window.confirm('Reset the demo data?')) act(b, 'seed', {}, () => { M = null; V.patient = null; V.tab = 'week'; toast('Demo data reset.'); }); break;
    }
  });

  document.addEventListener('submit', (ev) => { if (ev.target.id === 'asst-f') { ev.preventDefault(); ask($('asst-q').value); } });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'asst-q') V.ask = ev.target.value; });

  (async function start() {
    try { S = await window.TJSPayAPI('state'); V.month = S.today.slice(0, 7); render(); }
    catch (e) { $('view').innerHTML = `<p>TJS Pay couldn’t load: ${esc(e.message)}</p>`; }
  })();
})();

// SPDX-License-Identifier: AGPL-3.0-or-later
// TJS Pay: the therapist's screen.
(function () {
  'use strict';
  let S = null, M = null, DEP = null;
  // Who is using the screen (a demo switch; in real use each person signs in):
  // the billing office (invoices, applying payments, what is owed), the finance department (budgets and
  // money requests), or a department's staff.
  let role = 'billing';
  try { role = localStorage.getItem('tjs-pay-role') || 'billing'; } catch { /* private window */ }
  if (role === 'admin') role = 'billing';
  const TABS = { billing: ['week', 'appts', 'patients', 'ins', 'settings'], finance: ['depts', 'money'], dept: ['dept'] };
  const team = () => (role === 'billing' || role === 'finance' ? role : 'dept');
  const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 7); };
  const V = { dmonth: null, tab: 'week', filter: 'all', patient: null, month: null, ask: '', plan: null, busy: false, results: null };
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
  // A draft for an insured patient can be split: the family pays the excess, the rest is claimed.
  const canSplit = (i) => { const p = pat(i.patient_id); return !!(p && p.insurance && i.status === 'DRAFT' && !i.paid_pence && i.kind !== 'claim' && !i.claim_id && i.total_pence > p.insurance.excess_pence); };
  const insName = (p) => ((S.insurers || []).find((x) => x.id === p.insurance.insurer_id) || {}).name || 'their insurer';
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
      if (d && d.patients) { S = d; if (!path.startsWith('expenses')) M = null; DEP = d.budgets || null; }
      if (d && d.fy && d.totals) DEP = d;
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
    const open = invs.filter((i) => isOpen(i) && i.kind !== 'claim');
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
    if (team() === 'dept' && !dep(role)) role = 'billing';
    const tabs = TABS[team()];
    if (!tabs.includes(V.tab)) V.tab = tabs[0];
    $('role').innerHTML = `<option value="billing">Billing office</option><option value="finance">Finance department</option><optgroup label="Department staff">${S.departments.map((d) => `<option value="${esc(d.id)}">${esc(d.code)} ${esc(d.name)}</option>`).join('')}</optgroup>`;
    $('role').value = role;
    const needs = needsYou().length, asks = (S.requests || []).filter((r) => r.status === 'pending').length;
    document.querySelectorAll('.tab').forEach((t) => {
      t.hidden = !tabs.includes(t.dataset.tab);
      t.setAttribute('aria-selected', String(t.dataset.tab === V.tab));
      if (t.dataset.tab === 'week') t.innerHTML = 'Overview' + (needs ? `<span class="count">${needs}</span>` : '');
      if (t.dataset.tab === 'depts') t.innerHTML = 'Budgets and requests' + (asks ? `<span class="count">${asks}</span>` : '');
    });
    $('demo-note').innerHTML = S.clinic
      ? (S.mode === 'live' ? '' : 'PayPal sandbox: test money only. Switch PAYPAL_MODE to live when you are ready.')
      : `${S.mode === 'mock' ? 'Test mode: PayPal is simulated.' : 'Public demo: made-up hospital and patients, PayPal sandbox, no real money.'} <a href="/own">Use TJS Pay in your clinic</a> with your own PayPal account.`;
    const view = $('view');
    if (V.tab === 'week') view.innerHTML = weekView();
    if (V.tab === 'patients') view.innerHTML = V.patient ? patientView(pat(V.patient)) : patientsView();
    if (V.tab === 'money') { view.innerHTML = M ? moneyView() : '<p class="muted">Adding it up…</p>'; if (!M) loadMoney(); }
    if (V.tab === 'settings') view.innerHTML = settingsView();
    if (V.tab === 'appts') view.innerHTML = apptsView();
    if (V.tab === 'ins') view.innerHTML = insView();
    if (V.tab === 'depts' || V.tab === 'dept') {
      if (DEP && DEP.fy) view.innerHTML = V.tab === 'dept' ? myDeptView(dep(role)) : deptsView();
      else { view.innerHTML = '<p class="muted">Adding up department budgets…</p>'; loadDep(); }
    }
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
      out.push({ html: `<p><b>${esc(p.known_as)}</b>: draft invoice, ${esc(i.kind === 'block' ? 'next block' : i.period)}, ${m(i.total_pence)}.</p><p class="muted">Not sent yet.</p>`, actions: `${canSplit(i) ? `<button class="btn small line" data-act="ins-split" data-id="${esc(i.id)}">Split with insurance</button>` : ''}<button class="btn small" data-act="review" data-id="${esc(i.id)}">Review and send</button>` });
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
    const open = S.invoices.filter((i) => isOpen(i) && i.kind !== 'claim').sort((a, b) => a.due_date.localeCompare(b.due_date));
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
        <div class="actions" data-mt8><button class="btn small" data-act="parse">Check</button></div>
        <div id="pw-out" aria-live="polite"></div></div></section>
      <section class="panel"><div class="panel-b"><p class="muted fs-85">Reminders go out automatically each morning. To send any that are due right now:</p><div class="actions" data-mt8><button class="btn small line" data-act="reminders">Send due reminders</button></div></div></section>
    </aside></div>`;
  }

  // ----- the billing assistant -----
  const EXAMPLES = {
    billing: ['Who owes us money? Chase anyone more than two weeks late.', 'Invoice everything that’s waiting.', 'Has anyone paid since yesterday?'],
    finance: ['Review the money requests from departments.', 'Which departments are close to their budget?', 'How much came in this month?'],
  };
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
    const ex = EXAMPLES[team()] || EXAMPLES.billing;
    return `<section class="panel asst" aria-labelledby="h-asst"><div class="panel-h"><h2 id="h-asst">${team() === 'finance' ? 'Finance assistant' : 'Billing assistant'}</h2><span class="muted asst-note">${S.ai ? `Typed questions: AI plans, you approve${S.ai_today && S.ai_today.limit ? ` · AI calls today ${S.ai_today.calls} of ${S.ai_today.limit}` : ''}` : 'Built-in rules'}</span></div><div class="panel-b">
      <form id="asst-f" class="asst-row"><label class="sr" for="asst-q">Ask the billing assistant</label>
        <input id="asst-q" maxlength="600" autocomplete="off" placeholder="${esc(ex[0])}" value="${esc(V.ask)}">
        <button class="btn" type="submit"${V.busy ? ' disabled' : ''}>Ask</button></form>
      <div class="asst-ex"><span class="muted asst-note">Instant, no AI:</span>${ex.map((e) => `<button class="filter" type="button" data-act="ask-ex" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      ${out}</div></section>`;
  }
  async function ask(q, instant) {
    q = String(q || '').trim();
    if (!q) return toast('Type a question first.', true);
    V.ask = q; V.busy = true; V.plan = null; V.results = null; render();
    try { const d = await window.TJSPayAPI('assistant', { request: q, team: team(), instant: !!instant }); V.plan = d.plan; S = await window.TJSPayAPI('state'); }
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

  // ----- departments: budgets and money requests -----
  const dep = (id) => (S.departments || []).find((d) => d.id === id);
  const depOfSvc = (sid) => dep((svc(sid) || {}).department_id);
  const RQ = { pending: ['todo', 'Waiting for Finance'], sending: ['', 'Sent with PayPal'], paid: ['paid', 'Paid with PayPal'], unclaimed: ['', 'Waiting to be claimed'], failed: ['late', 'Payout failed'], rejected: ['late', 'Not approved'] };
  const rqTag = (x) => { const [c, t] = RQ[x] || ['', x]; return `<span class="tag ${c}">${esc(t)}</span>`; };
  const leftM = (p) => `<span class="m${p < 0 ? ' neg' : ''}">${gbp(p)}</span>`;
  const bar = (used, budget) => { const pc = budget ? Math.min(100, Math.round(used / budget * 100)) : 0; return `<span class="budget-bar${pc >= 90 ? ' hi' : ''}" role="img" aria-label="${pc}% used"><i class="w${Math.round(pc / 5) * 5}"></i></span>`; };
  async function loadDep() { try { DEP = await window.TJSPayAPI('departments', {}); render(); } catch (e) { toast(e.message, true); } }
  function requestRow(r, admin) {
    const acts = admin && ['pending', 'failed'].includes(r.status)
      ? `<div class="actions"><button class="btn small${r.left_after < 0 ? ' warn' : ''}" data-act="rq-approve" data-id="${esc(r.id)}" data-over="${r.left_after < 0 ? 1 : ''}">${r.left_after < 0 ? 'Approve over budget' : 'Approve and pay with PayPal'}</button><button class="btn small line" data-act="rq-reject" data-id="${esc(r.id)}">Reject</button></div>` : '';
    return `<li class="rq"><div><p>${admin ? `<span class="code">${esc(r.code)}</span> ` : ''}<b>${m(r.pence)}</b> ${esc(r.purpose)} ${rqTag(r.status)}</p>
      <p class="muted">To ${esc(r.payee_name)}${r.pay_to === 'supplier' ? ' (supplier)' : ''}, ${esc(r.payee_email)} · asked ${esc(day(r.created_at))}${['pending', 'failed'].includes(r.status) ? ` · budget left after: ${leftM(r.left_after)}` : r.decided_at ? ` · decided ${esc(day(r.decided_at))}` : ''}${r.reason ? ` · ${esc(r.reason)}` : ''}</p></div>${acts}</li>`;
  }
  function deptsView() {
    const B = DEP, T = B.totals, waiting = B.requests.filter((r) => ['pending', 'failed'].includes(r.status)), done = B.requests.filter((r) => !['pending', 'failed'].includes(r.status));
    return `<div class="page-h"><h1>Budgets and requests</h1><span class="muted">Finance department · financial year ${esc(B.fy)}</span></div>
    ${assistantView()}
    <p class="muted dep-intro">Finance allocates each department a budget for the year, within the overall budget set by the hospital’s leadership. Departments log what they spend and ask for money when they need it. You see what is used and left, then approve (the money is sent with <b>PayPal Payouts</b>, to the department’s PayPal account or straight to a supplier) or reject.</p>
    <section class="panel"><div class="panel-h"><h2>Money requests</h2><div class="actions">${done.some((r) => ['sending', 'unclaimed'].includes(r.status)) ? '<button class="btn small line" data-act="payout-refresh">Check status with PayPal</button>' : ''}<span class="muted">${waiting.length} waiting</span></div></div>
      ${waiting.length ? `<ul class="rows">${waiting.map((r) => requestRow(r, true)).join('')}</ul>` : '<p class="empty">No requests waiting.</p>'}
      ${done.length ? `<details class="done"><summary>Decided (${done.length})</summary><ul class="rows">${done.map((r) => requestRow(r, true)).join('')}</ul></details>` : ''}</section>
    <section class="panel"><div class="panel-h"><h2>Budgets ${esc(B.fy)}</h2><span class="muted">${m(T.used)} used of ${m(T.budget)}</span></div>
      <div class="tbl"><table><thead><tr><th>Code</th><th>Department</th><th class="num">Budget</th><th class="num">Used</th><th></th><th class="num">Left</th><th class="num">Waiting</th><th class="num">Income <span class="muted">(report)</span></th></tr></thead><tbody>
      ${B.departments.map((r) => `<tr><td><span class="code">${esc(r.code)}</span></td><td>${esc(r.name)}</td><td class="num">${m(r.budget)}</td><td class="num">${m(r.used)}</td><td>${bar(r.used, r.budget)}</td><td class="num">${leftM(r.left)}</td><td class="num">${r.waiting ? `${m(r.waiting_pence)} <span class="muted">(${r.waiting})</span>` : '<span class="muted">–</span>'}</td><td class="num">${m(r.income)}</td></tr>`).join('')}
      <tr class="total"><td></td><td>All departments</td><td class="num">${m(T.budget)}</td><td class="num">${m(T.used)}</td><td>${bar(T.used, T.budget)}</td><td class="num">${leftM(T.left)}</td><td class="num">${m(T.waiting_pence)}</td><td class="num">${m(T.income)}</td></tr></tbody></table></div>
      <p class="note">Used = spending the department logged + requests paid with PayPal. Income is what patients paid for each department’s services (from the codes on invoice lines); it is shown for reporting and doesn’t change budgets.</p></section>
    <section class="panel"><div class="panel-h"><h2>Outside providers</h2><span class="muted">Paid with PayPal Payouts</span></div>
      ${(B.partners || []).length ? `<ul class="rows">${B.partners.map((x) => `<li class="rq"><div><p><b>${esc(x.name)}</b> <span class="muted">${esc(x.what || '')}</span></p>
        <p class="muted">Earned from payments collected: ${m(x.earned)} · paid: ${m(x.paid)} · <b>to pay: ${m(x.to_pay)}</b>${x.payouts.length ? ` · last payout ${rqTag(x.payouts[0].status)}` : ''}</p></div>
        <div class="actions">${x.to_pay ? `<button class="btn small" data-act="pt-pay" data-id="${esc(x.id)}">Pay ${esc(gbp(x.to_pay))} with PayPal</button>` : ''}</div></li>`).join('')}</ul>
        <p class="note">The patient pays the hospital; the partner who did the work (for example the PET-CT scan) is paid its agreed fee from money actually collected.</p>` : '<p class="empty">No outside providers.</p>'}</section>
    <section class="panel"><div class="panel-h"><h2>Spending logged by departments</h2></div>${B.spend.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Code</th><th>What</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${B.spend.slice(0, 20).map((x) => `<tr><td>${esc(day(x.date))}</td><td><span class="code">${esc(x.code)}</span></td><td>${esc(x.what)}</td><td>${esc(x.category)}</td><td class="num">${m(x.pence)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing logged yet.</p>'}</section>
    <section class="panel"><div class="panel-h"><h2>Budgets and PayPal accounts</h2><button class="btn small" data-act="save-depts">Save</button></div>
      <div class="tbl"><table><thead><tr><th>Code</th><th>Department</th><th>Budget ${esc(B.fy)} (£)</th><th>Department’s PayPal email</th></tr></thead><tbody>
      ${S.departments.map((d) => `<tr data-dep="${esc(d.id)}"><td><input class="cd" value="${esc(d.code)}" maxlength="12" aria-label="Code"></td><td><input class="nm" value="${esc(d.name)}" maxlength="60" aria-label="Department name"></td><td><input class="bd" inputmode="decimal" value="${((d.budget_pence || 0) / 100).toFixed(0)}" aria-label="Budget for ${esc(d.code)}"></td><td><input class="em" type="email" value="${esc(d.payout_email || '')}" aria-label="PayPal email for ${esc(d.code)}"></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Departments need only a PayPal account that can receive money at this email; no PayPal app or keys. In the sandbox demo, every payout goes to the demo account so you can see it arrive.</p></section>`;
  }

  // ----- my department (department staff) -----
  function myDeptView(d) {
    const r = DEP.departments.find((x) => x.id === d.id) || {};
    const mine = DEP.requests.filter((x) => x.dept_id === d.id);
    const spend = DEP.spend.filter((x) => x.dept_id === d.id);
    const svcs = S.services.filter((v) => v.department_id === d.id && !v.plan_only);
    return `<div class="page-h"><h1><span class="code big">${esc(d.code)}</span> ${esc(d.name)}</h1><span class="muted">Financial year ${esc(DEP.fy)}</span></div>
    <div class="figs dep-figs"><div class="fig"><span>Budget</span><b class="m">${gbp(r.budget)}</b></div><div class="fig"><span>Used</span><b class="m">${gbp(r.used)}</b>${bar(r.used, r.budget)}</div><div class="fig${r.left < 0 ? ' late' : ''}"><span>Left</span><b class="m">${gbp(r.left)}</b></div><div class="fig"><span>Waiting for Finance</span><b class="m">${gbp(r.waiting_pence)}</b></div></div>
    <div class="two-col"><div>
      <section class="panel"><div class="panel-h"><h2>Ask for money</h2></div><div class="form">
        <div class="two"><label>How much (£)<input id="rq-amt" inputmode="decimal"></label><label>Pay to<select id="rq-to"><option value="department">Our PayPal account${d.payout_email ? ` (${esc(d.payout_email)})` : ''}</option><option value="supplier">A supplier</option></select></label></div>
        <label>What it’s for<input id="rq-purpose" maxlength="200" placeholder="e.g. Hearing aid batteries and repair kits"></label>
        <div class="two" id="rq-sup" hidden><label>Supplier<input id="rq-sname" maxlength="80"></label><label>Supplier’s PayPal email<input id="rq-semail" type="email" maxlength="120"></label></div>
        <div class="actions"><button class="btn" data-act="rq-ask">Send to Finance</button><span class="muted fs-82">The finance department checks it against your budget and pays it with PayPal.</span></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Our requests</h2></div>${mine.length ? `<ul class="rows">${mine.map((x) => requestRow(x, false)).join('')}</ul>` : '<p class="empty">No requests yet.</p>'}</section>
      <section class="panel"><div class="panel-h"><h2>Log spending</h2></div><div class="logform">
        <label>Date<input type="date" id="sp-date" value="${esc(S.today)}" max="${esc(S.today)}"></label>
        <label>What<input id="sp-what" maxlength="100" placeholder="e.g. Disposable specula"></label>
        <label>Category<select id="sp-cat"><option>Supplies</option><option>Equipment</option><option>Staff</option><option>Training</option><option>Travel</option><option>Other</option></select></label>
        <label>Amount (£)<input id="sp-amt" inputmode="decimal" size="8"></label>
        <button class="btn" data-act="sp-log">Log</button></div>
        <p class="note">For money spent another way, e.g. on the hospital card. It counts against your budget.</p>
        ${spend.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>What</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${spend.slice(0, 10).map((x) => `<tr><td>${esc(day(x.date))}</td><td>${esc(x.what)}</td><td>${esc(x.category)}</td><td class="num">${m(x.pence)}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>
    </div><aside>
      <section class="panel"><div class="panel-h"><h2>Log a session</h2></div><div class="form">
        <label>Patient<select id="ds-pat">${S.patients.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <label>Service<select id="ds-svc">${svcs.map((v) => `<option value="${esc(v.id)}">${esc(v.name)} (${esc(gbp(v.price_pence))})</option>`).join('')}</select></label>
        <label>Date<input type="date" id="ds-date" value="${esc(S.today)}" max="${esc(S.today)}"></label>
        <label>Where<select id="ds-where"><option>in person</option><option>online</option><option>at school</option><option>at home</option></select></label>
        <div class="actions"><button class="btn" data-act="dept-log">Log</button></div></div>
        <p class="note">The billing office invoices patients through PayPal with your code, ${esc(d.code)}. Income this year: ${esc(gbp(r.income))}.</p></section>
    </aside></div>`;
  }

  // ----- appointments: check-in & pay (front desk, billing office) -----
  const SCALE_PC = { full: 0, s20: 20, s40: 40, s60: 60 };
  const apptPrice = (a) => Math.round(svc(a.service_id).price_pence * (100 - (SCALE_PC[a.scale] || 0)) / 100);
  function apptTags(a) {
    const t = [];
    if (a.status === 'booked') t.push('<span class="tag">Booked</span>');
    if (a.status === 'checked_in') t.push('<span class="tag paid">Checked in online</span>');
    if (a.status === 'arrived') t.push('<span class="tag paid">Arrived</span>');
    if (a.status === 'no_show') t.push('<span class="tag late">No-show</span>');
    if (a.status === 'cancelled') t.push('<span class="tag">Cancelled</span>');
    if (a.deposit_pence && !a.hold && ['booked'].includes(a.status)) t.push(`<span class="tag todo">${gbp(a.deposit_pence)} deposit not held yet</span>`);
    if (a.hold && a.hold.status === 'held') t.push(`<span class="tag paid">${gbp(a.deposit_pence)} held with PayPal</span>`);
    if (a.hold && a.hold.status === 'captured') t.push(`<span class="tag">${gbp(a.hold.captured_pence)} taken${a.status === 'no_show' ? ' as no-show fee' : ', put toward the bill'}</span>`);
    if (a.hold && a.hold.status === 'released') t.push('<span class="tag">Hold released</span>');
    if (a.scale && a.scale !== 'full') t.push(`<span class="tag">Sliding scale ${SCALE_PC[a.scale]}% off</span>`);
    return t.join(' ');
  }
  function apptRow(a) {
    const p = pat(a.patient_id), v = svc(a.service_id), d = depOfSvc(a.service_id), open = ['booked', 'checked_in'].includes(a.status), past = a.at.slice(0, 10) <= S.today;
    const acts = open ? `<button class="btn small line" data-act="ap-link" data-id="${esc(a.id)}">Check-in link</button>${past ? `<button class="btn small" data-act="ap-arrived" data-id="${esc(a.id)}">Arrived</button><button class="btn small line" data-act="ap-noshow" data-id="${esc(a.id)}">No-show</button>` : ''}<button class="btn small line" data-act="ap-cancel" data-id="${esc(a.id)}">Cancel</button>`
      : a.invoice_id ? `<button class="btn small line" data-act="open-patient" data-id="${esc(p.id)}">Invoice</button>` : '';
    return `<li class="rq"><div><p><span class="appt-time">${esc(a.at.slice(11, 16))}</span> <b>${esc(p.known_as)}</b> ${d ? `<span class="code">${esc(d.code)}</span> ` : ''}${esc(v.name)} · ${m(apptPrice(a))}</p><div class="tags">${apptTags(a)}</div></div><div class="actions">${acts}</div></li>`;
  }
  function apptsView() {
    const all = (S.appointments || []).slice().sort((x, y) => x.at.localeCompare(y.at));
    const today = all.filter((a) => a.at.slice(0, 10) === S.today), next = all.filter((a) => a.at.slice(0, 10) > S.today), earlier = all.filter((a) => a.at.slice(0, 10) < S.today).reverse();
    const group = (list, title) => list.length ? `<section class="panel"><div class="panel-h"><h2>${title}</h2><span class="muted">${list.length}</span></div><ul class="rows">${list.map(apptRow).join('')}</ul></section>` : '';
    const byDay = {}; next.forEach((a) => { (byDay[a.at.slice(0, 10)] = byDay[a.at.slice(0, 10)] || []).push(a); });
    return `<div class="page-h"><h1>Appointments</h1><span class="muted">Check-in & pay</span></div>
    <p class="muted dep-intro">Send families a check-in link before the visit. Families who pay for themselves choose a sliding-scale price (no proof asked). For high-demand services, a ${esc(gbp(S.settings.deposit_pence))} deposit is <b>held on their PayPal</b>, not taken: on arrival it goes toward the bill, on a no-show it is kept as a fee, and on a cancellation it is released.</p>
    <section class="panel"><div class="panel-h"><h2>Book an appointment</h2></div><div class="logform">
      <label>Patient<select id="ap-pat">${S.patients.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>Service<select id="ap-svc">${S.services.filter((v) => v.minutes).map((v) => `<option value="${esc(v.id)}">${depOfSvc(v.id) ? esc(depOfSvc(v.id).code) + ' · ' : ''}${esc(v.name)} (${esc(gbp(v.price_pence))})${(S.settings.deposit_services || []).includes(v.id) ? ' · deposit' : ''}</option>`).join('')}</select></label>
      <label>Date<input type="date" id="ap-date" value="${esc(S.today)}" min="${esc(S.today)}"></label>
      <label>Time<input type="time" id="ap-time" value="14:00" step="900"></label>
      <button class="btn" data-act="ap-book">Book</button></div></section>
    ${group(today, 'Today')}${Object.entries(byDay).map(([dd, list]) => group(list, esc(day(dd)))).join('')}${group(earlier, 'Earlier')}
    ${all.length ? '' : '<p class="empty">No appointments yet.</p>'}`;
  }
  async function openLink(id) {
    const a = S.appointments.find((x) => x.id === id), p = pat(a.patient_id), v = svc(a.service_id);
    try {
      const r = await window.TJSPayAPI(`appointments/${id}/link`, {});
      const who = p.payer.type === 'family' ? first(billTo(p).name) : 'there';
      const text = `Hi ${who}, ${p.known_as}’s appointment (${v.name}) at ${S.settings.practice} is on ${day(a.at)} at ${a.at.slice(11, 16)}. Please check in here before you come${a.deposit_pence ? ` (a ${gbp(a.deposit_pence)} deposit is held, not taken)` : ''}: ${r.checkin_url}`;
      dlg().innerHTML = `<div class="dlg"><div class="head"><h2>Check-in link: ${esc(p.known_as)}</h2><button class="btn text" id="l-close" type="button">Close</button></div>
        <div class="qr">${r.qr_svg || ''}<div class="grow"><p class="muted">Show this QR code at the desk, or send the message by text or email.</p>
        <label>Message<textarea id="l-text" readonly>${esc(text)}</textarea></label>
        <div class="actions"><button class="btn small" id="l-copy" type="button">Copy message</button><a class="btn small line" href="${esc(r.checkin_url)}" target="_blank" rel="noopener">Open as the family</a></div></div></div></div>`;
      dlg().showModal();
      $('l-close').onclick = () => dlg().close();
      $('l-copy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a text message.'); } catch { $('l-text').select(); toast('Select the text and copy it.', true); } };
    } catch (e) { toast(e.message, true); }
  }

  // ----- insurance claims (billing office) -----
  const CLAIM = { submitted: ['todo', 'Waiting for insurer'], paid: ['paid', 'Paid in full'], part_paid: ['', 'Part paid'], rejected: ['late', 'Rejected'] };
  function insView() {
    const list = (S.insurance_claims || []), ins = (id) => (S.insurers.find((x) => x.id === id) || {}).name, open = list.filter((c) => c.status === 'submitted');
    const row = (c) => { const p = pat(c.patient_id), i = S.invoices.find((x) => x.id === c.invoice_id), [cl, t] = CLAIM[c.status];
      return `<li class="rq"><div><p><b>${esc(ins(c.insurer_id))}</b> · ${esc(p.known_as)}, ${esc(i ? i.period : '')} · ${m(c.claimed_pence)} <span class="tag ${cl}">${t}</span></p>
        <p class="muted">Policy ${esc(c.policy)} · claimed ${esc(day(c.submitted_at))}${c.status === 'submitted' && i ? ` · insurer usually pays by ${esc(day(i.due_date))}` : ''}${c.paid_pence ? ` · paid ${m(c.paid_pence)}${c.reference ? `, ref ${esc(c.reference)}` : ''}` : ''}${c.reason ? ` · ${esc(c.reason)}` : ''}${c.shortfall_invoice_id ? ' · the rest is billed to the family' : ''}</p></div>
        <div class="actions">${c.status === 'submitted' ? `<button class="btn small" data-act="ic-paid" data-id="${esc(c.id)}">Insurer paid</button><button class="btn small line" data-act="ic-rej" data-id="${esc(c.id)}">Rejected</button>` : ''}</div></li>`; };
    return `<div class="page-h"><h1>Insurance claims</h1><span class="muted">${m(open.reduce((t, c) => t + c.claimed_pence, 0))} waiting</span></div>
    <p class="muted dep-intro">For an insured patient, open their draft invoice and choose <b>Split with insurance</b>: the family pays their excess through PayPal, and the rest is claimed from the insurer. When the insurer pays (usually by bank), record it here. Anything the insurer doesn’t cover becomes a draft invoice to the family.</p>
    ${(() => { const ready = S.invoices.filter(canSplit); return ready.length ? `<section class="panel"><div class="panel-h"><h2>Ready to claim</h2><span class="muted">${ready.length}</span></div><ul class="rows">${ready.map((i) => { const p = pat(i.patient_id); return `<li class="rq"><div><p><b>${esc(p.known_as)}</b>, ${esc(i.period)} · ${m(i.total_pence)}</p><p class="muted">${esc(insName(p))}, policy ${esc(p.insurance.policy)}: family pays ${m(p.insurance.excess_pence)}, ${m(i.total_pence - p.insurance.excess_pence)} is claimed</p></div><div class="actions"><button class="btn small" data-act="ins-split" data-id="${esc(i.id)}">Split with insurance</button><button class="btn small line" data-act="review" data-id="${esc(i.id)}">Open draft</button></div></li>`; }).join('')}</ul></section>` : ''; })()}
    <section class="panel"><div class="panel-h"><h2>Claims</h2><span class="muted">${list.length}</span></div>${list.length ? `<ul class="rows">${list.map(row).join('')}</ul>` : '<p class="empty">No claims yet.</p>'}</section>`;
  }
  // ----- surgery payment plans (patient page) -----
  function planPanel(p) {
    const plans = (S.payment_plans || []).filter((x) => x.patient_id === p.id), surg = S.services.filter((v) => v.plan_only);
    if (!surg.length) return '';
    const st = (part) => { const i = part.invoice_id && S.invoices.find((x) => x.id === part.invoice_id); if (!i) return `<span class="tag">Sends ${esc(day(part.due))}</span>`; return PAID.includes(i.status) ? '<span class="tag paid">Paid</span>' : isLate(i) ? '<span class="tag late">Overdue</span>' : '<span class="tag">Sent, waiting</span>'; };
    return `<section class="panel"><div class="panel-h"><h2>Surgery payment plan</h2></div>
      ${plans.map((pl) => `<div class="panel-b"><p><b>${esc(svc(pl.service_id).name)}</b> on ${esc(day(pl.date))} · ${m(pl.total_pence)}</p><ul class="rows plan-parts">${pl.parts.map((x, k) => `<li class="rq"><div><p>${esc(x.label)} · ${m(x.pence)} ${st(x)}</p></div><div class="actions">${x.invoice_id ? '' : `<button class="btn small line" data-act="pl-send" data-id="${esc(pl.id)}" data-part="${k}">Send now</button>`}</div></li>`).join('')}</ul></div>`).join('')}
      <div class="logform">
        <label>Surgery<select id="pl-svc">${surg.map((v) => `<option value="${esc(v.id)}">${depOfSvc(v.id) ? esc(depOfSvc(v.id).code) + ' · ' : ''}${esc(v.name)} (${esc(gbp(v.price_pence))})</option>`).join('')}</select></label>
        <label>Date<input type="date" id="pl-date" min="${esc(S.today)}"></label>
        <label>Deposit (%)<input id="pl-dep" value="30" inputmode="numeric" size="3"></label>
        <label>Instalments<select id="pl-n">${[1, 2, 3, 4, 5, 6].map((n) => `<option${n === 2 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn" data-act="pl-make" data-id="${esc(p.id)}">Create plan</button></div>
      <p class="note">The deposit is sent through PayPal now; each instalment is sent on its date, the last a week before the surgery. PayPal may offer families Pay Later (Pay in 3) when they pay.</p></section>`;
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
    else if (i.kind === 'claim') tag = `<span class="tag">Claim to ${esc(i.to.name)}</span>`;
    else if (i.kind === 'block' && PAID.includes(i.status)) { const u = S.sessions.filter((s) => s.invoice_id === i.id).length; tag = `<span class="tag paid">Paid, ${u} of ${i.block_size} used</span>`; }
    else if (i.status === 'PAID') tag = '<span class="tag paid">Paid through PayPal</span>';
    else if (i.status === 'MARKED_AS_PAID') tag = '<span class="tag paid">Paid, recorded in PayPal</span>';
    else if (i.status === 'PARTIALLY_PAID') tag = `<span class="tag">${m(i.paid_pence)} of ${m(i.total_pence)} paid</span>`;
    else if (isLate(i)) tag = '<span class="tag late">Overdue</span>';
    const sub = i.status === 'DRAFT' ? 'Not sent yet' : `Sent to ${toName(i.to)} ${day(i.sent_at)}${isOpen(i) && i.reminder_count ? `, ${count(i.reminder_count, 'reminder', 'reminders')} since` : ''}${i.paid_at ? `, paid ${day(i.paid_at)}` : ''}`;
    const a = [], live = isOpen(i) && i.kind !== 'claim';
    if (i.status === 'DRAFT') a.push(`<button class="btn small" data-act="review" data-id="${esc(i.id)}">Review and send</button>`);
    if (live) a.push(`<button class="btn small line" data-act="family" data-id="${esc(i.id)}">What ${esc(i.to.org ? 'they' : toName(i.to))} see${i.to.org ? '' : 's'}</button>`);
    if (live) a.push(`<button class="btn small line" data-act="nudge" data-id="${esc(i.id)}">Reminder</button>`);
    if (live && i.view_url) a.push(`<a class="btn small line" href="${esc(i.view_url)}" target="_blank" rel="noopener">Open in PayPal</a>`);
    if (live && (S.mode === 'sandbox' || S.mode === 'live')) a.push(`<button class="btn small line" data-act="refresh" data-id="${esc(i.id)}">Check PayPal</button>`);
    if (live && S.mode !== 'sandbox' && S.mode !== 'live') a.push(`<button class="btn small line" data-act="mock-pay" data-id="${esc(i.id)}">Simulate PayPal payment</button>`);
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
        ${p.insurance ? `<dt>Insurance</dt><dd>${esc((S.insurers.find((x) => x.id === p.insurance.insurer_id) || {}).name || '')}<div class="muted">Policy ${esc(p.insurance.policy)} · excess ${esc(gbp(p.insurance.excess_pence))} a visit</div></dd>` : ''}
        <dt>Billing</dt><dd>${planText(p)}${p.plan === 'block' ? blockInfo(p) : ''}</dd></dl></section>
      <div>
        <section class="panel"><div class="panel-h"><h2>Log a session</h2>${L.toInvoice.length && !L.drafts.length && p.plan !== 'block' ? `<button class="btn small" data-act="draft" data-id="${esc(p.id)}">Invoice ${count(L.toInvoice.length, 'session', 'sessions')}</button>` : ''}</div>
          <div class="logform">
            <label>Date<input type="date" id="ls-date" value="${esc(S.today)}" max="${esc(S.today)}"></label>
            <label>Service<select id="ls-svc">${S.services.filter((s) => !s.plan_only).map((s) => `<option value="${esc(s.id)}"${s.id === p.service_id ? ' selected' : ''}>${depOfSvc(s.id) ? esc(depOfSvc(s.id).code) + ' · ' : ''}${esc(s.name)}${s.minutes ? `, ${s.minutes} min` : ''} (${esc(gbp(s.price_pence))})</option>`).join('')}</select></label>
            <label>Where<select id="ls-where"><option>in person</option><option>online</option><option>at school</option><option>at home</option></select></label>
            <button class="btn" data-act="log" data-id="${esc(p.id)}">Log</button>
          </div></section>
        ${planPanel(p)}
        <section class="panel"><div class="panel-h"><h2>Invoices</h2></div>${invs.length ? `<ul class="rows">${invs.map((i) => `<li>${invoiceLine(i)}</li>`).join('')}</ul>` : '<p class="empty">No invoices yet.</p>'}</section>
        <section class="panel"><div class="panel-h"><h2>Payments</h2></div>${pays.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Method</th><th>For</th><th class="num">Amount</th></tr></thead><tbody>${pays.map((x) => `<tr><td>${esc(day(x.date))}</td><td>${esc(howShort(x.method))}${x.reference ? `<div class="muted">Ref ${esc(x.reference)}</div>` : ''}</td><td>${esc(invById[x.invoice_id] ? invById[x.invoice_id].period : '')}</td><td class="num">${m(x.pence)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No payments yet.</p>'}</section>
        <section class="panel"><div class="panel-h"><h2>Sessions</h2><span class="muted">${sessions.length}</span></div>${sessions.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Service</th><th>Where</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>${sessions.map((s) => `<tr><td>${esc(day(s.date))}</td><td>${depOfSvc(s.service_id) ? `<span class="code">${esc(depOfSvc(s.service_id).code)}</span> ` : ''}${esc(svc(s.service_id).name)}</td><td>${esc(s.minutes ? s.where : '')}</td><td class="num">${m(s.price_pence)}</td><td>${sesStatus(s)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No sessions yet.</p>'}</section>
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
      <ul class="legend">${list.map((x, k) => `<li><span class="sw sw${k % PIE.length}"></span><span>${esc(x.name)} <span class="muted">(${x.count})</span></span><span class="v">${m(x.pence)}<small>${Math.round(x.pence / total * 100)}%</small></span></li>`).join('')}</ul></div>`;
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
      <section class="panel"><div class="panel-h"><h2>Deposits for high-demand appointments</h2></div><div class="form">
        <label>Deposit held with PayPal (£)<input id="st-deposit" value="${((s.deposit_pence || 0) / 100).toFixed(2)}" inputmode="decimal"></label>
        <fieldset class="dep-svcs"><legend>Services that need a deposit</legend>${S.services.filter((v) => v.minutes).map((v) => `<label class="chk"><input type="checkbox" data-depsvc="${esc(v.id)}"${(s.deposit_services || []).includes(v.id) ? ' checked' : ''}> ${depOfSvc(v.id) ? `<span class="code">${esc(depOfSvc(v.id).code)}</span> ` : ''}${esc(v.name)}</label>`).join('')}</fieldset>
        <p class="muted">Held on the family’s PayPal at check-in, not taken. On arrival it goes toward the bill; on a no-show it’s kept; on a cancellation it’s released.</p></div></section>
      <section class="panel"><div class="panel-h"><h2>PayPal fees</h2></div><div class="form">
        <label>Percentage per payment<input id="st-fee" value="${s.fee_percent}" inputmode="decimal"></label>
        <label>Fixed fee per payment (£)<input id="st-fixed" value="${(s.fee_fixed_pence / 100).toFixed(2)}" inputmode="decimal"></label>
        <p class="muted">Used for the profit estimate only. Check your PayPal account for your rate.</p></div></section>
      <section class="panel" data-wide><div class="panel-h"><h2>Reminders</h2></div><div class="form">
        <label>Send reminders this many days after the invoice<input id="st-days" value="${esc(s.reminder_days.join(', '))}"></label>
        ${texts.map((t, k) => `<label>Reminder ${k + 1} <span class="muted">(day ${s.reminder_days[k]})</span><textarea data-reminder="${k}" maxlength="1200">${esc(t)}</textarea></label>`).join('')}
        <p class="muted chips">These fill in automatically: <code>{name}</code> the person paying, <code>{child}</code>, <code>{amount}</code>, <code>{period}</code>, <code>{practice}</code>. A “tell us you paid another way” link is added at the end. You can also change the next reminder for one invoice from Overview.</p></div></section>
    </div>
    <div class="actions" data-mt16><button class="btn" data-act="save-settings">Save</button>${S.clinic ? '' : '<button class="btn warn" data-act="seed">Reset demo data</button>'}</div>`;
  }

  // ---------- dialogs ----------
  const dlg = () => $('dlg');
  function openDraft(id) {
    const i = S.invoices.find((x) => x.id === id), p = pat(i.patient_id);
    dlg().innerHTML = `<form class="dlg" method="dialog"><div class="head"><h2>Invoice: ${esc(p.known_as)}, ${esc(i.kind === 'block' ? 'next block' : i.period)}</h2><button class="btn text" value="close">Close</button></div>
      <p class="to">To ${esc(i.to.name)}${i.to.email ? ', ' + esc(i.to.email) : ''}</p>
      <ul class="items">${i.items.map((it) => `<li><span>${it.code ? `<span class="code">${esc(it.code)}</span> ` : ''}${esc(it.name)}</span><span>${m(it.pence)}</span></li>`).join('')}<li class="sum"><span>Total</span><span>${m(i.total_pence)}</span></li></ul>
      <label>Email subject<input id="d-subject" maxlength="100" value="${esc(i.subject)}"></label>
      <label>Message<textarea id="d-note" rows="4" maxlength="1500">${esc(i.note)}</textarea></label>
      ${canSplit(i) ? `<div class="ins-box"><p><b>${esc(p.known_as)} is insured</b> with ${esc(insName(p))} (policy ${esc(p.insurance.policy)}, excess ${m(p.insurance.excess_pence)}).<br><span class="muted">Split it: the family pays the excess through PayPal, and the rest is claimed from the insurer.</span></p><button class="btn small" id="d-ins" type="button">Split with insurance</button></div>`
        : p.insurance && i.status === 'DRAFT' && !i.claim_id && i.kind !== 'claim' ? `<p class="hint">${esc(p.known_as)}’s ${m(p.insurance.excess_pence)} insurance excess covers this whole bill, so there’s nothing to claim.</p>`
        : i.claim_id ? `<p class="hint">Split with insurance: this is the family’s excess. The rest is on the Insurance claims page.</p>` : ''}
      <p class="hint">${i.note_by_ai ? 'Written by AI from billing details only.' : 'Standard wording.'} Edit as needed.${S.ai && S.mode !== 'review' ? ' <button class="btn text" id="d-ai" type="button">Write with AI</button>' : ''}</p>
      <div class="actions"><button class="btn" id="d-send" type="button">Send through PayPal</button><button class="btn line" id="d-discard" type="button">Delete draft</button></div></form>`;
    dlg().showModal();
    $('d-send').onclick = (e) => act(e.currentTarget, `invoices/${id}/send`, { subject: $('d-subject').value, note: $('d-note').value }, () => { dlg().close(); toast(`Sent to ${toName(i.to)}.`); });
    $('d-discard').onclick = (e) => act(e.currentTarget, `invoices/${id}/discard`, {}, () => { dlg().close(); toast('Draft deleted.'); });
    if ($('d-ins')) $('d-ins').onclick = (e) => act(e.currentTarget, 'insurance/split', { invoice_id: id }, () => { openDraft(id); toast('Split: the excess stays on this invoice, the rest is claimed from the insurer.'); });
    if ($('d-ai')) $('d-ai').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const w = await window.TJSPayAPI(`invoices/${id}/ai-note`, {}); $('d-subject').value = w.subject; $('d-note').value = w.note; i.subject = w.subject; i.note = w.note; i.note_by_ai = true; toast('Written by AI. Check it before sending.'); }
      catch (err) { toast(err.message, true); } finally { if ($('d-ai')) $('d-ai').disabled = false; }
    };
  }
  async function openNudge(id) {
    const i = S.invoices.find((x) => x.id === id), p = pat(i.patient_id);
    const r = await window.TJSPayAPI(`invoices/${id}/reminder-text`, {});
    const left = r.number <= S.settings.reminder_days.length;
    dlg().innerHTML = `<form class="dlg" method="dialog"><div class="head"><h2>Reminder ${r.number}: ${esc(p.known_as)}, ${esc(i.period)}</h2><button class="btn text" value="close">Close</button></div>
      <p class="to">To ${esc(i.to.name)}. ${left ? `Goes out automatically: ${esc(nextReminder(i))}.` : 'All automatic reminders have been sent.'}</p>
      <label>Message<textarea id="n-text" rows="6" maxlength="1200">${esc(r.custom ? r.text : r.filled)}</textarea></label>
      ${S.mode !== 'review' ? '<div class="actions" data-mt8><span class="muted fs-82">Rewrite with AI:</span><button class="btn small line" type="button" data-rw="warmer">Warmer</button><button class="btn small line" type="button" data-rw="shorter">Shorter</button><button class="btn small line" type="button" data-rw="firmer">Firmer</button></div>' : ''}
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
      case 'ins-split': act(b, 'insurance/split', { invoice_id: id }, () => toast('Split: the family’s excess stays on the invoice, and the rest is claimed from the insurer.')); break;
      case 'ic-paid': { const amt = window.prompt('How much did the insurer pay (£)?'); if (amt === null) break; const ref = window.prompt('Payment reference (optional)') || ''; act(b, `insurance/${id}/paid`, { amount: amt, reference: ref }, () => toast('Recorded.')); break; }
      case 'ic-rej': { const why = window.prompt('Why was it rejected?'); if (why === null) break; act(b, `insurance/${id}/rejected`, { reason: why }, () => toast('The full amount is now a draft invoice to the family.')); break; }
      case 'pt-pay': if (window.confirm('Pay this provider with PayPal Payouts?')) act(b, `partners/${id}/pay`, {}, () => toast('Sent with PayPal Payouts.')); break;
      case 'pl-make': act(b, 'plans', { patient_id: id, service_id: $('pl-svc').value, date: $('pl-date').value, deposit_percent: $('pl-dep').value, instalments: $('pl-n').value }, () => toast('Plan created. The deposit invoice was sent through PayPal.')); break;
      case 'pl-send': act(b, `plans/${id}/send`, { part: b.dataset.part }, () => toast('Sent through PayPal.')); break;
      case 'ap-book': act(b, 'appointments', { patient_id: $('ap-pat').value, service_id: $('ap-svc').value, date: $('ap-date').value, time: $('ap-time').value }, () => toast('Booked.')); break;
      case 'ap-link': openLink(id); break;
      case 'ap-arrived': act(b, `appointments/${id}/arrived`, {}, () => toast('Arrived. The visit invoice is ready.')); break;
      case 'ap-noshow': if (window.confirm('Mark as a no-show? A held deposit is kept as the no-show fee.')) act(b, `appointments/${id}/no-show`, {}, () => toast('Marked as a no-show.')); break;
      case 'ap-cancel': if (window.confirm('Cancel this appointment? A held deposit is released.')) act(b, `appointments/${id}/cancel`, {}, () => toast('Cancelled.')); break;
      case 'payout-refresh': act(b, 'payouts/refresh', {}, () => toast('Checked with PayPal.')); break;
      case 'save-depts': act(b, 'departments/settings', { departments: [...document.querySelectorAll('[data-dep]')].map((r) => ({ id: r.dataset.dep, code: r.querySelector('.cd').value, name: r.querySelector('.nm').value, budget: r.querySelector('.bd').value, payout_email: r.querySelector('.em').value })) }, () => { toast('Saved.'); act(null, 'state'); }); break;
      case 'rq-approve': { const r = DEP.requests.find((x) => x.id === id); const over = !!b.dataset.over;
        if (!window.confirm(over ? `This takes ${r.code} ${gbp(-r.left_after)} over its budget. Pay ${gbp(r.pence)} to ${r.payee_name} with PayPal anyway?` : `Pay ${gbp(r.pence)} to ${r.payee_name} with PayPal?`)) break;
        act(b, `requests/${id}/approve`, { over_budget: over }, () => toast('Sent with PayPal Payouts.')); break; }
      case 'rq-reject': { const why = window.prompt('Why isn’t it approved? The department will see this.'); if (why === null) break; act(b, `requests/${id}/reject`, { reason: why }, () => toast('Marked as not approved.')); break; }
      case 'rq-ask': act(b, 'requests', { dept_id: role, amount: $('rq-amt').value, purpose: $('rq-purpose').value.trim(), pay_to: $('rq-to').value, payee_name: $('rq-sname').value.trim(), payee_email: $('rq-semail').value.trim() }, () => toast('Sent to the finance department.')); break;
      case 'sp-log': act(b, 'spend', { dept_id: role, date: $('sp-date').value, what: $('sp-what').value.trim(), category: $('sp-cat').value, amount: $('sp-amt').value }, () => toast('Logged against your budget.')); break;
      case 'dept-log': act(b, 'sessions', { patient_id: $('ds-pat').value, service_id: $('ds-svc').value, date: $('ds-date').value, where: $('ds-where').value }, () => toast('Logged. The billing office will invoice it.')); break;
      case 'ask-ex': ask(b.dataset.q, true); break;
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
        reminder_days: $('st-days').value, reminder_texts: [...document.querySelectorAll('[data-reminder]')].map((t) => t.value), fee_percent: $('st-fee').value, fee_fixed: $('st-fixed').value, deposit: $('st-deposit').value, deposit_services: [...document.querySelectorAll('[data-depsvc]:checked')].map((c) => c.dataset.depsvc),
        services: [...document.querySelectorAll('[data-svc]')].map((r) => ({ id: r.dataset.svc, name: r.children[0].value, price: r.children[2].value })),
      }, () => { M = null; toast('Saved.'); }); break;
      case 'seed': if (window.confirm('Reset the demo data?')) act(b, 'seed', {}, () => { M = null; V.patient = null; V.tab = 'week'; toast('Demo data reset.'); }); break;
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'rq-to') { $('rq-sup').hidden = ev.target.value !== 'supplier'; return; }
    if (ev.target.id !== 'role') return;
    role = ev.target.value; try { localStorage.setItem('tjs-pay-role', role); } catch { /* ignore */ }
    V.tab = TABS[team()][0]; V.patient = null; V.plan = null; V.results = null; V.ask = ''; DEP = null; render(); window.scrollTo(0, 0);
  });
  document.addEventListener('submit', (ev) => { if (ev.target.id === 'asst-f') { ev.preventDefault(); ask($('asst-q').value); } });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'asst-q') V.ask = ev.target.value; });

  (async function start() {
    try { S = await window.TJSPayAPI('state'); V.month = S.today.slice(0, 7); render(); }
    catch (e) { $('view').innerHTML = `<p>TJS Pay couldn’t load: ${esc(e.message)}</p>`; }
  })();
})();

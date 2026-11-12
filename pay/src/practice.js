// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
// TJS Pay billing logic. One practice = one document (D), loaded and saved by the caller.
// PayPal and AI are passed in, so the same code runs in the Worker (real PayPal sandbox, Claude)
// and in the browser review copy (simulated PayPal, standard wording).
// Rules: the AI writes and reads words only; every amount, split and date is worked out here in plain code.

export function makePractice({ paypal, ai, linkFor, checkinLinkFor, aiLimit, clinic = false, today: todayFn }) {
  // ---------- small helpers ----------
  const gbp = (p) => (p < 0 ? '−' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function toPence(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
    const m = String(v || '').replace(/[£,\s]/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    const p = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0);
    return p > 0 ? p : null;
  }
  const outstanding = (i) => Math.max(0, i.total_pence - i.paid_pence);
  const isOpen = (i) => ['SENT', 'PARTIALLY_PAID', 'UNPAID'].includes(i.status) && outstanding(i) > 0;
  function allocate(amount, invoices, preferred) {
    const open = invoices.filter(isOpen).sort((a, b) => a.id === preferred ? -1 : b.id === preferred ? 1 : (a.sent_at || '').localeCompare(b.sent_at || ''));
    let left = amount; const allocation = [];
    for (const inv of open) { if (left <= 0) break; const t = Math.min(left, outstanding(inv)); if (t > 0) { allocation.push({ invoice_id: inv.id, pence: t }); left -= t; } }
    return { allocation, credit_pence: left };
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fdate = (iso) => { const [, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)}`; };
  const fmonth = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const addDays = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.floor((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
  const today = todayFn || (() => new Date().toISOString().slice(0, 10));
  const now = () => new Date().toISOString();
  const uid = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const firstWord = (name) => String(name || '').trim().split(/\s+/)[0];
  const how = (m) => ({ bank: 'by bank transfer', cash: 'in cash', cheque: 'by cheque', other: 'another way', paypal: 'through PayPal' })[m];

  const pat = (D, id) => D.patients.find((p) => p.id === id);
  const dept = (D, id) => (D.departments || []).find((d) => d.id === id);
  /** The department an invoice line belongs to: stored on the line, else its service's department. */
  const lineDept = (D, it) => it.dept_id || (svc(D, it.service_id) || {}).department_id || ((D.departments || [])[0] || {}).id;
  function tagLine(D, it, service_id) {
    const sv = svc(D, service_id), d = sv && dept(D, sv.department_id);
    const partner = sv && sv.partner_id ? { partner_id: sv.partner_id, partner_pence: sv.partner_pence } : {};
    return d ? { ...it, service_id, dept_id: d.id, code: d.code, dept_name: d.name, ...partner } : { ...it, service_id, ...partner };
  }
  const inv = (D, id) => D.invoices.find((i) => i.id === id);
  const svc = (D, id) => D.services.find((s) => s.id === id);
  const billTo = (p) => p.payer.type === 'family' ? (p.caregivers.find((c) => c.invoices) || p.caregivers[0]) : { name: p.payer.name, email: p.payer.email, org: true };
  const toName = (t) => t.org ? t.name : firstWord(t.name);
  const log = (D, kind, text, patient_id = null) => { D.events.unshift({ id: uid('ev'), at: now(), kind, text, patient_id }); D.events.length = Math.min(D.events.length, 200); };
  function fill(D, t, p, i) {
    return String(t).replace(/\{name\}/g, p.payer.type === 'family' ? firstWord(billTo(p).name) : 'there').replace(/\{child\}/g, p.known_as)
      .replace(/\{amount\}/g, gbp(outstanding(i))).replace(/\{period\}/g, i.period).replace(/\{practice\}/g, D.settings.practice);
  }

  // ---------- words: standard wording by default; the AI writes a message only when someone asks ----------
  function standardNote(D, p, period, total, kind) {
    const to = p.payer.type === 'family' ? firstWord(billTo(p).name) : 'there';
    if (p.payer.type !== 'family') return { subject: `${D.settings.practice}: ${p.known_as}, ${period}`, note: `Hello, please find the invoice for ${p.known_as}'s speech and language therapy, ${period}, ${gbp(total)}. It can be paid by PayPal or card using the button, or by bank transfer quoting the invoice number. Thank you.` };
    if (kind === 'block') return { subject: `${p.known_as}'s next block of sessions`, note: `Hi ${to}, ${p.known_as}'s current block is nearly used up, so here is the invoice for the next one (${gbp(total)}). Paying before it runs out keeps sessions going without a gap. You can pay by PayPal, card or bank transfer.` };
    return { subject: `${p.known_as}'s sessions: ${period}`, note: `Hi ${to}, thank you for bringing ${p.known_as}. This covers ${period} and comes to ${gbp(total)}. You can pay by PayPal or card using the button, or by bank transfer.` };
  }
  async function invoiceWords(D, p, period, total, kind, items, useAi = false) {
    const fallback = standardNote(D, p, period, total, kind);
    if (!ai || !useAi) return { ...fallback, by_ai: false };
    try {
      const r = await ai.invoiceNote({
        practice: D.settings.practice, therapist: D.settings.therapist, child_known_as: p.known_as, billed_to: p.payer.type === 'family' ? firstWord(billTo(p).name) : p.payer.name,
        payer_is_organisation: p.payer.type !== 'family', kind, period, total: gbp(total), lines: items.map((it) => `${it.name}: ${gbp(it.pence)}`),
      });
      if (r && r.subject && r.note) return { subject: String(r.subject).slice(0, 100), note: String(r.note).slice(0, 1200), by_ai: true };
    } catch (e) { log(D, 'info', `Standard invoice wording used (AI unavailable: ${e.message}).`, p.id); }
    return { ...fallback, by_ai: false };
  }
  function parseByRules(D, text) {
    const lower = text.toLowerCase();
    const words = lower.match(/[a-zà-ÿ'’-]+/g) || [];
    let p = D.patients.find((x) => words.some((w) => w.replace(/['’]s$/, '') === x.known_as.toLowerCase()));
    if (!p) p = D.patients.find((x) => x.caregivers.some((c) => words.includes(firstWord(c.name).toLowerCase())) || words.includes(x.name.split(' ').slice(-1)[0].toLowerCase()) || (x.payer.name && lower.includes(x.payer.name.toLowerCase().split(' ')[0])));
    const ref = (text.match(/\bref(?:erence)?\.?\s*:?\s*([A-Za-z0-9-]+)/i) || [])[1] || null;
    const noRef = ref ? text.replace(/\bref(?:erence)?\.?\s*:?\s*[A-Za-z0-9-]+/i, '') : text;
    const am = noRef.match(/£?\s?(\d[\d,]*(?:\.\d{1,2})?)/);
    const method = /cash/.test(lower) ? 'cash' : /cheque|check/.test(lower) ? 'cheque' : /bank|transfer|bacs/.test(lower) ? 'bank' : 'other';
    return { patient_id: p ? p.id : null, amount: am ? parseFloat(am[1].replace(/,/g, '')) : null, method, reference: ref };
  }
  async function parsePayment(D, text) {
    // The built-in reader first; the AI only when it can't tell who paid (e.g. "Liam's grandad dropped off cash").
    let r = parseByRules(D, text);
    if (!r.patient_id && ai) {
      try {
        r = await ai.parsePayment({ text, today: today(), patients: D.patients.map((p) => ({ id: p.id, name: p.name, known_as: p.known_as, caregivers: p.caregivers.map((c) => c.name + (c.relation ? ` (${c.relation})` : '')), paid_by: p.payer.type === 'family' ? 'family' : p.payer.name })) });
        if (r && r.patient_id && !pat(D, r.patient_id)) r.patient_id = null; // the AI may only pick a real patient
      } catch { r = null; }
      if (!r || !r.patient_id) r = parseByRules(D, text);
    }
    const p = pat(D, r.patient_id);
    let pence = r.amount != null ? toPence(r.amount) : null, assumed = false;
    if (p && !pence) { const owed = D.invoices.filter((i) => i.patient_id === p.id && isOpen(i)).reduce((t, i) => t + outstanding(i), 0); if (owed) { pence = owed; assumed = true; } }
    const method = ['cash', 'bank', 'cheque', 'other'].includes(r.method) ? r.method : 'other';
    const unclear = !p ? 'Which patient is this for? Use their name, for example “Liam paid £135 cash”.' : !pence ? `${p.known_as} doesn’t owe anything right now. How much was paid?` : null;
    const a = p && pence ? allocate(pence, D.invoices.filter((i) => i.patient_id === p.id)) : null;
    return { patient_id: p ? p.id : null, who: p ? p.known_as : null, pence, method, reference: r.reference || null, assumed, unclear, lines: a ? a.allocation.map((x) => ({ period: inv(D, x.invoice_id).period, pence: x.pence })) : [], credit: a ? a.credit_pence : 0 };
  }

  // ---------- PayPal steps ----------
  async function send(D, i, { quiet, sentOn } = {}) {
    const p = pat(D, i.patient_id);
    const link = linkFor ? await linkFor(i.id) : null;
    const r = await paypal.createAndSend({ invoice: i, to: i.to, practice: D.settings.practice, note: i.note + (link ? `\n\nPaid another way (bank transfer or cash)? Tell us here: ${link}` : ''), subject: i.subject, dueDate: addDays(today(), 14) });
    Object.assign(i, { paypal_id: r.id, view_url: r.view_url || null, status: 'SENT', sent_at: sentOn || today(), due_date: addDays(sentOn || today(), 14) });
    // A deposit already put toward this invoice (taken at check-in) is recorded on the PayPal invoice too.
    for (const x of D.payments.filter((y) => y.invoice_id === i.id)) {
      try { await paypal.recordPayment(r.id, { method: x.method, pence: x.pence, date: x.date, note: x.reference || 'Deposit' }); }
      catch (e) { log(D, 'error', `Deposit could not be shown on the PayPal invoice: ${e.message}`, i.patient_id); }
    }
    if (i.paid_pence >= i.total_pence) i.status = 'PAID'; else if (i.paid_pence > 0) i.status = 'PARTIALLY_PAID';
    if (!quiet) log(D, 'sent', `Invoice sent through PayPal to ${toName(i.to)}: ${p.known_as}, ${i.period}, ${gbp(i.total_pence)}.`, p.id);
  }
  function recordLocal(D, i, pence, method, ref, date = today()) {
    D.payments.unshift({ id: uid('pay'), patient_id: i.patient_id, invoice_id: i.id, date, pence, method, reference: ref || null });
    i.paid_pence += pence;
    if (i.paid_pence >= i.total_pence) { i.status = method === 'paypal' ? 'PAID' : 'MARKED_AS_PAID'; i.paid_at = date; } else i.status = 'PARTIALLY_PAID';
  }
  /** Ask PayPal about an invoice. A payment PayPal took itself is recorded here as a PayPal payment. */
  async function refresh(D, i) {
    if (!i.paypal_id || !isOpen(i)) return false;
    const s = await paypal.get(i.paypal_id);
    const offPayPal = D.payments.filter((x) => x.invoice_id === i.id).reduce((t, x) => t + x.pence, 0);
    const newPence = s.paid_pence - offPayPal;
    if (newPence > 0) {
      recordLocal(D, i, newPence, 'paypal');
      log(D, 'paid', `${toName(i.to)} paid ${gbp(newPence)} for ${pat(D, i.patient_id).known_as} through PayPal. Marked automatically.`, i.patient_id);
      return true;
    }
    if (s.status === 'CANCELLED') { i.status = 'CANCELLED'; log(D, 'info', `${pat(D, i.patient_id).known_as}, ${i.period}: cancelled in PayPal.`, i.patient_id); }
    return false;
  }

  // ---------- billing ----------
  const blockNo = (i) => parseInt(String(i.period).replace(/\D+/g, ''), 10) || 0;
  // Oldest first. Two blocks can be created in the same millisecond, so the block number breaks ties.
  const blocks = (D, pid) => D.invoices.filter((i) => i.patient_id === pid && i.kind === 'block' && i.status !== 'CANCELLED').sort((a, b) => a.created_at.localeCompare(b.created_at) || blockNo(a) - blockNo(b));
  const usedIn = (D, b) => D.sessions.filter((s) => s.invoice_id === b.id).length;
  const blockPrice = (D, p) => Math.round(svc(D, p.service_id).price_pence * D.settings.block_size * (100 - D.settings.block_discount) / 100);
  async function makeInvoice(D, p, { kind, period, items, sessionIds = [], blockSize, words }) {
    const total = items.reduce((s, it) => s + it.pence, 0);
    const w = words || await invoiceWords(D, p, period, total, kind, items);
    const i = { id: uid('inv'), patient_id: p.id, kind, block_size: blockSize || null, status: 'DRAFT', period, items, total_pence: total, paid_pence: 0, note: w.note, subject: w.subject, note_by_ai: !!w.by_ai, created_at: now(), sent_at: null, due_date: null, reminder_count: 0, last_reminder_at: null, paid_at: null, to: billTo(p), paypal_id: null };
    D.invoices.unshift(i);
    sessionIds.forEach((id) => { D.sessions.find((s) => s.id === id).invoice_id = i.id; });
    return i;
  }
  async function newBlock(D, p, why) {
    const size = D.settings.block_size;
    const i = await makeInvoice(D, p, { kind: 'block', period: `Block ${blocks(D, p.id).length + 1}`, items: [tagLine(D, { name: `${size} × ${svc(D, p.service_id).name}${D.settings.block_discount ? ` (${D.settings.block_discount}% block discount)` : ''}`, pence: blockPrice(D, p) }, p.service_id)], blockSize: size });
    if (D.settings.renew_action === 'send') { await send(D, i, { quiet: true }); log(D, 'sent', `${why} Next block invoice sent through PayPal to ${toName(i.to)}: ${p.known_as}, ${gbp(i.total_pence)}.`, p.id); }
    else log(D, 'draft', `${why} Next block invoice for ${p.known_as} saved as a draft.`, p.id);
    return i;
  }
  async function logSession(D, pid, { date, service_id, where }) {
    const p = pat(D, pid); if (!p) throw new Error('That patient was not found.');
    const s0 = svc(D, service_id || p.service_id) || svc(D, p.service_id);
    const s = { id: uid('ses'), patient_id: pid, date, service_id: s0.id, minutes: s0.minutes, where, price_pence: s0.price_pence, invoice_id: null };
    D.sessions.unshift(s);
    if (p.plan !== 'block' || s0.id !== p.service_id) { log(D, 'info', `Session logged: ${p.known_as}, ${s0.name.toLowerCase()}, ${fdate(date)}.`, pid); return; }
    const b = blocks(D, pid).find((x) => usedIn(D, x) < x.block_size) || await newBlock(D, p, `${p.known_as} had no sessions left.`);
    s.invoice_id = b.id;
    const u = usedIn(D, b);
    log(D, 'info', `Session logged: ${p.known_as}, ${fdate(date)}, ${u} of ${b.block_size} in ${b.period.toLowerCase()}.`, pid);
    if (blocks(D, pid).slice(-1)[0] === b && u >= Math.min(D.settings.renew_at, b.block_size)) await newBlock(D, p, `Session ${u} of ${b.block_size}.`);
  }
  async function draftFor(D, pid) {
    const p = pat(D, pid);
    const waiting = D.sessions.filter((s) => s.patient_id === pid && !s.invoice_id).sort((a, b) => a.date.localeCompare(b.date));
    if (!waiting.length) throw new Error(`Nothing waiting to be invoiced for ${p.known_as}.`);
    let pick, period, kind;
    if (p.plan === 'monthly') { const mo = waiting[0].date.slice(0, 7); pick = waiting.filter((s) => s.date.startsWith(mo)); period = fmonth(mo); kind = 'monthly'; }
    else { pick = p.plan === 'session' ? [waiting[waiting.length - 1]] : waiting; period = pick.length === 1 ? fdate(pick[0].date) : `${fdate(pick[0].date)} to ${fdate(pick[pick.length - 1].date)}`; kind = 'session'; }
    const items = pick.map((s) => tagLine(D, { name: `${svc(D, s.service_id).name}, ${fdate(s.date)}${s.where === 'online' ? ' (online)' : ''}`, pence: s.price_pence }, s.service_id));
    const i = await makeInvoice(D, p, { kind, period, items, sessionIds: pick.map((s) => s.id) });
    log(D, 'draft', `Draft invoice: ${p.known_as}, ${period}, ${gbp(i.total_pence)}${i.note_by_ai ? ' (message written by AI)' : ''}.`, p.id);
    return i.id;
  }
  function nextReminderText(D, i) {
    const p = pat(D, i.patient_id), n = i.reminder_count + 1;
    const t = i.next_reminder || D.settings.reminder_texts[Math.min(n, D.settings.reminder_texts.length) - 1];
    return fill(D, t, p, i);
  }
  async function sendReminder(D, i) {
    const p = pat(D, i.patient_id);
    const text = nextReminderText(D, i);
    const link = linkFor ? await linkFor(i.id) : null;
    await paypal.remind(i.paypal_id, { subject: `Reminder: ${p.known_as}, ${i.period}`, note: text + (link ? `\n\nPaid another way? Tell us here: ${link}` : '') });
    i.last_reminder = text; i.reminder_count += 1; i.last_reminder_at = today(); i.next_reminder = null;
    log(D, 'reminder', `Reminder ${i.reminder_count} sent through PayPal to ${toName(i.to)}: ${p.known_as}, ${i.period}.`, p.id);
  }
  async function reminders(D) {
    let sent = 0;
    for (const i of D.invoices.filter(isOpen)) {
      try {
        if (await refresh(D, i)) continue; // never remind someone who has just paid
        if (!i.paypal_id) continue;
        const passed = D.settings.reminder_days.filter((d) => daysBetween(i.sent_at, today()) >= d).length;
        if (passed <= i.reminder_count || (i.last_reminder_at && daysBetween(i.last_reminder_at, today()) < 1)) continue;
        // Always the next reminder in order, one a day at most, so a missed day never makes the tone harsher.
        await sendReminder(D, i);
        sent++;
      } catch (e) { log(D, 'error', `Reminder not sent for ${pat(D, i.patient_id).known_as}, ${i.period}: ${e.message}`, i.patient_id); }
    }
    return sent;
  }
  async function confirm(D, cid) {
    const c = D.claims.find((x) => x.id === cid);
    if (!c || c.status !== 'pending') throw new Error('That payment has already been handled.');
    const p = pat(D, c.patient_id);
    for (const i of D.invoices.filter((x) => x.patient_id === p.id && isOpen(x))) await refresh(D, i);
    const { allocation, credit_pence } = allocate(c.amount_pence, D.invoices.filter((i) => i.patient_id === p.id), c.invoice_id);
    for (const a of allocation) {
      const i = inv(D, a.invoice_id);
      if (i.paypal_id) await paypal.recordPayment(i.paypal_id, { method: c.method, pence: a.pence, date: today(), note: [c.reference && 'Ref ' + c.reference, c.source === 'family' ? 'Reported by family, confirmed by therapist' : 'Recorded by therapist'].filter(Boolean).join('. ') });
      recordLocal(D, i, a.pence, c.method, c.reference);
    }
    if (credit_pence) p.credit_pence += credit_pence;
    c.status = 'confirmed';
    log(D, 'paid', `${gbp(c.amount_pence)} ${how(c.method)} for ${p.known_as}, recorded on the PayPal invoice${credit_pence ? `; ${gbp(credit_pence)} kept as credit` : ''}.`, p.id);
  }

  // ---------- finances for a month ----------
  function finances(D, ym) {
    const inMonth = (d) => d && d.slice(0, 7) === ym;
    const pays = D.payments.filter((x) => inMonth(x.date));
    const paidIn = pays.reduce((s, x) => s + x.pence, 0);
    const fees = pays.filter((x) => x.method === 'paypal').reduce((s, x) => s + Math.round(x.pence * D.settings.fee_percent / 100) + D.settings.fee_fixed_pence, 0);
    const expenses = D.expenses.filter((e) => inMonth(e.date)).sort((a, b) => a.date.localeCompare(b.date));
    const spent = expenses.reduce((s, e) => s + e.pence, 0);
    const sessions = D.sessions.filter((s) => inMonth(s.date));
    const byService = D.services.map((sv) => { const ss = sessions.filter((s) => s.service_id === sv.id); return { name: sv.name, count: ss.length, pence: ss.reduce((t, s) => t + s.price_pence, 0) }; }).filter((x) => x.count);
    const label = { family: 'Families', school: 'Schools', council: 'Local authorities', charity: 'Charities and other' };
    const group = (key) => Object.entries(pays.reduce((acc, x) => { const k = key(x); acc[k] = (acc[k] || 0) + x.pence; return acc; }, {}));
    return {
      month: ym, label: fmonth(ym), paidIn, fees, spent, profit: paidIn - fees - spent, payments: pays.length, expenses, byService,
      byPayer: group((x) => pat(D, x.patient_id).payer.type).map(([t, pence]) => ({ name: label[t] || 'Other', pence })),
      byMethod: group((x) => x.method).map(([mth, pence]) => ({ name: { paypal: 'PayPal and card', bank: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other' }[mth], pence })),
      hours: Math.round(sessions.reduce((t, s) => t + s.minutes, 0) / 6) / 10, sessionCount: sessions.filter((s) => s.minutes).length,
    };
  }

  // ---------- demo data: six made-up patients over two months ----------
  /** A clinic's own copy keeps its data across updates: missing lists are added, nothing is replaced. */
  function migrate(D) {
    for (const k of ['patients', 'sessions', 'invoices', 'payments', 'claims', 'expenses', 'events', 'spend', 'requests', 'appointments', 'insurers', 'partners', 'insurance_claims', 'partner_payouts', 'payment_plans', 'departments', 'services']) if (!Array.isArray(D[k])) D[k] = [];
    D.settings.deposit_pence = D.settings.deposit_pence || 0; D.settings.deposit_services = D.settings.deposit_services || [];
  }
  async function seed(D, { empty = false, name } = {}) {
    const d = (k) => addDays(today(), -k);
    Object.assign(D, {
      settings: {
        practice: 'Northern Voices Children’s Hospital', therapist: 'the billing office', reminder_days: [3, 7, 14], block_size: 10, block_discount: 10, renew_at: 8, renew_action: 'send', fee_percent: 2.9, fee_fixed_pence: 30,
        deposit_pence: 2000, deposit_services: ['svc_eeg', 'svc_echo', 'svc_aid', 'svc_intensive'],
        reminder_texts: [
          'Hi {name}, a quick reminder that the invoice for {child}, {period} ({amount}) is still open. If you have already paid by bank transfer or cash, you can tell us with the link below.',
          'Hi {name}, {amount} for {child}, {period} is still unpaid. If something is wrong with the invoice, or the timing is difficult, please reply and we can sort it out.',
          'Hi {name}, this is the last automatic reminder for {child}, {period} ({amount}). Please pay or get in touch this week. Thank you.',
        ],
      },
      // Departments and their codes, with the budget the hospital allocates each one for the financial year.
      departments: [
        ['ent', 'ENT-01', 'Ear, Nose and Throat (ENT)', 18000], ['paed', 'PAED-01', 'Paediatrics', 15000], ['neuro', 'NEU-01', 'Neurology', 22000],
        ['cardio', 'CARD-01', 'Cardiology', 25000], ['pt', 'PT-01', 'Physiotherapy', 9000], ['ot', 'OT-01', 'Occupational Therapy', 8000],
        ['avt', 'AVT-01', 'Auditory-Verbal Therapy', 7000], ['slt', 'SLT-01', 'Speech and Language Therapy', 12000], ['aud', 'AUD-01', 'Audiology', 16000], ['dx', 'DX-01', 'Diagnostics and Assessment', 10000],
      ].map(([k, code, name, pounds]) => ({ id: 'dep_' + k, code, name, budget_pence: pounds * 100, payout_email: `${code.toLowerCase()}.payouts@example.org` })),
      services: [
        { id: 'svc_assess', name: 'Assessment', minutes: 60, price_pence: 12000, department_id: 'dep_dx' },
        { id: 'svc_45', name: 'Therapy session', minutes: 45, price_pence: 6000, department_id: 'dep_slt' },
        { id: 'svc_30', name: 'Short therapy session', minutes: 30, price_pence: 4500, department_id: 'dep_slt' },
        { id: 'svc_check', name: 'Online check-in', minutes: 20, price_pence: 3000, department_id: 'dep_slt' },
        { id: 'svc_intensive', name: 'Intensive day', minutes: 180, price_pence: 30000, department_id: 'dep_slt' },
        { id: 'svc_travel', name: 'Travel to home or school', minutes: 0, price_pence: 2000, department_id: 'dep_slt' },
        { id: 'svc_ent', name: 'ENT consultation', minutes: 30, price_pence: 15000, department_id: 'dep_ent' },
        { id: 'svc_paed', name: 'Paediatric consultation', minutes: 30, price_pence: 16000, department_id: 'dep_paed' },
        { id: 'svc_eeg', name: 'EEG and neurology review', minutes: 60, price_pence: 28000, department_id: 'dep_neuro' },
        { id: 'svc_echo', name: 'ECG and echocardiogram', minutes: 45, price_pence: 24000, department_id: 'dep_cardio' },
        { id: 'svc_pt', name: 'Physiotherapy session', minutes: 45, price_pence: 6500, department_id: 'dep_pt' },
        { id: 'svc_ot', name: 'Occupational therapy session', minutes: 45, price_pence: 6500, department_id: 'dep_ot' },
        { id: 'svc_avt', name: 'Auditory-verbal therapy session', minutes: 60, price_pence: 7000, department_id: 'dep_avt' },
        { id: 'svc_hear', name: 'Hearing test', minutes: 45, price_pence: 8500, department_id: 'dep_aud' },
        { id: 'svc_aid', name: 'Hearing aid fitting', minutes: 60, price_pence: 22000, department_id: 'dep_aud' },
        // Done by an outside provider: the hospital bills and collects; the partner's fee is paid with PayPal Payouts.
        { id: 'svc_petct', name: 'PET-CT scan (Lakeside Imaging)', minutes: 90, price_pence: 95000, department_id: 'dep_dx', partner_id: 'pt_lakeside', partner_pence: 80000 },
        // Surgery: paid with a payment plan, not logged as a session.
        { id: 'svc_tonsil', name: 'Tonsillectomy (day surgery)', minutes: 0, price_pence: 320000, department_id: 'dep_ent', plan_only: true },
        { id: 'svc_grommets', name: 'Grommets (day surgery)', minutes: 0, price_pence: 240000, department_id: 'dep_ent', plan_only: true },
      ],
      insurers: [
        { id: 'ins_carewell', name: 'Carewell Health Insurance', email: 'claims@carewell.example', pay_days: 30 },
        { id: 'ins_northshield', name: 'Northshield Medical', email: 'provider-claims@northshield.example', pay_days: 21 },
      ],
      partners: [{ id: 'pt_lakeside', name: 'Lakeside Imaging Centre', payout_email: 'accounts@lakeside-imaging.example', what: 'PET-CT scans' }],
      insurance_claims: [], partner_payouts: [], payment_plans: [],
      patients: [], sessions: [], invoices: [], payments: [], claims: [], expenses: [], events: [], spend: [], requests: [], appointments: [],
    });
    if (empty) {
      // A clinic's own copy: sample departments and services to edit, no made-up patients or history.
      Object.assign(D.settings, { practice: String(name || 'Our clinic').slice(0, 80), therapist: 'the billing office' });
      D.departments.forEach((x) => { x.budget_pence = 0; x.payout_email = ''; });
      Object.assign(D, { insurers: [], partners: [] });
      D.services = D.services.filter((v) => !v.partner_id);
      log(D, 'info', 'TJS Pay is ready. Add your patients, set department budgets and PayPal emails, and check service prices in Settings.');
      return;
    }
    const P = (o) => D.patients.push({ credit_pence: 0, ...o });
    P({ id: 'p_arjun', name: 'Arjun Patel', known_as: 'Arjun', caregivers: [{ name: 'Priya Patel', relation: 'Mum', email: 'priya@example.com', invoices: true }], payer: { type: 'family' }, plan: 'session', service_id: 'svc_45' });
    P({ id: 'p_amara', insurance: { insurer_id: 'ins_carewell', policy: 'CW-4471902', excess_pence: 5000 }, name: 'Amara Okafor', known_as: 'Amara', caregivers: [{ name: 'Chidi Okafor', relation: 'Dad', email: 'chidi@example.com', invoices: true }, { name: 'Ngozi Okafor', relation: 'Mum', email: 'ngozi@example.com', invoices: false }], payer: { type: 'family' }, plan: 'monthly', service_id: 'svc_30' });
    P({ id: 'p_freya', name: 'Freya Jensen', known_as: 'Freya', caregivers: [{ name: 'Emma Jensen', relation: 'Mum', email: 'emma@example.com', invoices: true }], payer: { type: 'family' }, plan: 'session', service_id: 'svc_45' });
    P({ id: 'p_liam', name: 'Liam Murphy', known_as: 'Liam', caregivers: [{ name: 'Siobhan Murphy', relation: 'Mum', email: 'siobhan@example.com', invoices: true }, { name: 'Declan Murphy', relation: 'Grandad, does pick-ups', email: '', invoices: false }], payer: { type: 'family' }, plan: 'monthly', service_id: 'svc_30' });
    P({ id: 'p_zara', name: 'Zara Khan', known_as: 'Zara', caregivers: [{ name: 'Aisha Khan', relation: 'Mum', email: 'aisha@example.com', invoices: true }], payer: { type: 'family' }, plan: 'block', service_id: 'svc_45' });
    P({ id: 'p_tomas', name: 'Tomás Silva Pereira', known_as: 'Tomás', caregivers: [{ name: 'Jo Hughes', relation: 'Foster carer', email: 'jo@example.com', invoices: false }], payer: { type: 'council', name: 'Northfield Council SEND team', email: 'send.payments@example.gov.uk' }, plan: 'monthly', service_id: 'svc_45' });

    const S = (pid, date, service_id, where = 'in person', invoice_id = null) => { const s0 = svc(D, service_id); const s = { id: uid('ses'), patient_id: pid, date, service_id, minutes: s0.minutes, where, price_pence: s0.price_pence, invoice_id }; D.sessions.push(s); return s; };
    const lastMonth = addDays(today().slice(0, 8) + '01', -1).slice(0, 7);
    const twoAgo = addDays(lastMonth + '-01', -1).slice(0, 7);
    const quick = (p, period, total, kind) => ({ ...standardNote(D, p, period, total, kind), by_ai: false });
    // Paid history lives in TJS Pay only. Unpaid invoices are created for real in PayPal (the sandbox), so they can be paid and reminded.
    const old = async (p, kind, period, ses, sentDaysAgo, paidDaysAgo, method, ref) => {
      const items = ses.map((s) => tagLine(D, { name: svc(D, s.service_id).name + ', ' + fdate(s.date), pence: s.price_pence }, s.service_id));
      const i = await makeInvoice(D, p, { kind, period, items, sessionIds: ses.map((s) => s.id), words: quick(p, period, items.reduce((t, x) => t + x.pence, 0), kind) });
      if (paidDaysAgo != null) { Object.assign(i, { status: 'SENT', sent_at: d(sentDaysAgo), due_date: d(sentDaysAgo - 14) }); recordLocal(D, i, i.total_pence, method, ref, d(paidDaysAgo)); }
      else { await send(D, i, { quiet: true }); Object.assign(i, { sent_at: d(sentDaysAgo), due_date: d(sentDaysAgo - 14) }); }
      return i;
    };
    // Paid visits to the other departments, so every department has money to settle.
    const visit = async (pid, list, sentAgo, paidAgo, method, ref) => old(pat(D, pid), 'session', fdate(d(list[0][0])), list.map(([k, sid, where]) => S(pid, d(k), sid, where || 'in person')), sentAgo, paidAgo, method, ref);
    await visit('p_arjun', [[40, 'svc_ent'], [40, 'svc_hear']], 39, 37, 'paypal');
    await visit('p_arjun', [[8, 'svc_ent']], 7, 5, 'paypal');
    await visit('p_amara', [[44, 'svc_aid']], 43, 41, 'paypal');
    await visit('p_amara', [[19, 'svc_avt', 'online'], [12, 'svc_avt', 'online']], 11, 9, 'paypal');
    await visit('p_freya', [[36, 'svc_paed'], [33, 'svc_eeg']], 32, 29, 'bank', 'JENSEN-0921');
    await visit('p_freya', [[6, 'svc_paed']], 5, 2, 'paypal');
    await visit('p_liam', [[27, 'svc_echo']], 26, 24, 'paypal');
    // Arjun's mum paid the hospital for a PET-CT scan done by Lakeside Imaging: the hospital owes Lakeside its fee.
    await visit('p_arjun', [[15, 'svc_petct']], 14, 12, 'paypal');
    await visit('p_zara', [[22, 'svc_pt'], [15, 'svc_pt']], 14, 12, 'paypal');
    await visit('p_tomas', [[16, 'svc_ot', 'at school'], [9, 'svc_ot', 'at school']], 8, 4, 'bank', 'NFC-PO-88530');
    for (const [k, pk] of [[25, 24], [18, 17], [11, 3]]) await old(pat(D, 'p_arjun'), 'session', fdate(d(k)), [S('p_arjun', d(k), 'svc_45')], k, pk, 'paypal');
    S('p_arjun', d(4), 'svc_45');
    await old(pat(D, 'p_amara'), 'monthly', fmonth(twoAgo), ['04', '11', '18', '25'].map((x) => S('p_amara', `${twoAgo}-${x}`, 'svc_30', 'online')), 34, 31, 'paypal');
    ['04', '11', '18', '25'].forEach((x) => S('p_amara', `${lastMonth}-${x}`, 'svc_30', 'online'));
    await old(pat(D, 'p_freya'), 'session', fdate(d(31)), [S('p_freya', d(31), 'svc_assess')], 30, 27, 'paypal');
    const fj = await old(pat(D, 'p_freya'), 'session', fdate(d(10)), [S('p_freya', d(10), 'svc_45')], 9, null);
    Object.assign(fj, { reminder_count: 1, last_reminder_at: d(6) });
    const lm = await old(pat(D, 'p_liam'), 'monthly', fmonth(twoAgo), ['08', '15', '22'].map((x) => S('p_liam', `${twoAgo}-${x}`, 'svc_30')), 20, null);
    Object.assign(lm, { reminder_count: 1, last_reminder_at: d(17) });
    const zp = pat(D, 'p_zara');
    const zb = await makeInvoice(D, zp, { kind: 'block', period: 'Block 1', items: [tagLine(D, { name: '10 × Therapy session (10% block discount)', pence: 54000 }, 'svc_45')], blockSize: 10, words: quick(zp, 'Block 1', 54000, 'block') });
    Object.assign(zb, { status: 'SENT', sent_at: d(52), due_date: d(38) }); recordLocal(D, zb, 54000, 'bank', 'KHAN BLOCK1', d(50));
    [49, 42, 35, 28, 21, 14, 7].forEach((k) => S('p_zara', d(k), 'svc_45', 'in person', zb.id));
    await old(pat(D, 'p_tomas'), 'monthly', fmonth(twoAgo), [S('p_tomas', `${twoAgo}-06`, 'svc_assess', 'at school'), S('p_tomas', `${twoAgo}-06`, 'svc_travel'), ...['13', '20', '27'].map((x) => S('p_tomas', `${twoAgo}-${x}`, 'svc_45', 'at school'))], 33, 20, 'bank', 'NFC-PO-88213');
    await old(pat(D, 'p_tomas'), 'monthly', fmonth(lastMonth), ['03', '10', '17', '24'].map((x) => S('p_tomas', `${lastMonth}-${x}`, 'svc_45', 'at school')), 5, null);
    // Department spending this financial year, and money requests to the finance department.
    const fyStart = fyOf(today()).start, dd = (k) => { const x = d(k); return x < fyStart ? fyStart : x; };
    [['ent', 120, 'Otoscope replacement heads', 'Equipment', 1240000], ['ent', 40, 'Disposable specula', 'Supplies', 38000], ['paed', 90, 'Growth charts and scales service', 'Equipment', 620000], ['neuro', 150, 'EEG cap replacements', 'Equipment', 1690000], ['neuro', 30, 'Conference: paediatric epilepsy', 'Training', 245000],
      ['cardio', 100, 'Holter monitor service contract', 'Equipment', 980000], ['pt', 60, 'Treatment couch', 'Equipment', 410000], ['ot', 75, 'Sensory room equipment', 'Equipment', 350000], ['avt', 50, 'Toys and listening materials', 'Supplies', 120000],
      ['slt', 80, 'CELF-5 test forms', 'Supplies', 260000], ['slt', 20, 'AAC device loan stock', 'Equipment', 310000], ['aud', 110, 'Audiometer calibration', 'Equipment', 450000], ['dx', 70, 'Assessment software licence', 'Other', 280000]]
      .forEach(([k, ago, what, category, pence]) => D.spend.push({ id: uid('sp'), dept_id: 'dep_' + k, date: dd(ago), what, category, pence }));
    const R = (k, ago, pence, purpose, supplier, status, extra = {}) => { const dp = D.departments.find((x) => x.id === 'dep_' + k); D.requests.push({ id: uid('rq'), dept_id: dp.id, created_at: new Date(Date.parse(d(ago) + 'T10:00:00Z')).toISOString(), pence, purpose, pay_to: supplier ? 'supplier' : 'department', payee_name: supplier ? supplier[0] : `${dp.code} ${dp.name}`, payee_email: supplier ? supplier[1] : dp.payout_email, status, reason: null, decided_at: null, payout: null, ...extra }); };
    R('slt', 25, 9500, 'Replacement assessment forms', null, 'paid', { decided_at: new Date(Date.parse(dd(24) + 'T15:00:00Z')).toISOString(), payout: { batch_id: 'DEMO-HISTORY', item_id: 'SLT-01-demo', status: 'SUCCESS', seeded: true } });
    R('cardio', 18, 30000, 'ECG paper rolls', ['HeartTrace Supplies', 'orders@hearttrace.example'], 'rejected', { decided_at: new Date(Date.parse(dd(17) + 'T11:00:00Z')).toISOString(), reason: 'Please order through the hospital’s ECG paper contract.' });
    R('aud', 3, 64000, 'Hearing aid batteries and repair kits', ['SoundCare Supplies', 'sales@soundcare.example'], 'pending');
    R('pt', 2, 18000, 'Resistance bands and balance boards', null, 'pending');
    R('neuro', 1, 320000, 'EEG electrodes and conductive gel for the new clinic', ['NeuroSupply UK', 'accounts@neurosupply.example'], 'pending');
    [[twoAgo, '01', 'Room hire at the community centre', 'Rent', 40000], [twoAgo, '09', 'Assessment forms', 'Materials', 8500], [twoAgo, '30', 'Mileage, school visits', 'Travel', 4200], [lastMonth, '01', 'Room hire at the community centre', 'Rent', 40000], [lastMonth, '12', 'HCPC registration (monthly share)', 'Professional', 1800], [lastMonth, '20', 'Picture cards and toys', 'Materials', 3150], [lastMonth, '28', 'Mileage, school visits', 'Travel', 3800], [today().slice(0, 7), '01', 'Room hire at the community centre', 'Rent', 40000]]
      .forEach(([mo, dd, what, cat, pence]) => D.expenses.push({ id: uid('exp'), date: `${mo}-${dd}`, what, category: cat, pence }));
    // An insured visit: Amara's excess was paid through PayPal; the rest is claimed from her insurer, not paid yet.
    {
      const am = pat(D, 'p_amara'), ses = S('p_amara', d(18), 'svc_hear');
      const vi = await makeInvoice(D, am, { kind: 'session', period: fdate(d(18)), items: [tagLine(D, { name: `Hearing test, ${fdate(d(18))}`, pence: 8500 }, 'svc_hear')], sessionIds: [ses.id], words: quick(am, fdate(d(18)), 8500, 'session') });
      await billInsurance(D, vi.id, { excess: '50' });
      Object.assign(vi, { status: 'SENT', sent_at: d(17), due_date: d(3) }); recordLocal(D, vi, 5000, 'paypal', null, d(15));
      const cl = D.insurance_claims[0]; cl.submitted_at = new Date(Date.parse(d(17) + 'T10:00:00Z')).toISOString(); Object.assign(inv(D, cl.invoice_id), { sent_at: d(17), due_date: d(-13) });
    }
    // Upcoming appointments for the check-in & pay demo (none checked in yet, so every PayPal hold is real).
    const later = (k) => addDays(today(), k);
    [['p_freya', 'svc_eeg', later(0), '15:30'], ['p_arjun', 'svc_45', later(0), '16:15'], ['p_amara', 'svc_aid', later(1), '10:00'], ['p_liam', 'svc_intensive', later(2), '09:00'], ['p_tomas', 'svc_ot', later(1), '13:30']]
      .forEach(([pid, sid, date, time]) => book(D, { patient_id: pid, service_id: sid, date, time }));
    D.events = [];
    log(D, 'info', paypal.mode === 'mock' ? 'Demo data loaded (PayPal simulated).' : 'Demo data loaded. Unpaid invoices were created in the PayPal sandbox.');
  }

  // ---------- what the screen sends ----------
  const state = (D, mode) => ({ mode, today: today(), ...D, mock_paypal: undefined, plans: undefined, ai_usage: undefined, ai: !!ai, clinic, ai_today: { calls: D.ai_usage && D.ai_usage.day === new Date().toISOString().slice(0, 10) ? D.ai_usage.requests : 0, limit: aiLimit || null }, blockPrices: Object.fromEntries(D.patients.map((p) => [p.id, blockPrice(D, p)])) });

  async function handle(D, path, b = {}, mode) {
    const p = path.split('/');
    switch (p[0]) {
      case 'state': return state(D, mode);
      case 'seed': if (clinic) throw new Error('This is a clinic’s own copy: demo data can’t be loaded here.'); await seed(D); return state(D, mode);
      case 'money': return finances(D, /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : today().slice(0, 7));
      case 'settings': {
        const s = D.settings;
        if (b.practice) s.practice = String(b.practice).slice(0, 80);
        if (b.therapist) s.therapist = String(b.therapist).slice(0, 40);
        if (b.reminder_days) { const v = String(b.reminder_days).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0 && x < 90); if (v.length) s.reminder_days = [...new Set(v)].sort((x, y) => x - y); }
        const num = (v, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
        if (num(b.block_size, 2, 40) != null) s.block_size = Math.round(b.block_size);
        if (num(b.renew_at, 1, 40) != null) s.renew_at = Math.min(Math.round(b.renew_at), s.block_size);
        if (num(b.block_discount, 0, 50) != null) s.block_discount = Math.round(b.block_discount);
        if (['send', 'draft'].includes(b.renew_action)) s.renew_action = b.renew_action;
        if (b.deposit != null && toPence(b.deposit) != null && toPence(b.deposit) <= 50000) s.deposit_pence = toPence(b.deposit);
        if (Array.isArray(b.deposit_services)) s.deposit_services = b.deposit_services.filter((id) => svc(D, id));
        if (num(b.fee_percent, 0, 10) != null) s.fee_percent = parseFloat(b.fee_percent);
        if (b.fee_fixed != null && toPence(b.fee_fixed) != null) s.fee_fixed_pence = toPence(b.fee_fixed);
        if (Array.isArray(b.reminder_texts) && b.reminder_texts.length && b.reminder_texts.every((t) => String(t).trim())) s.reminder_texts = b.reminder_texts.map((t) => String(t).trim().slice(0, 1200));
        if (Array.isArray(b.services)) b.services.forEach((x) => { const sv = svc(D, x.id); if (sv && toPence(x.price)) { sv.price_pence = toPence(x.price); if (x.name) sv.name = String(x.name).slice(0, 40); } });
        return state(D, mode);
      }
      case 'patients': {
        if (!b.name || !b.caregiver_name) throw new Error('Add the patient’s name and at least one caregiver.');
        const id = uid('p');
        D.patients.push({ id, name: String(b.name).slice(0, 80), known_as: String(b.known_as || firstWord(b.name)).slice(0, 40), caregivers: [{ name: String(b.caregiver_name).slice(0, 80), relation: String(b.relation || '').slice(0, 40), email: String(b.email || '').slice(0, 120), invoices: true }],
          payer: b.payer_type && b.payer_type !== 'family' ? { type: ['school', 'council', 'charity'].includes(b.payer_type) ? b.payer_type : 'charity', name: String(b.payer_name || 'Funder').slice(0, 80), email: String(b.payer_email || '').slice(0, 120) } : { type: 'family' },
          plan: ['session', 'monthly', 'block'].includes(b.plan) ? b.plan : 'session', service_id: svc(D, b.service_id) ? b.service_id : 'svc_45', credit_pence: 0 });
        log(D, 'info', `Patient added: ${b.known_as || firstWord(b.name)}.`, id);
        const st = state(D, mode); st.added = id; return st;
      }
      case 'sessions': await logSession(D, b.patient_id, { date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') && b.date <= today() ? b.date : today(), service_id: b.service_id, where: ['in person', 'online', 'at school', 'at home'].includes(b.where) ? b.where : 'in person' }); return state(D, mode);
      case 'invoices': {
        if (p[1] === 'draft') { const id = await draftFor(D, b.patient_id); const st = state(D, mode); st.draft = id; return st; }
        const i = inv(D, p[1]); if (!i) throw new Error('That invoice was not found.');
        if (p[2] === 'send') { if (i.status !== 'DRAFT') throw new Error('Already sent.'); if (b.note) i.note = String(b.note).slice(0, 1500); if (b.subject) i.subject = String(b.subject).slice(0, 100); await send(D, i); }
        else if (p[2] === 'discard') { if (i.status !== 'DRAFT') throw new Error('Only drafts can be deleted.'); if (i.paid_pence > 0) throw new Error('A deposit has already been put toward this invoice, so it can’t be deleted. Send it instead.'); D.sessions.forEach((s) => { if (s.invoice_id === i.id) s.invoice_id = null; }); D.invoices = D.invoices.filter((x) => x !== i); }
        else if (p[2] === 'refresh') { if (!(await refresh(D, i))) log(D, 'info', `Checked PayPal: ${pat(D, i.patient_id).known_as}, ${i.period} not paid yet.`, i.patient_id); }
        else if (p[2] === 'reminder-text') return { text: i.next_reminder || D.settings.reminder_texts[Math.min(i.reminder_count + 1, D.settings.reminder_texts.length) - 1], filled: nextReminderText(D, i), custom: !!i.next_reminder, number: i.reminder_count + 1 };
        else if (p[2] === 'reminder-save') { i.next_reminder = String(b.text || '').trim().slice(0, 1200) || null; log(D, 'info', `Next reminder edited: ${pat(D, i.patient_id).known_as}, ${i.period}.`, i.patient_id); }
        else if (p[2] === 'reminder-now') { if (!isOpen(i)) throw new Error('This invoice is already paid.'); if (await refresh(D, i)) return state(D, mode); if (b.text) i.next_reminder = String(b.text).trim().slice(0, 1200); await sendReminder(D, i); }
        else if (p[2] === 'ai-note') {
          if (i.status !== 'DRAFT') throw new Error('Only drafts can be reworded.');
          if (!ai) throw new Error('AI writing is not available here.');
          const pt = pat(D, i.patient_id), w = await invoiceWords(D, pt, i.period, i.total_pence, i.kind, i.items, true);
          if (!w.by_ai) throw new Error('The AI couldn’t write a message just now. The standard wording is still there.');
          Object.assign(i, { subject: w.subject, note: w.note, note_by_ai: true });
          return { subject: i.subject, note: i.note };
        }
        else if (p[2] === 'reminder-rewrite') {
          if (!ai) throw new Error('AI rewriting is not available here.');
          return { text: await ai.rewriteReminder({ text: String(b.text || '').slice(0, 1200), style: ['warmer', 'shorter', 'firmer'].includes(b.style) ? b.style : 'warmer' }) };
        }
        else if (p[2] === 'family-link') return { url: linkFor ? await linkFor(i.id) : null };
        else if (p[2] === 'mock-pay') {
          if (!paypal.simulatePay) throw new Error('Only in test mode.');
          await paypal.simulatePay(i.paypal_id); await refresh(D, i);
        } else throw new Error('Not found');
        return state(D, mode);
      }
      case 'assistant': {
        if (p[1] === 'approve') { const results = await approve(D, String(b.plan_id || ''), b.numbers); const st = state(D, mode); st.results = results; return st; }
        return { plan: await assistant(D, b.request, b.team, !!b.instant) };
      }
      case 'insurance': {
        if (p[1] === 'split') await billInsurance(D, String(b.invoice_id || ''), b);
        else if (p[2] === 'paid') await settleClaim(D, p[1], b, false);
        else if (p[2] === 'rejected') await settleClaim(D, p[1], b, true);
        else throw new Error('Not found');
        return state(D, mode);
      }
      case 'partners': {
        if (p[2] === 'pay') await payPartner(D, p[1]);
        return { ...state(D, mode), budgets: budgets(D) };
      }
      case 'plans': {
        if (!p[1]) await createPlan(D, b);
        else if (p[2] === 'send') { const pl = pplan(D, p[1]), part = pl && pl.parts[parseInt(b.part, 10)]; if (!part || part.invoice_id) throw new Error('That instalment has already been sent.'); await sendPart(D, pl, part); }
        else throw new Error('Not found');
        return state(D, mode);
      }
      case 'appointments': {
        if (!p[1]) { const a = book(D, b); const st = state(D, mode); st.booked = a.id; return st; }
        if (p[2] === 'link') { if (!appt(D, p[1])) throw new Error('Not found'); return { checkin_url: checkinLinkFor ? await checkinLinkFor(p[1]) : null }; }
        if (p[2] === 'arrived') await arrived(D, p[1]);
        else if (p[2] === 'no-show') await noShow(D, p[1]);
        else if (p[2] === 'cancel') await cancelAppt(D, p[1], false);
        else throw new Error('Not found');
        return state(D, mode);
      }
      case 'departments': {
        if (p[1] === 'settings') {
          (Array.isArray(b.departments) ? b.departments : []).forEach((x) => { const d = dept(D, x.id); if (!d) return; if (x.name && String(x.name).trim()) d.name = String(x.name).trim().slice(0, 60); if (x.code && /^[A-Za-z0-9-]{2,12}$/.test(String(x.code).trim()) && !D.departments.some((o) => o !== d && o.code === String(x.code).trim().toUpperCase())) d.code = String(x.code).trim().toUpperCase(); const bp = x.budget === '' || x.budget == null ? null : toPence(x.budget); if (bp != null) d.budget_pence = bp; if (x.payout_email !== undefined) d.payout_email = String(x.payout_email).trim().slice(0, 120); });
          log(D, 'info', 'Department budgets and PayPal emails saved.');
        }
        return budgets(D);
      }
      case 'spend': logSpend(D, b); return { ...state(D, mode), budgets: budgets(D) };
      case 'requests': {
        if (!p[1]) askMoney(D, b);
        else if (p[2] === 'approve') await payRequest(D, p[1], !!b.over_budget);
        else if (p[2] === 'reject') rejectRequest(D, p[1], b.reason);
        else throw new Error('Not found');
        return { ...state(D, mode), budgets: budgets(D) };
      }
      case 'payouts': {
        if (p[1] !== 'refresh') throw new Error('Not found');
        await refreshPayouts(D); return { ...state(D, mode), budgets: budgets(D) };
      }
      case 'reminders': { const sent = await reminders(D); const st = state(D, mode); st.sent = sent; return st; }
      case 'expenses': {
        if (p[1] === 'delete') { D.expenses = D.expenses.filter((e) => e.id !== b.id); return finances(D, b.month); }
        const pence = toPence(b.amount);
        if (!b.what || !pence) throw new Error('Add what it was and how much.');
        D.expenses.push({ id: uid('exp'), date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today(), what: String(b.what).slice(0, 80), category: ['Rent', 'Materials', 'Travel', 'Professional', 'Software', 'Other'].includes(b.category) ? b.category : 'Other', pence });
        return finances(D, b.month);
      }
      case 'claims': {
        if (p[1] === 'parse') return parsePayment(D, String(b.text || '').slice(0, 600));
        if (p[1] === 'record') {
          if (!pat(D, b.patient_id) || !(b.pence > 0)) throw new Error('Choose a patient and an amount.');
          const c = { id: uid('clm'), patient_id: b.patient_id, source: 'therapist', amount_pence: Math.round(b.pence), method: ['cash', 'bank', 'cheque', 'other'].includes(b.method) ? b.method : 'other', reference: b.reference ? String(b.reference).slice(0, 80) : null, status: 'pending', created_at: now() };
          D.claims.unshift(c); await confirm(D, c.id); return state(D, mode);
        }
        if (p[2] === 'confirm') { await confirm(D, p[1]); return state(D, mode); }
        if (p[2] === 'reject') { const c = D.claims.find((x) => x.id === p[1] && x.status === 'pending'); if (!c) throw new Error('Already handled.'); c.status = 'rejected'; log(D, 'info', `Marked as not received: ${gbp(c.amount_pence)} for ${pat(D, c.patient_id).known_as}. The invoice stays open.`, c.patient_id); return state(D, mode); }
      }
    }
    throw new Error('Not found');
  }

  // ---------- insurance claims: the insurer's share and the patient's excess ----------
  // A draft invoice for an insured patient is split line by line: the patient's excess stays on the PayPal invoice,
  // the rest becomes a claim invoice to the insurer (insurers pay by bank, so it is tracked here, not sent through
  // PayPal). When the insurer pays, the payment is recorded; any shortfall becomes a draft invoice to the family.
  const insurer = (D, id) => (D.insurers || []).find((x) => x.id === id);
  const iclaim = (D, id) => (D.insurance_claims || []).find((x) => x.id === id);
  /** Split invoice lines into two parts by amount, keeping department codes and partner fees in proportion. */
  function splitLines(D, items, firstPence, firstTag, restTag) {
    const shares = split(firstPence, items.map((it, k) => ({ key: k, w: it.pence })));
    const a = [], b = [];
    items.forEach((it, k) => {
      const x = (shares.find((y) => y.key === k) || { pence: 0 }).pence, y = it.pence - x;
      const part = (pence, tag) => ({ ...it, name: `${it.name} (${tag})`, pence, ...(it.partner_pence ? { partner_pence: Math.round(it.partner_pence * pence / it.pence) } : {}) });
      if (x > 0) a.push(part(x, firstTag));
      if (y > 0) b.push(part(y, restTag));
    });
    return [a, b];
  }
  async function billInsurance(D, invoiceId, b) {
    const i = inv(D, invoiceId);
    if (!i || i.status !== 'DRAFT' || i.paid_pence) throw new Error('Only an unpaid draft invoice can be split with insurance.');
    const p = pat(D, i.patient_id), ins = p.insurance && insurer(D, p.insurance.insurer_id);
    if (!ins) throw new Error(`${p.known_as} has no insurance on file.`);
    const excess = Math.min(b.excess != null && toPence(b.excess) != null ? toPence(b.excess) : p.insurance.excess_pence, i.total_pence);
    if (excess >= i.total_pence) throw new Error('The excess covers the whole bill, so there is nothing to claim.');
    const [mine, theirs] = splitLines(D, i.items, excess, 'your excess', 'insurer’s share');
    Object.assign(i, { items: mine, total_pence: excess, note: `${standardNote(D, p, i.period, excess, i.kind).note} This is your insurance excess: the rest (${gbp(theirs.reduce((t, x) => t + x.pence, 0))}) has been claimed from ${ins.name}, policy ${p.insurance.policy}.` });
    const c = await makeInvoice(D, p, { kind: 'claim', period: i.period, items: theirs, words: { subject: `Claim: ${p.known_as}, ${i.period}`, note: `Claim under policy ${p.insurance.policy}.`, by_ai: false } });
    Object.assign(c, { to: { name: ins.name, email: ins.email, org: true }, status: 'SENT', sent_at: today(), due_date: addDays(today(), ins.pay_days || 30) });
    const claim = { id: uid('ic'), insurer_id: ins.id, patient_id: p.id, invoice_id: c.id, patient_invoice_id: i.id, policy: p.insurance.policy, claimed_pence: c.total_pence, paid_pence: 0, status: 'submitted', submitted_at: now(), decided_at: null, reference: null, reason: null };
    D.insurance_claims.unshift(claim);
    i.claim_id = claim.id;
    log(D, 'info', `Claim to ${ins.name}: ${gbp(c.total_pence)} for ${p.known_as}, ${i.period}. ${p.known_as}’s excess (${gbp(excess)}) stays on the PayPal invoice.`, p.id);
    return claim;
  }
  async function settleClaim(D, id, b, rejected) {
    const c = iclaim(D, id);
    if (!c || c.status !== 'submitted') throw new Error('This claim has already been settled.');
    const ci = inv(D, c.invoice_id), p = pat(D, c.patient_id), ins = insurer(D, c.insurer_id);
    const paid = rejected ? 0 : Math.min(toPence(b.amount) || 0, c.claimed_pence);
    if (!rejected && !paid) throw new Error('How much did the insurer pay?');
    if (paid) recordLocal(D, ci, paid, 'bank', b.reference ? String(b.reference).slice(0, 80) : `${ins.name} claim`);
    const short = c.claimed_pence - paid;
    Object.assign(ci, { status: paid ? (short ? 'MARKED_AS_PAID' : ci.status) : 'CANCELLED', written_off_pence: short });
    Object.assign(c, { paid_pence: paid, status: rejected ? 'rejected' : short ? 'part_paid' : 'paid', decided_at: now(), reference: b.reference || null, reason: b.reason ? String(b.reason).slice(0, 200) : null });
    if (short > 0) {
      // What the insurer didn't cover is the family's to pay: a draft invoice for the billing office to check and send.
      const [lines] = splitLines(D, ci.items, short, 'not covered by insurer', '');
      const d = await makeInvoice(D, p, { kind: 'session', period: ci.period, items: lines.map((x) => ({ ...x, name: x.name.replace(' (insurer’s share)', '') })) });
      c.shortfall_invoice_id = d.id;
      log(D, 'draft', `${ins.name} ${rejected ? 'rejected the claim' : `paid ${gbp(paid)} of ${gbp(c.claimed_pence)}`} for ${p.known_as}, ${ci.period}${c.reason ? ` (${c.reason})` : ''}. Draft invoice to the family for ${gbp(short)}.`, p.id);
    } else log(D, 'paid', `${ins.name} paid the claim in full: ${gbp(paid)} for ${p.known_as}, ${ci.period}.`, p.id);
    return c;
  }

  // ---------- outside providers: the hospital collects, the partner is paid its fee with PayPal Payouts ----------
  const partner = (D, id) => (D.partners || []).find((x) => x.id === id);
  /** What each partner has earned from money actually collected, what has been paid out, and what is left to pay. */
  function partnerSummary(D) {
    const earned = {};
    D.payments.forEach((x) => {
      const i = inv(D, x.invoice_id); if (!i || !i.total_pence) return;
      const total = i.items.reduce((t, it) => t + it.pence, 0) || i.total_pence;
      i.items.filter((it) => it.partner_id).forEach((it) => { earned[it.partner_id] = (earned[it.partner_id] || 0) + Math.round(it.partner_pence * x.pence / total); });
    });
    return (D.partners || []).map((pt) => {
      const out = (D.partner_payouts || []).filter((y) => y.partner_id === pt.id);
      const paid = out.filter((y) => USED.includes(y.status)).reduce((t, y) => t + y.pence, 0);
      return { ...pt, earned: earned[pt.id] || 0, paid, to_pay: Math.max(0, (earned[pt.id] || 0) - paid), payouts: out };
    });
  }
  async function payPartner(D, id) {
    const row = partnerSummary(D).find((x) => x.id === id);
    if (!row) throw new Error('No outside provider with that id.');
    if (!row.to_pay) throw new Error(`Nothing is owed to ${row.name} right now.`);
    const k = (D.partner_payouts || []).length + 1, itemId = `PARTNER-${row.id.slice(-6)}-${k}`;
    const out = await paypal.createPayout({ batchId: `${row.id}-${k}-${Date.now().toString(36)}`, subject: `${D.settings.practice}: payment for services`, items: [{ email: row.payout_email, pence: row.to_pay, itemId, note: `${row.name}: fees for services to our patients, collected by ${D.settings.practice}.` }] });
    D.partner_payouts = [{ id: uid('pp'), partner_id: row.id, pence: row.to_pay, status: 'sending', created_at: now(), payout: { batch_id: out.batch_id, item_id: itemId, status: 'PENDING' } }, ...(D.partner_payouts || [])];
    log(D, 'payout', `Paid ${row.name} ${gbp(row.to_pay)} with PayPal Payouts for services to our patients.`);
  }

  // ---------- surgery payment plans: a deposit now and instalments before the date ----------
  const pplan = (D, id) => (D.payment_plans || []).find((x) => x.id === id);
  async function sendPart(D, plan, part) {
    const p = pat(D, plan.patient_id), sv = svc(D, plan.service_id);
    const i = await makeInvoice(D, p, { kind: 'instalment', period: `${sv.name}, ${part.label.toLowerCase()}`, items: [tagLine(D, { name: `${sv.name} on ${fdate(plan.date)}: ${part.label.toLowerCase()}`, pence: part.pence }, sv.id)],
      words: { subject: `${p.known_as}’s ${sv.name.toLowerCase()}: ${part.label.toLowerCase()}`, note: `Hi ${p.payer.type === 'family' ? firstWord(billTo(p).name) : 'there'}, this is ${part.label.toLowerCase()} for ${p.known_as}’s ${sv.name.toLowerCase()} on ${fdate(plan.date)} (${gbp(part.pence)} of ${gbp(plan.total_pence)}). You can pay by PayPal or card, and PayPal may offer to spread it with Pay Later.`, by_ai: false } });
    await send(D, i, { quiet: true });
    Object.assign(part, { invoice_id: i.id, sent_at: today() });
    log(D, 'sent', `${sv.name} plan for ${p.known_as}: ${part.label.toLowerCase()} (${gbp(part.pence)}) sent through PayPal.`, p.id);
  }
  async function createPlan(D, b) {
    const p = pat(D, b.patient_id), sv = svc(D, b.service_id);
    if (!p || !sv || !sv.plan_only) throw new Error('Choose a patient and a surgery.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || daysBetween(today(), b.date) < 14) throw new Error('Choose a surgery date at least 2 weeks away.');
    const pct = Math.min(90, Math.max(10, parseInt(b.deposit_percent, 10) || 30)), n = Math.min(6, Math.max(1, parseInt(b.instalments, 10) || 2));
    const total = sv.price_pence, deposit = Math.round(total * pct / 100), days = daysBetween(today(), b.date) - 7;
    const rest = split(total - deposit, Array.from({ length: n }, (_, k) => ({ key: k, w: 1 })));
    const plan = { id: uid('plan'), patient_id: p.id, service_id: sv.id, date: b.date, total_pence: total, created_at: now(),
      parts: [{ label: `Deposit (${pct}%)`, pence: deposit, due: today(), invoice_id: null }, ...rest.map((x, k) => ({ label: `Instalment ${k + 1} of ${n}`, pence: x.pence, due: addDays(today(), Math.round(days * (k + 1) / n)), invoice_id: null }))] };
    D.payment_plans.unshift(plan);
    log(D, 'info', `Payment plan for ${p.known_as}’s ${sv.name.toLowerCase()} on ${fdate(b.date)}: ${gbp(deposit)} deposit, then ${n} instalment${n === 1 ? '' : 's'} before the date.`, p.id);
    await sendPart(D, plan, plan.parts[0]);
    return plan;
  }
  /** Daily: send every instalment that has come due. */
  async function sendDueInstalments(D) {
    let sent = 0;
    for (const plan of D.payment_plans || []) for (const part of plan.parts.filter((x) => !x.invoice_id && x.due <= today())) {
      try { await sendPart(D, plan, part); sent++; } catch (e) { log(D, 'error', `Instalment not sent: ${e.message}`, plan.patient_id); }
    }
    return sent;
  }

  // ---------- appointments: check-in & pay ----------
  // The front desk books a visit. High-demand services need a deposit. Before the visit the family opens a signed
  // check-in link: self-pay families can choose a sliding-scale price (self-reported, no questions), and the deposit
  // is held on their PayPal (authorised, not taken). On arrival the hold is captured toward the visit's invoice and
  // the rest released; on a no-show it is kept as a fee; on a cancellation it is voided.
  const appt = (D, id) => (D.appointments || []).find((a) => a.id === id);
  const SCALE = [{ id: 'full', label: 'Full price', percent: 0 }, { id: 's20', label: 'Household income under £40,000 a year', percent: 20 }, { id: 's40', label: 'Under £25,000 a year', percent: 40 }, { id: 's60', label: 'Under £15,000 a year, or on benefits', percent: 60 }];
  const priceOf = (D, a) => { const base = svc(D, a.service_id).price_pence, band = SCALE.find((b) => b.id === a.scale) || SCALE[0]; return Math.round(base * (100 - band.percent) / 100); };
  const HOLD_DAYS = 3; // PayPal honours an authorisation in full for 3 days, so check-in opens 3 days before
  function book(D, b) {
    const p = pat(D, b.patient_id), sv = svc(D, b.service_id);
    if (!p || !sv || !sv.minutes) throw new Error('Choose a patient and a service.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.time || '')) throw new Error('Choose a date and a time.');
    if (b.date < today()) throw new Error('Choose today or a later date.');
    const a = { id: uid('ap'), patient_id: p.id, service_id: sv.id, at: `${b.date}T${b.time}`, status: 'booked', deposit_pence: (D.settings.deposit_services || []).includes(sv.id) ? D.settings.deposit_pence : 0, scale: 'full', hold: null, checked_in_at: null, invoice_id: null, created_at: now() };
    D.appointments.unshift(a);
    log(D, 'info', `Booked: ${p.known_as}, ${sv.name}, ${a.at.replace('T', ' ')}${a.deposit_pence ? ` (deposit ${gbp(a.deposit_pence)})` : ''}.`, p.id);
    return a;
  }
  function checkinView(D, id) {
    const a = appt(D, id); if (!a) return null;
    const p = pat(D, a.patient_id), sv = svc(D, a.service_id), d = dept(D, sv.department_id);
    const daysTo = daysBetween(today(), a.at.slice(0, 10));
    return { practice: D.settings.practice, child: p.known_as, service: sv.name, code: d ? d.code : null, dept: d ? d.name : null, at: a.at, status: a.status, deposit: a.deposit_pence ? gbp(a.deposit_pence) : null, held: !!(a.hold && a.hold.status === 'held'),
      self_pay: p.payer.type === 'family', scale: a.scale, bands: p.payer.type === 'family' ? SCALE.map((b) => ({ id: b.id, label: b.label, percent: b.percent, price: gbp(Math.round(sv.price_pence * (100 - b.percent) / 100)) })) : null,
      price: gbp(priceOf(D, a)), opens_in_days: Math.max(0, daysTo - HOLD_DAYS), can_cancel: a.status === 'booked' || a.status === 'checked_in' ? daysBetween(today(), a.at.slice(0, 10)) >= 1 : false };
  }
  function setScale(D, a, scale) { const p = pat(D, a.patient_id); a.scale = p.payer.type === 'family' && SCALE.some((b) => b.id === scale) ? scale : 'full'; }
  async function checkinStart(D, id, b) {
    const a = appt(D, id);
    if (!a || !['booked', 'checked_in'].includes(a.status)) throw new Error('This appointment can’t be checked in.');
    if (daysBetween(today(), a.at.slice(0, 10)) > HOLD_DAYS) throw new Error(`Check-in opens ${HOLD_DAYS} days before the appointment.`);
    setScale(D, a, b.scale);
    const p = pat(D, a.patient_id);
    if (!a.deposit_pence || (a.hold && a.hold.status === 'held')) {
      if (a.status === 'booked') { a.status = 'checked_in'; a.checked_in_at = now(); log(D, 'info', `${p.known_as} checked in online for ${a.at.replace('T', ' ')}${a.scale !== 'full' ? ` (sliding scale: ${SCALE.find((x) => x.id === a.scale).percent}% off)` : ''}.`, p.id); }
      return { checked_in: true };
    }
    const o = await paypal.createHoldOrder({ ref: a.id, pence: a.deposit_pence, description: `${D.settings.practice}: deposit for ${p.known_as}, ${a.at.replace('T', ' ')}`, brand: D.settings.practice });
    a.hold = { order_id: o.id, status: 'pending' };
    return { order_id: o.id };
  }
  async function checkinHold(D, id, orderId) {
    const a = appt(D, id);
    if (!a || !a.hold || a.hold.order_id !== orderId) throw new Error('This deposit could not be matched to the appointment.');
    const r = await paypal.authorizeOrder(orderId);
    if (r.status !== 'CREATED' || r.custom_id !== a.id || r.pence !== a.deposit_pence) throw new Error('PayPal did not hold the deposit.');
    Object.assign(a.hold, { auth_id: r.auth_id, status: 'held', at: now(), expires: r.expires });
    a.status = 'checked_in'; a.checked_in_at = now();
    const p = pat(D, a.patient_id);
    log(D, 'info', `${p.known_as} checked in online: ${gbp(a.deposit_pence)} deposit held with PayPal${a.scale !== 'full' ? `, sliding scale ${SCALE.find((x) => x.id === a.scale).percent}% off` : ''}.`, p.id);
    return { checked_in: true };
  }
  /** One invoice for this visit (or a missed-appointment fee), with a deposit taken from the hold applied to it. */
  async function visitInvoice(D, a, items, period, depositPence, captureId) {
    const p = pat(D, a.patient_id);
    const i = await makeInvoice(D, p, { kind: 'session', period, items, sessionIds: items.map((x) => x.session_id).filter(Boolean) });
    if (depositPence > 0) recordLocal(D, i, depositPence, 'paypal', `Deposit ${captureId}`);
    if (i.paid_pence >= i.total_pence) Object.assign(i, { status: 'PAID', sent_at: today(), due_date: today() });
    else i.status = 'DRAFT';
    a.invoice_id = i.id;
    return i;
  }
  async function arrived(D, id) {
    const a = appt(D, id);
    if (!a || !['booked', 'checked_in'].includes(a.status)) throw new Error('This appointment is already closed.');
    const p = pat(D, a.patient_id), sv = svc(D, a.service_id), price = priceOf(D, a), date = a.at.slice(0, 10) <= today() ? a.at.slice(0, 10) : today();
    const s = { id: uid('ses'), patient_id: p.id, date, service_id: sv.id, minutes: sv.minutes, where: 'in person', price_pence: price, invoice_id: null, appointment_id: a.id };
    D.sessions.unshift(s);
    let taken = 0, cap = null;
    if (a.hold && a.hold.status === 'held') {
      taken = Math.min(a.deposit_pence, price);
      cap = await paypal.captureHold(a.hold.auth_id, taken);
      Object.assign(a.hold, { status: 'captured', captured_pence: taken, capture_id: cap.capture_id });
    }
    const band = SCALE.find((x) => x.id === a.scale);
    const i = await visitInvoice(D, a, [tagLine(D, { name: `${sv.name}, ${fdate(date)}${band.percent ? ` (sliding scale, ${band.percent}% off)` : ''}`, pence: price, session_id: s.id }, sv.id)], fdate(date), taken, cap && cap.capture_id);
    a.status = 'arrived';
    log(D, 'info', `${p.known_as} arrived.${taken ? ` ${gbp(taken)} of the deposit taken and put toward the bill${a.deposit_pence > taken ? `; ${gbp(a.deposit_pence - taken)} released` : ''}.` : ''} ${i.status === 'PAID' ? 'Visit fully paid.' : `Invoice for the remaining ${gbp(outstanding(i))} is ready to send.`}`, p.id);
    return i;
  }
  async function noShow(D, id) {
    const a = appt(D, id);
    if (!a || !['booked', 'checked_in'].includes(a.status)) throw new Error('This appointment is already closed.');
    if (a.at.slice(0, 10) > today()) throw new Error('The appointment hasn’t happened yet.');
    const p = pat(D, a.patient_id), sv = svc(D, a.service_id);
    a.status = 'no_show';
    if (a.hold && a.hold.status === 'held') {
      const cap = await paypal.captureHold(a.hold.auth_id, a.deposit_pence);
      Object.assign(a.hold, { status: 'captured', captured_pence: a.deposit_pence, capture_id: cap.capture_id });
      await visitInvoice(D, a, [tagLine(D, { name: `Missed appointment fee: ${sv.name}, ${fdate(a.at)}`, pence: a.deposit_pence }, sv.id)], `Missed ${fdate(a.at)}`, a.deposit_pence, cap.capture_id);
      log(D, 'info', `${p.known_as} didn’t come: the ${gbp(a.deposit_pence)} deposit was kept as a no-show fee.`, p.id);
    } else log(D, 'info', `${p.known_as} didn’t come to ${sv.name}, ${a.at.replace('T', ' ')} (no deposit held).`, p.id);
  }
  async function cancelAppt(D, id, byFamily) {
    const a = appt(D, id);
    if (!a || !['booked', 'checked_in'].includes(a.status)) throw new Error('This appointment is already closed.');
    if (byFamily && daysBetween(today(), a.at.slice(0, 10)) < 1) throw new Error('It’s less than a day before the appointment. Please call the hospital to cancel.');
    if (a.hold && a.hold.status === 'held') { await paypal.voidHold(a.hold.auth_id); a.hold.status = 'released'; }
    else if (a.hold) a.hold.status = 'released';
    a.status = 'cancelled';
    log(D, 'info', `${pat(D, a.patient_id).known_as}’s appointment on ${a.at.replace('T', ' ')} cancelled${byFamily ? ' by the family' : ''}.${a.hold && a.hold.auth_id ? ` ${gbp(a.deposit_pence)} hold released.` : ''}`, a.patient_id);
  }

  // ---------- departments: budgets, spending, and money requests paid with PayPal Payouts ----------
  // The hospital allocates each department a budget for the financial year (1 April to 31 March).
  // Departments log what they spend, and ask for money when they need it (for their own PayPal account or
  // straight to a supplier). The finance department sees what is used and left, then approves (PayPal Payouts sends
  // the money) or rejects. Income is still tagged by department code, for reporting only.
  function split(pence, parts) {
    const total = parts.reduce((t, x) => t + x.w, 0);
    if (!total) return [];
    const out = parts.map((x) => ({ key: x.key, pence: Math.floor(pence * x.w / total), r: (pence * x.w) % total }));
    let left = pence - out.reduce((t, x) => t + x.pence, 0);
    out.slice().sort((a, b) => b.r - a.r).forEach((x) => { if (left > 0) { x.pence += 1; left -= 1; } });
    return out.map(({ key, pence: p2 }) => ({ key, pence: p2 }));
  }
  function deptSplit(D, payment) {
    const i = inv(D, payment.invoice_id);
    if (!i) return [];
    const w = {};
    i.items.forEach((it) => { const k = lineDept(D, it); w[k] = (w[k] || 0) + it.pence; });
    return split(payment.pence, Object.entries(w).map(([key, wt]) => ({ key, w: wt }))).map((x) => ({ dept_id: x.key, pence: x.pence }));
  }
  /** Financial year containing a date: 1 April to 31 March. */
  function fyOf(iso) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), start = m >= 4 ? y : y - 1;
    return { start: `${start}-04-01`, end: `${start + 1}-03-31`, label: `${start}/${String(start + 1).slice(2)}` };
  }
  const inFy = (fy, iso) => iso && iso.slice(0, 10) >= fy.start && iso.slice(0, 10) <= fy.end;
  // A request counts against the budget once it is approved, unless PayPal later reports the payout failed.
  const USED = ['sending', 'paid', 'unclaimed'];
  const PAYOUT_STATUS = { SUCCESS: 'paid', UNCLAIMED: 'unclaimed', PENDING: 'sending', ONHOLD: 'sending', NEW: 'sending', FAILED: 'failed', RETURNED: 'failed', BLOCKED: 'failed', DENIED: 'failed', REFUNDED: 'failed', REVERSED: 'failed' };
  const req = (D, id) => (D.requests || []).find((r) => r.id === id);
  function budgets(D, onDate) {
    const fy = fyOf(onDate || today());
    const rows = (D.departments || []).map((d) => {
      const spent = D.spend.filter((x) => x.dept_id === d.id && inFy(fy, x.date)).reduce((t, x) => t + x.pence, 0);
      const rq = D.requests.filter((r) => r.dept_id === d.id);
      const paid = rq.filter((r) => USED.includes(r.status) && inFy(fy, r.decided_at)).reduce((t, r) => t + r.pence, 0);
      const waiting = rq.filter((r) => r.status === 'pending');
      return { id: d.id, code: d.code, name: d.name, payout_email: d.payout_email || '', budget: d.budget_pence || 0, spent, paid, used: spent + paid, left: (d.budget_pence || 0) - spent - paid, waiting: waiting.length, waiting_pence: waiting.reduce((t, r) => t + r.pence, 0), income: 0 };
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    D.payments.filter((x) => inFy(fy, x.date)).forEach((x) => deptSplit(D, x).forEach((y) => { if (byId[y.dept_id]) byId[y.dept_id].income += y.pence; }));
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    const view = (r) => ({ ...r, code: dept(D, r.dept_id).code, dept_name: dept(D, r.dept_id).name, left_after: byId[r.dept_id].left - (r.status === 'pending' || r.status === 'failed' ? r.pence : 0) });
    return {
      fy: fy.label, departments: rows, totals: { budget: sum('budget'), used: sum('used'), left: sum('left'), waiting: sum('waiting'), waiting_pence: sum('waiting_pence'), income: sum('income') },
      requests: D.requests.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.created_at.localeCompare(a.created_at)).slice(0, 60).map(view),
      partners: partnerSummary(D),
      spend: D.spend.filter((x) => inFy(fy, x.date)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80).map((x) => ({ ...x, code: dept(D, x.dept_id).code })),
    };
  }
  function logSpend(D, b) {
    const d = dept(D, b.dept_id); if (!d) throw new Error('Choose a department.');
    const pence = toPence(b.amount);
    if (!b.what || !pence) throw new Error('Add what it was for and how much.');
    D.spend.unshift({ id: uid('sp'), dept_id: d.id, date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') && b.date <= today() ? b.date : today(), what: String(b.what).slice(0, 100), category: ['Equipment', 'Supplies', 'Staff', 'Training', 'Travel', 'Other'].includes(b.category) ? b.category : 'Other', pence });
    log(D, 'info', `${d.code} logged spending: ${String(b.what).slice(0, 60)}, ${gbp(pence)}.`);
  }
  function askMoney(D, b) {
    const d = dept(D, b.dept_id); if (!d) throw new Error('Choose a department.');
    const pence = toPence(b.amount);
    if (!pence || !b.purpose) throw new Error('Say how much and what it is for.');
    if (pence > 5000000) throw new Error('Requests over £50,000 go through the hospital’s purchasing process.');
    const supplier = b.pay_to === 'supplier';
    const email = String(supplier ? b.payee_email || '' : d.payout_email || '').trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(supplier ? 'Add the supplier’s PayPal email.' : 'Your department has no PayPal email yet. Ask the finance department to add it.');
    const r = { id: uid('rq'), dept_id: d.id, created_at: now(), pence, purpose: String(b.purpose).slice(0, 200), pay_to: supplier ? 'supplier' : 'department', payee_name: supplier ? String(b.payee_name || 'Supplier').slice(0, 80) : `${d.code} ${d.name}`, payee_email: email, status: 'pending', reason: null, decided_at: null, payout: null };
    D.requests.unshift(r);
    log(D, 'request', `${d.code} asks for ${gbp(pence)}: ${r.purpose} (to ${r.payee_name}).`);
    return r;
  }
  function checkRequest(D, r, allowOver) {
    if (!r) return { error: 'No money request with that id.' };
    if (!['pending', 'failed'].includes(r.status)) return { error: 'This request has already been handled.' };
    const row = budgets(D).departments.find((x) => x.id === r.dept_id);
    const over = r.pence - row.left;
    if (over > 0 && !allowOver) return { error: `${row.code} would go ${gbp(over)} over its budget (${gbp(row.left)} left). The finance department must decide this one on screen.`, over };
    return { summary: `Pay ${gbp(r.pence)} to ${r.payee_name} for ${row.code}: ${r.purpose} (${gbp(row.left - r.pence)} of the budget left after)`, over: Math.max(0, over) };
  }
  async function payRequest(D, id, allowOver) {
    const r = req(D, id), c = checkRequest(D, r, allowOver);
    if (c.error) throw new Error(c.error);
    if (!paypal.createPayout) throw new Error('PayPal Payouts is not available here.');
    const d = dept(D, r.dept_id), itemId = `${d.code}-${r.id.slice(-8)}-${(r.attempts || 0) + 1}`;
    const out = await paypal.createPayout({ batchId: `${r.id}-${(r.attempts || 0) + 1}`, subject: `${D.settings.practice}: payment for ${d.code}`, items: [{ email: r.payee_email, pence: r.pence, itemId, note: `${d.code} ${d.name}: ${r.purpose}` }] });
    Object.assign(r, { status: 'sending', decided_at: now(), attempts: (r.attempts || 0) + 1, payout: { batch_id: out.batch_id, item_id: itemId, status: 'PENDING' }, reason: c.over ? `Approved ${gbp(c.over)} over budget.` : null });
    log(D, 'payout', `Approved and sent with PayPal Payouts: ${gbp(r.pence)} to ${r.payee_name} for ${d.code} (${r.purpose}).${c.over ? ` ${gbp(c.over)} over budget.` : ''}`);
    return r;
  }
  function rejectRequest(D, id, reason) {
    const r = req(D, id);
    if (!r || !['pending', 'failed'].includes(r.status)) throw new Error('This request has already been handled.');
    Object.assign(r, { status: 'rejected', decided_at: now(), reason: String(reason || '').trim().slice(0, 200) || 'No reason given.' });
    log(D, 'info', `Request from ${dept(D, r.dept_id).code} for ${gbp(r.pence)} not approved: ${r.reason}`);
  }
  async function refreshPayouts(D) {
    let changed = 0;
    for (const r of [...(D.requests || []), ...(D.partner_payouts || [])].filter((x) => x.payout && ['sending', 'unclaimed'].includes(x.status) && !x.payout.seeded)) {
      try {
        const g = await paypal.getPayout(r.payout.batch_id);
        const it = g.items.find((y) => y.item_id === r.payout.item_id);
        if (!it || it.status === r.payout.status) continue;
        r.payout.status = it.status; r.status = PAYOUT_STATUS[it.status] || 'sending'; changed++;
        if (r.status === 'failed') log(D, 'error', r.partner_id ? `PayPal payout to ${partner(D, r.partner_id).name} ${it.status.toLowerCase()}. It can be paid again.` : `PayPal payout to ${r.payee_name} for ${dept(D, r.dept_id).code} ${it.status.toLowerCase()}. It no longer counts against the budget and can be approved again.`);
      } catch (e) { log(D, 'error', `Could not check payout ${r.payout.batch_id}: ${e.message}`); }
    }
    return changed;
  }

  // ---------- the billing assistant ----------
  // The AI plans; this code checks and does. Read tools return billing facts only. propose_action only
  // adds a numbered proposal to the plan; each one is checked again and run only when the therapist approves it.
  const daysLate = (i) => i.due_date && i.due_date < today() ? daysBetween(i.due_date, today()) : 0;
  // Two teams use the assistant. The billing office invoices patients, applies payments to invoices and chases
  // what is owed. The finance department allocates budgets and approves money requests. Each gets only its own tools.
  const TEAM_ACTIONS = { billing: ['reminder', 'invoice', 'send_draft', 'confirm_payment'], finance: ['pay_request'] };
  const TEAM_TOOLS = { billing: ['list_unpaid_invoices', 'check_paypal', 'list_patients', 'list_reported_payments', 'propose_action'], finance: ['department_budgets', 'month_summary', 'list_unpaid_invoices', 'propose_action'] };
  const teamOf = (t) => (t === 'finance' ? 'finance' : 'billing');
  function checkAction(D, a) {
    if (a.type === 'reminder') {
      const i = inv(D, a.id);
      if (!i) return { error: 'No invoice with that id.' };
      const p = pat(D, i.patient_id);
      if (!isOpen(i)) return { error: `${p.known_as}, ${i.period} is already paid.` };
      if (!i.paypal_id) return { error: 'That invoice has not been sent through PayPal yet.' };
      if (i.last_reminder_at === today()) return { error: `${p.known_as}, ${i.period} was already reminded today.` };
      const n = i.reminder_count + 1;
      return { summary: `Send reminder ${n} to ${toName(i.to)} for ${p.known_as}, ${i.period} (${gbp(outstanding(i))} owed${daysLate(i) ? `, ${daysLate(i)} days late` : ''})`, patient_id: p.id };
    }
    if (a.type === 'send_draft') {
      const i = inv(D, a.id);
      if (!i || i.status !== 'DRAFT') return { error: 'No draft invoice with that id.' };
      return { summary: `Send the draft invoice to ${toName(i.to)} for ${pat(D, i.patient_id).known_as}, ${i.period} (${gbp(i.total_pence)})`, patient_id: i.patient_id };
    }
    if (a.type === 'invoice') {
      const p = pat(D, a.id);
      if (!p) return { error: 'No patient with that id.' };
      const waiting = D.sessions.filter((s) => s.patient_id === p.id && !s.invoice_id);
      if (!waiting.length) return { error: `${p.known_as} has no sessions waiting to be invoiced.` };
      if (D.invoices.some((i) => i.patient_id === p.id && i.status === 'DRAFT')) return { error: `${p.known_as} already has a draft. Propose send_draft instead.` };
      return { summary: `Invoice ${p.known_as}'s ${waiting.length === 1 ? 'session' : `${waiting.length} sessions`} and send it through PayPal to ${toName(billTo(p))}`, patient_id: p.id };
    }
    if (a.type === 'confirm_payment') {
      const c = D.claims.find((x) => x.id === a.id && x.status === 'pending');
      if (!c) return { error: 'No reported payment with that id is waiting.' };
      return { summary: `Mark ${gbp(c.amount_pence)} ${how(c.method)} for ${pat(D, c.patient_id).known_as} as received and record it on the PayPal invoice (check your bank first)`, patient_id: c.patient_id };
    }
    if (a.type === 'pay_request') { const c = checkRequest(D, req(D, a.id)); return c.error ? { error: c.error } : { summary: c.summary }; }
    return { error: 'Unknown action.' };
  }
  async function doAction(D, a) {
    if (a.type === 'reminder') return sendReminder(D, inv(D, a.id));
    if (a.type === 'send_draft') return send(D, inv(D, a.id));
    if (a.type === 'invoice') { const id = await draftFor(D, a.id); return send(D, inv(D, id)); }
    if (a.type === 'confirm_payment') return confirm(D, a.id);
    if (a.type === 'pay_request') return payRequest(D, a.id);
  }

  const TOOLS = [
    { name: 'list_unpaid_invoices', description: 'Every invoice that has been sent and is not fully paid, as TJS Pay last knew it: who it is for, who pays, amount owed, dates, how many days late, reminders sent, and whether the family has said they paid another way. Run check_paypal first if you need up-to-the-minute status.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { name: 'check_paypal', description: 'Ask PayPal now whether these invoices have been paid. Any payment PayPal has taken is recorded straight away. Use it before proposing reminders so nobody who has paid is chased.', input_schema: { type: 'object', properties: { invoice_ids: { type: 'array', items: { type: 'string' }, description: 'Invoice ids from list_unpaid_invoices. Empty means every unpaid invoice.' } }, required: ['invoice_ids'], additionalProperties: false }, strict: true },
    { name: 'list_patients', description: 'Billing facts for every patient: billing type, who pays, sessions waiting to be invoiced and their value, drafts, amount owed and credit. No clinical information.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { name: 'list_reported_payments', description: 'Payments families or the therapist reported outside PayPal (bank transfer, cash, cheque) that are waiting for the therapist to confirm they arrived.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { name: 'month_summary', description: 'Money for one month: paid in, estimated PayPal fees, expenses, profit, sessions and hours, split by payer and payment method.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'], additionalProperties: false }, strict: true },
    { name: 'department_budgets', description: 'This financial year (April to March) by department code: budget allocated, spending logged, money requests paid, used, left, and requests waiting. Also every money request with its id, purpose, payee, amount, status, and the budget left after it. Income per department is for reporting only.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { name: 'propose_action', description: 'Add one action to the plan for the user to approve. Nothing happens until they approve it. reminder: id is an invoice id; sends the next reminder through PayPal. invoice: id is a patient id; invoices their waiting sessions and sends it through PayPal. send_draft: id is a draft invoice id. confirm_payment: id is a reported payment id. pay_request: id is a money request id; approves it and sends the money with PayPal Payouts. Requests that would take a department over budget are refused here and must be decided by the finance department on screen. Each action is checked; an error explains why it was not added.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: [] }, id: { type: 'string' }, reason: { type: 'string', description: 'One short sentence the therapist will see.' } }, required: ['type', 'id', 'reason'], additionalProperties: false }, strict: true },
  ];
  const STEP = { department_budgets: 'Looked at department budgets and requests', list_unpaid_invoices: 'Looked at unpaid invoices', check_paypal: 'Checked payment status with PayPal', list_patients: 'Looked at patients and sessions to invoice', list_reported_payments: 'Looked at payments families reported', month_summary: 'Added up the month' };

  function toolsFor(team) {
    return TOOLS.filter((t) => TEAM_TOOLS[team].includes(t.name)).map((t) => t.name !== 'propose_action' ? t : { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, type: { type: 'string', enum: TEAM_ACTIONS[team] } } } });
  }
  async function runTool(D, plan, name, input) {
    if (!TEAM_TOOLS[plan.team].includes(name)) throw new Error('That tool is not available to this team.');
    if (name !== 'propose_action' && STEP[name] && !plan.steps.includes(STEP[name])) plan.steps.push(STEP[name]);
    if (name === 'list_unpaid_invoices') return D.invoices.filter((i) => isOpen(i) && i.kind !== 'claim').map((i) => { const p = pat(D, i.patient_id); return { invoice_id: i.id, patient: p.known_as, paid_by: i.to.org ? i.to.name : `${toName(i.to)} (family)`, period: i.period, owed: gbp(outstanding(i)), sent_on: i.sent_at, due_on: i.due_date, days_since_sent: daysBetween(i.sent_at, today()), days_late: daysLate(i), reminders_sent: i.reminder_count, last_reminder_on: i.last_reminder_at, family_says_paid_another_way: D.claims.some((c) => c.invoice_id === i.id && c.status === 'pending') }; });
    if (name === 'check_paypal') {
      const ids = Array.isArray(input.invoice_ids) && input.invoice_ids.length ? input.invoice_ids : D.invoices.filter((i) => isOpen(i) && i.paypal_id).map((i) => i.id);
      const out = [];
      for (const id of ids.slice(0, 20)) {
        const i = inv(D, id); if (!i) { out.push({ invoice_id: id, error: 'not found' }); continue; }
        const paidNow = isOpen(i) ? await refresh(D, i) : false;
        out.push({ invoice_id: id, patient: pat(D, i.patient_id).known_as, period: i.period, paid_just_now: paidNow, still_owed: gbp(outstanding(i)), status: isOpen(i) ? 'unpaid' : 'paid' });
      }
      plan.checked = (plan.checked || 0) + out.length;
      return out;
    }
    if (name === 'list_patients') return D.patients.map((p) => { const waiting = D.sessions.filter((s) => s.patient_id === p.id && !s.invoice_id); const open = D.invoices.filter((i) => i.patient_id === p.id && isOpen(i)); return { patient_id: p.id, known_as: p.known_as, billing: { session: 'after each session', monthly: 'monthly statement', block: 'prepaid blocks' }[p.plan], paid_by: p.payer.type === 'family' ? `${toName(billTo(p))} (family)` : p.payer.name, sessions_to_invoice: waiting.length, value_to_invoice: gbp(waiting.reduce((t, s) => t + s.price_pence, 0)), has_draft: D.invoices.some((i) => i.patient_id === p.id && i.status === 'DRAFT'), owed: gbp(open.reduce((t, i) => t + outstanding(i), 0)), credit: gbp(p.credit_pence) }; });
    if (name === 'list_reported_payments') return D.claims.filter((c) => c.status === 'pending').map((c) => ({ payment_id: c.id, patient: pat(D, c.patient_id).known_as, amount: gbp(c.amount_pence), method: c.method, reference: c.reference, reported_by: c.source, invoice_id: c.invoice_id || null }));
    if (name === 'month_summary') { const f = finances(D, /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : today().slice(0, 7)); return { month: f.label, paid_in: gbp(f.paidIn), paypal_fees_estimate: gbp(f.fees), expenses: gbp(f.spent), profit: gbp(f.profit), sessions: f.sessionCount, hours: f.hours, by_payer: f.byPayer.map((x) => `${x.name}: ${gbp(x.pence)}`), by_method: f.byMethod.map((x) => `${x.name}: ${gbp(x.pence)}`) }; }
    if (name === 'department_budgets') { const B = budgets(D); return { financial_year: B.fy, departments: B.departments.map((r) => ({ code: r.code, name: r.name, budget: gbp(r.budget), used: gbp(r.used), left: gbp(r.left), requests_waiting: r.waiting, income_for_reporting: gbp(r.income) })), requests: B.requests.map((r) => ({ request_id: r.id, department: r.code, purpose: r.purpose, pay_to: `${r.payee_name} (${r.pay_to})`, amount: gbp(r.pence), status: r.status, asked_on: r.created_at.slice(0, 10), budget_left_after: gbp(r.left_after) })) }; }
    if (name === 'propose_action') {
      const a = { type: input.type, id: String(input.id || '') };
      if (!TEAM_ACTIONS[plan.team].includes(a.type)) throw new Error(`That is not a ${plan.team === 'finance' ? 'finance' : 'billing office'} action.`);
      if (plan.actions.some((x) => x.type === a.type && x.id === a.id)) return { added: false, error: 'Already in the plan.' };
      if (plan.actions.length >= 12) return { added: false, error: 'The plan is full (12 actions).' };
      const c = checkAction(D, a);
      if (c.error) throw new Error(c.error);
      plan.actions.push({ n: plan.actions.length + 1, ...a, summary: c.summary, reason: String(input.reason || '').slice(0, 200), patient_id: c.patient_id });
      return { added: true, number: plan.actions.length, summary: c.summary };
    }
    throw new Error('Unknown tool.');
  }

  /** Without the AI (no key, daily limit reached, or an error): the same tools, driven by simple rules. */
  async function assistantByRules(D, plan, request) {
    const t = request.toLowerCase();
    const propose = async (type, id, reason) => { try { await runTool(D, plan, 'propose_action', { type, id, reason }); } catch { /* not eligible: skip */ } };
    const all = !/remind|chase|owe|late|overdue|unpaid|invoice|bill|paid|confirm/.test(t);
    if (plan.team === 'finance') {
      const B = await runTool(D, plan, 'department_budgets', {});
      const waiting = B.requests.filter((r) => r.status === 'pending');
      for (const r of waiting) await propose('pay_request', r.request_id, `Fits ${r.department}’s budget.`);
      const over = waiting.length - plan.actions.length;
      let month = '';
      if (/month|profit|income|money in/.test(t)) { const f = await runTool(D, plan, 'month_summary', { month: today().slice(0, 7) }); month = ` ${f.month}: ${f.paid_in} paid in, ${f.profit} profit after fees and expenses.`; }
      const near = budgets(D).departments.filter((r) => r.left < 0.15 * r.budget).map((r) => `${r.code} (${gbp(r.left)} left of ${gbp(r.budget)})`);
      if (/close|near|left|budget/.test(t) && !/request/.test(t)) return `${B.financial_year}: ${near.length ? `close to their budget: ${near.join(', ')}.` : 'no department is close to its budget.'}${month}`;
      return `${B.financial_year}: ${waiting.length ? `${waiting.length} money request${waiting.length === 1 ? ' is' : 's are'} waiting.` : 'No money requests are waiting.'}${plan.actions.length ? ` I’ve proposed paying ${plan.actions.length} that fit${plan.actions.length === 1 ? 's' : ''} the budget.` : ''}${over > 0 ? ` ${over} would go over budget, so decide ${over === 1 ? 'it' : 'them'} yourself under Money requests.` : ''}${plan.actions.length ? ' Nothing is sent until you approve.' : ''}${month}`;
    }
    const lines = [];
    if (all || /remind|chase|owe|late|overdue|unpaid|paid/.test(t)) {
      await runTool(D, plan, 'check_paypal', { invoice_ids: [] });
      const open = await runTool(D, plan, 'list_unpaid_invoices', {});
      const minLate = (t.match(/(\d+)\s*(day|week)/) || []).length ? parseInt(t.match(/(\d+)\s*(day|week)/)[1], 10) * (/week/.test(t) ? 7 : 1) : (/two weeks|fortnight/.test(t) ? 14 : 0);
      lines.push(open.length ? `${open.length} invoice${open.length === 1 ? ' is' : 's are'} unpaid: ${open.map((o) => `${o.patient} ${o.owed}`).join(', ')}.` : 'Nobody owes you anything right now.');
      if (all || /remind|chase/.test(t)) for (const o of open) if (!o.family_says_paid_another_way && (minLate ? o.days_since_sent >= minLate : o.days_late > 0)) await propose('reminder', o.invoice_id, `Sent ${o.days_since_sent} days ago; ${o.reminders_sent ? o.reminders_sent + ' reminder' + (o.reminders_sent === 1 ? '' : 's') + ' so far' : 'no reminders yet'}.`);
    }
    if (all || /invoice|bill/.test(t)) {
      const ps = await runTool(D, plan, 'list_patients', {});
      for (const p of ps) if (p.sessions_to_invoice && !p.has_draft) await propose('invoice', p.patient_id, `${p.sessions_to_invoice} session${p.sessions_to_invoice === 1 ? '' : 's'} waiting (${p.value_to_invoice}).`);
      for (const i of D.invoices.filter((x) => x.status === 'DRAFT')) await propose('send_draft', i.id, 'Draft waiting to be sent.');
    }
    if (all || /confirm|paid/.test(t)) {
      const r = await runTool(D, plan, 'list_reported_payments', {});
      if (r.length) lines.push(`${r.length} payment${r.length === 1 ? '' : 's'} reported outside PayPal ${r.length === 1 ? 'is' : 'are'} waiting for you to check.`);
    }
    lines.push(plan.actions.length ? `I’ve proposed ${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} below. Nothing is sent until you approve.` : 'There’s nothing to do right now.');
    return lines.join(' ');
  }

  async function assistant(D, request, teamName, instant) {
    const team = teamOf(teamName);
    request = String(request || '').trim().slice(0, 600);
    if (!request) throw new Error('Ask the assistant something first.');
    const plan = { id: uid('plan'), team, request, created_at: now(), steps: [], actions: [], text: '', by_ai: false, status: 'open' };
    if (ai && ai.assistant && !instant) {
      const s = D.settings;
      const who = team === 'finance'
        ? `You are the finance assistant inside TJS Pay for ${s.practice}, a UK children's hospital. You work for the finance department, which allocates each department a budget for the financial year (April to March) and approves departments' money requests; approved requests are paid with PayPal Payouts, to the department's PayPal account or a supplier's. You do not invoice patients or chase payments: that is the billing office's job.`
        : `You are the billing assistant inside TJS Pay for ${s.practice}, a UK children's hospital. You work for the billing office, which invoices patients and funders through PayPal, applies incoming payments to the right invoices, and follows up what is owed. Budgets and department spending belong to the finance department, not you.`;
      const how = team === 'finance'
        ? `- Propose pay_request only for requests that fit the department's budget; name any that would go over and leave them to the finance team to decide on screen.
- You may look at unpaid invoices and monthly income to answer questions, but you cannot act on them.`
        : `- Only propose reminders for invoices that are still unpaid after the PayPal check.
- If someone says they paid another way, don't propose a reminder for that invoice; mention it instead.
- Reminders follow the hospital's own wording and schedule (days ${s.reminder_days.join(', ')} after sending). The "reason" is for staff, not the family.`;
      const system = `${who} Today is ${today()}.
Departments, each with a code: ${(D.departments || []).map((d) => `${d.code} ${d.name}`).join('; ')}. One hospital PayPal account receives every patient payment; each invoice line carries its department's code.
You never see or discuss clinical information.
How you work:
- The current figures are in the request${team === 'billing' ? ', and PayPal was checked for payments just now' : ''}. Use the look-up tools only if you need something that isn't there.
- You cannot send, pay, charge or record anything yourself. Use propose_action for each thing that should happen; a person approves each one on screen.
${how}
- Propose only what the request asks for. Quote amounts exactly as the tools give them. Never invent amounts, dates or people.
Then reply in plain UK English: what you found and what you proposed, referring to proposals by number. At most 120 words, no tables, no headings, no emojis.`;
      try {
        // Give Claude the figures up front (and check PayPal first for billing), so it can usually answer in one or two calls.
        const snap = team === 'finance'
          ? { department_budgets: await runTool(D, plan, 'department_budgets', {}) }
          : { paypal_check: await runTool(D, plan, 'check_paypal', { invoice_ids: [] }), unpaid_invoices: await runTool(D, plan, 'list_unpaid_invoices', {}), patients: await runTool(D, plan, 'list_patients', {}), reported_payments: await runTool(D, plan, 'list_reported_payments', {}) };
        const r = await ai.assistant({ system, request: `${request}\n\nCurrent figures (JSON):\n${JSON.stringify(snap)}`, tools: toolsFor(team), run: (name, input) => runTool(D, plan, name, input) });
        plan.ai_calls = r.calls;
        plan.text = r.text || 'Done.'; plan.by_ai = true;
      } catch (e) {
        plan.steps.push(`AI unavailable (${String(e.message || e).slice(0, 80)}), so the built-in rules were used`);
        plan.text = await assistantByRules(D, plan, request);
      }
    } else { if (instant && ai) plan.steps.push('Instant answer from the built-in rules (no AI call)'); plan.text = await assistantByRules(D, plan, request); }
    D.plans = [plan, ...(D.plans || [])].slice(0, 5);
    log(D, 'info', `${team === 'finance' ? 'Finance' : 'Billing'} assistant: “${request.slice(0, 80)}”. ${plan.actions.length ? `${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} proposed.` : 'Nothing to approve.'}`);
    return plan;
  }

  /** The therapist approves some or all of a plan. Each action is checked again, then done by the billing code. */
  async function approve(D, planId, numbers) {
    const plan = (D.plans || []).find((x) => x.id === planId);
    if (!plan || plan.status !== 'open') throw new Error('This plan has already been handled. Ask the assistant again.');
    const pick = new Set((Array.isArray(numbers) ? numbers : []).map(Number));
    const results = [];
    for (const a of plan.actions.filter((x) => pick.has(x.n))) {
      const c = checkAction(D, a);
      if (c.error) { results.push({ n: a.n, ok: false, text: c.error }); continue; }
      try { await doAction(D, a); results.push({ n: a.n, ok: true, text: c.summary }); }
      catch (e) { results.push({ n: a.n, ok: false, text: e.message }); log(D, 'error', `Assistant action failed: ${c.summary}: ${e.message}`, a.patient_id); }
    }
    plan.status = 'done'; plan.results = results;
    if (results.length) log(D, 'info', `Approved ${results.filter((r) => r.ok).length} of ${plan.actions.length} assistant action${plan.actions.length === 1 ? '' : 's'}.`);
    return results;
  }

  // ---------- PayPal Checkout on the family page ----------
  async function checkoutStart(D, id) {
    const i = inv(D, id);
    if (!i || !isOpen(i)) throw new Error('This invoice is already settled. Thank you.');
    if (!paypal.createOrder) throw new Error('Paying here is not available.');
    const p = pat(D, i.patient_id), pence = outstanding(i);
    const o = await paypal.createOrder({ invoiceId: i.id, pence, description: `${D.settings.practice}: ${p.known_as}, ${i.period}`, brand: D.settings.practice });
    i.checkout = { order_id: o.id, pence, at: now() };
    return { id: o.id };
  }
  async function checkoutFinish(D, id, orderId) {
    const i = inv(D, id);
    if (!i || !i.checkout || i.checkout.order_id !== orderId) throw new Error('This payment could not be matched to the invoice.');
    const c = await paypal.captureOrder(orderId);
    if (c.status !== 'COMPLETED' || c.custom_id !== i.id || !(c.pence > 0)) throw new Error('PayPal did not complete the payment.');
    const p = pat(D, i.patient_id);
    const toInvoice = Math.min(c.pence, outstanding(i)), extra = c.pence - toInvoice;
    if (toInvoice > 0) {
      if (i.paypal_id) {
        try { await paypal.recordPayment(i.paypal_id, { method: 'paypal', pence: toInvoice, date: today(), note: `Paid with PayPal Checkout, capture ${c.capture_id}` }); }
        catch (e) { log(D, 'error', `Paid with PayPal Checkout, but the PayPal invoice could not be updated: ${e.message}`, p.id); }
      }
      recordLocal(D, i, toInvoice, 'paypal', 'Checkout ' + c.capture_id);
    }
    if (extra > 0) p.credit_pence += extra;
    i.checkout = null;
    log(D, 'paid', `${toName(i.to)} paid ${gbp(c.pence)} for ${p.known_as}, ${i.period} with PayPal Checkout on the family page${extra ? `; ${gbp(extra)} kept as credit` : ''}.`, p.id);
    return { paid: gbp(c.pence) };
  }

  // ---------- the family's "I paid another way" page ----------
  function family(D, id) {
    const i = inv(D, id); if (!i) return null;
    const p = pat(D, i.patient_id);
    return { practice: D.settings.practice, to: toName(i.to), child: p.known_as, period: i.period, outstanding: gbp(outstanding(i)), paid: !isOpen(i), reported: D.claims.some((c) => c.invoice_id === id && c.status === 'pending'), reminder: i.last_reminder || null };
  }
  function familyClaim(D, id, b) {
    const i = inv(D, id);
    if (!i || !isOpen(i)) throw new Error('This invoice is already settled. Thank you.');
    if (D.claims.some((c) => c.invoice_id === id && c.status === 'pending')) throw new Error('You have already told us about this payment. Thank you.');
    const p = pat(D, i.patient_id);
    const pence = toPence(b.amount) || outstanding(i);
    if (pence > outstanding(i) * 3) throw new Error('Please check the amount.');
    const method = ['bank', 'cash', 'cheque', 'other'].includes(b.method) ? b.method : 'other';
    D.claims.unshift({ id: uid('clm'), patient_id: p.id, source: 'family', amount_pence: pence, method, reference: b.reference ? String(b.reference).slice(0, 80) : null, invoice_id: id, status: 'pending', created_at: now() });
    log(D, 'claim', `${toName(i.to)} says ${gbp(pence)} was paid ${how(method)} for ${p.known_as}, ${i.period}.`, p.id);
  }

  /** PayPal webhook or hourly check: bring every open invoice up to date. */
  async function syncAll(D, onlyPayPalId) {
    let changed = 0;
    for (const i of D.invoices.filter((x) => isOpen(x) && x.paypal_id && (!onlyPayPalId || x.paypal_id === onlyPayPalId))) {
      try { if (await refresh(D, i)) changed++; } catch (e) { log(D, 'error', `Could not check PayPal for ${pat(D, i.patient_id).known_as}, ${i.period}: ${e.message}`, i.patient_id); }
    }
    return changed;
  }

  return { handle, migrate, family, familyClaim, checkoutStart, checkoutFinish, sendDueInstalments, checkinView, checkinStart, checkinHold, cancelAppt, syncAll, refreshPayouts, reminders, seed, state, _test: { allocate, toPence, parseByRules, split, deptSplit, budgets, fyOf, partnerSummary } };
}

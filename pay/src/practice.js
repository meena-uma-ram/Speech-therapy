// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
// TJS Pay billing logic. One practice = one document (D), loaded and saved by the caller.
// PayPal and AI are passed in, so the same code runs in the Worker (real PayPal sandbox, Claude)
// and in the browser review copy (simulated PayPal, standard wording).
// Rules: the AI writes and reads words only; every amount, split and date is worked out here in plain code.

export function makePractice({ paypal, ai, linkFor, today: todayFn }) {
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
  const inv = (D, id) => D.invoices.find((i) => i.id === id);
  const svc = (D, id) => D.services.find((s) => s.id === id);
  const billTo = (p) => p.payer.type === 'family' ? (p.caregivers.find((c) => c.invoices) || p.caregivers[0]) : { name: p.payer.name, email: p.payer.email, org: true };
  const toName = (t) => t.org ? t.name : firstWord(t.name);
  const log = (D, kind, text, patient_id = null) => { D.events.unshift({ id: uid('ev'), at: now(), kind, text, patient_id }); D.events.length = Math.min(D.events.length, 200); };
  function fill(D, t, p, i) {
    return String(t).replace(/\{name\}/g, p.payer.type === 'family' ? firstWord(billTo(p).name) : 'there').replace(/\{child\}/g, p.known_as)
      .replace(/\{amount\}/g, gbp(outstanding(i))).replace(/\{period\}/g, i.period).replace(/\{practice\}/g, D.settings.practice);
  }

  // ---------- words: AI first, standard wording if the AI is unavailable ----------
  function standardNote(D, p, period, total, kind) {
    const to = p.payer.type === 'family' ? firstWord(billTo(p).name) : 'there';
    if (p.payer.type !== 'family') return { subject: `${D.settings.practice}: ${p.known_as}, ${period}`, note: `Hello, please find the invoice for ${p.known_as}'s speech and language therapy, ${period}, ${gbp(total)}. It can be paid by PayPal or card using the button, or by bank transfer quoting the invoice number. Thank you.` };
    if (kind === 'block') return { subject: `${p.known_as}'s next block of sessions`, note: `Hi ${to}, ${p.known_as}'s current block is nearly used up, so here is the invoice for the next one (${gbp(total)}). Paying before it runs out keeps sessions going without a gap. You can pay by PayPal, card or bank transfer.` };
    return { subject: `${p.known_as}'s sessions: ${period}`, note: `Hi ${to}, thank you for bringing ${p.known_as}. This covers ${period} and comes to ${gbp(total)}. You can pay by PayPal or card using the button, or by bank transfer.` };
  }
  async function invoiceWords(D, p, period, total, kind, items) {
    const fallback = standardNote(D, p, period, total, kind);
    if (!ai) return { ...fallback, by_ai: false };
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
    let r = null;
    if (ai) {
      try {
        r = await ai.parsePayment({ text, today: today(), patients: D.patients.map((p) => ({ id: p.id, name: p.name, known_as: p.known_as, caregivers: p.caregivers.map((c) => c.name + (c.relation ? ` (${c.relation})` : '')), paid_by: p.payer.type === 'family' ? 'family' : p.payer.name })) });
        if (r && r.patient_id && !pat(D, r.patient_id)) r.patient_id = null; // the AI may only pick a real patient
      } catch { r = null; }
    }
    if (!r) r = parseByRules(D, text);
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
    const i = await makeInvoice(D, p, { kind: 'block', period: `Block ${blocks(D, p.id).length + 1}`, items: [{ name: `${size} × ${svc(D, p.service_id).name}${D.settings.block_discount ? ` (${D.settings.block_discount}% block discount)` : ''}`, pence: blockPrice(D, p) }], blockSize: size });
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
    const items = pick.map((s) => ({ name: `${svc(D, s.service_id).name}, ${fdate(s.date)}${s.where === 'online' ? ' (online)' : ''}`, pence: s.price_pence }));
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
  async function seed(D) {
    const d = (k) => addDays(today(), -k);
    Object.assign(D, {
      settings: {
        practice: 'Northern Voices Speech Therapy', therapist: 'Sarah', reminder_days: [3, 7, 14], block_size: 10, block_discount: 10, renew_at: 8, renew_action: 'send', fee_percent: 2.9, fee_fixed_pence: 30,
        reminder_texts: [
          'Hi {name}, a quick reminder that the invoice for {child}, {period} ({amount}) is still open. If you have already paid by bank transfer or cash, you can tell us with the link below.',
          'Hi {name}, {amount} for {child}, {period} is still unpaid. If something is wrong with the invoice, or the timing is difficult, please reply and we can sort it out.',
          'Hi {name}, this is the last automatic reminder for {child}, {period} ({amount}). Please pay or get in touch this week. Thank you.',
        ],
      },
      services: [
        { id: 'svc_assess', name: 'Assessment', minutes: 60, price_pence: 12000 },
        { id: 'svc_45', name: 'Therapy session', minutes: 45, price_pence: 6000 },
        { id: 'svc_30', name: 'Short therapy session', minutes: 30, price_pence: 4500 },
        { id: 'svc_check', name: 'Online check-in', minutes: 20, price_pence: 3000 },
        { id: 'svc_intensive', name: 'Intensive day', minutes: 180, price_pence: 30000 },
        { id: 'svc_travel', name: 'Travel to home or school', minutes: 0, price_pence: 2000 },
      ],
      patients: [], sessions: [], invoices: [], payments: [], claims: [], expenses: [], events: [],
    });
    const P = (o) => D.patients.push({ credit_pence: 0, ...o });
    P({ id: 'p_arjun', name: 'Arjun Patel', known_as: 'Arjun', caregivers: [{ name: 'Priya Patel', relation: 'Mum', email: 'priya@example.com', invoices: true }], payer: { type: 'family' }, plan: 'session', service_id: 'svc_45' });
    P({ id: 'p_amara', name: 'Amara Okafor', known_as: 'Amara', caregivers: [{ name: 'Chidi Okafor', relation: 'Dad', email: 'chidi@example.com', invoices: true }, { name: 'Ngozi Okafor', relation: 'Mum', email: 'ngozi@example.com', invoices: false }], payer: { type: 'family' }, plan: 'monthly', service_id: 'svc_30' });
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
      const items = ses.map((s) => ({ name: svc(D, s.service_id).name + ', ' + fdate(s.date), pence: s.price_pence }));
      const i = await makeInvoice(D, p, { kind, period, items, sessionIds: ses.map((s) => s.id), words: quick(p, period, items.reduce((t, x) => t + x.pence, 0), kind) });
      if (paidDaysAgo != null) { Object.assign(i, { status: 'SENT', sent_at: d(sentDaysAgo), due_date: d(sentDaysAgo - 14) }); recordLocal(D, i, i.total_pence, method, ref, d(paidDaysAgo)); }
      else { await send(D, i, { quiet: true }); Object.assign(i, { sent_at: d(sentDaysAgo), due_date: d(sentDaysAgo - 14) }); }
      return i;
    };
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
    const zb = await makeInvoice(D, zp, { kind: 'block', period: 'Block 1', items: [{ name: '10 × Therapy session (10% block discount)', pence: 54000 }], blockSize: 10, words: quick(zp, 'Block 1', 54000, 'block') });
    Object.assign(zb, { status: 'SENT', sent_at: d(52), due_date: d(38) }); recordLocal(D, zb, 54000, 'bank', 'KHAN BLOCK1', d(50));
    [49, 42, 35, 28, 21, 14, 7].forEach((k) => S('p_zara', d(k), 'svc_45', 'in person', zb.id));
    await old(pat(D, 'p_tomas'), 'monthly', fmonth(twoAgo), [S('p_tomas', `${twoAgo}-06`, 'svc_assess', 'at school'), S('p_tomas', `${twoAgo}-06`, 'svc_travel'), ...['13', '20', '27'].map((x) => S('p_tomas', `${twoAgo}-${x}`, 'svc_45', 'at school'))], 33, 20, 'bank', 'NFC-PO-88213');
    await old(pat(D, 'p_tomas'), 'monthly', fmonth(lastMonth), ['03', '10', '17', '24'].map((x) => S('p_tomas', `${lastMonth}-${x}`, 'svc_45', 'at school')), 5, null);
    [[twoAgo, '01', 'Room hire at the community centre', 'Rent', 40000], [twoAgo, '09', 'Assessment forms', 'Materials', 8500], [twoAgo, '30', 'Mileage, school visits', 'Travel', 4200], [lastMonth, '01', 'Room hire at the community centre', 'Rent', 40000], [lastMonth, '12', 'HCPC registration (monthly share)', 'Professional', 1800], [lastMonth, '20', 'Picture cards and toys', 'Materials', 3150], [lastMonth, '28', 'Mileage, school visits', 'Travel', 3800], [today().slice(0, 7), '01', 'Room hire at the community centre', 'Rent', 40000]]
      .forEach(([mo, dd, what, cat, pence]) => D.expenses.push({ id: uid('exp'), date: `${mo}-${dd}`, what, category: cat, pence }));
    D.events = [];
    log(D, 'info', paypal.mode === 'mock' ? 'Demo data loaded (PayPal simulated).' : 'Demo data loaded. Unpaid invoices were created in the PayPal sandbox.');
  }

  // ---------- what the screen sends ----------
  const state = (D, mode) => ({ mode, today: today(), ...D, mock_paypal: undefined, plans: undefined, ai_usage: undefined, ai: !!ai, blockPrices: Object.fromEntries(D.patients.map((p) => [p.id, blockPrice(D, p)])) });

  async function handle(D, path, b = {}, mode) {
    const p = path.split('/');
    switch (p[0]) {
      case 'state': return state(D, mode);
      case 'seed': await seed(D); return state(D, mode);
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
        else if (p[2] === 'discard') { if (i.status !== 'DRAFT') throw new Error('Only drafts can be deleted.'); D.sessions.forEach((s) => { if (s.invoice_id === i.id) s.invoice_id = null; }); D.invoices = D.invoices.filter((x) => x !== i); }
        else if (p[2] === 'refresh') { if (!(await refresh(D, i))) log(D, 'info', `Checked PayPal: ${pat(D, i.patient_id).known_as}, ${i.period} not paid yet.`, i.patient_id); }
        else if (p[2] === 'reminder-text') return { text: i.next_reminder || D.settings.reminder_texts[Math.min(i.reminder_count + 1, D.settings.reminder_texts.length) - 1], filled: nextReminderText(D, i), custom: !!i.next_reminder, number: i.reminder_count + 1 };
        else if (p[2] === 'reminder-save') { i.next_reminder = String(b.text || '').trim().slice(0, 1200) || null; log(D, 'info', `Next reminder edited: ${pat(D, i.patient_id).known_as}, ${i.period}.`, i.patient_id); }
        else if (p[2] === 'reminder-now') { if (!isOpen(i)) throw new Error('This invoice is already paid.'); if (await refresh(D, i)) return state(D, mode); if (b.text) i.next_reminder = String(b.text).trim().slice(0, 1200); await sendReminder(D, i); }
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
        return { plan: await assistant(D, b.request) };
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

  // ---------- the billing assistant ----------
  // The AI plans; this code checks and does. Read tools return billing facts only. propose_action only
  // adds a numbered proposal to the plan; each one is checked again and run only when the therapist approves it.
  const daysLate = (i) => i.due_date && i.due_date < today() ? daysBetween(i.due_date, today()) : 0;
  const ACTIONS = ['reminder', 'invoice', 'send_draft', 'confirm_payment'];
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
    return { error: 'Unknown action.' };
  }
  async function doAction(D, a) {
    if (a.type === 'reminder') return sendReminder(D, inv(D, a.id));
    if (a.type === 'send_draft') return send(D, inv(D, a.id));
    if (a.type === 'invoice') { const id = await draftFor(D, a.id); return send(D, inv(D, id)); }
    if (a.type === 'confirm_payment') return confirm(D, a.id);
  }

  const TOOLS = [
    { name: 'list_unpaid_invoices', description: 'Every invoice that has been sent and is not fully paid, as TJS Pay last knew it: who it is for, who pays, amount owed, dates, how many days late, reminders sent, and whether the family has said they paid another way. Run check_paypal first if you need up-to-the-minute status.', input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
    { name: 'check_paypal', description: 'Ask PayPal now whether these invoices have been paid. Any payment PayPal has taken is recorded straight away. Use it before proposing reminders so nobody who has paid is chased.', input_schema: { type: 'object', properties: { invoice_ids: { type: 'array', items: { type: 'string' }, description: 'Invoice ids from list_unpaid_invoices. Empty means every unpaid invoice.' } }, required: ['invoice_ids'], additionalProperties: false }, strict: true },
    { name: 'list_patients', description: 'Billing facts for every patient: billing type, who pays, sessions waiting to be invoiced and their value, drafts, amount owed and credit. No clinical information.', input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
    { name: 'list_reported_payments', description: 'Payments families or the therapist reported outside PayPal (bank transfer, cash, cheque) that are waiting for the therapist to confirm they arrived.', input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true },
    { name: 'month_summary', description: 'Money for one month: paid in, estimated PayPal fees, expenses, profit, sessions and hours, split by payer and payment method.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'], additionalProperties: false }, strict: true },
    { name: 'propose_action', description: 'Add one action to the plan for the therapist to approve. Nothing happens until they approve it. reminder: id is an invoice id; sends the next reminder through PayPal. invoice: id is a patient id; invoices their waiting sessions and sends it through PayPal. send_draft: id is a draft invoice id. confirm_payment: id is a reported payment id. Each action is checked; an error explains why it was not added.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ACTIONS }, id: { type: 'string' }, reason: { type: 'string', description: 'One short sentence the therapist will see.' } }, required: ['type', 'id', 'reason'], additionalProperties: false }, strict: true },
  ];
  const STEP = { list_unpaid_invoices: 'Looked at unpaid invoices', check_paypal: 'Checked payment status with PayPal', list_patients: 'Looked at patients and sessions to invoice', list_reported_payments: 'Looked at payments families reported', month_summary: 'Added up the month' };

  async function runTool(D, plan, name, input) {
    if (name !== 'propose_action' && STEP[name] && !plan.steps.includes(STEP[name])) plan.steps.push(STEP[name]);
    if (name === 'list_unpaid_invoices') return D.invoices.filter(isOpen).map((i) => { const p = pat(D, i.patient_id); return { invoice_id: i.id, patient: p.known_as, paid_by: i.to.org ? i.to.name : `${toName(i.to)} (family)`, period: i.period, owed: gbp(outstanding(i)), sent_on: i.sent_at, due_on: i.due_date, days_since_sent: daysBetween(i.sent_at, today()), days_late: daysLate(i), reminders_sent: i.reminder_count, last_reminder_on: i.last_reminder_at, family_says_paid_another_way: D.claims.some((c) => c.invoice_id === i.id && c.status === 'pending') }; });
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
    if (name === 'propose_action') {
      const a = { type: input.type, id: String(input.id || '') };
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
    const all = !/remind|chase|owe|late|overdue|unpaid|invoice|bill|paid|confirm|month|profit/.test(t);
    const propose = async (type, id, reason) => { try { await runTool(D, plan, 'propose_action', { type, id, reason }); } catch { /* not eligible: skip */ } };
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
    if (/month|profit/.test(t)) { const f = await runTool(D, plan, 'month_summary', { month: today().slice(0, 7) }); lines.push(`${f.month}: ${f.paid_in} paid in, ${f.profit} profit after fees and expenses.`); }
    lines.push(plan.actions.length ? `I’ve proposed ${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} below. Nothing is sent until you approve.` : 'There’s nothing to do right now.');
    return lines.join(' ');
  }

  async function assistant(D, request) {
    request = String(request || '').trim().slice(0, 600);
    if (!request) throw new Error('Ask the assistant something first.');
    const plan = { id: uid('plan'), request, created_at: now(), steps: [], actions: [], text: '', by_ai: false, status: 'open' };
    if (ai && ai.assistant) {
      const s = D.settings;
      const system = `You are the billing assistant inside TJS Pay for ${s.practice}, an independent speech and language therapy practice in the UK. The therapist is ${s.therapist}. Today is ${today()}.
You help with money only: invoices, PayPal payments, reminders and payments made outside PayPal. You never see or discuss clinical information.
How you work:
- Look things up with the tools. Before proposing a reminder, run check_paypal so nobody who has already paid is chased.
- You cannot send, charge or record anything yourself. Use propose_action for each thing that should happen; the therapist approves each one on screen.
- Propose only what the request asks for. If someone says they paid another way, don't propose a reminder for that invoice; mention it instead.
- Reminders follow the practice's own wording and schedule (days ${s.reminder_days.join(', ')} after sending). The "reason" is for the therapist, not the family.
- Quote amounts exactly as the tools give them. Never invent amounts, dates or people.
Then reply to the therapist in plain UK English: what you found and what you proposed, referring to proposals by number. At most 120 words, no tables, no headings, no emojis.`;
      try {
        const r = await ai.assistant({ system, request, tools: TOOLS, run: (name, input) => runTool(D, plan, name, input) });
        plan.text = r.text || 'Done.'; plan.by_ai = true;
      } catch (e) {
        plan.steps.push(`AI unavailable (${String(e.message || e).slice(0, 80)}), so the built-in rules were used`);
        plan.text = await assistantByRules(D, plan, request);
      }
    } else plan.text = await assistantByRules(D, plan, request);
    D.plans = [plan, ...(D.plans || [])].slice(0, 5);
    log(D, 'info', `Assistant: “${request.slice(0, 80)}”. ${plan.actions.length ? `${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} proposed.` : 'Nothing to approve.'}`);
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

  return { handle, family, familyClaim, checkoutStart, checkoutFinish, syncAll, reminders, seed, state, _test: { allocate, toPence, parseByRules } };
}

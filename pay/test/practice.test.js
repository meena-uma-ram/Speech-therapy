import test from 'node:test';
import assert from 'node:assert/strict';
import { makePractice } from '../src/practice.js';
import { mockPaypal } from '../src/paypal.js';

async function fresh(ai = null) {
  const D = {}; const pp = mockPaypal(D);
  const calls = [];
  const spy = { ...pp, createAndSend: async (x) => { calls.push(['send', x.invoice.id]); return pp.createAndSend(x); }, remind: async (id, x) => { calls.push(['remind', id]); }, recordPayment: async (id, x) => { calls.push(['record', id, x.method, x.pence]); return pp.recordPayment(id, x); } };
  const P = makePractice({ paypal: spy, ai, linkFor: async (id) => 'https://x/paid#i=' + id });
  await P.seed(D);
  return { D, P, pp, calls };
}
const inv = (D, pid, status) => D.invoices.find((i) => i.patient_id === pid && (!status || i.status === status));

test('seed: unpaid invoices are created in PayPal, paid history is not', async () => {
  const { D, calls } = await fresh();
  assert.equal(D.patients.length, 6);
  assert.equal(calls.filter((c) => c[0] === 'send').length, 3); // Freya, Liam, Tomás
});

test('allocate: oldest first, overpayment kept as credit', async () => {
  const { P } = await fresh();
  const r = P._test.allocate(10000, [
    { id: 'b', total_pence: 6000, paid_pence: 0, status: 'SENT', sent_at: '2026-10-20' },
    { id: 'a', total_pence: 3000, paid_pence: 0, status: 'SENT', sent_at: '2026-10-01' },
  ]);
  assert.deepEqual(r.allocation, [{ invoice_id: 'a', pence: 3000 }, { invoice_id: 'b', pence: 6000 }]);
  assert.equal(r.credit_pence, 1000);
});

test('plain words without AI: name only, bare numbers, references', async () => {
  const { D, P } = await fresh();
  let r = await P.handle(D, 'claims/parse', { text: 'Liam paid' });
  assert.equal(r.who, 'Liam'); assert.equal(r.pence, 13500); assert.equal(r.assumed, true);
  r = await P.handle(D, 'claims/parse', { text: 'Siobhan paid 135 by bank ref MUR-88213' });
  assert.equal(r.who, 'Liam'); assert.equal(r.pence, 13500); assert.equal(r.method, 'bank'); assert.equal(r.reference, 'MUR-88213');
  r = await P.handle(D, 'claims/parse', { text: 'someone paid 20' });
  assert.ok(r.unclear);
});

test('AI parse can only pick a real patient; code still does the sums', async () => {
  const { D, P } = await fresh({ parsePayment: async () => ({ patient_id: 'p_nobody', amount: 50, method: 'cash' }), invoiceNote: async () => { throw new Error('x'); } });
  const r = await P.handle(D, 'claims/parse', { text: 'Liam paid 50 cash' });
  assert.equal(r.patient_id, null);
  assert.ok(r.unclear);
});

test('recording a payment writes it to the PayPal invoice and splits correctly', async () => {
  const { D, P, calls } = await fresh();
  await P.handle(D, 'claims/record', { patient_id: 'p_liam', pence: 20000, method: 'cash' });
  const i = inv(D, 'p_liam');
  assert.equal(i.status, 'MARKED_AS_PAID');
  assert.equal(D.patients.find((p) => p.id === 'p_liam').credit_pence, 6500);
  assert.deepEqual(calls.find((c) => c[0] === 'record').slice(2), ['cash', 13500]);
});

test('PayPal payment is picked up by a sync (webhook or hourly)', async () => {
  const { D, P, pp } = await fresh();
  const i = inv(D, 'p_freya', 'SENT');
  await pp.simulatePay(i.paypal_id);
  assert.equal(await P.syncAll(D), 1);
  assert.equal(i.status, 'PAID');
  assert.equal(D.payments[0].method, 'paypal');
});

test('reminders: one at a time, never twice a day, never after payment', async () => {
  const { D, P, calls } = await fresh();
  const first = await P.reminders(D);
  assert.equal(first, 3);
  assert.equal(await P.reminders(D), 0);
  assert.equal(calls.filter((c) => c[0] === 'remind').length, 3);
});

test('edited reminder text is used once, then cleared', async () => {
  const { D, P } = await fresh();
  const i = inv(D, 'p_liam');
  await P.handle(D, `invoices/${i.id}/reminder-save`, { text: 'Hi {name}, about {amount} for {child}.' });
  const r = await P.handle(D, `invoices/${i.id}/reminder-text`);
  assert.equal(r.filled, 'Hi Siobhan, about £135.00 for Liam.');
  await P.handle(D, `invoices/${i.id}/reminder-now`, {});
  assert.equal(i.next_reminder, null);
  assert.equal(i.last_reminder, 'Hi Siobhan, about £135.00 for Liam.');
});

test('blocks: session 8 sends the next block, sessions 9-10 still use the first', async () => {
  const { D, P } = await fresh();
  for (let k = 0; k < 4; k++) await P.handle(D, 'sessions', { patient_id: 'p_zara' });
  const blocks = D.invoices.filter((i) => i.patient_id === 'p_zara' && i.kind === 'block');
  assert.equal(blocks.length, 2);
  assert.equal(blocks.find((b) => b.period === 'Block 2').total_pence, 54000);
  assert.equal(D.sessions.filter((s) => s.invoice_id === blocks.find((b) => b.period === 'Block 1').id).length, 10);
  assert.equal(D.sessions.filter((s) => s.invoice_id === blocks.find((b) => b.period === 'Block 2').id).length, 1);
});

test('family report then confirm; a second report is refused', async () => {
  const { D, P } = await fresh();
  const i = inv(D, 'p_freya', 'SENT');
  P.familyClaim(D, i.id, { method: 'bank', amount: '60' });
  assert.throws(() => P.familyClaim(D, i.id, { method: 'bank' }));
  await P.handle(D, `claims/${D.claims[0].id}/confirm`);
  assert.equal(i.status, 'MARKED_AS_PAID');
  assert.equal(P.family(D, i.id).paid, true);
});

test('invoice wording falls back to standard text when the AI fails', async () => {
  const { D, P } = await fresh({ invoiceNote: async () => { throw new Error('down'); } });
  const r = await P.handle(D, 'invoices/draft', { patient_id: 'p_amara' });
  const i = D.invoices.find((x) => x.id === r.draft);
  assert.equal(i.note_by_ai, false);
  assert.match(i.note, /£180\.00/);
});

test('finances add up', async () => {
  const { D, P } = await fresh();
  const lastMonth = new Date(); lastMonth.setUTCDate(0);
  const m = await P.handle(D, 'money', { month: lastMonth.toISOString().slice(0, 7) });
  assert.equal(m.profit, m.paidIn - m.fees - m.spent);
  assert.ok(m.byService.length > 0);
});

test('reminders go in order even if several are overdue', async () => {
  const { D, P } = await fresh();
  const liam = D.invoices.find((i) => i.patient_id === 'p_liam');
  await P.reminders(D);
  assert.equal(liam.reminder_count, 2);
  assert.match(liam.last_reminder, /still unpaid/);
});

// ---------- billing assistant ----------
test('assistant without AI: "chase anyone more than two weeks late" proposes only Liam, and nothing is sent before approval', async () => {
  const { D, P, calls } = await fresh();
  const { plan } = await P.handle(D, 'assistant', { request: 'Who owes me money? Chase anyone more than two weeks late.' });
  assert.equal(plan.by_ai, false);
  assert.deepEqual(plan.actions.map((a) => [a.type, D.invoices.find((i) => i.id === a.id).patient_id]), [['reminder', 'p_liam']]);
  assert.equal(calls.filter((c) => c[0] === 'remind').length, 0);
  const st = await P.handle(D, 'assistant/approve', { plan_id: plan.id, numbers: [1] });
  assert.deepEqual(st.results.map((r) => r.ok), [true]);
  assert.equal(calls.filter((c) => c[0] === 'remind').length, 1);
  assert.equal(inv(D, 'p_liam').reminder_count, 2);
  await assert.rejects(P.handle(D, 'assistant/approve', { plan_id: plan.id, numbers: [1] }), /already been handled/);
});

test('assistant without AI: "invoice everything" proposes Arjun and Amara, and approval sends through PayPal', async () => {
  const { D, P, calls } = await fresh();
  const { plan } = await P.handle(D, 'assistant', { request: 'Invoice everything that’s waiting' });
  assert.deepEqual(plan.actions.map((a) => [a.type, a.id]).sort(), [['invoice', 'p_amara'], ['invoice', 'p_arjun']]);
  const before = calls.filter((c) => c[0] === 'send').length;
  const st = await P.handle(D, 'assistant/approve', { plan_id: plan.id, numbers: [1, 2] });
  assert.ok(st.results.every((r) => r.ok));
  assert.equal(calls.filter((c) => c[0] === 'send').length, before + 2);
  assert.equal(D.sessions.filter((s) => ['p_arjun', 'p_amara'].includes(s.patient_id) && !s.invoice_id).length, 0);
});

test('assistant with AI: invalid proposals are refused, and every action is checked again at approval', async () => {
  let seen = [];
  const fakeAi = {
    async assistant({ tools, run }) {
      assert.ok(tools.every((t) => t.strict && t.input_schema.additionalProperties === false));
      const open = await run('list_unpaid_invoices', {});
      const paid = (await run('list_patients', {})).find((p) => p.known_as === 'Arjun');
      seen = open.map((o) => o.patient);
      await assert.rejects(run('propose_action', { type: 'reminder', id: 'inv_nope', reason: 'x' }), /No invoice/);
      await assert.rejects(run('propose_action', { type: 'invoice', id: 'p_zara', reason: 'x' }), /no sessions waiting/);
      for (const o of open) await run('propose_action', { type: 'reminder', id: o.invoice_id, reason: 'late' });
      assert.equal((await run('propose_action', { type: 'reminder', id: open[0].invoice_id, reason: 'again' })).added, false);
      assert.ok(paid);
      return { text: 'Three invoices are unpaid. I proposed reminders 1 to 3.' };
    },
  };
  const { D, P, pp, calls } = await fresh(fakeAi);
  const { plan } = await P.handle(D, 'assistant', { request: 'chase everyone' });
  assert.equal(plan.by_ai, true);
  assert.deepEqual(seen.sort(), ['Freya', 'Liam', 'Tomás']);
  assert.equal(plan.actions.length, 3);
  // Freya pays through PayPal before the therapist approves: her reminder must not go out.
  const freya = inv(D, 'p_freya', 'SENT');
  await pp.simulatePay(freya.paypal_id);
  await P.handle(D, 'invoices/' + freya.id + '/refresh', {});
  const st = await P.handle(D, 'assistant/approve', { plan_id: plan.id, numbers: plan.actions.map((a) => a.n) });
  const fr = st.results.find((r) => plan.actions.find((a) => a.n === r.n).id === freya.id);
  assert.equal(fr.ok, false); assert.match(fr.text, /already paid/);
  assert.equal(calls.filter((c) => c[0] === 'remind').length, 2);
});

test('assistant falls back to the rules when the AI fails', async () => {
  const { D, P } = await fresh({ assistant: async () => { throw new Error('daily AI limit reached'); } });
  const { plan } = await P.handle(D, 'assistant', { request: 'chase anyone late' });
  assert.equal(plan.by_ai, false);
  assert.ok(plan.steps.some((s) => /AI unavailable/.test(s)));
  assert.ok(plan.actions.length >= 1);
});

// ---------- PayPal Checkout on the family page ----------
test('checkout: the family pays the amount owed, recorded on the PayPal invoice as a PayPal payment', async () => {
  const { D, P, calls } = await fresh();
  const i = inv(D, 'p_liam', 'SENT');
  const o = await P.checkoutStart(D, i.id);
  await assert.rejects(P.checkoutFinish(D, i.id, 'SOME-OTHER-ORDER'), /could not be matched/);
  const r = await P.checkoutFinish(D, i.id, o.id);
  assert.equal(r.paid, '£135.00');
  assert.equal(i.status, 'PAID');
  assert.deepEqual(calls.filter((c) => c[0] === 'record').pop(), ['record', i.paypal_id, 'paypal', 13500]);
  await P.handle(D, 'invoices/' + i.id + '/refresh', {}); // the hourly check must not count it twice
  assert.equal(i.paid_pence, 13500);
  await assert.rejects(P.checkoutStart(D, i.id), /already settled/);
});

// ---------- departments and PayPal Payouts ----------
const lastMonthOf = (D) => { const t = new Date(); t.setUTCDate(1); t.setUTCDate(0); return t.toISOString().slice(0, 7); };

test('departments: ten with unique codes, and every invoice line carries one', async () => {
  const { D } = await fresh();
  assert.equal(D.departments.length, 10);
  assert.equal(new Set(D.departments.map((d) => d.code)).size, 10);
  for (const i of D.invoices) for (const it of i.items) assert.ok(it.code && D.departments.some((d) => d.id === it.dept_id), `${i.id} ${it.name}`);
});

test('split: pennies always add up, and a mixed invoice is shared by its lines', async () => {
  const { D, P } = await fresh();
  const parts = P._test.split(1001, [{ key: 'a', w: 1 }, { key: 'b', w: 1 }, { key: 'c', w: 1 }]);
  assert.equal(parts.reduce((t, x) => t + x.pence, 0), 1001);
  const mixed = D.invoices.find((i) => i.items.some((it) => it.code === 'ENT-01') && i.items.some((it) => it.code === 'AUD-01'));
  const pay = D.payments.find((x) => x.invoice_id === mixed.id);
  const s = P._test.deptSplit(D, pay);
  assert.deepEqual(s.map((x) => x.pence).sort((a, b) => a - b), [8500, 15000]);
});

test('budgets: income by department adds up to the year’s payments; used + left = budget', async () => {
  const { D, P } = await fresh();
  const B = await P.handle(D, 'departments', {});
  const fy = P._test.fyOf(new Date().toISOString().slice(0, 10));
  const paid = D.payments.filter((x) => x.date >= fy.start && x.date <= fy.end).reduce((t, x) => t + x.pence, 0);
  assert.equal(B.totals.income, paid);
  for (const r of B.departments) assert.equal(r.used + r.left, r.budget);
  assert.equal(B.totals.waiting, 3);
});

test('requests: a department asks, administration pays with PayPal Payouts, and it counts against the budget', async () => {
  const { D, P } = await fresh();
  await assert.rejects(P.handle(D, 'requests', { dept_id: 'dep_ot', amount: '120', purpose: 'Weighted blankets', pay_to: 'supplier', payee_email: 'not-an-email' }), /supplier’s PayPal email/);
  const st = await P.handle(D, 'requests', { dept_id: 'dep_ot', amount: '120', purpose: 'Weighted blankets' });
  const r = D.requests[0];
  assert.equal(r.status, 'pending'); assert.equal(r.payee_email, 'ot-01.payouts@example.org');
  const before = st.budgets.departments.find((x) => x.id === 'dep_ot');
  const after = (await P.handle(D, `requests/${r.id}/approve`, {})).budgets.departments.find((x) => x.id === 'dep_ot');
  assert.equal(r.status, 'sending'); assert.ok(r.payout.batch_id);
  assert.equal(after.left, before.left - 12000);
  await assert.rejects(P.handle(D, `requests/${r.id}/approve`, {}), /already been handled/);
  await P.refreshPayouts(D);
  assert.equal(r.status, 'paid');
});

test('requests: over budget needs an explicit decision; a failed payout stops counting and can be approved again', async () => {
  const { D, P, pp } = await fresh();
  const neuro = D.requests.find((x) => x.dept_id === 'dep_neuro' && x.status === 'pending');
  await assert.rejects(P.handle(D, `requests/${neuro.id}/approve`, {}), /over its budget/);
  await P.handle(D, `requests/${neuro.id}/approve`, { over_budget: true });
  assert.match(neuro.reason, /over budget/);
  const left = () => P._test.budgets(D).departments.find((x) => x.id === 'dep_neuro').left;
  assert.ok(left() < 0);
  pp.failPayoutItem(neuro.payout.batch_id, neuro.payout.item_id);
  await P.refreshPayouts(D);
  assert.equal(neuro.status, 'failed');
  assert.ok(left() > 0);
  const pt = D.requests.find((x) => x.dept_id === 'dep_pt');
  await P.handle(D, `requests/${pt.id}/reject`, { reason: 'Use the existing stock first.' });
  assert.equal(pt.status, 'rejected');
  await assert.rejects(P.handle(D, `requests/${pt.id}/approve`, {}), /already been handled/);
});

test('assistant without AI: money requests that fit the budget are proposed; the over-budget one is left to administration', async () => {
  const { D, P } = await fresh();
  const { plan } = await P.handle(D, 'assistant', { request: 'Review the money requests from departments', team: 'finance' });
  const depts = plan.actions.map((a) => D.requests.find((r) => r.id === a.id).dept_id).sort();
  assert.deepEqual(depts, ['dep_aud', 'dep_pt']);
  assert.match(plan.text, /over budget/);
  const st = await P.handle(D, 'assistant/approve', { plan_id: plan.id, numbers: [1, 2] });
  assert.ok(st.results.every((x) => x.ok));
  assert.equal(D.requests.filter((r) => r.status === 'sending').length, 2);
});

test('teams: the billing office cannot pay money requests, and finance cannot send reminders', async () => {
  let billingTools = [], financeTools = [];
  const ai = {
    async assistant({ tools, run }) {
      const names = tools.map((t) => t.name);
      const enumOf = tools.find((t) => t.name === 'propose_action').input_schema.properties.type.enum;
      if (names.includes('department_budgets')) {
        financeTools = names;
        assert.deepEqual(enumOf, ['pay_request']);
        await assert.rejects(run('propose_action', { type: 'reminder', id: 'x', reason: 'x' }), /not a finance action/);
        await assert.rejects(run('check_paypal', { invoice_ids: [] }), /not available/);
      } else {
        billingTools = names;
        assert.ok(!enumOf.includes('pay_request'));
        await assert.rejects(run('department_budgets', {}), /not available/);
        await assert.rejects(run('propose_action', { type: 'pay_request', id: 'x', reason: 'x' }), /not a billing office action/);
      }
      return { text: 'ok' };
    },
  };
  const { D, P } = await fresh(ai);
  const b = (await P.handle(D, 'assistant', { request: 'pay the requests' })).plan;
  const f = (await P.handle(D, 'assistant', { request: 'chase everyone', team: 'finance' })).plan;
  assert.equal(b.team, 'billing'); assert.equal(f.team, 'finance');
  assert.ok(billingTools.includes('check_paypal') && !billingTools.includes('department_budgets'));
  assert.ok(financeTools.includes('department_budgets') && !financeTools.includes('check_paypal'));
});

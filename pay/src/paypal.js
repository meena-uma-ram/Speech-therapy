// SPDX-License-Identifier: AGPL-3.0-or-later
// PayPal Invoicing v2. Credentials stay in Worker secrets and never reach the browser.
// PAYPAL_MODE=mock simulates PayPal for local testing; the submitted demo uses the real sandbox.
const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };
const pounds = (p) => (p / 100).toFixed(2);
const METHOD = { bank: 'BANK_TRANSFER', cash: 'CASH', cheque: 'CHECK', paypal: 'PAYPAL', other: 'OTHER' };

export function paypal(env, D) {
  const mode = env.PAYPAL_MODE || 'sandbox';
  if (mode === 'mock') return mockPaypal(D);
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal keys are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET as Worker secrets.');
  const base = BASE[mode] || BASE.sandbox, currency = env.CURRENCY || 'GBP';
  let token = null;
  async function auth() {
    if (token && token.exp > Date.now()) return token.value;
    const res = await fetch(base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status}). Check the client ID and secret.`);
    const j = await res.json();
    token = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
    return token.value;
  }
  async function call(method, path, body, extra = {}) {
    const res = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + (await auth()), 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!res.ok) {
      const detail = data.details?.map((d) => d.issue + (d.description ? ': ' + d.description : '')).join('; ') || data.message || res.statusText;
      throw new Error(`PayPal ${path.split('/').slice(0, 5).join('/')} (${res.status}): ${detail}`);
    }
    return data;
  }
  return {
    mode,
    async createAndSend({ invoice, to, practice, note, subject, dueDate }) {
      const recipient = to.org
        ? { billing_info: { business_name: to.name, email_address: env.DEMO_RECIPIENT_EMAIL || to.email } }
        : { billing_info: { name: { given_name: to.name.split(' ')[0], surname: to.name.split(' ').slice(1).join(' ') || to.name.split(' ')[0] }, email_address: env.DEMO_RECIPIENT_EMAIL || to.email } };
      const created = await call('POST', '/v2/invoicing/invoices', {
        detail: { currency_code: currency, reference: [invoice.id, ...new Set(invoice.items.map((it) => it.code).filter(Boolean))].join(' ').slice(0, 120), note: note.slice(0, 4000), payment_term: { due_date: dueDate } },
        invoicer: { business_name: practice.slice(0, 100) },
        primary_recipients: [recipient],
        items: invoice.items.map((it) => ({ name: ((it.code ? it.code + ' · ' : '') + it.name).slice(0, 200), description: it.dept_name ? `${it.dept_name} (department ${it.code})`.slice(0, 1000) : undefined, quantity: '1', unit_amount: { currency_code: currency, value: pounds(it.pence) }, unit_of_measure: 'QUANTITY' })),
        configuration: { allow_tip: false, partial_payment: { allow_partial_payment: invoice.kind === 'monthly' } },
      }, { Prefer: 'return=representation' });
      await call('POST', `/v2/invoicing/invoices/${created.id}/send`, { subject: subject.slice(0, 100), note: note.slice(0, 1000), send_to_invoicer: false, send_to_recipient: true });
      const full = await call('GET', `/v2/invoicing/invoices/${created.id}`);
      return { id: created.id, view_url: full.detail?.metadata?.recipient_view_url || null };
    },
    async remind(id, { subject, note }) {
      await call('POST', `/v2/invoicing/invoices/${id}/remind`, { subject: subject.slice(0, 100), note: note.slice(0, 1000), send_to_invoicer: false, send_to_recipient: true });
    },
    async recordPayment(id, { method, pence, date, note }) {
      await call('POST', `/v2/invoicing/invoices/${id}/payments`, { method: METHOD[method] || 'OTHER', payment_date: date, amount: { currency_code: currency, value: pounds(pence) }, note: (note || '').slice(0, 2000) });
    },
    async get(id) {
      const i = await call('GET', `/v2/invoicing/invoices/${id}`);
      const paid = i.payments?.paid_amount?.value;
      return { status: i.status, paid_pence: paid ? Math.round(parseFloat(paid) * 100) : 0 };
    },
    // PayPal Checkout (Orders v2): the family pays the amount owed straight from the family page.
    async createOrder({ invoiceId, pence, description, brand }) {
      const o = await call('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: invoiceId, custom_id: invoiceId, description: description.slice(0, 127), amount: { currency_code: currency, value: pounds(pence) } }],
        application_context: { brand_name: (brand || '').slice(0, 127) || undefined, shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
      }, { Prefer: 'return=minimal' });
      return { id: o.id };
    },
    async captureOrder(orderId) {
      const o = await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { 'PayPal-Request-Id': 'capture-' + orderId, Prefer: 'return=representation' });
      const u = o.purchase_units?.[0] || {}, cap = u.payments?.captures?.[0] || {};
      return { status: o.status === 'COMPLETED' && cap.status === 'COMPLETED' ? 'COMPLETED' : (cap.status || o.status), custom_id: cap.custom_id || u.custom_id || u.reference_id, capture_id: cap.id || null, pence: cap.amount && cap.amount.currency_code === currency ? Math.round(parseFloat(cap.amount.value) * 100) : 0 };
    },
    // PayPal Payouts: the hospital pays each department its share for a month, in one batch.
    // In the sandbox every department's payout goes to DEMO_PAYOUT_EMAIL (or the demo family account), so it can be seen.
    async createPayout({ batchId, subject, items }) {
      const r = await call('POST', '/v1/payments/payouts', {
        sender_batch_header: { sender_batch_id: batchId, email_subject: subject.slice(0, 255), email_message: 'Your department’s share for the month, from the hospital billing office.' },
        items: items.map((x) => ({ recipient_type: 'EMAIL', receiver: env.DEMO_PAYOUT_EMAIL || env.DEMO_RECIPIENT_EMAIL || x.email, amount: { currency, value: pounds(x.pence) }, note: x.note.slice(0, 4000), sender_item_id: x.itemId })),
      });
      return { batch_id: r.batch_header?.payout_batch_id, status: r.batch_header?.batch_status || 'PENDING' };
    },
    async getPayout(batchId) {
      const r = await call('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=100`);
      return { status: r.batch_header?.batch_status, items: (r.items || []).map((x) => ({ item_id: x.payout_item?.sender_item_id, status: x.transaction_status })) };
    },
    async verifyWebhook(headers, event) {
      if (!env.PAYPAL_WEBHOOK_ID) return false;
      const r = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'), transmission_id: headers.get('paypal-transmission-id'),
        transmission_sig: headers.get('paypal-transmission-sig'), transmission_time: headers.get('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
      });
      return r.verification_status === 'SUCCESS';
    },
  };
}

/** Simulated PayPal: same shape, kept inside the practice document. Used for local tests and the review copy. */
export function mockPaypal(D) {
  D.mock_paypal = D.mock_paypal || {};
  const store = D.mock_paypal;
  return {
    mode: 'mock',
    async createAndSend({ invoice }) { const id = 'MOCK-INV2-' + crypto.randomUUID().slice(0, 8).toUpperCase(); store[id] = { status: 'SENT', total: invoice.total_pence, paid: 0 }; return { id, view_url: null }; },
    async remind() {},
    async recordPayment(id, { pence }) { const x = store[id]; if (!x) return; x.paid += pence; x.status = x.paid >= x.total ? 'MARKED_AS_PAID' : 'PARTIALLY_PAID'; },
    async get(id) { const x = store[id] || { status: 'SENT', paid: 0 }; return { status: x.status, paid_pence: x.paid }; },
    async verifyWebhook() { return true; },
    async createOrder({ invoiceId, pence }) { const id = 'MOCK-ORDER-' + crypto.randomUUID().slice(0, 8).toUpperCase(); store[id] = { order: true, invoiceId, pence }; return { id }; },
    async captureOrder(id) { const o = store[id]; if (!o || !o.order) throw new Error('Order not found'); if (o.captured) return { status: 'COMPLETED', custom_id: o.invoiceId, capture_id: o.captured, pence: o.pence }; o.captured = 'MOCK-CAP-' + id.slice(-8); return { status: 'COMPLETED', custom_id: o.invoiceId, capture_id: o.captured, pence: o.pence }; },
    async createPayout({ items }) { const id = 'MOCK-BATCH-' + crypto.randomUUID().slice(0, 8).toUpperCase(); store[id] = { payout: true, status: 'PENDING', items: items.map((x) => ({ item_id: x.itemId, status: 'PENDING' })) }; return { batch_id: id, status: 'PENDING' }; },
    async getPayout(id) { const b = store[id]; if (!b) throw new Error('Batch not found'); b.status = 'SUCCESS'; b.items.forEach((x) => { if (x.status === 'PENDING') x.status = 'SUCCESS'; }); return { status: b.status, items: b.items.map((x) => ({ ...x })) }; },
    failPayoutItem(id, itemId) { const x = store[id].items.find((y) => y.item_id === itemId); x.status = 'FAILED'; },
    async simulatePay(id) { const x = store[id]; if (x) { x.paid = x.total; x.status = 'PAID'; } },
  };
}

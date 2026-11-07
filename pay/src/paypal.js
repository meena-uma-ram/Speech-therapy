// SPDX-License-Identifier: AGPL-3.0-or-later
// PayPal Invoicing v2. Credentials stay in Worker secrets and never reach the browser.
// PAYPAL_MODE=mock simulates PayPal for local testing; the submitted demo uses the real sandbox.
const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };
const pounds = (p) => (p / 100).toFixed(2);
const METHOD = { bank: 'BANK_TRANSFER', cash: 'CASH', cheque: 'CHECK', other: 'OTHER' };

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
        detail: { currency_code: currency, reference: invoice.id, note: note.slice(0, 4000), payment_term: { due_date: dueDate } },
        invoicer: { business_name: practice.slice(0, 100) },
        primary_recipients: [recipient],
        items: invoice.items.map((it) => ({ name: it.name.slice(0, 200), quantity: '1', unit_amount: { currency_code: currency, value: pounds(it.pence) }, unit_of_measure: 'QUANTITY' })),
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
    async simulatePay(id) { const x = store[id]; if (x) { x.paid = x.total; x.status = 'PAID'; } },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// The family page: pay now with PayPal Checkout, or tell the practice they paid by bank transfer, cash or cheque.
(function () {
  'use strict';
  const box = document.getElementById('box');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const q = new URLSearchParams(location.hash.slice(1));
  const i = q.get('i'), t = q.get('t');
  const show = (html) => { box.innerHTML = html; };
  async function load() {
    if (!i || !t) return show('<h2>This link is incomplete</h2><p>Please open the link in your invoice email again.</p>');
    const res = await fetch('/api/public/invoice?i=' + encodeURIComponent(i) + '&t=' + encodeURIComponent(t));
    const d = await res.json();
    if (!res.ok) return show('<h2>This link is not valid</h2><p>Please open the link in your invoice email again.</p>');
    if (d.paid) return show(`<h2>All settled</h2><p>${esc(d.child)}’s invoice for ${esc(d.period)} is paid. Thank you.</p>`);
    if (d.reported) return show(`<h2>Thank you</h2><p>You’ve already told us about this payment. ${esc(d.practice)} will check and confirm.</p>`);
    const pay = d.checkout ? `<h2>Pay ${esc(d.practice)}</h2>
      <p>${esc(d.child)}’s invoice for <b>${esc(d.period)}</b>: <b>${esc(d.outstanding)}</b>.</p>
      <div class="pay-now">${d.checkout.mock ? `<button class="btn" id="mock-pay" type="button">Pay ${esc(d.outstanding)} with PayPal (test mode)</button>` : '<div id="paypal-buttons"></div>'}
        <p class="muted" id="pay-err" role="alert"></p><p class="or">Already paid another way?</p></div>` : '<h2>Paid another way?</h2>';
    show(`${pay}
      <p>Tell ${esc(d.practice)} and they’ll mark ${esc(d.child)}’s invoice for <b>${esc(d.period)}</b> (${esc(d.outstanding)}) as paid once they’ve checked.</p>
      <form id="f">
        <fieldset><legend>How did you pay?</legend>
          ${[['bank', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['other', 'Something else']].map(([v, l], k) => `<label class="choice"><input type="radio" name="m" value="${v}"${k ? '' : ' checked'}> ${l}</label>`).join('')}
        </fieldset>
        <div class="dlg" style="padding:0"><label>How much<input id="amount" inputmode="decimal" value="${esc(d.outstanding.replace('£', ''))}"></label>
        <label>Reference, if you used one<input id="ref" maxlength="80" autocomplete="off"></label></div>
        <button class="btn" type="submit">Let them know</button>
        <p class="muted" id="err" role="alert" style="margin-top:8px"></p>
      </form>
      <p class="muted" style="font-size:.82rem;margin-top:10px">Only these payment details are shared with the practice.</p>`);
    if (d.checkout) checkout(d);
    document.getElementById('f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = ev.submitter; btn.disabled = true;
      const r = await fetch('/api/public/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i, t, method: document.querySelector('input[name=m]:checked').value, amount: document.getElementById('amount').value, reference: document.getElementById('ref').value }) });
      const out = await r.json();
      if (!r.ok) { document.getElementById('err').textContent = out.error; btn.disabled = false; return; }
      show(`<h2>Thank you</h2><p>${esc(d.practice)} has been told. You don’t need to do anything else.</p>`);
    });
  }
  // PayPal Checkout: the order is created and captured by the server, for the amount it knows is owed.
  const post = async (path, extra) => {
    const r = await fetch('/api/public/checkout/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i, t, ...extra }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Something went wrong.');
    return out;
  };
  const thanks = (d, paid) => show(`<h2>Thank you</h2><p>${esc(paid)} paid to ${esc(d.practice)} for ${esc(d.child)}, ${esc(d.period)}. PayPal will email you a receipt.</p>`);
  const payErr = (m) => { const e = document.getElementById('pay-err'); if (e) e.textContent = m; };
  function checkout(d) {
    if (d.checkout.mock) {
      document.getElementById('mock-pay').onclick = async (ev) => {
        ev.currentTarget.disabled = true;
        try { const o = await post('create'); const r = await post('capture', { order_id: o.id }); thanks(d, r.paid); }
        catch (e) { payErr(e.message); ev.currentTarget.disabled = false; }
      };
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?' + new URLSearchParams({ 'client-id': d.checkout.client_id, currency: d.checkout.currency, intent: 'capture', components: 'buttons', 'enable-funding': 'paylater' });
    s.onerror = () => payErr('PayPal could not be loaded. You can still pay with the button in your invoice email.');
    s.onload = () => {
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay' },
        createOrder: async () => (await post('create')).id,
        onApprove: async (data) => { const r = await post('capture', { order_id: data.orderID }); thanks(d, r.paid); },
        onError: () => payErr('The payment didn’t go through. Nothing was taken. Please try again.'),
      }).render('#paypal-buttons');
    };
    document.head.appendChild(s);
  }

  load().catch(() => show('<h2>Something went wrong</h2><p>Please try again in a moment.</p>'));
})();

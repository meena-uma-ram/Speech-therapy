// SPDX-License-Identifier: AGPL-3.0-or-later
// Check-in & pay: the family checks in before the visit, chooses a sliding-scale price if they pay for
// themselves, and lets the hospital hold a deposit on their PayPal (authorised now, taken only on arrival or a no-show).
(function () {
  'use strict';
  const box = document.getElementById('box');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const q = new URLSearchParams(location.hash.slice(1));
  const a = q.get('a'), t = q.get('t');
  const show = (html) => { box.innerHTML = html; };
  const when = (iso) => new Date(iso + ':00').toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const post = async (step, extra) => {
    const r = await fetch('/api/public/checkin/' + step, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, t, ...extra }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Something went wrong.');
    return out;
  };
  const err = (m) => { const e = document.getElementById('err'); if (e) e.textContent = m; };
  const head = (d) => `<p class="muted">${esc(d.practice)}</p><h2>${esc(d.child)}: ${esc(d.service)}</h2>
    <p>${d.code ? `<span class="code">${esc(d.code)}</span> ${esc(d.dept)}<br>` : ''}${esc(when(d.at))}</p>`;
  const cancelBtn = (d) => d.can_cancel ? `<p class="ci-cancel"><button class="btn text" id="cancel" type="button">Can’t come? Cancel this appointment</button></p>` : '';
  function wireCancel(d) {
    const c = document.getElementById('cancel'); if (!c) return;
    c.onclick = async () => {
      if (!window.confirm('Cancel this appointment?' + (d.held ? ' The deposit hold will be released.' : ''))) return;
      try { await post('cancel'); show(`${head(d)}<h2>Cancelled</h2><p>Your appointment is cancelled${d.held ? ' and the deposit hold has been released. Nothing was taken' : ''}.</p>`); }
      catch (e) { err(e.message); }
    };
  }

  async function load() {
    if (!a || !t) return show('<h2>This link is incomplete</h2><p>Please open the link in your message again.</p>');
    const res = await fetch('/api/public/checkin?a=' + encodeURIComponent(a) + '&t=' + encodeURIComponent(t));
    const d = await res.json();
    if (!res.ok) return show('<h2>This link is not valid</h2><p>Please open the link in your message again.</p>');
    if (d.status === 'cancelled') return show(`${head(d)}<h2>Cancelled</h2><p>This appointment was cancelled.</p>`);
    if (['arrived', 'no_show'].includes(d.status)) return show(`${head(d)}<p>This appointment is closed. Thank you.</p>`);
    if (d.status === 'checked_in') {
      show(`${head(d)}<h2>You’re checked in</h2><p>${d.held ? `A ${esc(d.deposit)} deposit is held on your PayPal. It isn’t taken now: when you arrive it goes toward the bill.` : 'See you soon.'}</p>${d.self_pay ? `<p class="muted">Your price: ${esc(d.price)}.</p>` : ''}${cancelBtn(d)}<p class="muted" id="err" role="alert"></p>`);
      return wireCancel(d);
    }
    if (d.opens_in_days > 0) return show(`${head(d)}<p>Check-in opens ${d.opens_in_days} day${d.opens_in_days === 1 ? '' : 's'} before your appointment. Please open this link again then.</p>${cancelBtn(d)}<p class="muted" id="err" role="alert"></p>`), wireCancel(d);

    show(`${head(d)}
      ${d.bands ? `<fieldset><legend>What can you pay?</legend>
        <p class="muted ci-note">Choose what fits your household. We don’t ask for proof, and nobody at the desk will ask you about it.</p>
        ${d.bands.map((b, k) => `<label class="choice"><input type="radio" name="scale" value="${esc(b.id)}"${k ? '' : ' checked'}> <span>${esc(b.label)}</span> <b class="m ci-price">${esc(b.price)}</b></label>`).join('')}</fieldset>` : ''}
      ${d.deposit ? `<p class="ci-note">This is a high-demand appointment, so we hold a <b>${esc(d.deposit)} deposit</b> on your PayPal. <b>Nothing is taken now.</b> When you arrive, it goes toward the bill. If you cancel at least a day before, it’s released.</p>
        ${d.paypal && d.paypal.mock ? `<button class="btn" id="mock-hold" type="button">Check in and hold ${esc(d.deposit)} with PayPal (test mode)</button>` : '<div id="paypal-buttons"></div>'}`
        : '<button class="btn" id="checkin" type="button">Check in</button>'}
      <p class="muted" id="err" role="alert"></p>${cancelBtn(d)}`);
    wireCancel(d);
    const scale = () => { const r = document.querySelector('input[name=scale]:checked'); return r ? r.value : 'full'; };
    const done = () => load();
    if (!d.deposit) {
      document.getElementById('checkin').onclick = async (ev) => { ev.currentTarget.disabled = true; try { await post('start', { scale: scale() }); done(); } catch (e) { err(e.message); ev.currentTarget.disabled = false; } };
      return;
    }
    if (d.paypal && d.paypal.mock) {
      document.getElementById('mock-hold').onclick = async (ev) => { ev.currentTarget.disabled = true; try { const o = await post('start', { scale: scale() }); await post('hold', { order_id: o.order_id }); done(); } catch (e) { err(e.message); ev.currentTarget.disabled = false; } };
      return;
    }
    if (!d.paypal) return err('Paying online isn’t available. Please check in at the desk.');
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?' + new URLSearchParams({ 'client-id': d.paypal.client_id, currency: d.paypal.currency, intent: 'authorize', components: 'buttons' });
    s.onerror = () => err('PayPal could not be loaded. Please check in at the desk.');
    s.onload = () => {
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
        createOrder: async () => { const o = await post('start', { scale: scale() }); if (!o.order_id) throw new Error('Already checked in'); return o.order_id; },
        onApprove: async (data) => { await post('hold', { order_id: data.orderID }); done(); },
        onError: () => err('The deposit hold didn’t go through. Nothing was taken. Please try again.'),
      }).render('#paypal-buttons');
    };
    document.head.appendChild(s);
  }
  load().catch(() => show('<h2>Something went wrong</h2><p>Please try again in a moment.</p>'));
})();

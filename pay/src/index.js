// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
// TJS Pay Worker: session-to-paid billing for independent therapy practices, with PayPal and AI.
import { makePractice } from './practice.js';
import { paypal } from './paypal.js';
import { claude } from './ai.js';
import qrcode from 'qrcode-generator';

const PRACTICE_ID = 'demo';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (message, status = 400) => json({ error: message }, status);

// ---------- loading and saving the practice ----------
async function load(env) {
  const row = await env.DB.prepare('SELECT version, doc FROM practice WHERE id = ?').bind(PRACTICE_ID).first();
  return row ? { D: JSON.parse(row.doc), version: row.version } : { D: { patients: [] }, version: 0 };
}
async function save(env, D, version) {
  const doc = JSON.stringify(D), at = new Date().toISOString();
  if (version === 0) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO practice (id, version, doc, updated_at) VALUES (?, 1, ?, ?)').bind(PRACTICE_ID, doc, at).run();
    if (!r.meta.changes) throw new Error('Something else changed at the same moment. Please try again.');
    return;
  }
  const r = await env.DB.prepare('UPDATE practice SET doc = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(doc, at, PRACTICE_ID, version).run();
  if (!r.meta.changes) throw new Error('Something else changed at the same moment. Please refresh and try again.');
}

// ---------- family links: signed, so nothing secret is stored ----------
async function sign(env, invoiceId) {
  const secret = env.LINK_SECRET || (env.PAYPAL_MODE === 'mock' ? 'local-mock-secret' : null);
  if (!secret) throw new Error('LINK_SECRET is not set.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(invoiceId)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24);
}
async function checkLink(env, id, token) {
  if (!id || !token || token.length !== 24) return false;
  const want = await sign(env, id);
  let diff = 0;
  for (let k = 0; k < want.length; k++) diff |= want.charCodeAt(k) ^ token.charCodeAt(k);
  return diff === 0;
}

// A cap on AI requests per day (UTC), so a public demo link can't run up the Anthropic bill.
// When it is reached, every AI job falls back to standard wording and rules.
function aiGuard(env, D) {
  const limit = parseInt(env.AI_DAILY_LIMIT || '150', 10);
  return () => {
    const day = new Date().toISOString().slice(0, 10);
    if (!D.ai_usage || D.ai_usage.day !== day) D.ai_usage = { day, requests: 0 };
    if (D.ai_usage.requests >= limit) throw new Error('daily AI limit reached');
    D.ai_usage.requests += 1;
  };
}

function practiceFor(env, D) {
  const origin = env.PUBLIC_URL || D.origin || '';
  return makePractice({
    paypal: paypal(env, D),
    ai: claude(env, aiGuard(env, D)),
    aiLimit: parseInt(env.AI_DAILY_LIMIT || '150', 10),
    linkFor: async (id) => `${origin}/paid#i=${id}&t=${await sign(env, id)}`,
    checkinLinkFor: async (id) => `${origin}/checkin#a=${id}&t=${await sign(env, id)}`,
  });
}
const modeOf = (env) => env.PAYPAL_MODE || 'sandbox';

/** Load, change, save. Saves only if something actually changed. */
async function withPractice(env, fn, origin) {
  const { D, version } = await load(env);
  if (origin && D.origin !== origin) D.origin = origin;
  const before = version ? JSON.stringify(D) : '';
  const P = practiceFor(env, D);
  // First visit, or data saved before departments existed: load the demo hospital.
  if (!D.settings || !D.departments || !D.requests || !D.appointments || !D.partners) await P.seed(D);
  const out = await fn(P, D);
  if (JSON.stringify(D) !== before) await save(env, D, version);
  return out;
}

async function body(req) { try { return await req.json(); } catch { return {}; } }

async function handleApi(req, env, url) {
  const path = url.pathname, method = req.method;

  // PayPal tells us something happened to an invoice. We verify it, then ask PayPal directly.
  if (path === '/api/paypal/webhook' && method === 'POST') {
    let event;
    try { event = JSON.parse(await req.text()); } catch { return fail('Not JSON'); }
    if (modeOf(env) !== 'mock' && !(await paypal(env, {}).verifyWebhook(req.headers, event))) return fail('Signature check failed', 401);
    const ppId = event.resource?.invoice?.id || event.resource?.id;
    if (ppId && String(event.event_type || '').startsWith('INVOICING.INVOICE.')) await withPractice(env, (P, D) => P.syncAll(D, ppId));
    if (String(event.event_type || '').startsWith('PAYMENT.PAYOUTS')) await withPractice(env, (P, D) => P.refreshPayouts(D));
    return json({ ok: true });
  }

  // The family's page. No sign-in: the signed link is the key, and it shows only the period and amount.
  if (path === '/api/public/invoice' && method === 'GET') {
    const id = url.searchParams.get('i');
    if (!(await checkLink(env, id, url.searchParams.get('t')))) return fail('This link is not valid.', 404);
    const { D } = await load(env);
    const f = D.settings && practiceFor(env, D).family(D, id);
    if (!f) return fail('This link is not valid.', 404);
    // PayPal Checkout buttons: the client ID is public by design; the secret never leaves the Worker.
    if (!f.paid) f.checkout = modeOf(env) === 'mock' ? { mock: true } : env.PAYPAL_CLIENT_ID ? { client_id: env.PAYPAL_CLIENT_ID, currency: env.CURRENCY || 'GBP' } : null;
    return json(f);
  }
  // Check-in & pay: the family's signed check-in link. Only the visit, price choices and deposit are shown.
  if (path === '/api/public/checkin' && method === 'GET') {
    const id = url.searchParams.get('a');
    if (!(await checkLink(env, id, url.searchParams.get('t')))) return fail('This link is not valid.', 404);
    const { D } = await load(env);
    const v = D.settings && practiceFor(env, D).checkinView(D, id);
    if (!v) return fail('This link is not valid.', 404);
    v.paypal = modeOf(env) === 'mock' ? { mock: true } : env.PAYPAL_CLIENT_ID ? { client_id: env.PAYPAL_CLIENT_ID, currency: env.CURRENCY || 'GBP' } : null;
    return json(v);
  }
  if (path.startsWith('/api/public/checkin/') && method === 'POST') {
    const b = await body(req);
    if (!(await checkLink(env, b.a, b.t))) return fail('This link is not valid.', 404);
    const step = path.slice('/api/public/checkin/'.length);
    if (step === 'start') return json(await withPractice(env, (P, D) => P.checkinStart(D, b.a, { scale: b.scale })));
    if (step === 'hold' && typeof b.order_id === 'string') return json(await withPractice(env, (P, D) => P.checkinHold(D, b.a, b.order_id)));
    if (step === 'cancel') { await withPractice(env, (P, D) => P.cancelAppt(D, b.a, true)); return json({ ok: true }); }
    return fail('Not found', 404);
  }
  if (path === '/api/public/checkout/create' && method === 'POST') {
    const b = await body(req);
    if (!(await checkLink(env, b.i, b.t))) return fail('This link is not valid.', 404);
    return json(await withPractice(env, (P, D) => P.checkoutStart(D, b.i)));
  }
  if (path === '/api/public/checkout/capture' && method === 'POST') {
    const b = await body(req);
    if (!(await checkLink(env, b.i, b.t)) || typeof b.order_id !== 'string') return fail('This link is not valid.', 404);
    return json(await withPractice(env, (P, D) => P.checkoutFinish(D, b.i, b.order_id)));
  }
  if (path === '/api/public/claim' && method === 'POST') {
    const b = await body(req);
    if (!(await checkLink(env, b.i, b.t))) return fail('This link is not valid.', 404);
    await withPractice(env, (P, D) => P.familyClaim(D, b.i, b));
    return json({ ok: true });
  }

  // Everything else is the therapist's screen.
  if (!path.startsWith('/api/pay/')) return fail('Not found', 404);
  if (env.ADMIN_PASSCODE && req.headers.get('x-passcode') !== env.ADMIN_PASSCODE) return fail('Passcode needed', 401);
  const route = path.slice('/api/pay/'.length);
  if (method === 'GET' && route !== 'state') return fail('Not found', 404);
  const b = method === 'POST' ? await body(req) : {};
  const out = await withPractice(env, (P, D) => P.handle(D, route, b, modeOf(env)), url.origin);
  if (out && out.checkin_url) { const q = qrcode(0, 'M'); q.addData(out.checkin_url); q.make(); out.qr_svg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
  return json(out);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(req, env, url); }
      catch (e) { console.error(e); return fail(e.message || 'Something went wrong.', 500); }
    }
    const res = await env.ASSETS.fetch(req);
    // The family pages load PayPal's buttons, so it allows PayPal's domains. Every other page stays 'self' only.
    if (['/paid', '/paid.html', '/checkin', '/checkin.html'].includes(url.pathname)) {
      const out = new Response(res.body, res);
      out.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://*.paypal.com https://*.paypalobjects.com; connect-src 'self' https://*.paypal.com; frame-src https://*.paypal.com; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return out;
    }
    return res;
  },
  // Every hour: check PayPal for payments (so the webhook is optional). At 09:00 UTC: send reminders that are due.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(withPractice(env, async (P, D) => {
      await P.syncAll(D);
      await P.refreshPayouts(D);
      if (new Date(event.scheduledTime).getUTCHours() === 9) { await P.reminders(D); await P.sendDueInstalments(D); }
    }).catch((e) => console.error('scheduled run failed', e)));
  },
};

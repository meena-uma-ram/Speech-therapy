// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
// TJS Pay Worker: session-to-paid billing for independent therapy practices, with PayPal and AI.
import { makePractice } from './practice.js';
import { paypal } from './paypal.js';
import { claude } from './ai.js';

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

function practiceFor(env, D) {
  const origin = env.PUBLIC_URL || D.origin || '';
  return makePractice({
    paypal: paypal(env, D),
    ai: claude(env),
    linkFor: async (id) => `${origin}/paid#i=${id}&t=${await sign(env, id)}`,
  });
}
const modeOf = (env) => env.PAYPAL_MODE || 'sandbox';

/** Load, change, save. Saves only if something actually changed. */
async function withPractice(env, fn, origin) {
  const { D, version } = await load(env);
  if (origin && D.origin !== origin) D.origin = origin;
  const before = version ? JSON.stringify(D) : '';
  const P = practiceFor(env, D);
  if (!D.settings) await P.seed(D);
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
    return json({ ok: true });
  }

  // The family's page. No sign-in: the signed link is the key, and it shows only the period and amount.
  if (path === '/api/public/invoice' && method === 'GET') {
    const id = url.searchParams.get('i');
    if (!(await checkLink(env, id, url.searchParams.get('t')))) return fail('This link is not valid.', 404);
    const { D } = await load(env);
    const f = D.settings && practiceFor(env, D).family(D, id);
    return f ? json(f) : fail('This link is not valid.', 404);
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
  return json(await withPractice(env, (P, D) => P.handle(D, route, b, modeOf(env)), url.origin));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(req, env, url); }
      catch (e) { console.error(e); return fail(e.message || 'Something went wrong.', 500); }
    }
    return env.ASSETS.fetch(req);
  },
  // Every hour: check PayPal for payments (so the webhook is optional). At 09:00 UTC: send reminders that are due.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(withPractice(env, async (P, D) => {
      await P.syncAll(D);
      if (new Date(event.scheduledTime).getUTCHours() === 9) await P.reminders(D);
    }).catch((e) => console.error('scheduled run failed', e)));
  },
};

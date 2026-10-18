// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/*
 * Sends email through the clinic's own account (Google Workspace / Gmail, Microsoft 365 / Outlook, Zoho, any SMTP server).
 * No dependencies: SMTP over TLS (port 465) or STARTTLS (port 587), AUTH PLAIN or LOGIN, MIME with attachments.
 */
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const os = require('os');

const PRESETS = {
  google: { host: 'smtp.gmail.com', port: 465, security: 'tls', label: 'Google Workspace / Gmail', help: 'Turn on 2-Step Verification for the account, then create an App password (Google Account → Security → App passwords) and use it here.' },
  microsoft: { host: 'smtp.office365.com', port: 587, security: 'starttls', label: 'Microsoft 365 / Outlook', help: 'An administrator must allow "Authenticated SMTP" for this mailbox (Microsoft 365 admin centre → user → Mail → Manage email apps). With 2-step sign-in, use an app password.' },
  zoho: { host: 'smtp.zoho.in', port: 465, security: 'tls', label: 'Zoho Mail (India)', help: 'Use an application-specific password if 2-factor sign-in is on.' },
  other: { host: '', port: 587, security: 'starttls', label: 'Other SMTP server', help: 'Ask your email provider for the SMTP server, port and security.' }
};
// Consumer mailboxes come without a business data processing agreement.
const PERSONAL_DOMAINS = /@(gmail|googlemail|outlook|hotmail|live|yahoo|ymail|rediffmail|icloud|me)\.[a-z.]+$/i;
const EMAIL = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[a-z]{2,}$/i;

function clean(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
function word(v) { v = clean(v); return /^[\x20-\x7e]*$/.test(v) ? v : '=?UTF-8?B?' + Buffer.from(v, 'utf8').toString('base64') + '?='; }
function wrap(b64) { return b64.replace(/.{1,76}/g, '$&\r\n'); }
function address(name, addr) { return name ? word(name).replace(/[",]/g, '') + ' <' + addr + '>' : addr; }

/* The raw message, ready for DATA. */
function buildMessage(m) {
  const domain = (m.from.split('@')[1] || 'localhost').replace(/[^a-z0-9.-]/gi, '');
  const id = '<' + crypto.randomBytes(12).toString('hex') + '@' + domain + '>';
  const head = ['From: ' + address(m.fromName, m.from), 'To: ' + m.to.join(', '), 'Subject: ' + word(m.subject), 'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: ' + id, 'MIME-Version: 1.0'];
  if (m.replyTo) head.push('Reply-To: ' + m.replyTo);
  const text = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(String(m.text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))];
  let body;
  if (!m.attachments || !m.attachments.length) body = head.concat(text).join('\r\n');
  else {
    const b = 'tjs-' + crypto.randomBytes(10).toString('hex');
    const parts = ['--' + b].concat(text);
    m.attachments.forEach(function (a) {
      const fname = clean(a.filename).replace(/["\\]/g, '');
      parts.push('--' + b, 'Content-Type: ' + clean(a.contentType) + '; name="' + word(fname) + '"', 'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="' + word(fname) + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname), '', wrap(a.content.toString('base64')));
    });
    parts.push('--' + b + '--', '');
    body = head.concat(['Content-Type: multipart/mixed; boundary="' + b + '"', '']).concat(parts).join('\r\n');
  }
  return { id: id, raw: body };
}

/* Talk SMTP: one connection, one message. Resolves { messageId, response }. */
function send(cfg, m) {
  const to = [].concat(m.to).map(clean).filter(Boolean);
  if (!to.length || !to.every(function (x) { return EMAIL.test(x); })) return Promise.reject(new Error('That email address does not look right.'));
  if (!EMAIL.test(cfg.from || '')) return Promise.reject(new Error('Set the clinic\u2019s sending address first.'));
  const msg = buildMessage({ from: cfg.from, fromName: cfg.fromName, replyTo: cfg.replyTo && EMAIL.test(cfg.replyTo) ? cfg.replyTo : '', to: to, subject: m.subject, text: m.text, attachments: m.attachments });
  return new Promise(function (resolve, reject) {
    let sock, buf = '', waiter = null, finished = false;
    const timer = setTimeout(function () { fail(new Error('The mail server did not answer in time.')); }, cfg.timeoutMs || 30000);
    function fail(e) { if (finished) return; finished = true; clearTimeout(timer); try { sock.destroy(); } catch (x) { /* closed */ } reject(e); }
    function onData(d) {
      buf += d.toString('utf8');
      // A reply is complete when its last line has a space after the code: "250 OK".
      const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf);
      if (m && waiter) { const text = buf, w = waiter; buf = ''; waiter = null; w(Number(m[1]), text); }
    }
    function attach(s) {
      sock = s;
      s.on('data', onData);
      s.on('error', function (e) { fail(new Error('Could not reach the mail server: ' + e.message)); });
      s.on('close', function () { if (!finished) fail(new Error('The mail server closed the connection.')); });
    }
    function reply() { return new Promise(function (res) { waiter = function (code, text) { res({ code: code, text: text }); }; if (buf) onData(''); }); }
    function cmd(line, ok, what) {
      if (line != null) sock.write(line + '\r\n');
      return reply().then(function (r) {
        if (ok.indexOf(r.code) < 0) throw new Error((what || 'The mail server refused') + ': ' + r.text.trim().split('\r\n').pop());
        return r;
      });
    }
    const host = os.hostname().replace(/[^a-z0-9.-]/gi, '') || 'tjs.local';
    const opts = { host: cfg.host, port: Number(cfg.port), servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== false };
    attach(cfg.security === 'tls' ? tls.connect(opts) : net.connect(opts));
    let caps = '';
    cmd(null, [220], 'Greeting')
      .then(function () { return cmd('EHLO ' + host, [250], 'EHLO'); })
      .then(function (r) {
        caps = r.text;
        if (cfg.security !== 'starttls') return;
        if (!/STARTTLS/i.test(caps)) throw new Error('The mail server does not offer STARTTLS; use port 465 with TLS.');
        return cmd('STARTTLS', [220], 'STARTTLS').then(function () {
          return new Promise(function (res, rej) {
            const plain = sock;
            plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
            const t = tls.connect(Object.assign({}, opts, { socket: plain }), function () { res(); });
            t.on('error', rej);
            attach(t);
          });
        }).then(function () { return cmd('EHLO ' + host, [250], 'EHLO'); }).then(function (r2) { caps = r2.text; });
      })
      .then(function () {
        if (!cfg.user) return;
        if (cfg.security === 'none' && !/^(localhost|127\.0\.0\.1|::1)$/.test(cfg.host)) throw new Error('Refusing to send a password without encryption.');
        if (/AUTH[^\r\n]*PLAIN/i.test(caps)) return cmd('AUTH PLAIN ' + Buffer.from('\0' + cfg.user + '\0' + cfg.password).toString('base64'), [235], 'Sign-in');
        return cmd('AUTH LOGIN', [334], 'Sign-in').then(function () { return cmd(Buffer.from(cfg.user).toString('base64'), [334], 'Sign-in'); })
          .then(function () { return cmd(Buffer.from(cfg.password || '').toString('base64'), [235], 'Sign-in'); });
      })
      .then(function () { return cmd('MAIL FROM:<' + cfg.from + '>', [250], 'Sender'); })
      .then(function () { return to.reduce(function (p, addr) { return p.then(function () { return cmd('RCPT TO:<' + addr + '>', [250, 251], 'Recipient ' + addr); }); }, Promise.resolve()); })
      .then(function () { return cmd('DATA', [354], 'DATA'); })
      // Lines starting with a dot get a second dot (RFC 5321 4.5.2).
      .then(function () { return cmd(msg.raw.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250], 'Sending'); })
      .then(function (r) {
        finished = true; clearTimeout(timer);
        sock.end('QUIT\r\n');
        resolve({ messageId: msg.id, response: r.text.trim() });
      })
      .catch(fail);
  });
}

module.exports = { send: send, buildMessage: buildMessage, PRESETS: PRESETS, PERSONAL_DOMAINS: PERSONAL_DOMAINS, EMAIL: EMAIL };

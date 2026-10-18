// The SMTP client against a small fake mail server: plain (localhost only), STARTTLS and TLS, with sign-in and attachments.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const Mailer = require('../server/mailer.js');

const cert = { key: fs.readFileSync(path.join(__dirname, 'fixtures/smtp-test.key')), cert: fs.readFileSync(path.join(__dirname, 'fixtures/smtp-test.crt')) };

// mode: 'plain' | 'starttls' | 'tls'. Records what it received.
function fakeSmtp(mode, auth) {
  const got = { commands: [], data: '', auth: null };
  const handle = (sock, upgraded) => {
    let buf = '', inData = false;
    const say = (s) => sock.write(s + '\r\n');
    if (!upgraded) say('220 fake.smtp ESMTP');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; say('250 2.0.0 queued as 42'); } else got.data += line + '\r\n';
          continue;
        }
        got.commands.push(line.replace(/^(AUTH PLAIN ).*/, '$1***'));
        if (/^EHLO/.test(line)) { sock.write('250-fake.smtp\r\n' + (mode === 'starttls' && !upgraded ? '250-STARTTLS\r\n' : '') + '250 AUTH PLAIN LOGIN\r\n'); }
        else if (line === 'STARTTLS') {
          say('220 go ahead');
          sock.removeAllListeners('data');
          const t = new tls.TLSSocket(sock, Object.assign({ isServer: true }, cert));
          handle(t, true);
          return;
        } else if (/^AUTH PLAIN /.test(line)) { got.auth = Buffer.from(line.slice(11), 'base64').toString().split('\0'); say(got.auth[2] === auth ? '235 ok' : '535 bad'); }
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) say('250 ok');
        else if (line === 'DATA') { inData = true; say('354 go'); }
        else if (line === 'QUIT') { say('221 bye'); sock.end(); }
        else say('502 ?');
      }
    });
  };
  const server = mode === 'tls' ? tls.createServer(cert, (s) => handle(s, false)) : net.createServer((s) => handle(s, false));
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, got })));
}

const base = { host: '127.0.0.1', user: 'reports@clinic.in', password: 'app-pass', from: 'reports@clinic.in', fromName: 'Bright Steps Clinic', rejectUnauthorized: false };

test('sends over STARTTLS with sign-in, a UTF-8 subject, an attachment and dot-stuffing', async () => {
  const f = await fakeSmtp('starttls', 'app-pass');
  try {
    const r = await Mailer.send(Object.assign({}, base, { port: f.port, security: 'starttls' }), {
      to: ['family@example.com'], subject: 'Your summary – நன்றி', text: 'Dear Lakshmi,\n.\nline after a dot',
      attachments: [{ filename: 'report.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 hello') }]
    });
    assert.match(r.response, /queued/);
    assert.ok(f.got.commands.includes('STARTTLS'));
    assert.deepStrictEqual(f.got.auth, ['', 'reports@clinic.in', 'app-pass']);
    assert.ok(f.got.commands.includes('RCPT TO:<family@example.com>'));
    assert.match(f.got.data, /^Subject: =\?UTF-8\?B\?/m);
    assert.match(f.got.data, /Content-Disposition: attachment; filename="report.pdf"/);
    const text = Buffer.from(/charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(f.got.data)[1].replace(/\r\n/g, ''), 'base64').toString();
    assert.strictEqual(text, 'Dear Lakshmi,\r\n.\r\nline after a dot');
    assert.ok(f.got.data.includes(Buffer.from('%PDF-1.4 hello').toString('base64')));
  } finally { f.server.close(); }
});

test('sends over implicit TLS (port 465 style)', async () => {
  const f = await fakeSmtp('tls', 'app-pass');
  try {
    await Mailer.send(Object.assign({}, base, { port: f.port, security: 'tls' }), { to: ['a@example.com'], subject: 'Hi', text: 'x' });
    assert.ok(f.got.commands.some((c) => /^MAIL FROM:<reports@clinic.in>/.test(c)));
  } finally { f.server.close(); }
});

test('wrong password, bad addresses, header injection and unencrypted passwords are refused', async () => {
  const f = await fakeSmtp('starttls', 'right');
  try {
    await assert.rejects(Mailer.send(Object.assign({}, base, { port: f.port, security: 'starttls' }), { to: ['a@example.com'], subject: 's', text: 't' }), /Sign-in/);
  } finally { f.server.close(); }
  await assert.rejects(Mailer.send(Object.assign({}, base, { port: 1, security: 'tls' }), { to: ['not-an-address'], subject: 's', text: 't' }), /does not look right/);
  await assert.rejects(Mailer.send(Object.assign({}, base, { port: 1, security: 'tls' }), { to: ['a@example.com\r\nBcc: x@evil.com'], subject: 's', text: 't' }), /does not look right/);
  const m = Mailer.buildMessage({ from: 'a@b.in', to: ['c@d.in'], subject: 'Hello\r\nBcc: x@evil.com', text: 't' });
  assert.ok(!/\r\nBcc:/.test(m.raw));
  await assert.rejects(Mailer.send(Object.assign({}, base, { host: 'smtp.example.com', port: 1, security: 'none' }), { to: ['a@example.com'], subject: 's', text: 't' }), /reach|encryption/);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
// `npm start`: serves the app from this folder on http://localhost:8080 and opens it in the browser.
// No downloads, no dependencies: only Node.js. Usage: node scripts/serve.js [port] [--no-open]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
let port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let file;
  try { file = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (file === '/') file = '/index.html';
  const full = path.join(root, path.normalize(file));
  // Only files inside the app folder, never the data folders or hidden files.
  if (!full.startsWith(root + path.sep) || /[\\/](\.|clinic-data|node_modules)/.test(file)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found: ' + file); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer' });
    res.end(buf);
  });
});

function open(url) {
  if (args.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  exec(cmd, () => { /* no browser to open: the URL is printed */ });
}

// If the port is taken (another copy is running), try the next one.
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < 8100) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error('Could not start: ' + e.message); process.exit(1); }
});
server.on('listening', () => {
  const url = 'http://localhost:' + port + '/';
  console.log('TJS is running at ' + url + '\nOpen that address in Chrome, Edge, Firefox or Safari. Press Ctrl+C to stop.');
  open(url);
});
server.listen(port, '127.0.0.1');

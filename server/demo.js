// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the demo clinic (the same data the browser loads on first use) by running the app's own store in a sandbox.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function demoState() {
  const root = path.join(__dirname, '..');
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }, key: () => null, length: 0 };
  const win = { localStorage: storage, sessionStorage: storage, document: { querySelector: () => null }, crypto: require('crypto').webcrypto };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { TextEncoder, TextDecoder, btoa, atob, console }));
  ['js/logic.js', 'js/sync.js', 'js/store.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  const s = JSON.parse(JSON.stringify(ctx.Store.state));
  s.settings.currentUserId = '';
  return s;
};

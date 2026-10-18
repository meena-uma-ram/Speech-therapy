// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/*
 * Offline support for the installed app. Caches only the app's own files (code, styles, icons).
 * Patient data never passes through the cache: it stays in the browser's own storage, or on the clinic server (api/ requests are never cached).
 *
 * Share target: when someone shares a file to TJS from another app (WhatsApp, Gmail, Files, Gallery), the phone posts it to ./share.
 * The worker keeps it for a moment in the 'tjs-incoming' inbox and opens TJS, which encrypts it and lists it under "Files to file".
 */
const CACHE = 'tjs-v6';
const FILES = ['./', './css/styles.css', './js/logic.js', './js/sync.js', './js/regions.js', './js/consent.js', './js/store.js', './js/app.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function keepShared(form) {
  return new Promise(function (resolve, reject) {
    const open = indexedDB.open('tjs-incoming', 1);
    open.onupgradeneeded = function () { open.result.createObjectStore('items', { keyPath: 'id' }); };
    open.onerror = function () { reject(open.error); };
    open.onsuccess = function () {
      const tx = open.result.transaction('items', 'readwrite'), st = tx.objectStore('items');
      const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join(' ').slice(0, 500);
      form.getAll('files').forEach(function (f, i) {
        if (f && f.size) st.put({ id: Date.now() + '-' + i, name: f.name || 'shared-file', type: f.type, blob: f, text: text, at: new Date().toISOString() });
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    };
  });
}

// Network first so updates arrive straight away; fall back to the cached copy when offline.
self.addEventListener('fetch', function (ev) {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && /\/share$/.test(url.pathname)) {
    ev.respondWith(req.formData().then(keepShared).then(function () {
      return Response.redirect(new URL('./#/files-to-file?shared=1', self.registration.scope).href, 303);
    }, function () { return Response.redirect(new URL('./#/files-to-file?shared=failed', self.registration.scope).href, 303); }));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') >= 0) return;
  ev.respondWith(fetch(req).then(function (res) {
    const copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('./'); });
  }));
});

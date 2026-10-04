// Tut-P service worker: offline fallback page only (Android app / installable web app).
//
// What it does: keeps one static page (/offline.html) and one icon, and shows
// that page when a top-level page load fails because there is no network.
// What it never does: cache or answer /api, sign-in, cookies, uploads, pages
// of the app, scripts or styles. Everything else goes straight to the network
// exactly as without a service worker, so a family's data is never stored by
// this file. The cache name carries a version; a change of the version
// removes every older cache of ours.
const CACHE = 'tutp-shell-v1';
const OFFLINE_URL = '/offline.html';
const SHELL = [OFFLINE_URL, '/images/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only a top-level page load (a tap or typed address) is ever handled here.
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).catch(() =>
      caches.open(CACHE).then((cache) => cache.match(OFFLINE_URL)).then((hit) => hit || Response.error())
    )
  );
});

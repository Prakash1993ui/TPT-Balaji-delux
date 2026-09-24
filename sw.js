/*
 * Service worker: makes the app load instantly and work offline.
 * Bump VERSION whenever app files change so devices pick up the update.
 * A new version activates as soon as it has downloaded; the app then reloads
 * itself at a safe moment (never while a form is open).
 */
const VERSION = 'tbd-v1.0.1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/preact.min.js',
  'vendor/preact-hooks.min.js',
  'vendor/htm.min.js',
  'js/ui/icons.js',
  'js/core/utils.js',
  'js/core/persist.js',
  'js/core/store.js',
  'js/core/logic.js',
  'js/core/sync.js',
  'js/core/demo.js',
  'js/ui/kit.js',
  'js/views/booking-form.js',
  'js/views/bookings.js',
  'js/views/invoice.js',
  'js/views/dashboard.js',
  'js/views/rooms.js',
  'js/views/calendar.js',
  'js/views/guests.js',
  'js/views/expenses.js',
  'js/views/reports.js',
  'js/views/settings.js',
  'js/views/welcome.js',
  'js/app.js',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tbd-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // live data always goes to the server

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((cached) => cached || fetch(req)).catch(() => fetch(req))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

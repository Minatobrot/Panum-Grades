// Service Worker der Handy-Seite. Hält nur die Seite selbst vor (HTML, CSS, JS, Icons).
// Kalenderdaten liegen in IndexedDB, API-Anfragen und .ics gehen nie durch diesen Cache.

const CACHE = 'klassenkalender-v3';
const SHELL = [
  './', 'config.js', 'pwa.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'shared/calendar.css', 'shared/calendar.js', 'shared/db.js', 'shared/scope.js', 'shared/ics.js', 'shared/sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Online immer die neue Fassung holen und merken, offline die gemerkte nehmen
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ics/') || url.pathname === '/healthz') return;

  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});

// Service worker: precache the whole app, serve cache-first, work fully offline.
// Bump VERSION whenever any file changes so clients pick up the update.
const VERSION = 'dryfire-v1.0.1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/content.js', './js/progress.js', './js/scoring.js', './js/audio.js',
  './js/runner.js', './js/mancard.js', './js/stats.js', './js/diagram.js', './js/ui.js', './js/session.js',
  './data/drills.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // drills.json: serve cached copy instantly, refresh it in the background so
  // edits to the content file show up on the next launch.
  if (req.url.endsWith('/data/drills.json')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const cached = await c.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => cached);
      return cached || fresh;
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : undefined)));
});

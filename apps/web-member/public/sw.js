/*
 * Minimal service worker for the Obikai member PWA — makes the app installable and gives an offline
 * fallback for the app shell. Deliberately NETWORK-FIRST for navigations (so a new deploy is picked
 * up immediately and we never serve a stale shell), falling back to the cached shell only when
 * offline. API requests (/api/*) are never cached — they are authenticated and dynamic. A richer
 * precaching strategy (workbox / vite-plugin-pwa) can replace this later.
 */
const CACHE = 'obikai-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Never cache API calls or non-GET requests.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets (hashed): cache-first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }),
    ),
  );
});

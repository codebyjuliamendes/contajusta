'use strict';

// App shell offline. Assets sem hash: network-first, cache só como fallback. A API nunca é cacheada.
const CACHE = 'contajusta-shell-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/theme.js', '/mark-cj.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && request.mode !== 'navigate') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      // Offline: navegações (inclusive /g/<chave>) caem no shell; o app lê a chave da URL.
      .catch(() => caches.match(request.mode === 'navigate' ? '/' : request).then(hit => hit || Response.error())),
  );
});

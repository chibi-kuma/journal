/* Service worker : permet à l'application de fonctionner sans internet. */
'use strict';

const CACHE = 'journal-v3';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'zip.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});

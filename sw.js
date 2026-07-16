/**
 * sw.js — Service Worker JLBedoya Almacén
 * Estrategia: NETWORK-FIRST para assets propios (siempre trae lo último)
 * Rutas relativas para repo en subdirectorio /Almacen/
 */
var CACHE_NAME = 'jlb-almacen-v4';
var ASSETS_CACHE = [
  './',
  './index.html',
  './shim.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_CACHE);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // GAS API → siempre red, nunca cache
  if (url.includes('script.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Google Fonts → red
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Assets propios (HTML/JS) → NETWORK-FIRST, cache solo como respaldo offline
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.status === 200 && response.type !== 'opaque') {
        var toCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, toCache);
        });
      }
      return response;
    }).catch(function() {
      // Sin internet → usar lo que haya en caché
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

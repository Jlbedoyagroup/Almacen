/**
 * sw.js — Service Worker JLBedoya Almacén
 * Cache-first para assets, network-only para GAS API
 */

var CACHE_NAME = 'jlb-almacen-v1';

var ASSETS_CACHE = [
  '/',
  '/index.html',
  '/shim.js',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// ── Instalación: pre-cachear assets ──────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_CACHE);
    }).then(function() {
      return self.skipWaiting(); // activar inmediatamente sin esperar recarga
    })
  );
});

// ── Activación: limpiar caches viejos ────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // tomar control de todas las pestañas
    })
  );
});

// ── Fetch: estrategia por tipo de recurso ─────────────────────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // GAS API calls → siempre red (nunca cache)
  if (url.includes('script.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Google Fonts → siempre red (CDN ya tiene su propio cache)
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Assets locales → cache primero, luego red como respaldo
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;

      return fetch(e.request).then(function(response) {
        // Solo cachear respuestas válidas
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        var toCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, toCache);
        });
        return response;
      }).catch(function() {
        // Sin red y sin cache → página offline básica
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

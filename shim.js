/**
 * shim.js — JLBedoya Group · Almacén Maestro
 * ─────────────────────────────────────────────────────────────────────
 * 1. Define GAS_URL (única línea que debes editar)
 * 2. Shim de google.script.run → fetch() sin cambiar app.js
 * 3. Notificaciones nativas del sistema operativo
 * 4. Registro del Service Worker (PWA)
 * ─────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════
// 1. CONFIGURACIÓN — EDITA SOLO ESTA LÍNEA
// ═══════════════════════════════════════════════════════════════════════
var GAS_URL = 'https://script.google.com/macros/s/AKfycbwukgOIHmHgTsQx96QineroFHlNeFA6GWjR8tb8INFK1wCwMwLy2kgHrKOJpFKEXpLD/exec';
//                                                   ↑ pega tu ID aquí


// ═══════════════════════════════════════════════════════════════════════
// 2. SHIM — google.script.run → fetch()
// Intercepta TODAS las llamadas a google.script.run.*
// sin tocar una sola línea de app.js
// ═══════════════════════════════════════════════════════════════════════
(function() {
  var _s = null; // success handler pendiente
  var _f = null; // failure handler pendiente

  var proxy = new Proxy(
    {
      withSuccessHandler: function(fn) { _s = fn; return proxy; },
      withFailureHandler: function(fn) { _f = fn; return proxy; }
    },
    {
      get: function(target, prop) {
        // Si es withSuccessHandler / withFailureHandler, usar como está
        if (prop in target) return target[prop];

        // Cualquier otro nombre → función GAS a llamar
        return function() {
          var args    = Array.from(arguments);
          var success = _s;
          var failure = _f;
          _s = null; // reset para la siguiente cadena
          _f = null;

          fetch(GAS_URL, {
            method: 'POST',
            // Sin Content-Type → text/plain → sin preflight CORS
            // GAS con "Cualquiera, incluso anónimo" lo acepta correctamente
            body: JSON.stringify({ action: prop, params: args })
          })
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function(data) {
            if (success) success(data);
          })
          .catch(function(err) {
            if (failure) failure(err);
            else console.error('[GAS] Error en "' + prop + '":', err);
          });
        };
      }
    }
  );

  // Exponer como global (app.js lo usa así)
  window.google = { script: { run: proxy } };
})();


// ═══════════════════════════════════════════════════════════════════════
// 3. NOTIFICACIONES NATIVAS DEL SO
// Se solicita permiso después del login.
// app.js llama a notificar() en los eventos clave.
// ═══════════════════════════════════════════════════════════════════════
window._notifPermiso = false;

window.solicitarPermisoNotificaciones = function() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    window._notifPermiso = true;
    return;
  }
  if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(function(perm) {
      window._notifPermiso = (perm === 'granted');
      if (window._notifPermiso) {
        // Notificación de bienvenida para confirmar que funciona
        new Notification('JLB Almacén', {
          body : 'Notificaciones activadas correctamente',
          icon : 'icon-192.png',
          badge: 'icon-192.png',
          tag  : 'bienvenida'
        });
      }
    });
  }
};

window.notificar = function(titulo, cuerpo, urgente) {
  if (!window._notifPermiso || !('Notification' in window)) return;
  try {
    new Notification(titulo, {
      body   : cuerpo || '',
      icon   : '/icon-192.png',
      badge  : '/icon-192.png',
      tag    : urgente ? 'jlb-urgente' : 'jlb-almacen',
      vibrate: urgente ? [200, 100, 200] : [100]
    });
  } catch(e) {
    console.warn('[Notif] No se pudo mostrar:', e);
  }
};


// ═══════════════════════════════════════════════════════════════════════
// 4. SERVICE WORKER — PWA (cache offline + instalable)
// ═══════════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js')
      .then(function() { console.log('[SW] Registrado correctamente'); })
      .catch(function(e) { console.warn('[SW] No se pudo registrar:', e); });
  });
}

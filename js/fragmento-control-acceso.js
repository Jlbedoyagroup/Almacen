/**
 * Barrera de acceso frontend — JL BEDOYA GROUP
 * Debe ser el PRIMER script en <head>, antes de cualquier CSS/JS de la app,
 * para bloquear el render antes de que el DOM sea visible.
 *
 * Config por archivo: cambia APP_ID según en qué app se inyecte este fragmento.
 */
(function () {
  'use strict';

  var CONFIG = {
    IDP_BASE_URL: 'https://script.google.com/macros/s/AKfycby4K-qxW87hfd9Fy1wKHeyF8bic_Qo8clKfJ-ZuPg9zElNuc7XOe8qTgW8sUmJ9mnKjDA/exec',
    APP_ID: 'ALMACEN', // PRODUCCION | PRUEBAS | ALMACEN
    LOGIN_URL: 'https://jlbedoyagroup.github.io/acceso/login.html',
    SUSPENDED_URL: 'https://jlbedoyagroup.github.io/acceso/suspendido.html',
    TOKEN_KEY: 'jlb_session_token',
    VALIDATE_TIMEOUT_MS: 8000
  };

  // Oculta el documento hasta confirmar que hay sesión válida.
  document.documentElement.style.visibility = 'hidden';

  function redirectTo(baseUrl) {
    var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
    location.replace(baseUrl + sep + 'redirect=' + encodeURIComponent(location.href.split('#')[0]));
  }

  function reveal() {
    document.documentElement.style.visibility = 'visible';
  }

  function mostrarAvisoPago() {
    if (document.getElementById('jlb-aviso-pago')) return;

    var overlay = document.createElement('div');
    overlay.id = 'jlb-aviso-pago';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui,Arial,sans-serif;';
    overlay.innerHTML =
      '<div style="background:#1e293b;color:#e2e8f0;max-width:380px;width:90%;border-radius:12px;padding:1.75rem;box-shadow:0 20px 50px rgba(0,0,0,.4);text-align:center;">' +
        '<div style="font-size:2.2rem;margin-bottom:.5rem;">⚠️</div>' +
        '<h2 style="font-size:1.05rem;margin:0 0 .75rem;color:#fbbf24;">Pago pendiente</h2>' +
        '<p style="font-size:.88rem;line-height:1.5;color:#cbd5e1;margin:0 0 1.25rem;">No hemos recibido el abono correspondiente al servicio de esta aplicación. Por favor, ponte al día con tu obligación de pago para continuar disfrutando del servicio sin interrupciones.</p>' +
        '<button id="jlb-aviso-cerrar" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:.65rem 1.5rem;font-weight:600;cursor:pointer;font-size:.85rem;">Entendido</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.getElementById('jlb-aviso-cerrar').addEventListener('click', function () {
      overlay.remove();
    });
  }

  function deny(reason) {
    try { sessionStorage.removeItem(CONFIG.TOKEN_KEY); } catch (e) {}
    redirectTo(reason === 'suspended' ? CONFIG.SUSPENDED_URL : CONFIG.LOGIN_URL);
  }

  function getToken() {
    try {
      return sessionStorage.getItem(CONFIG.TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function validate(token) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, CONFIG.VALIDATE_TIMEOUT_MS);

    var url = CONFIG.IDP_BASE_URL +
      '?action=validateToken' +
      '&token=' + encodeURIComponent(token) +
      '&app=' + encodeURIComponent(CONFIG.APP_ID);

    fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
      .then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('http-' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.active === false) {
          deny('suspended');
          return;
        }
        if (!data.valid) {
          deny('invalid');
          return;
        }
        if (!data.allowedApps || data.allowedApps.indexOf(CONFIG.APP_ID) === -1) {
          deny('forbidden');
          return;
        }
        reveal();
        if (data.avisoPago) {
          var intervaloMin = parseFloat(data.avisoPagoIntervaloMin) || 15;
          setTimeout(mostrarAvisoPago, 1500);
          setInterval(mostrarAvisoPago, intervaloMin * 60 * 1000);
        }
      })
      .catch(function () {
        deny('network-error');
      });
  }

  var token = getToken();
  if (!token) {
    deny('no-token');
    return;
  }

  validate(token);
})();

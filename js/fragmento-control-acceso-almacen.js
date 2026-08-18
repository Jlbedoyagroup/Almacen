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

// Cierre de sesión por inactividad. Va antes que cualquier otro script de la página:
// si la cuenta lleva más de 30 minutos sin uso, se borra la sesión guardada en este
// navegador antes de que la página la lea, así nunca se muestran expedientes sin clave.
// Los accesos inmediatos (anónimos) no se cierran: no tienen contraseña para volver a entrar.
(function () {
  'use strict';
  var IDLE_MS = 30 * 60 * 1000;
  var TOKEN = 'sb-wctwkhixmmluckingjhf-auth-token';
  var LAST = 'valoraia_last_activity';
  var NOTICE = 'valoraia_idle_logout';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(TOKEN) || 'null'); } catch (e) { return null; }
  }
  function isAccount(s) {
    var u = s && (s.user || (s.currentSession && s.currentSession.user));
    return !!(u && !u.is_anonymous);
  }
  function last() { return Number(localStorage.getItem(LAST) || 0); }
  function expire() {
    try {
      localStorage.removeItem(TOKEN);
      localStorage.removeItem(TOKEN + '-user');
      sessionStorage.setItem(NOTICE, '1');
    } catch (e) { /* almacenamiento bloqueado */ }
  }

  try {
    var s = readSession();
    if (isAccount(s) && (!last() || Date.now() - last() > IDLE_MS)) expire();
    localStorage.setItem(LAST, String(Date.now()));
  } catch (e) { /* almacenamiento bloqueado: nada que proteger */ }

  // Actividad: clics, teclas y desplazamiento (como mucho una escritura cada 20 s).
  var lastWrite = 0;
  function touch() {
    var now = Date.now();
    if (now - lastWrite < 20000) return;
    lastWrite = now;
    try { localStorage.setItem(LAST, String(now)); } catch (e) {}
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  });

  // Con la página abierta: si pasa el tiempo sin uso (en ninguna pestaña), se cierra y recarga.
  function check() {
    if (isAccount(readSession()) && Date.now() - last() > IDLE_MS) { expire(); location.reload(); }
  }
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });

  // Aviso en la pantalla de acceso después de un cierre automático.
  window.addEventListener('DOMContentLoaded', function () {
    try { if (sessionStorage.getItem(NOTICE) !== '1') return; sessionStorage.removeItem(NOTICE); } catch (e) { return; }
    var bar = document.createElement('div');
    bar.className = 'status';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'max-width:980px;margin:12px auto;';
    bar.textContent = 'Por seguridad cerramos tu sesión tras 30 minutos sin actividad. Ingresa de nuevo para ver tus expedientes.';
    var main = document.getElementById('app') || document.querySelector('main') || document.body.firstElementChild;
    if (main && main.parentNode) main.parentNode.insertBefore(bar, main); else document.body.prepend(bar);
  });
})();

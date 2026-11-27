// Medición de visitas (Ávila Control Comercial). Sin cookies ni datos personales.
// Solo avisa cuando hay señales de una persona real: scroll, toque, mouse, teclado
// o 20 segundos con la página visible. Los robots y escáneres que solo cargan la página no cuentan.
(function () {
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.)/.test(location.hostname) || navigator.webdriver) return;
  var sent = false, visibleMs = 0, last = Date.now(), timer;
  var events = ['scroll', 'pointermove', 'pointerdown', 'touchstart', 'keydown', 'wheel'];
  function send() {
    if (sent) return;
    sent = true;
    events.forEach(function (e) { removeEventListener(e, send, true); });
    clearInterval(timer);
    try {
      var utm = new URLSearchParams(location.search).get('utm_source') || '';
      fetch('https://avila-control-comercial.danfelavicas.workers.dev/api/public/visit', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ p: location.pathname, r: document.referrer, u: utm, h: 1 })
      }).catch(function () {});
    } catch (e) {}
  }
  events.forEach(function (e) { addEventListener(e, send, { capture: true, passive: true }); });
  timer = setInterval(function () {
    var t = Date.now();
    if (document.visibilityState === 'visible') visibleMs += t - last;
    last = t;
    if (visibleMs >= 20000) send();
  }, 1000);
})();

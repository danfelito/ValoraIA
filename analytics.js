// Medición de visitas (Ávila Control Comercial). Sin cookies ni datos personales.
(function () {
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.)/.test(location.hostname) || navigator.webdriver) return;
  try {
    var utm = new URLSearchParams(location.search).get('utm_source') || '';
    fetch('https://avila-control-comercial.danfelavicas.workers.dev/api/public/visit', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ p: location.pathname, r: document.referrer, u: utm })
    }).catch(function () {});
  } catch (e) {}
})();

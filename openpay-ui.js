(() => {
  'use strict';
  if (!window.supabase || !window.VALORAIA_CONFIG) return;
  const cfg = window.VALORAIA_CONFIG;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const params = new URLSearchParams(location.search);
  const isCommercial = params.get('tipo') !== 'profesional';
  const returnedRequest = params.get('solicitud');
  const testMode = params.get('prueba') === '1';
  const pendingKey = testMode ? 'valoraia_pending_commercial_test' : 'valoraia_pending_commercial_request';
  const root = document.getElementById('app');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const note = (text, error=false) => `<div class="status ${error ? 'error' : 'ok'}">${esc(text)}</div>`;

  function productCard() {
    return `<section class="commercial-product card" data-openpay-product>
      <div class="price-header"><div><span class="eyebrow">Servicio digital</span><h2>Conoce el costo antes de continuar</h2></div><div class="price-tag"><strong>${testMode ? '$1' : '$365'}</strong><span>MXN · ${testMode ? 'prueba sandbox' : 'precio final'}</span></div></div>
      <div class="delivery-grid"><div><h3>Recibirás</h3><ul class="check-list"><li>Opinión de valor comercial en PDF.</li><li>Valor estimado, rango orientativo y referencia por m².</li><li>Comparables públicos utilizados y metodología.</li><li>Alcance y limitaciones del resultado.</li></ul></div><div><h3>Forma de entrega</h3><ul class="check-list"><li>Envío al correo registrado.</li><li>Descarga segura desde tu expediente.</li><li>Comprobante del pago de Openpay.</li><li>Si solicitas factura, recibirás PDF y XML cuando sea emitida.</li></ul></div></div>
      <div class="notice"><strong>Importante:</strong> Es una opinión orientativa y no sustituye un avalúo profesional firmado para crédito, juicio, garantía o trámites regulados.</div>
    </section>`;
  }

  function invoiceBlock() {
    return `<div class="invoice-box" data-openpay-invoice><div class="check"><input id="invoice_requested" type="checkbox" name="invoice_requested"><label for="invoice_requested"><strong>Necesito factura CFDI</strong><br><span class="muted">Captura los datos exactamente como aparecen en tu constancia fiscal.</span></label></div><div id="fiscal-fields" class="fields hidden"><div class="field"><label>RFC *</label><input name="fiscal_rfc" maxlength="13"></div><div class="field"><label>Nombre o razón social *</label><input name="fiscal_legal_name"></div><div class="field"><label>Código postal fiscal *</label><input name="fiscal_postal_code" maxlength="5" inputmode="numeric"></div><div class="field"><label>Régimen fiscal *</label><input name="fiscal_tax_regime" placeholder="Ej. 612 - Personas Físicas"></div><div class="field"><label>Uso del CFDI *</label><select name="fiscal_cfdi_use"><option value="">Selecciona</option><option value="G03">G03 - Gastos en general</option><option value="S01">S01 - Sin efectos fiscales</option></select></div><div class="field"><label>Correo fiscal</label><input name="fiscal_email" type="email"></div></div></div>`;
  }

  async function commercialSubmit(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    const form = event.currentTarget, button = document.getElementById('send'), status = document.getElementById('rs'), fd = new FormData(form), payload = {};
    for (const [key,value] of fd.entries()) if(key!=='intake_files')payload[key] = value;
    payload.privacy_accepted = fd.get('privacy_accepted') === 'on';
    payload.marketing_consent = fd.get('marketing_consent') === 'on';
    payload.service_type = 'commercial';
    payload.invoice_requested = fd.get('invoice_requested') === 'on';
    payload.fiscal_data = payload.invoice_requested ? {
      rfc: String(fd.get('fiscal_rfc') || '').trim().toUpperCase(),
      legal_name: String(fd.get('fiscal_legal_name') || '').trim(),
      postal_code: String(fd.get('fiscal_postal_code') || '').trim(),
      tax_regime: String(fd.get('fiscal_tax_regime') || '').trim(),
      cfdi_use: String(fd.get('fiscal_cfdi_use') || '').trim(),
      email: String(fd.get('fiscal_email') || fd.get('client_email') || '').trim().toLowerCase()
    } : {};
    button.disabled = true;
    status.innerHTML = '<div class="status">Preparando tu expediente y la liga segura de pago…</div>';
    try {
      const {validateIntakeFiles,uploadIntakeFiles}=await import('./upload-intake.mjs');
      const files=fd.getAll('intake_files').filter(file=>file.size);
      validateIntakeFiles(files);
      const land = ['terreno','rancho'].includes(payload.property_type)||(['bodega','industrial'].includes(payload.property_type)&&payload.comparison_area_basis==='land');
      const area = Number(payload[land ? 'land_area_m2' : 'built_area_m2']);
      if (!payload.region?.trim() || !payload.municipality?.trim() || !Number.isFinite(area) || area <= 0) {
        throw new Error('Antes de pagar, completa estado, municipio y la superficie '+(land?'de terreno':'construida')+' mayor a cero.');
      }
      const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))].map(n=>n.toString(16).padStart(2,'0')).join('');
      // Only retry this exact capture. A stale paid/test request or a different
      // property must never be silently overwritten by starting another test.
      let requestId = sessionStorage.getItem(pendingKey+'_fingerprint')===fingerprint?sessionStorage.getItem(pendingKey):null;
      if (!requestId) {
        const saved = await db.rpc('submit_valuation_request', { payload });
        if (saved.error) throw saved.error;
        requestId = saved.data.request_id;
        sessionStorage.setItem(pendingKey, requestId);
        sessionStorage.setItem(pendingKey+'_fingerprint',fingerprint);
      }
      const auth=await db.auth.getSession();
      await uploadIntakeFiles(db,auth.data.session?.user.id,requestId,files,(n,total)=>{status.textContent=`Guardando evidencia ${n}/${total} antes del pago…`;});
      status.textContent='Evidencia guardada. Preparando la liga de pago…';
      const checkout = await db.functions.invoke('openpay-create-checkout', { body: { request_id: requestId, test_mode: testMode } });
      if (checkout.error) {
        const detail = await checkout.error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || checkout.error.message);
      }
      if (checkout.data?.status === 'paid') { location.assign(`servicios.html?tipo=comercial&pago=regreso&solicitud=${encodeURIComponent(requestId)}`); return; }
      if (!checkout.data?.checkout_url) throw new Error(checkout.data?.error || 'No se recibió la liga de pago.');
      location.assign(checkout.data.checkout_url);
    } catch (error) {
      status.innerHTML = note(error.message || 'No se pudo iniciar el pago.', true);
      button.disabled = false;
    }
  }

  function enhance() {
    if (!isCommercial || returnedRequest) return;
    const selected = root.querySelector('.selected-service');
    if (selected && !root.querySelector('[data-openpay-product]')) selected.insertAdjacentHTML('afterend', productCard());
    const form = document.getElementById('request');
    if (!form || form.dataset.openpayReady) return;
    form.dataset.openpayReady = 'true';
    const privacy = form.querySelector('input[name="privacy_accepted"]')?.closest('.check');
    if (privacy && !form.querySelector('[data-openpay-invoice]')) privacy.insertAdjacentHTML('beforebegin', invoiceBlock());
    const invoice = document.getElementById('invoice_requested');
    if (invoice) invoice.addEventListener('change', () => {
      const fields = document.getElementById('fiscal-fields');
      fields.classList.toggle('hidden', !invoice.checked);
      fields.querySelectorAll('input,select').forEach(el => { if (el.name !== 'fiscal_email') el.required = invoice.checked; });
    });
    const button = document.getElementById('send');
    if (button) {
      button.textContent = `Generar documento · ${testMode ? '$1 MXN (prueba)' : '$365 MXN'}`;
      button.insertAdjacentHTML('afterend', `<p class="button-helper">Al continuar guardarás el expediente y pasarás a la pasarela segura de Openpay. ${testMode ? 'Prueba interna: solo la cuenta administradora puede usar $1 en sandbox. ' : ''}El PDF se genera únicamente después de que el pago sea confirmado.</p>`);
    }
    form.addEventListener('submit', commercialSubmit, true);
  }

  function statusView() {
    sessionStorage.removeItem('valoraia_pending_commercial_request');
    sessionStorage.removeItem('valoraia_pending_commercial_test');
    sessionStorage.removeItem('valoraia_pending_commercial_request_fingerprint');
    sessionStorage.removeItem('valoraia_pending_commercial_test_fingerprint');
    root.innerHTML = `<section class="selected-service commercial-selected"><div><span class="badge">Opinión de valor comercial</span><h1>Seguimiento de tu documento</h1><p>El PDF se genera únicamente después de que Openpay confirma el pago.</p></div></section><section class="card payment-status-card"><div class="status-icon">✓</div><h2>Estamos verificando tu pago</h2><p class="muted">Después analizaremos los comparables, generaremos el PDF y lo enviaremos al correo registrado.</p><div id="payment-progress" class="progress-list"><div class="progress-item active">1. Confirmación de pago</div><div class="progress-item">2. Análisis y comparables</div><div class="progress-item">3. Generación del PDF</div><div class="progress-item">4. Envío por correo</div></div><div id="status-box"><div class="status">Preparando el seguimiento…</div></div><div class="actions"><a class="btn primary" href="solicitud.html?id=${encodeURIComponent(returnedRequest)}">Abrir mi expediente</a><a class="btn secondary" href="cuenta.html">Mis solicitudes</a><a class="btn secondary" href="index.html">Volver al inicio</a></div></section>`;
  }

  async function poll(attempt) {
    const box = document.getElementById('status-box'); if (!box) return;
    try {
      const response = await db.functions.invoke('commercial-request-status', { body: { request_id: returnedRequest } });
      if (response.error) throw response.error;
      const state = response.data, items = [...document.querySelectorAll('.progress-item')];
      items.forEach(x => x.classList.remove('active','done'));
      if (state.payment_status === 'paid') items[0].classList.add('done'); else items[0].classList.add('active');
      if (['queued','generating'].includes(state.document_status)) {
        items[1].classList.add('done'); items[2].classList.add('active');
        const progress = state.total_pages ? ` Avance documental: ${Number(state.completed_pages || 0)} de ${Number(state.total_pages)} páginas${state.source_title ? ` · ${state.source_title}` : ''}.` : '';
        box.innerHTML = note('Pago confirmado. Estamos preparando tu opinión de valor comercial.' + progress);
      } else if (state.document_status === 'ready') {
        items[0].classList.add('done'); items[1].classList.add('done'); items[2].classList.add('done'); items[3].classList.add(state.document_emailed_at ? 'done' : 'active');
        box.innerHTML = `<div class="status ok"><strong>Tu documento está listo.</strong><br>${state.document_emailed_at ? 'También fue enviado al correo registrado.' : 'Puedes descargarlo ahora. El envío por correo requiere que el remitente del sistema esté configurado.'}</div>${state.download_url ? `<a class="btn primary download-button" href="${esc(state.download_url)}">Descargar PDF</a>` : ''}${state.invoice_requested ? `<div class="invoice-result">Factura: ${esc(state.invoice_status === 'ready' ? 'emitida' : 'solicitada y pendiente de procesamiento fiscal')}${state.invoice_pdf_url ? ` · <a href="${esc(state.invoice_pdf_url)}">PDF</a>` : ''}${state.invoice_xml_url ? ` · <a href="${esc(state.invoice_xml_url)}">XML</a>` : ''}</div>` : ''}`;
        return;
      } else if (state.document_status === 'needs_review') {
        items[0].classList.add('done'); box.innerHTML = note(`El pago fue confirmado, pero la información requiere revisión antes de emitir una cifra confiable. ${state.review_reason || 'El expediente quedó en seguimiento.'}`); return;
      } else if (['failed','cancelled'].includes(state.payment_status)) {
        box.innerHTML = note(state.payment_error || 'El pago no fue aprobado.', true); return;
      } else box.innerHTML = note('Pago pendiente de confirmación. Puedes mantener esta página abierta o regresar después con el mismo enlace.');
    } catch (error) { box.innerHTML = note(error.message || 'No se pudo consultar el estado.', true); }
    if (attempt < 60) setTimeout(() => poll(attempt + 1), 5000);
  }

  if (returnedRequest && isCommercial) {
    statusView();
    const timer = setInterval(async () => {
      const { data } = await db.auth.getSession();
      if (data.session) { clearInterval(timer); statusView(); poll(0); }
    }, 250);
  } else {
    const observer = new MutationObserver(enhance);
    observer.observe(root, { childList: true, subtree: true });
    enhance();
  }
})();

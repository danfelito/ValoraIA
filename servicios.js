(() => {
  'use strict';

  const cfg = window.VALORAIA_CONFIG;
  const root = document.getElementById('app');
  if (!window.supabase || !cfg) {
    root.innerHTML = '<div class="status error">No se pudo cargar la configuración.</div>';
    return;
  }

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const requestedType = new URLSearchParams(window.location.search).get('tipo');
  const service = requestedType === 'profesional' ? 'professional' : 'commercial';
  const redirectUrl = `https://valoraia.onrender.com/servicios.html?tipo=${service === 'professional' ? 'profesional' : 'comercial'}`;

  let session = null;
  let last = null;
  let quickProfile = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const note = (text, error = false) => `<div class="status ${error ? 'error' : 'ok'}">${esc(text)}</div>`;

  function serviceSummary() {
    if (service === 'professional') {
      return `
        <section class="selected-service professional-selected">
          <div>
            <span class="badge">Opción seleccionada</span>
            <h1>Avalúo profesional</h1>
            <p>Tu información formará un expediente para clasificación, seguimiento administrativo y asignación a un perito adecuado.</p>
          </div>
          <a href="index.html#opciones">Cambiar opción</a>
        </section>`;
    }
    return `
      <section class="selected-service commercial-selected">
        <div>
          <span class="badge">Opción seleccionada</span>
          <h1>Opinión de valor comercial</h1>
          <p>Captura la propiedad y sus documentos para preparar una estimación orientativa con la información disponible.</p>
        </div>
        <a href="index.html#opciones">Cambiar opción</a>
      </section>`;
  }

  function auth() {
    root.innerHTML = `${serviceSummary()}
      <section class="auth card compact-auth quick-access-card">
        <span class="eyebrow">Acceso inmediato</span>
        <h2>Comienza tu reporte sin contraseña</h2>
        <p class="muted">Captura tu nombre y correo. Podrás completar el inmueble, adjuntar documentos y continuar con el reporte de inmediato.</p>
        <form id="quick-access">
          <div class="fields">
            <div class="field"><label>Nombre completo</label><input name="name" autocomplete="name" required></div>
            <div class="field"><label>Correo</label><input name="email" type="email" autocomplete="email" required></div>
          </div>
          <button class="btn primary quick-button" type="submit">Continuar con mi reporte</button>
          <div id="quick-status" role="status"></div>
        </form>
        <details class="account-access">
          <summary>Ya tengo cuenta o quiero crear una</summary>
          <form id="auth">
            <div class="field"><label>Nombre completo</label><input name="name" autocomplete="name"></div>
            <div class="field"><label>Correo</label><input name="email" type="email" autocomplete="email" required></div>
            <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required><small class="field-help">Puedes usar letras, números o símbolos, sin una combinación obligatoria.</small></div>
            <div class="actions">
              <button class="btn primary" name="mode" value="signin">Ingresar</button>
              <button class="btn secondary" name="mode" value="signup">Crear cuenta</button>
            </div>
            <div id="as" role="status"></div>
          </form>
        </details>
      </section>`;

    document.getElementById('quick-access').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = String(form.get('name') || '').trim();
      const email = String(form.get('email') || '').trim().toLowerCase();
      const status = document.getElementById('quick-status');
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      status.innerHTML = '<div class="status">Preparando tu solicitud…</div>';
      try {
        const result = await db.auth.signInAnonymously({
          options: { data: { full_name: name, contact_email: email, locale: 'es-MX' } }
        });
        if (result.error) throw result.error;
        quickProfile = { name, email };
        session = result.data.session;
        portal();
      } catch (error) {
        const disabled = error?.code === 'anonymous_provider_disabled' || /anonymous sign-ins are disabled/i.test(error?.message || '');
        status.innerHTML = note(disabled
          ? 'El acceso inmediato aún no está habilitado. Puedes ingresar o crear una cuenta en la opción inferior.'
          : (error.message || 'No se pudo iniciar la solicitud.'), true);
      } finally {
        button.disabled = false;
      }
    };

    document.getElementById('auth').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const mode = event.submitter?.value || 'signin';
      const email = String(form.get('email') || '').trim().toLowerCase();
      const password = String(form.get('password') || '');
      const status = document.getElementById('as');
      status.innerHTML = '<div class="status">Validando acceso…</div>';

      try {
        const result = mode === 'signup'
          ? await db.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: redirectUrl,
                data: { full_name: form.get('name'), locale: 'es-MX' }
              }
            })
          : await db.auth.signInWithPassword({ email, password });

        if (result.error) throw result.error;
        if (mode === 'signup' && !result.data.session) {
          status.innerHTML = note('Revisa tu correo y confirma la cuenta para continuar.');
        } else {
          session = result.data.session;
          portal();
        }
      } catch (error) {
        const rateLimited = error?.code === 'over_email_send_rate_limit' || /after [0-9]+ seconds/i.test(error?.message || '');
        status.innerHTML = note(rateLimited
          ? 'Ya se envió un correo de confirmación. Puedes continuar ahora con el acceso inmediato de arriba, sin esperar ni solicitar otro mensaje.'
          : (error.message || 'No se pudo completar el acceso.'), true);
      }
    };
  }

  function portal() {
    document.getElementById('logout').classList.remove('hidden');
    // Al volver de Openpay, openpay-ui controla el seguimiento. Los eventos
    // de sesión posteriores no deben reemplazarlo por una solicitud nueva.
    if (service === 'commercial' && new URLSearchParams(location.search).get('solicitud')) return;
    const defaultName = quickProfile?.name || session.user.user_metadata?.full_name || '';
    const defaultEmail = quickProfile?.email || session.user.user_metadata?.contact_email || session.user.email || '';

    root.innerHTML = `${serviceSummary()}
      <section class="card request-card">
        <form id="request">
          <h2 class="section-title">Datos del solicitante</h2>
          <div class="fields">
            <div class="field"><label>Nombre completo *</label><input name="client_name" value="${esc(defaultName)}" required></div>
            <div class="field"><label>Correo *</label><input name="client_email" type="email" value="${esc(defaultEmail)}" required></div>
            <div class="field"><label>Teléfono *</label><input name="client_phone" required></div>
            <div class="field"><label>Teléfono alterno</label><input name="alternate_phone"></div>
            <div class="field"><label>Medio preferido</label><select name="preferred_contact"><option>WhatsApp</option><option>Llamada</option><option>Correo</option></select></div>
            <div class="field"><label>Mejor horario</label><input name="best_contact_time" placeholder="Ej. 9:00 a 13:00"></div>
          </div>

          <h2 class="section-title">Datos del inmueble</h2>
          <div class="fields">
            <div class="field"><label>Tipo de inmueble *</label><select name="property_type" required><option value="">Selecciona</option><option value="casa">Casa</option><option value="departamento">Departamento</option><option value="terreno">Terreno</option><option value="local_comercial">Local comercial</option><option value="bodega">Bodega</option><option value="oficina">Oficina</option><option value="rancho">Rancho / finca</option><option value="industrial">Industrial</option><option value="otro">Otro</option></select></div>
            <div class="field"><label>Subtipo o uso</label><input name="property_subtype" placeholder="Ej. residencial, agrícola, ganadero"></div>
            <div class="field full"><label>Dirección completa *</label><input name="address_line" required></div>
            <div class="field"><label for="f-region">Estado *</label><input id="f-region" name="region" list="mx-estados" autocomplete="address-level1" placeholder="Ej. Veracruz" required></div>
            <div class="field"><label for="f-municipality">Municipio *</label><input id="f-municipality" name="municipality" autocomplete="address-level2" placeholder="Ej. Boca del Río" required></div>
            <div class="field"><label>Localidad / colonia</label><input name="locality"></div>
            <div class="field"><label>Código postal</label><input name="postal_code" inputmode="numeric" maxlength="5" autocomplete="postal-code"></div>
            <div class="field"><label for="f-land">Terreno (m²)<span data-req="land"></span></label><input id="f-land" name="land_area_m2" type="number" min="0" step="0.01" inputmode="decimal"></div>
            <div class="field"><label for="f-built">Construcción (m²)<span data-req="built"></span></label><input id="f-built" name="built_area_m2" type="number" min="0" step="0.01" inputmode="decimal"></div>
            <div class="field full"><label>Base de comparación de bodegas e industriales</label><select name="comparison_area_basis"><option value="auto">Habitual según tipo de inmueble</option><option value="land">Bodegas / industriales: precio total por m² de terreno</option><option value="built">Bodegas / industriales: precio total por m² construido</option></select><small>Usa terreno sólo para bodegas o industriales. Se comparan inmuebles con construcción, conservando las diferencias de oficinas, mezanine y estado.</small></div>
            <div class="field"><label>Recámaras</label><input name="bedrooms" type="number" min="0"></div>
            <div class="field"><label>Baños</label><input name="bathrooms" type="number" min="0" step="0.5"></div>
            <div class="field"><label>Estacionamientos</label><input name="parking_spaces" type="number" min="0"></div>
            <div class="field"><label>Año de construcción</label><input name="construction_year" type="number" min="1800" max="2100"></div>
            <div class="field"><label>Conservación</label><select name="conservation_state"><option value="">Selecciona</option><option>Nuevo</option><option>Bueno</option><option>Regular</option><option>Para remodelar</option></select></div>
            <div class="field"><label>Urgencia</label><select name="urgency"><option>Normal</option><option>Alta</option><option>Sin fecha definida</option></select></div>
            <div class="field full"><label>Enlace del anuncio de este inmueble</label><input name="subject_listing_url" type="url" placeholder="https://..."><small>Sirve para excluir la propiedad de su propia muestra de comparables.</small></div>
            <div class="field"><label>Precio anunciado (sólo para contraste)</label><input name="asking_price" type="number" min="0" step="0.01"></div>
            <div class="field full"><label>Descripción y datos adicionales</label><textarea name="property_notes" placeholder="Servicios, acabados, antigüedad, situación legal, accesos, mejoras y ocupación."></textarea></div>
          </div>

          ${service==='commercial'?'<section class="card"><h2>Documentos y fotografías del inmueble</h2><p>Adjunta la evidencia antes de continuar al pago. Puedes incluir planos, predial, escritura y fotografías. Si no aportas documentos, el informe señalará qué datos sólo fueron declarados.</p><input name="intake_files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"><small>Hasta 40 MB por archivo; fotografías hasta 30 MB en conjunto.</small></section>':''}
          <div class="check"><input type="checkbox" name="privacy_accepted" required><label>Acepto el almacenamiento y uso de la información para atender esta solicitud. *</label></div>
          <div class="check"><input type="checkbox" name="marketing_consent"><label>Acepto recibir seguimiento posterior sobre servicios de valuación.</label></div>
          <button class="btn primary" id="send">Guardar expediente</button>
          <div id="rs"></div>
        </form>
      </section>
      <section id="upload" class="card hidden upload-card"></section>`;

    document.getElementById('request').onsubmit = submit;
    document.getElementById('request').insertAdjacentHTML('beforeend', '<datalist id="mx-estados"><option value="Aguascalientes"><option value="Baja California"><option value="Baja California Sur"><option value="Campeche"><option value="Chiapas"><option value="Chihuahua"><option value="Ciudad de México"><option value="Coahuila"><option value="Colima"><option value="Durango"><option value="Estado de México"><option value="Guanajuato"><option value="Guerrero"><option value="Hidalgo"><option value="Jalisco"><option value="Michoacán"><option value="Morelos"><option value="Nayarit"><option value="Nuevo León"><option value="Oaxaca"><option value="Puebla"><option value="Querétaro"><option value="Quintana Roo"><option value="San Luis Potosí"><option value="Sinaloa"><option value="Sonora"><option value="Tabasco"><option value="Tamaulipas"><option value="Tlaxcala"><option value="Veracruz"><option value="Yucatán"><option value="Zacatecas"></datalist>');
    wireAreaRequirement();
    restoreDraft();
  }

  // Borrador: lo capturado se guarda en esta pestaña y se recupera si la página se recarga.
  const DRAFT_KEY = 'valoraia_draft_' + service;
  const SKIP = new Set(['intake_files', 'privacy_accepted']);
  function restoreDraft() {
    const form = document.getElementById('request');
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { /* sin borrador */ }
    // Se aplica después de que openpay-ui agrega sus campos (factura), que llegan un instante más tarde.
    if (draft) setTimeout(() => {
      for (const [name, value] of Object.entries(draft)) {
        const el = form.elements[name];
        if (!el || SKIP.has(name) || el.type === 'file') continue;
        if (el.type === 'checkbox') { el.checked = !!value; el.dispatchEvent(new Event('change')); }
        else el.value = value;
      }
      form.elements.property_type?.dispatchEvent(new Event('change'));
    }, 0);
    const save = () => {
      const data = {};
      for (const el of form.elements) {
        if (!el.name || SKIP.has(el.name) || el.type === 'file') continue;
        data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (_) { /* almacenamiento lleno o bloqueado */ }
    };
    form.addEventListener('input', save); form.addEventListener('change', save);
  }
  window.valoraiaClearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {} };

  // La superficie obligatoria depende del tipo de inmueble: terreno para terrenos y ranchos
  // (y bodegas/industriales comparados por terreno); construcción para todo lo demás.
  function wireAreaRequirement() {
    const form = document.getElementById('request');
    const type = form.elements.property_type, basis = form.elements.comparison_area_basis;
    const update = () => {
      const t = type.value;
      const land = ['terreno', 'rancho'].includes(t) || (['bodega', 'industrial'].includes(t) && basis.value === 'land');
      const needs = service === 'commercial' && t !== '';
      form.elements.land_area_m2.required = needs && land;
      form.elements.built_area_m2.required = needs && !land;
      form.querySelector('[data-req="land"]').textContent = needs && land ? ' *' : '';
      form.querySelector('[data-req="built"]').textContent = needs && !land ? ' *' : '';
      if (needs) (land ? form.elements.land_area_m2 : form.elements.built_area_m2).min = '0.01';
    };
    type.addEventListener('change', update); basis.addEventListener('change', update); update();
    form.addEventListener('input', (e) => e.target.classList?.remove('field-missing'));
  }

  async function submit(event) {
    event.preventDefault();
    const button = document.getElementById('send');
    const status = document.getElementById('rs');
    const form = new FormData(event.currentTarget);
    const payload = {};
    for (const [key, value] of form.entries()) payload[key] = value;
    payload.privacy_accepted = form.get('privacy_accepted') === 'on';
    payload.marketing_consent = form.get('marketing_consent') === 'on';
    payload.service_type = service;

    button.disabled = true;
    status.innerHTML = '<div class="status">Guardando expediente…</div>';

    try {
      const result = await db.rpc('submit_valuation_request', { payload });
      if (result.error) throw result.error;
      last = result.data;
      window.valoraiaClearDraft();

      if (service === 'professional') {
        const routeResult = await db.rpc('route_professional_request', { p_request_id: last.request_id });
        if (routeResult.error) console.warn(routeResult.error);
      }

      status.innerHTML = note(
        service === 'commercial'
          ? 'Expediente guardado. Continúa con los documentos y el proceso comercial.'
          : 'Expediente profesional guardado y visible en Administración.'
      );
      upload(last);
    } catch (error) {
      status.innerHTML = note(error.message || 'No se pudo guardar la solicitud.', true);
    } finally {
      button.disabled = false;
    }
  }

  function upload(data) {
    const section = document.getElementById('upload');
    section.classList.remove('hidden');
    section.innerHTML = `
      <h2>Expediente ${esc(data.folio)}</h2>
      <p class="muted">Agrega los documentos disponibles. Puedes continuar aunque todavía no tengas todos.</p>
      <form id="files">
        <div class="fields">
          <div class="field"><label>Categoría</label><select name="category"><option value="escritura">Escritura</option><option value="predial">Predial</option><option value="plano">Plano</option><option value="fotografia">Fotografía</option><option value="identificacion">Identificación</option><option value="otro">Otro</option></select></div>
          <div class="field"><label>Archivos</label><input name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"></div>
        </div>
        <button class="btn secondary">Cargar documentos</button>
        <div id="fs"></div>
      </form>
      ${data.service_type === 'commercial'
        ? `<div class="notice followup-notice"><strong>Continuar con la opinión comercial</strong><br>${data.checkout_url ? `<a class="btn primary inline-action" href="${esc(data.checkout_url)}" target="_blank" rel="noopener">Realizar pago</a>` : 'El expediente quedó guardado. Administración debe configurar la liga de pago para continuar con el procesamiento.'}</div>`
        : '<div class="notice followup-notice">Administración ya puede consultar el expediente y dar seguimiento a la asignación profesional.</div>'}`;

    document.getElementById('files').onsubmit = sendFiles;
    section.scrollIntoView({ behavior: 'smooth' });
  }

  async function sendFiles(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const files = form.getAll('files').filter(file => file.size);
    const status = document.getElementById('fs');
    if (!files.length) {
      status.innerHTML = note('Selecciona al menos un archivo.', true);
      return;
    }

    status.innerHTML = '<div class="status">Cargando documentos…</div>';
    try {
      const request = await db.from('service_requests').select('organization_id').eq('id', last.request_id).single();
      if (request.error) throw request.error;

      for (const file of files) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${request.data.organization_id}/${last.request_id}/${crypto.randomUUID()}-${safe}`;
        const uploaded = await db.storage.from('valuation-intake').upload(path, file, { contentType: file.type });
        if (uploaded.error) throw uploaded.error;

        const inserted = await db.from('intake_documents').insert({
          organization_id: request.data.organization_id,
          request_id: last.request_id,
          uploaded_by: session.user.id,
          category: form.get('category'),
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size
        });
        if (inserted.error) throw inserted.error;
      }
      status.innerHTML = note('Documentos cargados correctamente.');
      event.currentTarget.reset();
    } catch (error) {
      status.innerHTML = note(error.message || 'No se pudieron cargar los archivos.', true);
    }
  }

  document.getElementById('logout').onclick = async () => {
    await db.auth.signOut();
    session = null;
    quickProfile = null;
    document.getElementById('logout').classList.add('hidden');
    auth();
  };

  (async () => {
    const result = await db.auth.getSession();
    session = result.data.session;
    session ? portal() : auth();
    db.auth.onAuthStateChange((event, currentSession) => {
      session = currentSession;
      // Al volver a la pestaña, Supabase renueva la sesión y emite eventos.
      // Sólo se dibuja el formulario si todavía no está en pantalla; si no, se borraría lo capturado.
      if (event === 'SIGNED_OUT') { if (!document.getElementById('quick-access')) auth(); return; }
      if (currentSession && !document.getElementById('request')) portal();
    });
  })();
})();

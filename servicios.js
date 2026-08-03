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
      <section class="auth card compact-auth">
        <h2>Accede para guardar tu solicitud</h2>
        <p class="muted">El expediente quedará asociado a tu correo para que la información no se pierda.</p>
        <form id="auth">
          <div class="field"><label>Nombre completo</label><input name="name" autocomplete="name"></div>
          <div class="field"><label>Correo</label><input name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label>Contraseña</label><input name="password" type="password" minlength="6" autocomplete="current-password" required></div>
          <div class="actions">
            <button class="btn primary" name="mode" value="signin">Ingresar</button>
            <button class="btn secondary" name="mode" value="signup">Crear cuenta</button>
          </div>
          <div id="as"></div>
        </form>
      </section>`;

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
        status.innerHTML = note(error.message || 'No se pudo completar el acceso.', true);
      }
    };
  }

  function portal() {
    document.getElementById('logout').classList.remove('hidden');
    const defaultName = session.user.user_metadata?.full_name || '';

    root.innerHTML = `${serviceSummary()}
      <section class="card request-card">
        <form id="request">
          <h2 class="section-title">Datos del solicitante</h2>
          <div class="fields">
            <div class="field"><label>Nombre completo *</label><input name="client_name" value="${esc(defaultName)}" required></div>
            <div class="field"><label>Correo *</label><input name="client_email" type="email" value="${esc(session.user.email)}" required></div>
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
            <div class="field"><label>Estado</label><input name="region"></div>
            <div class="field"><label>Municipio</label><input name="municipality"></div>
            <div class="field"><label>Localidad / colonia</label><input name="locality"></div>
            <div class="field"><label>Código postal</label><input name="postal_code"></div>
            <div class="field"><label>Terreno (m²)</label><input name="land_area_m2" type="number" min="0" step="0.01"></div>
            <div class="field"><label>Construcción (m²)</label><input name="built_area_m2" type="number" min="0" step="0.01"></div>
            <div class="field"><label>Recámaras</label><input name="bedrooms" type="number" min="0"></div>
            <div class="field"><label>Baños</label><input name="bathrooms" type="number" min="0" step="0.5"></div>
            <div class="field"><label>Estacionamientos</label><input name="parking_spaces" type="number" min="0"></div>
            <div class="field"><label>Año de construcción</label><input name="construction_year" type="number" min="1800" max="2100"></div>
            <div class="field"><label>Conservación</label><select name="conservation_state"><option value="">Selecciona</option><option>Nuevo</option><option>Bueno</option><option>Regular</option><option>Para remodelar</option></select></div>
            <div class="field"><label>Urgencia</label><select name="urgency"><option>Normal</option><option>Alta</option><option>Sin fecha definida</option></select></div>
            <div class="field full"><label>Descripción y datos adicionales</label><textarea name="property_notes" placeholder="Servicios, acabados, antigüedad, situación legal, accesos, mejoras y ocupación."></textarea></div>
          </div>

          <div class="check"><input type="checkbox" name="privacy_accepted" required><label>Acepto el almacenamiento y uso de la información para atender esta solicitud. *</label></div>
          <div class="check"><input type="checkbox" name="marketing_consent"><label>Acepto recibir seguimiento posterior sobre servicios de valuación.</label></div>
          <button class="btn primary" id="send">Guardar expediente</button>
          <div id="rs"></div>
        </form>
      </section>
      <section id="upload" class="card hidden upload-card"></section>`;

    document.getElementById('request').onsubmit = submit;
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
    document.getElementById('logout').classList.add('hidden');
    auth();
  };

  (async () => {
    const result = await db.auth.getSession();
    session = result.data.session;
    session ? portal() : auth();
    db.auth.onAuthStateChange((_event, currentSession) => {
      session = currentSession;
      if (currentSession) portal();
    });
  })();
})();

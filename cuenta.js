(() => {
  'use strict';
  const root=document.getElementById('app'), cfg=window.VALORAIA_CONFIG;
  if(!window.supabase||!cfg){root.innerHTML='<div class="status error">No fue posible cargar el acceso. Vuelve a cargar la página.</div>';return;}
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses={draft:'En preparación',submitted:'Solicitud recibida',paid:'Pagado',in_review:'En revisión',completed:'Concluido',pending:'Pendiente',needs_review:'Requiere revisión'};
  let generation=0;
  function login(){
    document.getElementById('account-logout').classList.add('hidden');
    root.innerHTML='<section class="auth card"><span class="badge">Acceso privado</span><h1>Ingresar a mi cuenta</h1><p class="muted">Aquí puedes consultar tus solicitudes, documentos e informes.</p><form id="account-login"><div class="field"><label for="account-email">Correo</label><input id="account-email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="account-password">Contraseña</label><input id="account-password" name="password" type="password" autocomplete="current-password" required></div><button type="submit" class="btn primary">Ingresar</button><div id="account-message" role="status"></div></form><p class="muted">¿Aún no tienes cuenta? <a href="servicios.html?tipo=comercial">Comienza una solicitud y crea tu cuenta</a>.</p></section>';
    document.getElementById('account-login').onsubmit=async event=>{
      event.preventDefault(); const f=new FormData(event.currentTarget), button=event.currentTarget.querySelector('button');
      button.disabled=true;
      const result=await db.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});
      if(result.error){document.getElementById('account-message').innerHTML='<div class="status error">'+esc(result.error.message)+'</div>';button.disabled=false;}
      else await show();
    };
  }
  async function show(){
    const ticket=++generation; root.innerHTML='<div class="status">Verificando acceso…</div>';
    const {data,error}=await db.auth.getUser();
    if(ticket!==generation)return;
    if(error||!data.user){login();return;}
    const user=data.user;
    const [members,requests]=await Promise.all([
      db.from('organization_members').select('role,organization_id,organizations(name)').eq('user_id',user.id).eq('status','active'),
      db.from('service_requests').select('id,case_id,service_type,status,payment_status,document_status,created_at,valuation_cases(folio,municipality,region)').eq('created_by',user.id).order('created_at',{ascending:false})
    ]);
    if(ticket!==generation)return;
    const roles=(members.data||[]).map(x=>x.role), admin=roles.some(r=>['owner','admin'].includes(r)), professional=roles.some(r=>['owner','admin','appraiser','reviewer','analyst','assistant'].includes(r));
    document.getElementById('account-logout').classList.remove('hidden');
    root.innerHTML=`<section class="hero"><span class="badge">Sesión iniciada</span><h1>Mi cuenta</h1><p>${esc(user.email)}</p><div class="actions">${admin?'<a class="btn primary" href="operaciones.html">Administración</a><a class="btn secondary" href="operaciones.html#knowledge">Mis PDF y repositorio IA</a>':''}${professional?'<a class="btn secondary" href="profesional.html">Expedientes profesionales</a>':''}<a class="btn secondary" href="servicios.html?tipo=comercial">Nueva solicitud</a></div></section><section class="card"><h2>Mis solicitudes e informes</h2>${requests.error?'<p class="status error">No fue posible consultar las solicitudes.</p>':(requests.data||[]).map(r=>`<article class="file-item"><div><strong>${esc(r.valuation_cases?.folio||'Expediente')}</strong><br>${r.service_type==='commercial'?'Opinión comercial':'Avalúo con perito'} · ${esc(statuses[r.status]||r.status)}<br><span class="muted">${esc([r.valuation_cases?.municipality,r.valuation_cases?.region].filter(Boolean).join(', '))}</span></div><a class="btn secondary" href="solicitud.html?id=${encodeURIComponent(r.id)}">Abrir expediente</a>${r.payment_status==='paid'&&r.document_status==='ready'?`<button class="btn primary" data-client-report="${r.id}">Ver informe PDF</button>`:''}</article>`).join('')||'<p class="muted">Aún no tienes solicitudes. Tus datos se conservarán cuando completes una, aunque el pago quede pendiente.</p>'}</section>`;
    root.querySelectorAll('[data-client-report]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      const result=await db.functions.invoke('commercial-request-status',{body:{request_id:button.dataset.clientReport}});
      button.disabled=false;
      if(result.error||!result.data?.download_url){alert(result.data?.error||result.error?.message||'El informe todavía no está disponible.');return;}
      window.open(result.data.download_url,'_blank','noopener');
    });
  }
  db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){++generation;root.replaceChildren();login();}else if(event==='SIGNED_IN')setTimeout(show,0);});
  document.getElementById('account-logout').onclick=async()=>{++generation;root.replaceChildren();await db.auth.signOut();login();};
  show();
})();

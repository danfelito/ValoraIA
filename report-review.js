(() => {
  'use strict';
  const cfg=window.VALORAIA_CONFIG;
  if(!window.supabase||!cfg)return;
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stages={documents:'Lectura y contraste de documentos',subject:'Revisión de la ficha y de las observaciones del cliente',market:'Sondeo de mercado y redes públicas',pdf:'Preparación del informe',ready:'Informe preparado',needs_review:'Requiere revisión'};
  const states={generated:'Vista previa disponible',generating:'Análisis en curso',needs_review:'Requiere revisión',not_started:'Vista previa pendiente'};
  async function invoke(body){const r=await db.functions.invoke('generate-valuation-preview',{body});if(r.error)throw new Error(r.data?.error||r.error.message);if(r.data?.error)throw new Error(r.data.error);return r.data;}
  async function open(container,caseId){
    container.innerHTML='<section class="card"><h2>Informe y documentos del expediente</h2><div class="status">Consultando…</div></section>';
    let timer,live=true;const token=Symbol();container.__valoraiaReviewRun=token;
    const refresh=async()=>{
      if(!container.isConnected||!live||container.__valoraiaReviewRun!==token){clearTimeout(timer);return;}
      try{
        const [state,docs,req]=await Promise.all([invoke({case_id:caseId,action:'status'}),db.from('documents').select('id,file_name,category,status,storage_path,metadata').eq('case_id',caseId),db.from('service_requests').select('id,organization_id').eq('case_id',caseId).maybeSingle()]);
        if(!container.isConnected||!live||container.__valoraiaReviewRun!==token)return;
        if(docs.error)throw docs.error;
        let intake=[];
        if(req.data){const r=await db.from('intake_documents').select('id,file_name,category,status,storage_path,analysis').eq('request_id',req.data.id);if(r.error)throw r.error;intake=r.data||[];}
        const files=[...(docs.data||[]).map(d=>({...d,bucket:'valuation-documents'})),...intake.map(d=>({...d,bucket:'valuation-intake'}))];
        const p=state.pipeline||{};
        container.innerHTML=`<section class="card"><span class="badge">Revisión privada</span><h2>Informe y documentos del expediente</h2><p>La vista previa muestra el análisis comercial completo. Puedes revisarla sin modificar pagos, cerrar el expediente ni enviar correos. Para un avalúo profesional se requiere la revisión y firma del perito.</p><div class="status ${state.reason?'error':''}"><strong>${esc(states[state.status]||state.status)}</strong>${p.stage?'<br>'+esc(stages[p.stage]||p.stage):''}${p.source_title?'<br>'+esc(p.source_title)+' · '+(p.completed_pages||0)+'/'+(p.total_pages||'?')+' páginas':''}${p.source_count!==undefined?'<br>'+ (p.completed_sources||0)+'/'+p.source_count+' fuentes terminadas':''}${state.reason?'<br>'+esc(state.reason):''}${state.outdated?'<br>La ficha o las fuentes cambiaron desde la emisión. Regenera para usar la información actual.':''}${state.stalled?'<br>El análisis dejó de avanzar. Puedes reintentarlo conservando las páginas ya procesadas.':''}</div><div class="actions">${state.download_url?`<a class="btn primary" href="${esc(state.download_url)}" target="_blank" rel="noopener">Ver PDF completo</a>`:''}<button class="btn secondary" id="generate-preview" ${state.analysis_enabled===false||state.status==='generating'&&!state.stalled?'disabled':''}>${state.download_url?'Regenerar con datos actuales':'Generar vista previa PDF'}</button><button class="btn secondary" id="refresh-preview">Actualizar estado</button></div><h3>Documentos del cliente y del expediente</h3><div class="file-list">${files.map((d,i)=>{const e=d.analysis?.commercial_evidence||d.metadata?.commercial_evidence;return `<div class="file-item"><div><strong>${esc(d.file_name)}</strong><br><span class="muted">${esc(d.category||'Documento')} · ${e?`${e.completed_pages||0}/${e.page_count||'?'} páginas leídas`:esc(d.status||'Lectura pendiente')}</span></div><button class="btn secondary" data-open-case-file="${i}">Abrir original</button></div>`}).join('')||'<p class="muted">No hay archivos aportados. El informe identificará los datos que sólo provienen de la ficha.</p>'}</div><h3>Fuentes y sondeo usados en el informe</h3>${(state.documents||[]).map(d=>`<p><strong>${esc(d.title)}</strong> · ${d.evidence?.completed_pages||0}/${d.evidence?.page_count||'?'} páginas · ${d.kind==='knowledge'?'Repositorio técnico':'Expediente'}${d.evidence?.duplicate_of?' · contenido duplicado, lectura reutilizada':''}</p>`).join('')||'<p class="muted">Aparecerán aquí cuando termine el análisis.</p>'}${(state.survey||[]).map(s=>`<p><strong>${esc(s.channel)}</strong>: ${esc(s.reason||s.status)}</p>`).join('')}<p><a href="operaciones.html#knowledge">Consultar los PDF del repositorio y sus análisis</a></p>${state.versions?.length?'<h3>Versiones anteriores</h3>'+state.versions.map(v=>`<button class="btn secondary" data-report-version="${v.index}">Ver versión del ${esc(v.generated_at||'registro anterior')}</button>`).join(''):''}</section>`;
        container.querySelector('#generate-preview').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await invoke({case_id:caseId,force:true});await refresh();}catch(e){alert(e.message);button.disabled=false;}};
        container.querySelector('#refresh-preview').onclick=refresh;
        container.querySelectorAll('[data-open-case-file]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const d=files[Number(b.dataset.openCaseFile)],r=await db.storage.from(d.bucket).createSignedUrl(d.storage_path,600);if(r.error)throw r.error;window.open(r.data.signedUrl,'_blank','noopener');}catch(e){alert(e.message);}finally{b.disabled=false;}});
        container.querySelectorAll('[data-report-version]').forEach(b=>b.onclick=async()=>{try{const r=await invoke({case_id:caseId,action:'download_version',index:Number(b.dataset.reportVersion)});if(r.download_url)window.open(r.download_url,'_blank','noopener');}catch(e){alert(e.message);}});
        clearTimeout(timer);if(state.status==='generating')timer=setTimeout(refresh,5000);
      }catch(e){container.innerHTML='<section class="card"><h2>Informe del expediente</h2><div class="status error">'+esc(e.message)+'</div></section>';}
    };
    const unsubscribe=db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){live=false;clearTimeout(timer);container.replaceChildren();unsubscribe.data.subscription.unsubscribe();}});
    await refresh();
  }
  window.ValoraIAReview={open};
  let injecting=false;
  function enhance(){
    const tabs=document.querySelector('.case-tabs'),caseId=window.__valoraiaCurrentCaseId;
    if(!tabs||!caseId||injecting||tabs.parentElement.querySelector('[data-professional-review]'))return;
    injecting=true;
    const bar=document.createElement('section');bar.className='card';bar.dataset.professionalReview=caseId;
    bar.innerHTML='<div class="actions"><button type="button" class="btn primary">Ver documentos e informe PDF</button><a class="btn secondary" href="operaciones.html#knowledge">Mis PDF del repositorio</a><a class="btn secondary" href="cuenta.html">Mi cuenta</a></div><div class="review-content"></div>';
    tabs.insertAdjacentElement('beforebegin',bar);
    bar.querySelector('button').onclick=()=>open(bar.querySelector('.review-content'),caseId);
    injecting=false;
  }
  new MutationObserver(enhance).observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
  window.addEventListener('valoraia-case-loaded',enhance);
})();

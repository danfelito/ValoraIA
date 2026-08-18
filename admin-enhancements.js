(()=>{
  'use strict';
  const cfg=window.VALORAIA_CONFIG;
  if(!window.supabase||!cfg)return;
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

  function setButtonState(btn,status){
    btn.disabled=status==='processing';
    if(status==='processing')btn.textContent='Actualizando…';
    else if(status==='ready')btn.textContent='Analizado';
    else if(status==='error'||status==='needs_configuration')btn.textContent='Reintentar';
    else btn.textContent='Actualizar';
  }

  async function refreshButton(btn){
    const id=btn.dataset.analyze;
    if(!id)return;
    const {data}=await db.from('knowledge_sources').select('status').eq('id',id).maybeSingle();
    if(data)setButtonState(btn,data.status);
  }

  async function runAnalysis(btn){
    const id=btn.dataset.analyze;
    if(!id)return;
    btn.disabled=true;
    btn.textContent='Actualizando…';
    try{
      const {error}=await db.functions.invoke('analyze-knowledge-source',{body:{source_id:id}});
      if(error)throw error;
      setButtonState(btn,'ready');
      const row=btn.closest('.file-item');
      const muted=row?.querySelector('.muted');
      if(muted)muted.textContent=muted.textContent.replace(/pending|processing|error|needs_configuration|ready/gi,'ready');
    }catch(e){
      setButtonState(btn,'error');
      alert('No fue posible actualizar el análisis: '+(e?.message||'Error desconocido'));
    }
  }

  async function deleteSource(btn){
    const id=btn.dataset.deleteSource;
    if(!id)return;
    const {data:source,error}=await db.from('knowledge_sources').select('id,title,source_type,storage_path').eq('id',id).single();
    if(error){alert(error.message);return;}
    if(!confirm(`¿Eliminar “${source.title}” del Repositorio IA? Esta acción no se puede deshacer.`))return;
    btn.disabled=true;
    btn.textContent='Eliminando…';
    try{
      if(source.source_type==='pdf'&&source.storage_path){
        const removed=await db.storage.from('valuation-knowledge').remove([source.storage_path]);
        if(removed.error)throw removed.error;
      }
      const deleted=await db.from('knowledge_sources').delete().eq('id',id);
      if(deleted.error)throw deleted.error;
      btn.closest('.file-item')?.remove();
    }catch(e){
      btn.disabled=false;
      btn.textContent='Eliminar';
      alert('No fue posible eliminar la fuente: '+(e?.message||'Error desconocido'));
    }
  }

  function enhance(){
    document.querySelectorAll('[data-analyze]').forEach(btn=>{
      if(btn.dataset.repoEnhanced)return;
      btn.dataset.repoEnhanced='1';
      refreshButton(btn);
      btn.addEventListener('click',e=>{
        e.preventDefault();
        e.stopImmediatePropagation();
        runAnalysis(btn);
      },true);
      const del=document.createElement('button');
      del.type='button';
      del.className='btn danger';
      del.dataset.deleteSource=btn.dataset.analyze;
      del.textContent='Eliminar';
      del.addEventListener('click',e=>{
        e.preventDefault();
        e.stopImmediatePropagation();
        deleteSource(del);
      },true);
      btn.insertAdjacentElement('afterend',del);
    });
  }

  const observer=new MutationObserver(()=>queueMicrotask(enhance));
  observer.observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
  setTimeout(enhance,200);
})();
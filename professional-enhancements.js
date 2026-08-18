(()=>{
  'use strict';
  const cfg=window.VALORAIA_CONFIG;
  if(!window.supabase||!cfg)return;
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let rendering=false;

  function addStyles(){
    if(document.getElementById('valoraia-service-switch-style'))return;
    const style=document.createElement('style');
    style.id='valoraia-service-switch-style';
    style.textContent=`
      .service-switch-bar{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 14px;padding:14px 16px;border:1px solid rgba(15,118,110,.22);border-radius:14px;background:rgba(15,118,110,.055)}
      .service-switch-copy{display:flex;flex-direction:column;gap:3px}.service-switch-copy small{opacity:.72}.service-switch-copy strong{font-size:15px}
      .service-switch-status{display:inline-flex;align-items:center;gap:8px}.service-switch-dot{width:8px;height:8px;border-radius:50%;background:#0f766e;display:inline-block}
      .service-switch-note{font-size:12px;opacity:.72;margin-top:2px}
      @media(max-width:640px){.service-switch-bar{align-items:stretch}.service-switch-bar .btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  async function getCase(id){
    const {data,error}=await db.from('valuation_cases').select('id,service_type,purpose,status').eq('id',id).single();
    if(error)throw error;
    return data;
  }

  function labelFor(type){return type==='commercial'?'Opinión de valor comercial':'Avalúo con perito';}

  async function injectSwitch(){
    if(rendering)return;
    const tabs=document.querySelector('.case-tabs');
    const caseId=window.__valoraiaCurrentCaseId;
    if(!tabs||!caseId)return;
    const existing=document.getElementById('service-switch-bar');
    if(existing?.dataset.caseId===caseId)return;
    rendering=true;
    try{
      const c=await getCase(caseId);
      existing?.remove();
      const current=c.service_type==='commercial'?'commercial':'professional';
      const next=current==='commercial'?'professional':'commercial';
      const bar=document.createElement('section');
      bar.id='service-switch-bar';
      bar.className='service-switch-bar';
      bar.dataset.caseId=caseId;
      bar.innerHTML=`<div class="service-switch-copy"><small>Tipo de servicio actual</small><strong class="service-switch-status"><span class="service-switch-dot"></span>${labelFor(current)}</strong><span class="service-switch-note">Tus datos y documentos permanecen en el mismo expediente al cambiar de modalidad.</span></div><button type="button" class="btn secondary" id="switch-service-btn">Cambiar a ${labelFor(next)}</button>`;
      tabs.parentNode.insertBefore(bar,tabs);
      const btn=bar.querySelector('#switch-service-btn');
      btn.addEventListener('click',async()=>{
        const msg=next==='professional'
          ?'Vas a cambiar este expediente a Avalúo con perito. Se conservarán todos los datos y documentos. Si ya existe un pago, quedará registrado para revisión administrativa. ¿Continuar?'
          :'Vas a cambiar este expediente a Opinión de valor comercial. Se conservarán todos los datos y documentos. Si corresponde, el expediente pasará al flujo de pago comercial. ¿Continuar?';
        if(!confirm(msg))return;
        btn.disabled=true;
        const old=btn.textContent;
        btn.textContent='Cambiando…';
        try{
          const {data,error}=await db.rpc('switch_valuation_service',{p_case_id:caseId,p_service_type:next});
          if(error)throw error;
          window.dispatchEvent(new CustomEvent('valoraia-service-changed',{detail:data}));
          bar.remove();
          await injectSwitch();
          const notice=document.createElement('div');
          notice.className='toast';
          notice.textContent=`Modalidad cambiada a ${labelFor(next)}.`;
          document.body.appendChild(notice);
          setTimeout(()=>notice.remove(),3500);
        }catch(e){
          btn.disabled=false;
          btn.textContent=old;
          alert(e?.message||'No fue posible cambiar la modalidad.');
        }
      });
    }catch(e){console.error('ValoraIA service switch:',e)}finally{rendering=false;}
  }

  addStyles();
  const observer=new MutationObserver(()=>{queueMicrotask(injectSwitch)});
  observer.observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
  window.addEventListener('valoraia-case-loaded',injectSwitch);
  setTimeout(injectSwitch,250);
})();
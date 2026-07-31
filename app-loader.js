(async () => {
  const target = document.getElementById('app');
  try {
    const parts = [
      'assets/app/app-01.b64','assets/app/app-02.b64',
      'assets/app/app-03a.b64','assets/app/app-03b.b64','assets/app/app-03c.b64',
      'assets/app/app-04.b64','assets/app/app-05.b64','assets/app/app-06.b64',
      'assets/app/app-07.b64','assets/app/app-08.b64'
    ];
    const encoded = (await Promise.all(parts.map(async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
      return (await response.text()).trim();
    }))).join('');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    let source = new TextDecoder().decode(bytes);

    const redirectUrl = 'https://valoraia.onrender.com/';

    // Todos los correos de confirmación regresan al dominio público de producción.
    source = source.replace(
      "options:{data:{full_name:",
      `options:{emailRedirectTo:'${redirectUrl}',data:{full_name:`
    );

    // Muestra un reenvío explícito sin obligar al usuario a registrarse otra vez.
    source = source.replace(
      `<div id="auth-msg"></div><button class="btn primary full" type="submit">\${S.authMode==='signin'?'Ingresar':'Crear cuenta'}</button></form>`,
      `<div id="auth-msg"></div><button class="btn primary full" type="submit">\${S.authMode==='signin'?'Ingresar':'Crear cuenta'}</button><button class="btn secondary full" type="button" id="resend-confirmation" style="margin-top:10px">Reenviar confirmación</button></form>`
    );

    source = source.replace(
      `const af=document.getElementById('auth-form');if(af)af.onsubmit=authSubmit;document.querySelectorAll('[data-view]')`,
      `const af=document.getElementById('auth-form');if(af)af.onsubmit=authSubmit;const resend=document.getElementById('resend-confirmation');if(resend)resend.onclick=resendConfirmation;document.querySelectorAll('[data-view]')`
    );

    const improvedAuth = `async function authSubmit(e){e.preventDefault();if(window.__valoraiaAuthBusy)return;const fd=new FormData(e.currentTarget),email=String(fd.get('email')||'').trim().toLowerCase(),password=fd.get('password'),msg=document.getElementById('auth-msg');msg.innerHTML='';if(S.authMode==='signup'){const last=Number(localStorage.getItem('valoraia_signup_sent_at')||0),pending=localStorage.getItem('valoraia_pending_email')||'';if(pending===email&&Date.now()-last<60000){const left=Math.ceil((60000-(Date.now()-last))/1000);msg.innerHTML='<div class="msg ok">El correo ya fue enviado. Abre solamente el mensaje más reciente. Podrás solicitar otro en '+left+' segundos.</div>';return}}window.__valoraiaAuthBusy=true;setLoading(true);try{let result;if(S.authMode==='signup'){result=await db.auth.signUp({email,password,options:{emailRedirectTo:'${redirectUrl}',data:{full_name:fd.get('full_name'),locale:'es-MX'}}})}else result=await db.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(S.authMode==='signup'&&!result.data.session){localStorage.setItem('valoraia_pending_email',email);localStorage.setItem('valoraia_signup_sent_at',String(Date.now()));msg.innerHTML='<div class="msg ok"><strong>Registro recibido.</strong> El correo ya fue enviado. No vuelvas a registrarte: abre solamente el mensaje más reciente y pulsa Confirmar. Después regresarás automáticamente a ValoraIA.</div>'}else toast('Acceso correcto')}catch(x){const code=x?.code||'';if(code==='email_not_confirmed'){localStorage.setItem('valoraia_pending_email',email);msg.innerHTML='<div class="msg error">Tu correo todavía no está confirmado. Pulsa “Reenviar confirmación” y abre solamente el enlace del correo más reciente.</div>'}else if(code==='over_email_send_rate_limit'){msg.innerHTML='<div class="msg ok">Ya existe un correo enviado. Espera un minuto antes de solicitar otro; no necesitas registrarte nuevamente.</div>'}else msg.innerHTML='<div class="msg error">'+esc(errText(x))+'</div>'}finally{window.__valoraiaAuthBusy=false;setLoading(false)}}
async function resendConfirmation(){const input=document.querySelector('#auth-form [name="email"]');const email=String(input?.value||localStorage.getItem('valoraia_pending_email')||prompt('Correo registrado:')||'').trim().toLowerCase();if(!email)return;const last=Number(localStorage.getItem('valoraia_signup_sent_at')||0),elapsed=Date.now()-last;if(elapsed<60000){toast('Espera '+Math.ceil((60000-elapsed)/1000)+' segundos antes de reenviar.',true);return}setLoading(true);try{const {error}=await db.auth.resend({type:'signup',email,options:{emailRedirectTo:'${redirectUrl}'}});if(error)throw error;localStorage.setItem('valoraia_pending_email',email);localStorage.setItem('valoraia_signup_sent_at',String(Date.now()));toast('Confirmación reenviada. Abre solamente el correo más reciente.')}catch(x){toast(errText(x),true)}finally{setLoading(false)}}
`;

    source = source.replace(
      /async function authSubmit\(e\)\{[\s\S]*?\}\nasync function createOrg\(e\)/,
      improvedAuth + 'async function createOrg(e)'
    );

    // Elimina parámetros de un enlace anterior después de conservar un mensaje claro.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error')) {
      localStorage.setItem(
        'valoraia_auth_notice',
        'El enlace anterior no es válido. Solicita uno nuevo y abre solamente el correo más reciente.'
      );
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    new Function(source)();

    const notice = localStorage.getItem('valoraia_auth_notice');
    if (notice) {
      setTimeout(() => {
        const box = document.getElementById('auth-msg');
        if (box) {
          box.innerHTML = `<div class="msg error">${notice}</div>`;
          localStorage.removeItem('valoraia_auth_notice');
        }
      }, 100);
    }
  } catch (error) {
    console.error(error);
    target.innerHTML = '<div class="fatal">No se pudo iniciar ValoraIA. Revisa el despliegue y vuelve a cargar.</div>';
  }
})();

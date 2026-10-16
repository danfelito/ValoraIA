import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('distingue PDF disponible, correo enviado y ausencia de informe',async()=>{
  const context={window:{}};vm.runInNewContext(await readFile('flow-ui.js','utf8'),context);
  const f=context.window.ValoraIAFlow;
  assert.match(f.delivery({document_status:'ready'}),/correo pendiente/);
  assert.match(f.delivery({document_status:'needs_review',payment_status:'paid'}),/aún no tiene/);
  assert.match(f.delivery({document_emailed_at:'2026-10-15'}),/registrado/);
  assert.equal(f.label('needs_configuration'),'Envío pendiente de configuración');
});
test('administración pide contraseña aunque haya una sesión previa y no consulta datos antes',async()=>{
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',classList:{add(){},remove(){}}});return elements.get(id);};
  let sessions=0,queries=0;
  const client={auth:{onAuthStateChange(){},getSession(){sessions++;return Promise.resolve({data:{session:{user:{id:'owner'}}}});}},from(){queries++;throw new Error('Consulta antes de verificar contraseña');}};
  const context={window:{VALORAIA_CONFIG:{},supabase:{createClient:()=>client}},document:{getElementById:element},location:{hash:'#requests'},Intl,console};
  vm.runInNewContext(await readFile('operaciones.js','utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('app').innerHTML,/Acceso administrativo/);
  assert.match(element('app').innerHTML,/type="password"/);
  assert.equal(sessions,0);assert.equal(queries,0);
});

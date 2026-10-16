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

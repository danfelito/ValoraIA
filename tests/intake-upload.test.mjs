import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadIntakeFiles,validateIntakeFiles} from '../upload-intake.mjs';
test('carga evidencia antes del pago y reanuda sin duplicar ni sobrescribir archivos',async()=>{
  const rows=[],objects=new Set();let uploaded=0;
  const db={from(table){let inserted=null;const query={select(){return this},eq(){return this},single:async()=>({data:{organization_id:'org-test'}}),
    insert(value){inserted=value;return this},then(resolve){if(inserted)rows.push(inserted);return Promise.resolve({data:table==='intake_documents'?rows:[],error:null}).then(resolve)}};return query;},
    storage:{from(bucket){assert.equal(bucket,'valuation-intake');return {upload:async(path,file,opts)=>{uploaded++;assert.equal(opts.upsert,false);objects.add(path);return {error:null}}}}}};
  const file=new File(['test-pdf-content'],'ficha.pdf',{type:'application/pdf'});
  const first=await uploadIntakeFiles(db,'user-test','request-test',[file]);
  assert.equal(uploaded,1);assert.equal(rows.length,1);assert.ok(first[0].startsWith('org-test/request-test/'));
  assert.equal(rows[0].uploaded_by,'user-test');
  assert.deepEqual(await uploadIntakeFiles(db,'user-test','request-test',[file]),first);assert.equal(uploaded,1);assert.equal(rows.length,1);
  await uploadIntakeFiles(db,'user-test','request-test',[new File(['different'],'ficha.pdf',{type:'application/pdf'})]);
  assert.equal(objects.size,2);assert.equal(rows.length,2);
  assert.throws(()=>validateIntakeFiles([{type:'text/html',size:10}]),/PDF/);
  assert.throws(()=>validateIntakeFiles([{type:'application/pdf',size:41*1024*1024}]),/40 MB/);
});
test('un fallo de carga detiene la preparación y no crea una fila que acredite evidencia',async()=>{
  let inserted=false;
  const db={from(){return {select(){return this},eq(){return this},single:async()=>({data:{organization_id:'org-test'}}),
    insert(){inserted=true;return Promise.resolve({data:null})},then(resolve){return Promise.resolve({data:[]}).then(resolve)}}},
    storage:{from(){return {upload:async()=>({error:{message:'Storage no disponible',statusCode:503}})}}}};
  await assert.rejects(uploadIntakeFiles(db,'user-test','request-test',[new File(['x'],'x.pdf',{type:'application/pdf'})]),/Storage no disponible/);
  assert.equal(inserted,false);
});

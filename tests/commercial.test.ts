import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { numberValue, resolveSubject, selectComparables, marketStatistics, validatePageCoverage, contextualReferences, documentCandidates } from "../supabase/functions/_shared/commercial-core.ts";
import { processSourceStep, validEvidence } from "../supabase/functions/_shared/commercial-evidence.ts";
import type { Row } from "../supabase/functions/_shared/commercial-core.ts";

const property = {address_line:"Ejemplo 99",land_area_m2:120,built_area_m2:100,bedrooms:2,bathrooms:2,parking_spaces:1,construction_year:2020,conservation_state:"Bueno"};
const request = {id:"request-test",organization_id:"org-test",case_id:"case-test",created_by:"user-test",property_type:"casa",client_name:"Demostración con datos simulados",client_email:"test@example.com",service_type:"commercial",payment_status:"paid",document_status:"queued",
  intake_data:{asking_price:2150000},valuation_cases:{id:"case-test",organization_id:"org-test",folio:"DEMO - DATOS SIMULADOS",municipality:"Boca del Río",region:"Veracruz",locality:"Colonia de prueba",currency_code:"MXN"}};
const subject = resolveSubject(property,request,[]);
const comparable = (i:number,extra:Row={}) => ({title:"Referencia simulada "+i,price:[1800000,2100000,2420000][i-1]||2400000,price_basis:"total",currency:"MXN",operation_type:"offer",
  property_type:"casa",address_line:"Ejemplo "+i,locality:"Colonia de prueba",municipality:"Boca del Río",region:"Veracruz",
  land_area_m2:120,built_area_m2:[90,100,110][i-1]||115,bedrooms:2,bathrooms:2,parking_spaces:1,construction_year:2020,conservation_state:"Bueno",
  origin:"web",source:"Fuente simulada",url:"https://example.com/c"+i,date:"2026-10-07",price_evidence:"Precio publicado en ficha de prueba",area_evidence:"Superficie construida en ficha de prueba",...extra});
const urls = [1,2,3,4,5,6].map(i=>"https://example.com/c"+i);

test("normaliza números mexicanos y decimales sin convertir null a cero",()=>{
  assert.equal(numberValue("512,40"),512.4);
  assert.equal(numberValue("2,650,000"),2650000);
  assert.equal(numberValue("1.234,56"),1234.56);
  assert.equal(numberValue(null),null);
  assert.equal(numberValue("desconocido"),null);
});
test("bloquea conflictos de superficie y admite una decisión documentada",()=>{
  const docs=[{kind:"intake",title:"Plano.pdf",evidence:{facts:[{field_key:"built_area_m2",scope:"subject",value:140,unit:"m2",confidence:.99,page_number:1,evidence:"Área construida 140 m2"}]}}];
  assert.throws(()=>resolveSubject(property,request,docs),/discrepancias/);
  assert.equal(resolveSubject(property,request,docs,[{field_key:"built_area_m2",value:140,justification:"Medición contrastada con plano"}]).area,140);
  assert.throws(()=>resolveSubject({...property,built_area_m2:null},request,[]),/no se sustituirá/);
});
test("exige cobertura de todas las páginas y evidencia localizada",()=>{
  assert.throws(()=>validatePageCoverage({pages:[{page_number:1,readable:true}],facts:[],price_references:[]},[1,2]),/todas las páginas/);
  assert.throws(()=>validatePageCoverage({pages:[{page_number:1,readable:false}],facts:[],price_references:[]},[1]),/ilegibles/);
  assert.throws(()=>validatePageCoverage({pages:[{page_number:1,readable:true}],facts:[{page_number:4,evidence:"dato"}],price_references:[]},[1]),/sin evidencia/);
});
test("excluye renta, propia propiedad, otra ciudad, superficie incompatible y URL sin fuente",()=>{
  const inputs=[comparable(1),comparable(2),comparable(3),comparable(4,{operation_type:"rent"}),comparable(5,{municipality:"Alvarado"}),comparable(6,{url:"https://example.com/unknown"}),comparable(7,{is_subject:true}),comparable(8,{built_area_m2:null})];
  const selected=selectComparables(subject,inputs,urls,"2026-10-07");
  assert.equal(selected.included.length,3);
  assert.equal(selected.excluded.length,5);
});
test("elimina anuncios duplicados entre portales",()=>{
  const selected=selectComparables(subject,[comparable(1),comparable(2),comparable(3),comparable(4,{url:"https://example.com/c1?utm_source=test"})],urls,"2026-10-07");
  assert.equal(selected.included.length,3);
  assert.match(selected.excluded[0].exclusion_reason,/duplicado|anuncio/);
});
test("integra ofertas de PDF fechadas; costos y suelo quedan como contexto",()=>{
  const doc={id:"pdf-test",title:"Precios.pdf",kind:"knowledge",evidence:{content_hash:"hash",price_references:[
    {...comparable(3),source_id:"pdf-test",page_number:1,evidence:"Venta $2,420,000, construcción 110 m2",confidence:.99,origin:"pdf"},
    {...comparable(4),operation_type:"construction_cost",price_basis:"m2_built",price:17000,region:"Ciudad de México",municipality:"Ciudad de México",page_number:2,evidence:"Costo de construcción 17000 por m2",confidence:.99},
    {...comparable(5),property_type:"terreno",operation_type:"land_reference",price_basis:"m2_land",price:null,price_low:18000,price_high:25000,page_number:3,evidence:"Rango de suelo",confidence:.99},
  ]}};
  const selected=selectComparables(subject,[comparable(1),comparable(2),...documentCandidates([doc])],urls,"2026-10-07");
  assert.equal(selected.included.length,3);
  assert.equal(selected.included[2].origin,"pdf");
  const stats=marketStatistics(selected.included,subject);
  assert.equal(stats.estimated,2100000);
  assert.equal(stats.mean_unit,21000);
  assert.equal(stats.low,2000000);assert.equal(stats.high,2200000);
  assert.equal(contextualReferences(subject,[doc]).length,3);
});
test("no emite cifra si la muestra es insuficiente o dispersa",()=>{
  assert.throws(()=>marketStatistics([{adjusted_unit:20000,price:1}],subject),/tres comparables/);
  assert.throws(()=>marketStatistics([1,2,100].map(n=>({adjusted_unit:n,price:n})),subject),/dispersión/);
});

class Query {
  db: any; table: string; mode="select"; filters:Array<(row:Row)=>boolean>=[]; values:any; singleMode=false; optional=false;
  constructor(db:any,table:string){this.db=db;this.table=table;}
  select(){return this;}
  eq(key:string,value:any){this.filters.push(row=>row[key]===value);return this;}
  neq(key:string,value:any){this.filters.push(row=>row[key]!==value);return this;}
  in(key:string,values:any[]){this.filters.push(row=>values.includes(row[key]));return this;}
  order(){return this;}
  single(){this.singleMode=true;return this;}
  maybeSingle(){this.singleMode=true;this.optional=true;return this;}
  update(values:any){this.mode="update";this.values=values;return this;}
  upsert(values:any){this.mode="upsert";this.values=values;return this;}
  insert(values:any){this.mode="insert";this.values=values;return this;}
  then(resolve:any,reject:any){return Promise.resolve().then(()=>{
    const rows=this.db.tables[this.table] ||= [];
    const matches=rows.filter((row:Row)=>this.filters.every(fn=>fn(row)));
    if(this.mode==="update")matches.forEach((row:Row)=>Object.assign(row,this.values));
    if(this.mode==="upsert"){
      const key=this.values.request_id?"request_id":this.values.case_id?"case_id":"id";
      const existing=rows.find((r:Row)=>r[key]===this.values[key]);
      if(existing)Object.assign(existing,this.values);else rows.push(structuredClone(this.values));
    } else if(this.mode==="insert")rows.push(structuredClone(this.values));
    const data=this.singleMode?(matches[0]||null):matches;
    return {data,error:this.singleMode&&!data&&!this.optional?{message:"Sin fila"}:null};
  }).then(resolve,reject);}
}
function fakeDb(tables:Row,files:Map<string,Uint8Array>) {
  return {tables,auth:{getUser:async()=>({data:{user:{id:"user-test"}},error:null})},
    from(table:string){return new Query(this,table);},
    storage:{from(bucket:string){return {
      download:async(path:string)=>({data:new Blob([files.get(bucket+"/"+path)!]),error:null}),
      createSignedUrl:async(path:string)=>({data:{signedUrl:"https://example.com/private-preview"},error:null}),
      upload:async(path:string,bytes:Uint8Array)=>{files.set(bucket+"/"+path,bytes);return {data:{path},error:null};}
    };}}
  };
}
async function inputPdf(pages:number) {
  const pdf=await PDFDocument.create();for(let i=0;i<pages;i++)pdf.addPage();
  return pdf.save();
}
const config={secret:"test-secret",apiKey:"test-key",model:"test-model"};
function extraction(prompt:string,cost=false):Row {
  const list=prompt.match(/Páginas ORIGINALES[^:]*:\s*([^.]*)\./)![1].split(",").map(Number);
  return {summary:"Documento simulado de prueba",warnings:[],valuation_guidance:[],
    pages:list.map(page_number=>({page_number,readable:true,summary:"Página de prueba"})),
    facts:cost?[]:[{field_key:"built_area_m2",scope:"subject",value:100,unit:"m2",page_number:list[0],confidence:.99,evidence:"Construcción 100 m2"}],
    price_references:cost?[{title:"Modelo simulado de costo",property_type:"casa",operation_type:"construction_cost",price:17000,price_basis:"m2_built",currency:"MXN",date:"2026-04-01",region:"Ciudad de México",municipality:"Ciudad de México",locality:null,page_number:list[0],confidence:.99,evidence:"Costo de construcción 17000 por m2"}]:[]};
}
test("procesa todos los bloques, verifica firma y reutiliza extracción sin repetir IA",async()=>{
  const bytes=await inputPdf(6),files=new Map([["valuation-intake/org-test/request-test/file.pdf",bytes]]);
  const source={id:"source-test",organization_id:"org-test",title:"Plano.pdf",file_name:"Plano.pdf",mime_type:"application/pdf",kind:"intake",bucket:"valuation-intake",request_id:"request-test",storage_path:"org-test/request-test/file.pdf",analysis:{}};
  const db=fakeDb({intake_documents:[source]},files);
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url:any,options:any)=>{
    calls++;const body=JSON.parse(options.body);const analysis=extraction(body.input[0].content[0].text);
    return Response.json({status:"completed",output_text:JSON.stringify(analysis)});
  };
  try {
    const first=await processSourceStep(db,source,config);
    assert.equal(first.evidence.completed_pages,4);assert.equal(first.evidence.complete,false);
    const second=await processSourceStep(db,source,config);
    assert.equal(second.evidence.completed_pages,6);assert.equal(second.evidence.complete,true);
    await processSourceStep(db,source,config);assert.equal(calls,2);
    assert.equal(await validEvidence(second.evidence,"org-test","test-secret"),true);
    assert.equal(await validEvidence({...second.evidence,summary:"Manipulado"},"org-test","test-secret"),false);
  } finally {globalThis.fetch=original;}
});

test("flujo integrado: documentos, consulta web, PDF y descarga sin mezclar costos",async()=>{
  const files=new Map<string,Uint8Array>([["valuation-intake/org-test/request-test/intake.pdf",await inputPdf(2)],["valuation-knowledge/org-test/cost.pdf",await inputPdf(1)]]);
  const rows:Row={
    service_requests:[structuredClone(request)],properties:[{...property,case_id:"case-test"}],
    valuation_cases:[{id:"case-test",...request.valuation_cases,status:"draft"}],commercial_reports:[],adopted_values:[],data_conflicts:[],market_comparables:[],valuation_calculations:[],
    intake_documents:[{id:"doc-intake",organization_id:"org-test",request_id:"request-test",file_name:"Plano de prueba.pdf",mime_type:"application/pdf",storage_path:"org-test/request-test/intake.pdf",analysis:{}}],
    documents:[],knowledge_sources:[{id:"doc-knowledge",organization_id:"org-test",title:"Costos simulados.pdf",file_name:"Costos simulados.pdf",source_type:"pdf",category:"mercado",mime_type:"application/pdf",storage_path:"org-test/cost.pdf",analysis:{},status:"pending"}],
  };
  (globalThis as any).__fakeDB=fakeDb(rows,files);
  const originalFetch=globalThis.fetch;const jobs:Promise<any>[]=[];let handler:any;let searches=0,extractions=0;
  (globalThis as any).Deno={env:{get:(name:string)=>({SUPABASE_URL:"https://project.example.com",SUPABASE_SERVICE_ROLE_KEY:"test-secret",SUPABASE_ANON_KEY:"test-anon",OPENAI_API_KEY:"test-key"} as Row)[name]},serve:(fn:any)=>handler=fn};
  (globalThis as any).EdgeRuntime={waitUntil:(job:Promise<any>)=>jobs.push(job)};
  globalThis.fetch=async(url:any,options:any)=>{
    if(String(url).includes("/functions/v1/generate-commercial-report"))return handler(new Request(String(url),options));
    const body=JSON.parse(options.body);
    if(typeof body.input==="string"&&body.input.startsWith("REVISIÓN DE FICHA:"))return Response.json({status:"completed",output_text:JSON.stringify({observations:["Datos simulados contrastados con la ficha"],missing_information:["Visita física pendiente"],documentary_contrasts:[],declared_features:[]})});
    if(body.tools?.[0]?.type==="web_search"){
      searches++;return Response.json({id:"response-test",status:"completed",output_text:JSON.stringify({comparables:[1,2,3].map(i=>comparable(i))}),output:[{type:"web_search_call",action:{sources:urls.map(url=>({url}))}}]});
    }
    extractions++;const prompt=body.input[0].content[0].text;
    return Response.json({status:"completed",output_text:JSON.stringify(extraction(prompt,prompt.includes("Costos simulados")))});
  };
  try {
    await import("../supabase/functions/generate-commercial-report/index.ts");
    assert.equal((await handler(new Request("https://project.example.com/run",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"request_id":"request-test"}'}))).status,401);
    rows.service_requests.push({...request,id:"professional-test",service_type:"professional"});
    assert.equal((await handler(new Request("https://project.example.com/run",{method:"POST",headers:{Authorization:"Bearer test-secret","Content-Type":"application/json"},body:'{"request_id":"professional-test"}'}))).status,409);
    const savedOrg=rows.service_requests[0].valuation_cases.organization_id;
    rows.service_requests[0].valuation_cases.organization_id="different-org";
    assert.equal((await handler(new Request("https://project.example.com/run",{method:"POST",headers:{Authorization:"Bearer test-secret","Content-Type":"application/json"},body:'{"request_id":"request-test"}'}))).status,409);
    rows.service_requests[0].valuation_cases.organization_id=savedOrg;
    const response=await handler(new Request("https://project.example.com/run",{method:"POST",headers:{Authorization:"Bearer test-secret","Content-Type":"application/json"},body:'{"request_id":"request-test"}'}));
    assert.equal(response.status,202);
    for(let i=0;i<jobs.length;i++)await jobs[i];
    assert.equal(searches,1);assert.equal(extractions,2);
    assert.equal(rows.service_requests[0].document_status,"ready");
    const report=rows.commercial_reports[0];
    assert.equal(report.estimated_value,2100000);
    assert.equal(report.report_data.documents.length,2);
    assert.equal(report.report_data.contextual_references[0].operation_type,"construction_cost");
    const output=files.get("valuation-documents/"+report.pdf_storage_path)!;
    const pdf=await PDFDocument.load(output);assert.ok(pdf.getPageCount()>=6);
    await mkdir("tmp",{recursive:true});
    await writeFile("tmp/report-preview.json",JSON.stringify({...report.report_data,documents:[
      {id:"doc-intake",kind:"intake",title:"Plano de prueba.pdf",evidence:{page_count:2,completed_pages:2,facts:[{}],price_references:[]}},
      {id:"doc-knowledge",kind:"knowledge",title:"Costos simulados.pdf",category:"mercado",evidence:{page_count:1,completed_pages:1,facts:[],price_references:[{}]}},
    ],demo:true},null,2));
  } finally {globalThis.fetch=originalFetch;delete (globalThis as any).Deno;delete (globalThis as any).EdgeRuntime;}
});


test("la vista previa exige rol y no cobra, envía correos ni altera el avalúo profesional",async()=>{
  const caseRow={...request.valuation_cases,id:"case-test",organization_id:"org-test",created_by:"user-test",property_type:"casa",service_type:"professional",status:"draft"};
  const rows:Row={service_requests:[{...structuredClone(request),valuation_cases:caseRow,service_type:"professional",payment_status:"not_required",document_status:"not_started"}],
    valuation_cases:[caseRow],properties:[{...property,case_id:"case-test"}],adopted_values:[],data_conflicts:[],market_comparables:[],
    organization_members:[{organization_id:"org-test",user_id:"user-test",role:"assistant",status:"active"}],intake_documents:[],documents:[],knowledge_sources:[],
    valuation_report_previews:[],valuation_calculations:[{case_id:"case-test",final_value:999,status:"approved"}]};
  const files=new Map<string,Uint8Array>();(globalThis as any).__fakeDB=fakeDb(rows,files);
  const original=globalThis.fetch,jobs:Promise<any>[]=[];let handler:any,mail=0;
  (globalThis as any).Deno={env:{get:(n:string)=>({SUPABASE_URL:"https://project.example.com",SUPABASE_SERVICE_ROLE_KEY:"test-secret",SUPABASE_ANON_KEY:"test-anon",OPENAI_API_KEY:"test-key",RESEND_API_KEY:"mail-test",VALORAIA_FROM_EMAIL:"test@example.com"} as Row)[n]},serve:(fn:any)=>handler=fn};
  (globalThis as any).EdgeRuntime={waitUntil:(job:Promise<any>)=>jobs.push(job)};
  globalThis.fetch=async(url:any,options:any)=>{
    if(String(url).includes("/functions/v1/generate-valuation-preview"))return handler(new Request(String(url),options));
    if(String(url).includes("resend.com")){mail++;return Response.json({id:"bad-mail"});}
    if(String(JSON.parse(options.body).input).startsWith("REVISIÓN DE FICHA:"))return Response.json({status:"completed",output_text:JSON.stringify({observations:[],missing_information:[],documentary_contrasts:[],declared_features:[]})});
    return Response.json({id:"test-search",status:"completed",output_text:JSON.stringify({comparables:[1,2,3].map(i=>comparable(i)),survey:[{channel:"facebook",status:"access_limited",reason:"Ejemplo simulado: sin acceso verificable",urls:[]}]}),output:[{type:"web_search_call",action:{sources:urls.map(url=>({url}))}}]});
  };
  try{
    await import("../supabase/functions/generate-valuation-preview/index.ts");
    const req=(body:Row,auth=true)=>new Request("https://project.example.com/preview",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer test-user"}:{})},body:JSON.stringify(body)});
    assert.equal((await handler(req({case_id:"case-test"},false))).status,401);
    assert.equal((await handler(req({case_id:"case-test"}))).status,403);
    rows.organization_members[0].role="owner";
    assert.equal((await handler(req({case_id:"case-test"}))).status,202);
    for(let i=0;i<jobs.length;i++)await jobs[i];
    const preview=rows.valuation_report_previews[0];assert.equal(preview.status,"generated");
    assert.equal(rows.service_requests[0].payment_status,"not_required");assert.equal(rows.service_requests[0].document_status,"not_started");
    assert.equal(rows.valuation_cases[0].status,"draft");assert.equal(rows.valuation_calculations[0].final_value,999);assert.equal(mail,0);
    const state=await (await handler(req({case_id:"case-test",action:"status"}))).json();
    assert.equal(state.outdated,false);assert.ok(state.download_url);
    rows.properties[0].notes="Acabados actualizados por el cliente";
    assert.equal((await (await handler(req({case_id:"case-test",action:"status"}))).json()).outdated,true);
    const pdf=await PDFDocument.load(files.get("valuation-documents/"+preview.pdf_storage_path)!);assert.ok(pdf.getPageCount()>=6);
  }finally{globalThis.fetch=original;delete (globalThis as any).Deno;delete (globalThis as any).EdgeRuntime;}
});

test("la consulta temporal de producción no procesa documentos ni permite generar sin activación",async()=>{
  const rows:Row={valuation_cases:[request.valuation_cases],service_requests:[structuredClone(request)],commercial_reports:[],valuation_report_previews:[],
    organization_members:[{organization_id:"org-test",user_id:"user-test",role:"owner",status:"active"}]};
  (globalThis as any).__fakeDB=fakeDb(rows,new Map());
  let handler:any;const original=globalThis.fetch;
  (globalThis as any).Deno={env:{get:(n:string)=>({SUPABASE_URL:"https://project.example.com",SUPABASE_SERVICE_ROLE_KEY:"test-secret",SUPABASE_ANON_KEY:"test-anon"} as Row)[n]},serve:(fn:any)=>handler=fn};
  globalThis.fetch=async()=>{throw new Error("La consulta privada no debe llamar a ningún servicio externo");};
  try {
    await import("../supabase/functions/generate-valuation-preview/read-only.ts");
    const req=(body:Row,auth=true)=>new Request("https://project.example.com/preview",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer test-user"}:{})},body:JSON.stringify(body)});
    assert.equal((await handler(req({case_id:"case-test",action:"status"},false))).status,401);
    const before=JSON.stringify(rows);
    assert.equal((await handler(req({case_id:"case-test",force:true}))).status,428);
    const status=await (await handler(req({case_id:"case-test",action:"status"}))).json();
    assert.equal(status.analysis_enabled,false);assert.equal(status.download_url,null);
    assert.equal(JSON.stringify(rows),before);
    rows.organization_members[0].role="assistant";
    assert.equal((await handler(req({case_id:"case-test",action:"status"}))).status,403);
  } finally {globalThis.fetch=original;delete (globalThis as any).Deno;}
});

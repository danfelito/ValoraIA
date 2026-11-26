import { rgb } from "npm:pdf-lib@1.17.1";
import { Report, C, M, CW, clean, money, num, loadBrand } from "./report-design.ts";
import { check } from "./report-inputs.ts";
import { REPORT_VERSION } from "./commercial-core.ts";
import { validEvidence } from "./commercial-evidence.ts";
import type { Row } from "./commercial-core.ts";

export function reviewReason(message:string,stage:string) {
  if (/tres comparables|dispersión|superficie|discrepancias|conflictos documentales/.test(message)) return message;
  return `No se completó la etapa de ${stage === 'market'?'consulta de mercado':stage === 'subject'?'contraste del inmueble':'lectura y análisis'}. El expediente requiere seguimiento; no se emite una cifra sin sustento.`;
}

// A paid commercial request always has a downloadable deliverable, even if an
// external analysis fails. Unknown values stay null, never zero or asking price.
// Diseño con marca: portada, resumen, gráficas del mercado, faltantes y siguientes pasos.
const TYPE_LABEL:Row={casa:'Casa',departamento:'Departamento',terreno:'Terreno',local_comercial:'Local comercial',bodega:'Bodega',oficina:'Oficina',rancho:'Rancho / finca',industrial:'Industrial',otro:'Inmueble'};
const has=(v:unknown)=>v!==null&&v!==undefined&&v!=='';
const fmt=(v:unknown,unit='')=>has(v)?`${typeof v==='number'?num(v):v}${unit}`:'No indicado';
export async function deliverablePdf(data:Row,brand:Row={}):Promise<Uint8Array> {
  const s=data.subject||{}, received=data.outcome==='received', insufficient=data.outcome==='insufficient_evidence';
  const type=TYPE_LABEL[s.property_type]||s.property_type||'Inmueble', place=[s.locality,s.municipality,s.region].filter(Boolean).join(', ');
  const landBasis=['terreno','rancho'].includes(s.property_type)||(['bodega','industrial'].includes(s.property_type)&&s.area_basis==='land');
  const basisLabel=landBasis?'terreno':'construcción', currency=s.currency||'MXN';
  const r=await Report.create({folio:data.folio,title:received?'Seguimiento de solicitud':'Informe de análisis de mercado',subtitle:'Opinión de valor comercial',
    footerNote:received?'Documento de seguimiento: todavía no contiene una estimación de valor.':'Informe orientativo sin cifra de valor. No sustituye un avalúo profesional firmado.'},brand);
  const badge=received?'EN PROCESO · ANÁLISIS EN CURSO':insufficient?'RESULTADO: VALOR NO DETERMINADO · EVIDENCIA INSUFICIENTE':'RESULTADO: ANÁLISIS INCOMPLETO · EN SEGUIMIENTO';
  r.cover({title:received?'Seguimiento de tu opinión de valor comercial':'Informe de análisis de mercado',
    subtitle:received?'Recibimos tu solicitud y la estamos analizando. Este documento resume lo registrado.':`Opinión de valor comercial · ${type} en ${place||'ubicación no indicada'}`,
    badge,badgeColor:received?C.amber:C.red,property:`${type}${s.property_subtype?' '+s.property_subtype:''}`,location:[s.address_line,place].filter(Boolean).join(' · '),
    facts:[[fmt(s.built_area_m2,' m²'),'Construcción'],[fmt(s.land_area_m2,' m²'),'Terreno'],[fmt(s.bedrooms),'Recámaras'],[fmt(s.bathrooms),'Baños'],[fmt(s.parking_spaces),'Estacionamientos']],
    details:[['Folio',data.folio],['Fecha de emisión',data.generated_date],['Solicitante',data.client||'No indicado'],['Servicio','Opinión de valor comercial'],['Elaborado por','ValoraIA · Círculo Internacional Bienes Raíces']]});

  // ---- datos del mercado (anuncios web y registrados) ----
  const unitOf=(c:Row)=>{const a=Number(landBasis?c.land_area_m2:(c.area??c.built_area_m2));return Number(c.price)>0&&a>0?Number(c.price)/a:null;};
  const listings=[...(data.comparables||[]).map((c:Row)=>({...c,admitted:true})),...(data.excluded||[]).filter((e:Row)=>e.origin!=='pdf').map((e:Row)=>({...e,admitted:false}))]
    .map((c:Row)=>({...c,unit:unitOf(c)})).filter((c:Row)=>c.unit);
  const summary=data.excluded_summary||{}, sources=data.market_observation?.sources||[], survey=data.market_observation?.survey||[];
  const docs=(data.documents||[]), library=docs.filter((d:Row)=>d.kind==='knowledge'), clientDocs=docs.filter((d:Row)=>d.kind!=='knowledge');
  const needed=3, admitted=(data.comparables||[]).length;

  // ---- 1. resumen ejecutivo ----
  r.newPage('Resumen ejecutivo');
  r.h1(received?'Tu solicitud está en proceso':'Resumen ejecutivo','Lo más importante');
  if(received) r.callout('Pago confirmado. El análisis continúa.','Registramos la ficha del inmueble y la evidencia recibida. Estamos leyendo los documentos y consultando anuncios públicos de la zona. Cuando termine recibirás por correo el informe con el resultado; este archivo será sustituido por la versión final.','amber');
  else if(insufficient) r.callout('Con la evidencia disponible no es responsable emitir una cifra de valor.',`Encontramos ${listings.length} anuncio${listings.length===1?'':'s'} de inmuebles parecidos en la zona, pero solo ${admitted} cumple${admitted===1?'':'n'} todos los criterios de comparación; el método exige al menos ${needed}. En lugar de inventar un valor, este informe te muestra lo que encontramos, por qué se descartó y qué falta para concluir.`,'red');
  else r.callout('El análisis no pudo completarse.',`${data.reason||''} El expediente quedó en seguimiento y nuestro equipo lo revisará contigo. No se emite una cifra sin sustento.`,'amber');
  if(!received) r.kpis([
    {value:num(sources.length),label:'Fuentes públicas consultadas',note:'Portales, sitios y redes',tone:'ink'},
    {value:String(listings.length),label:'Anuncios con precio y superficie',note:'Mismo tipo y zona',tone:'ink'},
    {value:`${admitted} de ${needed}`,label:'Comparables válidos',note:'Mínimo para calcular',tone:admitted>=needed?'green':'red'},
    {value:num(summary.documentary||0),label:'Datos técnicos revisados',note:'Catálogos y guías',tone:'ink'}]);
  r.h2('Cómo llegamos a este resultado');
  r.steps([
    {title:'Ficha',text:'Datos capturados del inmueble y del solicitante',state:'done'},
    {title:'Documentos',text:`${clientDocs.length} archivo(s) del cliente y ${library.length} guía(s) técnicas`,state:received?'stop':'done'},
    {title:'Mercado',text:'Búsqueda de anuncios públicos actuales de la zona',state:received?'todo':'done'},
    {title:'Filtros',text:'Mismo tipo, zona, superficie ±30% y características',state:received?'todo':insufficient?'stop':'done'},
    {title:'Valor',text:insufficient?`Se requieren ${needed} comparables; hay ${admitted}`:'Mediana del precio por m² de la muestra',state:received?'todo':insufficient?'todo':'stop'}]);
  r.h2('Cómo leer este informe');
  r.para('Una opinión de valor comercial compara tu inmueble con otros parecidos que están en venta en la misma zona. Cada referencia debe tener precio, superficie y características verificables; se descartan las que no se parecen lo suficiente o no se pueden comprobar. Con al menos tres referencias válidas se calcula el precio por metro cuadrado y se aplica a la superficie de tu inmueble. Las siguientes páginas muestran cada paso con gráficas y explicaciones.',{size:9.4});

  // ---- 2. el inmueble ----
  r.newPage('El inmueble');
  r.h1('Ficha del inmueble','Lo que nos compartiste');
  r.table(['Dato','Valor declarado','Dato','Valor declarado'],[110,150,110,150],[
    ['Tipo',`${type}${s.property_subtype?' · '+s.property_subtype:''}`,'Ubicación',place||'No indicada'],
    ['Construcción',fmt(s.built_area_m2,' m²'),'Terreno',fmt(s.land_area_m2,' m²')],
    ['Recámaras',fmt(s.bedrooms),'Baños',fmt(s.bathrooms)],
    ['Estacionamientos',fmt(s.parking_spaces),'Año de construcción',has(s.construction_year)?String(s.construction_year):'No indicado'],
    ['Conservación',fmt(s.conservation_state),'Código postal',fmt(s.postal_code)],
    ['Base de comparación',`Precio por m² de ${basisLabel}`,'Precio solicitado',has(s.asking_price)?money(Number(s.asking_price),currency):'No indicado']]);
  if(s.property_notes){r.h2('Descripción proporcionada');r.callout('En palabras del solicitante',String(s.property_notes),'neutral');}
  if(data.subject_review?.observations?.length){r.h2('Lo que observamos al revisar la información');r.bullets(data.subject_review.observations.slice(0,6),{size:8.9});}

  // ---- 3. mercado ----
  if(!received){
    r.newPage('Mercado');
    r.h1('Lo que encontramos en el mercado','Comparación con inmuebles en venta');
    r.funnel([
      {value:num(sources.length),label:'Fuentes consultadas',note:'Portales inmobiliarios, sitios de agencias y redes públicas'},
      {value:String(listings.length),label:'Anuncios con precio y superficie',note:`${type.toLowerCase()} en ${s.locality||s.municipality||'la zona'}, superficie parecida`},
      {value:String(admitted),label:'Cumplen todos los criterios',note:'Tipo, zona, superficie ±30%, recámaras, baños, antigüedad y conservación'},
      {value:String(needed),label:'Mínimo requerido para calcular',note:'Con menos, la cifra no sería estadísticamente defendible',color:C.redDark}]);
    if(listings.length){
      r.h2(`Precio por m² de ${basisLabel} de cada anuncio`);
      const units=listings.map((c:Row)=>c.unit), avg=units.reduce((a:number,b:number)=>a+b,0)/units.length;
      r.hbars(listings.sort((a:Row,b:Row)=>b.unit-a.unit).map((c:Row)=>({label:clean(String(c.source||c.title||'Anuncio')).slice(0,30),sub:c.admitted?'Cumple los criterios':'Descartado: '+String(c.exclusion_reason||'otro motivo').split(';')[0].toLowerCase().slice(0,40),
        value:c.unit,display:money(c.unit,currency),color:c.admitted?C.red:rgb(0.72,0.72,0.75)})),{labelWidth:165,refValue:avg,refLabel:'Promedio observado'});
      r.para(`Rojo: anuncios que cumplen los criterios. Gris: anuncios descartados, con el motivo debajo de su nombre. La línea punteada marca el promedio de todos los anuncios (${money(avg,currency)}/m²). Es una lectura del mercado, no una opinión de valor: los anuncios son precios de oferta, no de cierre, y los descartados tienen diferencias que habría que justificar antes de usarlos.`,{size:8.4,color:C.muted});
      r.h2('Detalle de los anuncios');
      r.table(['Fuente','Precio publicado','Construcción','Terreno','Precio / m²','Resultado'],[120,80,66,58,74,122],
        listings.map((c:Row)=>[c.source||c.title||'Anuncio',money(Number(c.price),currency),fmt(c.built_area_m2??c.area,' m²'),fmt(c.land_area_m2,' m²'),money(c.unit,currency),c.admitted?'Cumple los criterios':'Descartado: '+String(c.exclusion_reason||'otro motivo').split(';')[0].toLowerCase()]),
        {size:7.8,alignRight:[1,4]});
    }
    if(summary.documentary) r.callout(`También revisamos ${num(summary.documentary)} datos de precios en guías y catálogos técnicos`,'Son costos de construcción, rentas, valores fiscales y rangos por zona. Sirven como contexto, pero no son ventas de inmuebles comparables, por eso no se promedian con los anuncios.','neutral');
    if(survey.length){
      r.h2('Sondeo por canal');
      for(const v of survey){
        const tone=v.status==='references_found'?'green':v.status==='access_limited'?'amber':'neutral';
        const label=v.status==='references_found'?'Referencias encontradas':v.status==='access_limited'?'Acceso limitado':'Sin referencias verificables';
        r.ensure(40); const w=r.pill(label,M+92,r.y-12,tone); r.textAt(String(v.channel).replace(/^\w/,(m:string)=>m.toUpperCase()),M,r.y-12,{bold:true,size:9.5});
        r.y-=22; r.para(v.reason||'',{size:8.3,x:M,width:CW,color:C.body,after:8});
      }
    }
  }

  // ---- 4. qué falta ----
  const missing=data.subject_review?.missing_information||[];
  r.newPage('Siguientes pasos');
  r.h1(received?'Qué sigue':'Qué falta para obtener un valor','Siguientes pasos');
  if(!received) r.cards([
    {title:'Más referencias de la zona',text:insufficient?`Faltan ${Math.max(needed-admitted,1)} comparable(s) válido(s). Si conoces ventas o anuncios recientes de inmuebles parecidos, compártelos para incluirlos.`:'Repetiremos la consulta del mercado para completar la muestra.'},
    {title:'Confirmar el estado del inmueble',text:'Fotografías actuales, fecha de las remodelaciones y acabados permiten comparar con anuncios que hoy se descartan por conservación distinta.'},
    {title:'Avalúo con perito',text:'Si necesitas una cifra para crédito, juicio o trámite, un perito valuador puede inspeccionar el inmueble y emitir un avalúo firmado.'}]);
  if(missing.length){r.h2('Información que conviene reunir');r.checklist(missing.slice(0,10));}
  if(!received){
    r.h2('Cómo se trabaja la opinión de valor');
    r.bullets([
      'Se toma la ficha del inmueble y se contrasta con los documentos aportados. Las declaraciones sin respaldo se señalan como tales.',
      `Se buscan anuncios públicos actuales del mismo tipo de inmueble en ${place||'la zona'}, con precio y superficie visibles. Un mismo inmueble publicado en varios portales cuenta una sola vez.`,
      `Se descartan los que difieren en más de 30% de superficie, en más de una recámara, baño o estacionamiento, en más de 15 años de antigüedad o en estado de conservación sin una homologación justificada.`,
      `Con al menos ${needed} comparables válidos se calcula la mediana del precio por m² de ${basisLabel} y se multiplica por la superficie del inmueble. El rango muestra la dispersión de la muestra.`,
      'Las guías de costos, valores catastrales y rentas se conservan como contexto técnico y no sustituyen a los comparables de mercado.'],{size:8.8});
    r.h2('Fuentes consultadas');
    r.para(`Se registraron ${num(sources.length)} enlaces públicos consultados durante la búsqueda. Estos son algunos de ellos:`,{size:8.6});
    for(const u of sources.slice(0,10)) r.para(String(u).replace(/^https?:\/\//,'').slice(0,105),{size:7.2,color:C.muted,after:1});
    if(sources.length>10) r.para(`Y ${sources.length-10} enlaces más, conservados en el expediente.`,{size:7.6,color:C.muted});
    if(library.length){r.h2('Biblioteca técnica considerada');r.table(['Documento','Páginas','Uso en el análisis'],[260,50,210],library.slice(0,8).map((d:Row)=>[d.title,fmt(d.evidence?.page_count),'Contexto técnico y metodológico; no son ventas comparables']),{size:7.6});}
  }
  r.callout('Alcance de este documento','Este informe es una lectura orientativa del mercado preparada por ValoraIA, la plataforma de análisis de Círculo Internacional Bienes Raíces. No asigna un valor de cero ni usa el precio anunciado como estimación, y no constituye un avalúo firmado, fiscal, hipotecario ni judicial. Para aclaraciones o una revisión, escríbenos a contacto@circulointernacionalveracruz.org o al 229 135 8056.','neutral');
  return r.save();
}

export async function saveDeliverable(admin:any,request:Row,config:Row,runId:string,snapshot:Row,previous:Row,reason:string,outcome:string) {
  const p=snapshot.property||{},intake=request.intake_data||{},c=request.valuation_cases||{};
  const documents=await Promise.all(snapshot.sources.map(async(s:Row)=>{const e=(s.kind==='case'?s.metadata:s.analysis)?.commercial_evidence;return {id:s.id,title:s.title,kind:s.kind,evidence:await validEvidence(e,request.organization_id,config.secret)?e:null};}));
  const subject={...intake,...p,property_type:request.property_type,locality:c.locality||intake.locality,municipality:c.municipality||intake.municipality,region:c.region||intake.region,area_basis:intake.comparison_area_basis||'auto'};
  const prior=previous.report_data||{},market=prior.pipeline?.market_diagnostics||{};
  const data:Row={version:REPORT_VERSION,outcome,reason,folio:c.folio||request.case_id,generated_at:new Date().toISOString(),generated_date:new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City'}).format(new Date()),subject,documents,subject_review:prior.pipeline?.subject_review,comparables:market.included||[],excluded:(market.excluded||[]).slice(0,72),excluded_summary:market.excluded_summary||null,market_observation:market.market||{},input_fingerprint:snapshot.fingerprint,previous_versions:prior.previous_versions||[],pipeline:{...prior.pipeline,run_id:runId,stage:outcome==='received'?'documents':'ready',heartbeat:new Date().toISOString()}};
  data.photos=[];let imageBytes=0;
  if(outcome!=='received')for(const s of snapshot.sources.filter((s:Row)=>s.kind!=='knowledge'&&/^image\/(jpeg|png)$/.test(s.mime_type||''))){try{const blob=check(await admin.storage.from(s.bucket).download(s.storage_path)),bytes=new Uint8Array(await blob.arrayBuffer());imageBytes+=bytes.length;if(imageBytes<=40000000)data.photos.push({title:s.title,mime_type:s.mime_type,bytes});else data.documents.push({id:s.id,title:s.title,evidence:{warnings:['La fotografía original se conserva en el expediente; no se incorporó por el límite de tamaño del PDF.']}});}catch{data.documents.push({id:s.id,title:s.title,evidence:{warnings:['No se pudo incorporar la imagen; el original permanece registrado para consulta.']}});}}
  data.client=request.client_name||null;
  const bytes=await deliverablePdf(data,await loadBrand()),path=`${request.organization_id}/${request.case_id}/commercial/${runId}-${outcome}.pdf`;
  data.photos=data.photos.map((p:Row)=>({title:p.title,mime_type:p.mime_type}));
  check(await admin.storage.from('valuation-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false}));
  if(previous.pdf_storage_path)data.previous_versions.push({path:previous.pdf_storage_path,generated_at:previous.generated_at});
  // Persist a compact ledger; complete catalog extractions stay in the library.
  data.documents=documents.map((d:Row)=>({...d,evidence:d.evidence?{complete:d.evidence.complete,page_count:d.evidence.page_count,completed_pages:d.evidence.completed_pages,summary:d.kind==='knowledge'?undefined:d.evidence.summary?.slice(0,1800),content_hash:d.evidence.content_hash,warnings:d.evidence.warnings?.slice(0,3),warning_count:d.evidence.warnings?.length||0}:null}));
  check(await admin.from('commercial_reports').update({status:outcome==='received'?'generating':'generated',report_data:data,pdf_storage_path:path,generated_at:data.generated_at,error_message:null,estimated_value:null,low_value:null,high_value:null,price_per_m2:null,comparable_count:data.comparables.length}).eq('request_id',request.id));
  check(await admin.from('service_requests').update({document_status:outcome==='received'?'generating':'ready',document_storage_path:path,document_generated_at:data.generated_at,document_emailed_at:null,status:'in_review'}).eq('id',request.id).eq('service_type','commercial'));
  return data;
}

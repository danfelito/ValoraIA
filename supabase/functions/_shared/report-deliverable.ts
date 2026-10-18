import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { check } from "./report-inputs.ts";
import { REPORT_VERSION } from "./commercial-core.ts";
import { validEvidence } from "./commercial-evidence.ts";
import type { Row } from "./commercial-core.ts";

const clean=(v:unknown)=>String(v??"No aportado").replace(/[–—]/g,"-").replace(/[^\x20-\xFF\n]/g," ");
export function reviewReason(message:string,stage:string) {
  if (/tres comparables|dispersión|superficie|discrepancias|conflictos documentales/.test(message)) return message;
  return `No se completó la etapa de ${stage === 'market'?'consulta de mercado':stage === 'subject'?'contraste del inmueble':'lectura y análisis'}. El expediente requiere seguimiento; no se emite una cifra sin sustento.`;
}

// A paid commercial request always has a downloadable deliverable, even if an
// external analysis fails. Unknown values stay null, never zero or asking price.
export async function deliverablePdf(data:Row):Promise<Uint8Array> {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`ValoraIA - Informe de análisis ${data.folio}`);doc.setAuthor('ValoraIA');
  let page:any,y=0;
  const newPage=()=>{page=doc.addPage([612,792]);y=704;page.drawRectangle({x:0,y:740,width:612,height:52,color:rgb(.04,.04,.04)});page.drawText('ValoraIA - Círculo Internacional',{x:42,y:760,size:14,font:bold,color:rgb(1,1,1)});};
  const text=(value:unknown,heading=false)=>{
    const size=heading?13:10,f=heading?bold:font;let line='';
    if(heading&&y<105)newPage();
    const flush=()=>{if(y<65)newPage();page.drawText(line,{x:42,y,size,font:f,color:heading?rgb(.93,.11,.18):rgb(.12,.12,.12)});y-=heading?22:15;line='';};
    for(const word of clean(value).split(/\s+/)){
      const next=line?line+' '+word:word;
      if(f.widthOfTextAtSize(next,size)<=525){line=next;continue;}
      if(line)flush();
      for(const char of word){if(f.widthOfTextAtSize(line+char,size)>525)flush();line+=char;}
    }
    if(line)flush();y-=8;
  };
  newPage();text(data.outcome==='received'?'SOLICITUD PAGADA - ANÁLISIS EN CURSO':'INFORME DE ANÁLISIS - VALOR NO DETERMINADO',true);
  text(`Folio: ${data.folio}`);text(`Fecha: ${data.generated_date}`);text('Pago confirmado. Documento disponible en el expediente privado del solicitante.');
  text('Resultado y alcance',true);text(data.reason);text('Este documento no asigna un valor de cero, no usa el precio anunciado como estimación y no constituye un avalúo firmado. La entrega de un archivo no acredita la suficiencia de la evidencia para calcular un valor.');
  const s=data.subject; text('Inmueble y datos declarados',true);
  for(const [label,value] of [['Tipo',s.property_type],['Dirección',s.address_line],['Colonia',s.locality],['Municipio / estado',[s.municipality,s.region].filter(Boolean).join(', ')],['Terreno (m2)',s.land_area_m2],['Construcción (m2)',s.built_area_m2],['Base de comparación',s.area_basis],['Precio solicitado (sólo contraste)',s.asking_price]])text(`${label}: ${value===null||value===undefined||value===''?'No acreditado':value}`);
  if(s.property_notes)text(`Descripción declarada: ${s.property_notes}`);
  text('Evidencia y estado de lectura',true);
  for(const d of data.documents){const e=d.evidence;text(`${d.title}: ${e?`${e.completed_pages||0}/${e.page_count||'?'} unidades procesadas${e.complete===false?' - lectura parcial':''}`:'Lectura pendiente o no completada'}`);if(e?.summary)text(e.summary);for(const w of e?.warnings||[])text(`Limitación: ${w}`);}
  if(!data.documents.length)text('No se registraron archivos aportados para esta solicitud.');
  if(data.subject_review){text('Contraste de la información',true);for(const v of [...(data.subject_review.observations||[]),...(data.subject_review.documentary_contrasts||[])])text(v);text('Información que falta verificar',true);for(const v of data.subject_review.missing_information||[])text(v);}
  text('Consulta y selección de mercado',true);text(`Referencias admitidas por los filtros: ${data.comparables.length}. No se calculó una mediana ni un rango sin muestra suficiente y consistente.`);
  for(const c of data.comparables)text(`Referencia admitida, sin concluir valor: ${c.title}; precio publicado ${c.price}; superficie de comparación ${c.area}; ${c.url||c.source||'Fuente documental'}`);
  for(const e of data.excluded)text(`Referencia excluida: ${e.title||e.source||'Anuncio'} - ${e.exclusion_reason}. ${e.url||''}`);
  for(const v of data.market_observation?.survey||[])text(`Canal ${v.channel}: ${v.reason||v.status}`);
  for(const url of data.market_observation?.sources||[])text(`Fuente consultada: ${url}`);
  text('Seguimiento',true);text(data.outcome==='received'?'El análisis continúa. Este documento inicial será sustituido en el enlace del expediente por el informe resultante; se conservará la versión anterior.':'Completar o revisar la evidencia indicada y actualizar el informe desde el mismo expediente. No se requiere repetir el pago para reintentar esta solicitud. Los catálogos técnicos requieren justificar modelo, fecha, región, alcance y depreciación antes de aplicar costos.');
  if(data.photos?.length){newPage();text('Evidencia fotográfica aportada',true);for(const photo of data.photos){text(photo.title);try{const image=photo.mime_type==='image/png'?await doc.embedPng(photo.bytes):await doc.embedJpg(photo.bytes),dims=image.scaleToFit(525,230);if(y-dims.height<65)newPage();page.drawImage(image,{x:42+(525-dims.width)/2,y:y-dims.height,width:dims.width,height:dims.height});y-=dims.height+20;}catch{text('La imagen original se conserva en el expediente; no fue posible reproducirla en este PDF.');}}text('Las fotografías no sustituyen inspección física ni acreditan superficies.');}
  doc.getPages().forEach((p:any,i:number)=>p.drawText(clean(`${data.folio} | Análisis sin cifra | ${i+1}/${doc.getPageCount()}`),{x:42,y:28,size:8,font,color:rgb(.4,.4,.4)}));
  return doc.save();
}

export async function saveDeliverable(admin:any,request:Row,config:Row,runId:string,snapshot:Row,previous:Row,reason:string,outcome:string) {
  const p=snapshot.property||{},intake=request.intake_data||{},c=request.valuation_cases||{};
  const documents=await Promise.all(snapshot.sources.map(async(s:Row)=>{const e=(s.kind==='case'?s.metadata:s.analysis)?.commercial_evidence;return {id:s.id,title:s.title,kind:s.kind,evidence:await validEvidence(e,request.organization_id,config.secret)?e:null};}));
  const subject={...intake,...p,property_type:request.property_type,locality:c.locality||intake.locality,municipality:c.municipality||intake.municipality,region:c.region||intake.region,area_basis:intake.comparison_area_basis||'auto'};
  const prior=previous.report_data||{},market=prior.pipeline?.market_diagnostics||{};
  const data:Row={version:REPORT_VERSION,outcome,reason,folio:c.folio||request.case_id,generated_at:new Date().toISOString(),generated_date:new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City'}).format(new Date()),subject,documents,subject_review:prior.pipeline?.subject_review,comparables:market.included||[],excluded:market.excluded||[],market_observation:market.market||{},input_fingerprint:snapshot.fingerprint,previous_versions:prior.previous_versions||[],pipeline:{...prior.pipeline,run_id:runId,stage:outcome==='received'?'documents':'ready',heartbeat:new Date().toISOString()}};
  data.photos=[];let imageBytes=0;
  if(outcome!=='received')for(const s of snapshot.sources.filter((s:Row)=>s.kind!=='knowledge'&&/^image\/(jpeg|png)$/.test(s.mime_type||''))){try{const blob=check(await admin.storage.from(s.bucket).download(s.storage_path)),bytes=new Uint8Array(await blob.arrayBuffer());imageBytes+=bytes.length;if(imageBytes<=40000000)data.photos.push({title:s.title,mime_type:s.mime_type,bytes});else data.documents.push({id:s.id,title:s.title,evidence:{warnings:['La fotografía original se conserva en el expediente; no se incorporó por el límite de tamaño del PDF.']}});}catch{data.documents.push({id:s.id,title:s.title,evidence:{warnings:['No se pudo incorporar la imagen; el original permanece registrado para consulta.']}});}}
  const bytes=await deliverablePdf(data),path=`${request.organization_id}/${request.case_id}/commercial/${runId}-${outcome}.pdf`;
  data.photos=data.photos.map((p:Row)=>({title:p.title,mime_type:p.mime_type}));
  check(await admin.storage.from('valuation-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false}));
  if(previous.pdf_storage_path)data.previous_versions.push({path:previous.pdf_storage_path,generated_at:previous.generated_at});
  // Persist a compact ledger; complete catalog extractions stay in the library.
  data.documents=documents.map((d:Row)=>({...d,evidence:d.evidence?{complete:d.evidence.complete,page_count:d.evidence.page_count,completed_pages:d.evidence.completed_pages,summary:d.evidence.summary,content_hash:d.evidence.content_hash,warnings:d.evidence.warnings}:null}));
  check(await admin.from('commercial_reports').update({status:outcome==='received'?'generating':'generated',report_data:data,pdf_storage_path:path,generated_at:data.generated_at,error_message:null,estimated_value:null,low_value:null,high_value:null,price_per_m2:null,comparable_count:data.comparables.length}).eq('request_id',request.id));
  check(await admin.from('service_requests').update({document_status:outcome==='received'?'generating':'ready',document_storage_path:path,document_generated_at:data.generated_at,document_emailed_at:null,status:'in_review'}).eq('id',request.id).eq('service_type','commercial'));
  return data;
}

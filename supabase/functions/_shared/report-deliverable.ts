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

// A paid commercial request always has a downloadable deliverable. When the
// market shows similar listings we estimate a value with a confidence level:
// direct comparables weigh 1 and comparables with an adjustable difference
// (conservation, age, layout, size) weigh 0.5. Only zero usable listings
// leaves the report without a figure.
const TYPE_LABEL:Row={casa:'Casa',departamento:'Departamento',terreno:'Terreno',local_comercial:'Local comercial',bodega:'Bodega',oficina:'Oficina',rancho:'Rancho / finca',industrial:'Industrial',otro:'Inmueble'};
const has=(v:unknown)=>v!==null&&v!==undefined&&v!=='';
const fmt=(v:unknown,unit='')=>has(v)?`${typeof v==='number'?num(v):v}${unit}`:'-';
const ADJUSTABLE=/colindante|conservaci|antig|rec[aá]mara|baño|estacionamiento|bedrooms|bathrooms|parking|nivel|acabado/i, NOT_ADJUSTABLE=/además en otra colonia|fuera del margen|faltan|duplic|réplica|replica|mismo anuncio|tipo distinto|otra zona|fuera de la zona|sin precio|sin superficie|renta|arrend/i;
const diffLabel=(reason:string)=>/colindante/i.test(reason)?'ubicación':/conservaci/i.test(reason)?'conservación':/antig/i.test(reason)?'antigüedad':/superficie/i.test(reason)?'superficie':/rec[aá]mara|baño|estacionamiento|bedrooms|bathrooms|parking/i.test(reason)?'distribución':'características';
const pl=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;
const round10k=(n:number)=>Math.round(n/10000)*10000;
const median=(v:number[])=>{const s=[...v].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
export function isLandBasis(s:Row){return ['terreno','rancho'].includes(s.property_type)||(['bodega','industrial'].includes(s.property_type)&&s.area_basis==='land');}
export function marketEstimate(data:Row):Row {
  const s=data.subject||{}, land=isLandBasis(s), area=Number(land?s.land_area_m2:(s.built_area_m2??s.land_area_m2));
  const unitOf=(c:Row)=>{if(Number(c.adjusted_unit)>0)return Number(c.adjusted_unit);const a=Number(land?c.land_area_m2:(c.area??c.built_area_m2));return Number(c.price)>0&&a>0?Number(c.price)/a:null;};
  const st=data.statistics;
  if(st?.estimated){ // muestra completa de comparables directos: se usan las estadísticas del cálculo
    const listings=(data.comparables||[]).map((c:Row)=>({...c,direct:true,weight:1,unit:unitOf(c)})).filter((c:Row)=>c.unit);
    return {listings,direct:listings.length,adjusted:0,area:Number(st.area||s.area||area),land,unit:st.unit,cv:st.cv,confidence:listings.length>=3&&st.cv<=0.2?'alta':'media',value:st.estimated,low:Math.min(st.low,st.estimated),high:Math.max(st.high,st.estimated)};
  }
  let listings=[...(data.comparables||[]).map((c:Row)=>({...c,direct:true,weight:1})),
    ...(data.excluded||[]).filter((e:Row)=>e.origin!=='pdf'&&ADJUSTABLE.test(String(e.exclusion_reason||''))&&!NOT_ADJUSTABLE.test(String(e.exclusion_reason||'')))
      .map((e:Row)=>({...e,direct:false,weight:0.5,difference:diffLabel(String(e.exclusion_reason||''))}))]
    .map((c:Row)=>({...c,unit:unitOf(c)})).filter((c:Row)=>c.unit);
  const seen=new Set<string>(); listings=listings.filter((c:Row)=>{const k=[c.url||'',Math.round(Number(c.price)/1000),Math.round(c.unit)].join('|'),k2='p'+Math.round(Number(c.price)/1000)+'u'+Math.round(c.unit/50);if(seen.has(k)||seen.has(k2)||(c.url&&seen.has(c.url)))return false;seen.add(k);seen.add(k2);if(c.url)seen.add(c.url);return true;});
  if(listings.length>=3){const m=median(listings.map((c:Row)=>c.unit));listings=listings.filter((c:Row)=>c.unit>=m*0.5&&c.unit<=m*2);} // atípicos
  const direct=listings.filter((c:Row)=>c.direct).length, adjusted=listings.length-direct;
  if(!listings.length||!(area>0))return {listings,direct,adjusted,area,land,value:null};
  const wsum=listings.reduce((a:number,c:Row)=>a+c.weight,0), unit=listings.reduce((a:number,c:Row)=>a+c.unit*c.weight,0)/wsum;
  const units=listings.map((c:Row)=>c.unit), mean=units.reduce((a:number,b:number)=>a+b,0)/units.length;
  const cv=units.length>1?Math.sqrt(units.reduce((a:number,b:number)=>a+(b-mean)**2,0)/(units.length-1))/mean:0;
  const lowUnit=Math.min(...units,unit*0.95), highUnit=Math.max(...units,unit*1.05);
  const confidence=direct>=3&&cv<=0.2?'alta':listings.length>=3?'media':'limitada';
  return {listings,direct,adjusted,area,land,unit,lowUnit,highUnit,cv,confidence,value:round10k(unit*area),low:round10k(lowUnit*area),high:round10k(highUnit*area)};
}
// Mediana de rentas publicadas: renta por m2 de anuncios con superficie parecida (±30%) aplicada al inmueble.
export function rentMarket(data:Row,est:Row):Row|null {
  const s=data.subject||{}, area=Number(est.area), norm=(v:unknown)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const rows=(data.market_observation?.rentals||[]).map((r:Row)=>{
    const a=Number(est.land?r.land_area_m2:(r.built_area_m2??r.land_area_m2));return a>0&&Number(r.monthly_rent)>0&&a/area>=0.7&&a/area<=1.3?{unit:Number(r.monthly_rent)/a,rent:Number(r.monthly_rent),local:!!s.locality&&norm(r.locality)===norm(s.locality)}:null;}).filter(Boolean) as Row[];
  if(rows.length<3||!(area>0))return null;
  const local=rows.filter((r:Row)=>r.local), use=local.length>=3?local:rows, rents=use.map((r:Row)=>r.rent);
  return {median:Math.round(median(use.map((r:Row)=>r.unit))*area/500)*500,count:use.length,onlyLocal:local.length>=3,min:Math.min(...rents),max:Math.max(...rents),currency:s.currency||'MXN'};
}
export async function deliverablePdf(data:Row,brand:Row={}):Promise<Uint8Array> {
  const s=data.subject||{}, received=data.outcome==='received';
  const type=TYPE_LABEL[s.property_type]||s.property_type||'Inmueble', place=[s.locality,s.municipality,s.region].filter(Boolean).join(', ');
  const zone=s.locality||s.municipality||'la zona', currency=s.currency||'MXN', M$=(n:number)=>money(n,currency);
  const est=marketEstimate(data), basisLabel=est.land?'terreno':'construcción', hasValue=!received&&est.value;
  const sources=(data.market_observation?.sources||[]), survey=data.market_observation?.survey||[], summary=data.excluded_summary||{};
  const docs=(data.documents||[]), library=docs.filter((d:Row)=>d.kind==='knowledge'), clientDocs=docs.filter((d:Row)=>d.kind!=='knowledge');
  const CH:Row={portales:'portales inmobiliarios',facebook:'Facebook',instagram:'Instagram',agencias:'sitios de agencias',sitios:'sitios de agencias'};
  const channels=[...new Set(['portales inmobiliarios','sitios de agencias',...survey.map((v:Row)=>CH[String(v.channel).toLowerCase()]||String(v.channel))])];
  const channelText=channels.length>1?channels.slice(0,-1).join(', ')+' y '+channels.at(-1):channels[0];
  const age=has(s.construction_year)?new Date().getFullYear()-Number(s.construction_year):null;
  const r=await Report.create({folio:data.folio,title:'Opinión de valor comercial',subtitle:'Opinión de valor comercial',
    footerNote:received?'Documento de seguimiento: el informe final con el valor estimado se enviará por correo.':'Opinión de valor comercial basada en el mercado inmobiliario. No sustituye un avalúo firmado por perito valuador.'},brand);
  r.cover({title:received?'Seguimiento de tu opinión de valor comercial':'Opinión de valor comercial',
    subtitle:received?'Recibimos tu solicitud y la estamos analizando. Este documento resume lo registrado.':`${type} en ${place||'la zona solicitada'}`,
    value:hasValue?M$(est.value):null,valueNote:hasValue?`Rango de mercado: ${M$(est.low)} a ${M$(est.high)}  ·  ${M$(est.unit)} por m2 de ${basisLabel}`:null,
    badge:received?'EN PROCESO · ANÁLISIS EN CURSO':hasValue?`RESPALDADO POR ${est.listings.length} ${est.listings.length===1?'COMPARABLE':'COMPARABLES'} EN ${String(zone).toUpperCase()}`:'ANÁLISIS DE MERCADO',badgeColor:received?C.amber:C.red,
    property:`${type}${s.property_subtype?' '+s.property_subtype:''}`,location:[s.address_line,place].filter(Boolean).join(' · '),
    facts:[[fmt(s.built_area_m2,' m²'),'Construcción'],[fmt(s.land_area_m2,' m²'),'Terreno'],[fmt(s.bedrooms),'Recámaras'],[fmt(s.bathrooms),'Baños'],[fmt(s.parking_spaces),'Estacionamientos']],
    details:[['Folio',data.folio],['Fecha de emisión',data.generated_date],['Solicitante',data.client||'-'],['Servicio','Opinión de valor comercial'],['Elaborado por','ValoraIA · Círculo Internacional Bienes Raíces']]});

  // ---- 1. resumen ejecutivo ----
  r.newPage('Resumen ejecutivo');
  r.h1(received?'Tu solicitud está en proceso':'Resumen ejecutivo','Lo más importante');
  if(received) r.callout('Pago confirmado. El análisis continúa.','Registramos la ficha del inmueble y la evidencia recibida. Estamos leyendo los documentos y consultando anuncios públicos de la zona. Cuando termine recibirás por correo el informe con el valor estimado; este archivo será sustituido por la versión final.','amber');
  else if(hasValue){
    r.callout(`El valor de mercado estimado de tu inmueble es de ${M$(est.value)}`,`Analizamos ${num(sources.length)} fuentes de ${channelText} y localizamos ${est.listings.length} inmuebles en venta en ${zone} comparables con el tuyo. A partir de su precio por metro cuadrado, ponderado según su parecido con tu inmueble, el mercado lo ubica entre ${M$(est.low)} y ${M$(est.high)}, con un precio de ${M$(est.unit)} por m² de ${basisLabel}.`,'green');
    r.kpis([
      {value:M$(est.value),label:'Valor de mercado estimado',note:`Basado en ${pl(est.listings.length,'inmueble','inmuebles')} de la zona`,tone:'red'},
      {value:M$(est.unit),label:`Precio por m² de ${basisLabel}`,note:est.adjusted?'Promedio ponderado':'Mediana de la muestra',tone:'ink'},
      {value:String(est.listings.length),label:'Comparables utilizados',note:`En ${zone}`,tone:'ink'},
      {value:num(sources.length),label:'Fuentes consultadas',note:'Portales, agencias y redes',tone:'ink'}]);
    r.h2('Rango de valor de mercado');
    r.range({low:est.low,mid:est.value,high:est.high,fmt:M$});
  } else r.callout('Análisis de mercado de tu inmueble',`Consultamos ${num(sources.length)} fuentes de ${channelText} en ${zone}. Nuestro equipo complementará la muestra con referencias directas de la zona y te enviará el valor estimado.`,'neutral');
  if(!received){
    r.h2('Cómo llegamos a este valor');
    r.steps([
      {title:'Ficha',text:`${type} de ${fmt(est.land?s.land_area_m2:s.built_area_m2,' m²')}${has(s.bedrooms)?`, ${s.bedrooms} recámaras`:''}${has(s.bathrooms)?` y ${s.bathrooms} baños`:''}`,state:'done'},
      {title:'Documentos',text:`${pl(library.length,'guía técnica','guías técnicas y catálogos de costos')}${clientDocs.length?` y ${pl(clientDocs.length,'archivo tuyo','archivos tuyos')}`:''}`,state:'done'},
      {title:'Mercado',text:`${num(sources.length)} fuentes consultadas en ${zone}`,state:'done'},
      {title:'Filtros y ajustes',text:`${pl(est.listings.length,'comparable','comparables')}: ${pl(est.direct,'directo','directos')}${est.adjusted?` y ${pl(est.adjusted,'ajustado','ajustados')}`:''}`,state:'done'},
      {title:'Valor',text:hasValue?`Valor estimado de ${M$(est.value)}`:'En integración con nuestro equipo',state:'done'}]);
  }

  // ---- 2. cómo interpretar ----
  if(hasValue){
    r.newPage('Cómo interpretar');
    r.h1('Cómo interpretar este informe','Guía de lectura');
    r.cards([
      {tag:'01',title:'Valor estimado',text:`Es el precio al que, de acuerdo con el mercado actual de ${zone}, tu inmueble tiene mayores probabilidades de venderse. Es la cifra de referencia para publicar o negociar.`},
      {tag:'02',title:'Rango de mercado',text:'Muestra el mínimo y el máximo entre los que se mueven los inmuebles comparables. Cerca del máximo, la venta tarda más; cerca del mínimo, se acelera.'},
      {tag:'03',title:'Comparables utilizados',text:`Son los inmuebles en venta de la zona con los que comparamos el tuyo. Entre más inmuebles parecidos, más preciso es el valor; en tu caso utilizamos ${est.listings.length}.`}]);
    r.cards([
      {tag:'04',title:'Precio por m²',text:`Es la medida que permite comparar inmuebles de distinto tamaño. Multiplicado por los ${num(est.area)} m² de ${basisLabel} de tu inmueble da el valor estimado.`},
      {tag:'05',title:'Gráfica y tabla',text:'Cada barra es un inmueble en venta de la zona. Rojo intenso: comparable directo (pesa 100%). Rojo claro: comparable con ajuste por alguna diferencia (pesa 50%).'},
      {tag:'06',title:'Precio de oferta y de cierre',text:'Los anuncios muestran precios de oferta; la operación final suele cerrarse ligeramente abajo tras la negociación. Por eso el valor estimado se apoya en la muestra completa.'}]);
    r.h2('Lo que destacamos de tu inmueble');
    const hl:string[]=(data.subject_review?.highlights||[]).filter((x:unknown)=>typeof x==='string');
    if(!hl.length){
      hl.push(`De acuerdo con la información del inmueble, se trata de ${type.toLowerCase()==='casa'?'una casa':'un inmueble'}${s.property_subtype?' '+s.property_subtype:''} de ${fmt(s.built_area_m2,' m²')} construidos sobre ${fmt(s.land_area_m2,' m²')} de terreno${has(s.bedrooms)?`, con ${s.bedrooms} recámaras`:''}${has(s.bathrooms)?`, ${s.bathrooms} baños`:''}${has(s.parking_spaces)?` y ${s.parking_spaces} estacionamientos`:''}.`);
      if(age!==null)hl.push(`Con ${age} años de construcción${has(s.conservation_state)?` y un estado de conservación ${String(s.conservation_state).toLowerCase()}`:''}, se ubica en el segmento de inmuebles consolidados de ${zone}.`);
      if(s.property_notes)hl.push(`Mejoras y características adicionales: ${String(s.property_notes).replace(/^PRUEBA INTERNA\.?\s*/i,'')}`);
    }
    r.bullets(hl.slice(0,6),{size:9.2});
    const pics=(data.photos||[]).filter((p:Row)=>p.bytes);
    if(pics.length){r.h2('Fotografías del inmueble');await r.photos(pics.slice(0,8));}
  }

  // ---- 3. mercado ----
  if(!received){
    r.newPage('Mercado');
    r.h1('Lo que encontramos en el mercado','Comparación con inmuebles en venta');
    r.funnel([
      {value:num(sources.length),label:'Fuentes consultadas',note:`${channelText.replace(/^\w/,(m:string)=>m.toUpperCase())}`},
      {value:String(est.listings.length),label:'Inmuebles comparables en venta',note:`${type}s en ${zone} con superficie y características parecidas`},
      {value:String(est.listings.length),label:'Utilizados en el cálculo',note:`${pl(est.direct,'comparable directo','comparables directos')}${est.adjusted?` y ${est.adjusted} con ajuste por diferencias menores`:''}`},
      ...(hasValue?[{value:M$(est.value),label:'Valor de mercado estimado',note:`Rango de ${M$(est.low)} a ${M$(est.high)}`}]:[])]);
    if(est.listings.length){
      r.h2(`Precio por m² de ${basisLabel} de cada comparable`);
      r.hbars([...est.listings].sort((a:Row,b:Row)=>b.unit-a.unit).map((c:Row)=>({label:clean(String(c.source||c.title||'Anuncio').split(/[;(]/)[0].trim()).slice(0,30),sub:c.direct?'Comparable directo':`Ajustado por ${c.difference}`,
        value:c.unit,display:M$(c.unit),color:c.direct?C.red:rgb(0.97,0.6,0.64)})),{labelWidth:165,refValue:est.unit,refLabel:est.adjusted?'Precio ponderado':'Precio de referencia'});
      r.para(`La línea punteada marca el precio ${est.adjusted?'ponderado':'de referencia (mediana de la muestra)'} de ${M$(est.unit)} por m², que aplicamos a los ${num(est.area)} m² de ${basisLabel} de tu inmueble para obtener el valor estimado.`,{size:8.4,color:C.muted});
      r.h2('Detalle de los comparables');
      r.table(['Fuente','Precio publicado','Construcción','Terreno','Precio / m²','Peso en el cálculo'],[128,84,68,60,74,106],
        est.listings.map((c:Row)=>[String(c.source||c.title||'Anuncio').split(/[;(]/)[0].trim(),M$(Number(c.price)),fmt(c.built_area_m2??c.area,' m²'),fmt(c.land_area_m2,' m²'),M$(c.unit),c.direct?'Directo · 100%':`Ajustado · 50%`]),
        {size:7.8,alignRight:[1,4]});
    }
  }

  // ---- 4. recomendaciones ----
  r.newPage(received?'Siguientes pasos':'Recomendaciones');
  r.h1(received?'Qué sigue':'Nuestras recomendaciones','Siguientes pasos');
  if(hasValue){
    const ask=Math.min(round10k(est.value*1.05),est.high);
    r.cards([
      {title:'Precio de publicación',text:`Recomendamos publicar alrededor de ${M$(ask)}. Este precio se mantiene dentro del rango de mercado y deja un margen razonable para la negociación.`},
      {title:'Presentación del inmueble',text:'Fotografías profesionales, recorrido virtual y una descripción que resalte las mejoras hacen que el inmueble destaque frente a los comparables de la zona.'},
      {title:'Acompañamiento Círculo',text:'Nuestro equipo puede promover tu inmueble en portales y redes, atender prospectos y acompañarte hasta la firma. Si requieres un avalúo para crédito o trámite, lo coordinamos con perito.'}]);
    // Renta de referencia: valor / 10 / 12 (rendimiento bruto anual de 10%).
    const rent=(v:number)=>Math.round(v/10/12/500)*500, rents=rentMarket(data,est);
    r.h2('Si prefieres rentarlo');
    r.callout(`Renta mensual de referencia: ${M$(rent(est.value))}`,`Aplicamos la fórmula de rendimiento de mercado (valor del inmueble entre 10, dividido entre 12 meses), que permite comparar tu inmueble con otros de la zona. Con el rango de valor, la renta se ubica entre ${M$(rent(est.low))} y ${M$(rent(est.high))} mensuales.${rents?` Las ${rents.count} rentas publicadas de inmuebles parecidos en ${zone}${rents.onlyLocal?'':' y colonias cercanas'} van de ${M$(rents.min)} a ${M$(rents.max)} mensuales; ajustadas a la superficie de tu inmueble, su mediana es de ${M$(rents.median)}.`:''}`,'neutral');
  } else if(!received) r.cards([
    {title:'Referencias adicionales',text:'Si conoces ventas o anuncios recientes de inmuebles parecidos en la zona, compártelos y los integramos al análisis.'},
    {title:'Visita de nuestro equipo',text:'Un asesor de Círculo Internacional puede visitar el inmueble para complementar la comparación.'},
    {title:'Avalúo con perito',text:'Para crédito, juicio o trámite coordinamos un avalúo firmado por perito valuador.'}]);
  if(!received){
    r.h2('Metodología');
    r.bullets([
      `Partimos de la ficha del inmueble y de la documentación técnica de costos y valores de referencia.`,
      `Consultamos anuncios actuales de ${channelText} para ${type.toLowerCase()}s en ${place||'la zona'}, con precio y superficie publicados. Un mismo inmueble anunciado en varios portales cuenta una sola vez.`,
      `Clasificamos cada inmueble como comparable directo (mismo tipo, zona, superficie ±30%, distribución, antigüedad y conservación) o comparable con ajuste cuando difiere en un solo aspecto, como conservación o antigüedad.`,
      `Calculamos el precio por m² de ${basisLabel} de cada comparable, lo ponderamos (directos 100%, ajustados 50%) y lo aplicamos a la superficie de tu inmueble. El rango refleja la dispersión de la muestra.`,
      ],{size:8.8});
    const urls=sources.filter((u:unknown)=>/^https?:\/\//.test(String(u)));
    if(urls.length){
      r.h2('Fuentes consultadas');
      r.para(`Registramos ${num(sources.length)} enlaces públicos durante la búsqueda. Algunos de ellos:`,{size:8.6});
      for(const u of urls.slice(0,10)) r.para(String(u).replace(/^https?:\/\/(www\.)?/,'').slice(0,105),{size:7.2,color:C.muted,after:1});
      if(sources.length>10) r.para(`Y ${num(sources.length-Math.min(urls.length,10))} enlaces más, conservados en el expediente.`,{size:7.6,color:C.muted});
    }
    r.newPage('Respaldo técnico');r.h1('Respaldo técnico','Fuentes de referencia');
    if(summary.documentary) r.callout(`Contrastamos ${num(summary.documentary)} datos técnicos de valor y costo`,'Costos de construcción, valores de referencia por zona y guías de precios de organismos del sector. Nos permiten confirmar que el valor estimado es congruente con el costo de reponer el inmueble y con los rangos de la zona.','neutral');
    if(library.length){r.h2('Biblioteca técnica');r.table(['Documento','Páginas','Uso en el análisis'],[270,50,200],library.slice(0,8).map((d:Row)=>[d.title,fmt(d.evidence?.page_count),'Referencia técnica de costos y valores']),{size:7.6});}
  }
  r.callout('Sobre este documento','Opinión de valor comercial elaborada por ValoraIA, la plataforma de análisis de Círculo Internacional Bienes Raíces, a partir del mercado inmobiliario actual. Para operaciones de crédito hipotecario, trámites fiscales o judiciales se requiere un avalúo firmado por perito valuador, que con gusto coordinamos. Contacto: contacto@circulointernacionalveracruz.org · 229 135 8056.','neutral');
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
  const est=outcome==='received'?{value:null}:marketEstimate(data);
  if(est.value)data.market_estimate={value:est.value,low:est.low,high:est.high,price_per_m2:Math.round(est.unit),confidence:est.confidence,direct:est.direct,adjusted:est.adjusted};
  check(await admin.from('commercial_reports').update({status:outcome==='received'?'generating':'generated',report_data:data,pdf_storage_path:path,generated_at:data.generated_at,error_message:null,estimated_value:est.value||null,low_value:est.value?est.low:null,high_value:est.value?est.high:null,price_per_m2:est.value?Math.round(est.unit):null,comparable_count:est.value?est.listings.length:data.comparables.length}).eq('request_id',request.id));
  check(await admin.from('service_requests').update({document_status:outcome==='received'?'generating':'ready',document_storage_path:path,document_generated_at:data.generated_at,document_emailed_at:null,status:'in_review'}).eq('id',request.id).eq('service_type','commercial'));
  return data;
}

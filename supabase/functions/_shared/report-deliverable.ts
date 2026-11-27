import { rgb } from "npm:pdf-lib@1.17.1";
import { Report, C, M, CW, clean, money, num, loadBrand } from "./report-design.ts";
import { check } from "./report-inputs.ts";
import { REPORT_VERSION } from "./commercial-core.ts";
import { validEvidence } from "./commercial-evidence.ts";
import { costSummary } from "./market-search.ts";
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
// ---- Homologación ----
// Factores que emplean los peritos valuadores para llevar cada comparable a las condiciones del
// inmueble analizado. Quedan fijos en código; el producto de factores se acota a 0.75–1.25.
export const NEGOTIATION = { sale: 0.95, rent: 0.97 }; // oferta publicada → precio de cierre
const USEFUL_LIFE:Row={casa:70,departamento:70,local_comercial:60,oficina:60,bodega:50,industrial:50};
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const ross=(age:number,life:number)=>{const x=Math.min(Math.max(age,0)/life,1);return 0.5*(x+x*x);};
function conservationScore(v:unknown):number|null{const t=String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!t)return null;if(/excelente|nuev|optimo/.test(t))return 1;if(/muy buen/.test(t))return 0.97;if(/buen/.test(t))return 0.93;if(/regular|normal|medio/.test(t))return 0.85;if(/mal|deterior|remodel/.test(t))return 0.7;return null;}
export function homologate(c:Row,s:Row,land:boolean,area:number):Row{
  const ca=Number(land?c.land_area_m2:(c.area??c.built_area_m2));
  if(!(Number(c.price)>0&&ca>0&&area>0))return {unit:null};
  if(c.reviewed&&Number(c.adjusted_unit_price)>0)return {unit:Number(c.adjusted_unit_price),raw_unit:Number(c.price)/ca,factor:1,factors:{}};
  const f:Row={neg:c.operation_type==='rent'?NEGOTIATION.rent:c.operation_type==='closed_sale'?1:NEGOTIATION.sale,sup:clamp(Math.pow(ca/area,0.125),0.9,1.1)};
  const life=USEFUL_LIFE[s.property_type], year=new Date().getFullYear(), sy=Number(s.construction_year), cy=Number(c.construction_year);
  if(!land&&life&&sy>1900&&cy>1900)f.edad=clamp((1-ross(year-sy,life))/(1-ross(year-cy,life)),0.8,1.2);
  const cs=conservationScore(s.conservation_state), cc=conservationScore(c.conservation_state);
  if(cs&&cc)f.cons=clamp(cs/cc,0.8,1.2);
  const factor=clamp(Object.values(f).reduce((a:number,b:any)=>a*Number(b),1),0.75,1.25), raw=Number(c.price)/ca;
  return {unit:raw*factor,raw_unit:raw,factor,factors:f};
}
export function marketEstimate(data:Row,step=10000):Row {
  const rnd=(n:number)=>Math.round(n/step)*step;
  const s=data.subject||{}, land=isLandBasis(s), area=Number(land?s.land_area_m2:(s.built_area_m2??s.land_area_m2));
  let listings=[...(data.comparables||[]).map((c:Row)=>({...c,direct:true,weight:1})),
    ...(data.excluded||[]).filter((e:Row)=>e.origin!=='pdf'&&ADJUSTABLE.test(String(e.exclusion_reason||''))&&!NOT_ADJUSTABLE.test(String(e.exclusion_reason||'')))
      .map((e:Row)=>({...e,direct:false,weight:0.5,difference:diffLabel(String(e.exclusion_reason||''))}))]
    .map((c:Row)=>({...c,...homologate(c,s,land,area)})).filter((c:Row)=>c.unit);
  const seen=new Set<string>(); listings=listings.filter((c:Row)=>{const k=[c.url||'',Math.round(Number(c.price)/1000),Math.round(c.raw_unit)].join('|'),k2='p'+Math.round(Number(c.price)/1000)+'u'+Math.round(c.raw_unit/50);if(seen.has(k)||seen.has(k2)||(c.url&&seen.has(c.url)))return false;seen.add(k);seen.add(k2);if(c.url)seen.add(c.url);return true;});
  if(listings.length>=3){const m=median(listings.map((c:Row)=>c.unit));listings=listings.filter((c:Row)=>c.unit>=m*0.5&&c.unit<=m*2);} // atípicos
  const direct=listings.filter((c:Row)=>c.direct).length, adjusted=listings.length-direct;
  if(!listings.length||!(area>0))return {listings,direct,adjusted,area,land,value:null};
  const wsum=listings.reduce((a:number,c:Row)=>a+c.weight,0), unit=listings.reduce((a:number,c:Row)=>a+c.unit*c.weight,0)/wsum;
  const units=listings.map((c:Row)=>c.unit), mean=units.reduce((a:number,b:number)=>a+b,0)/units.length;
  const cv=units.length>1?Math.sqrt(units.reduce((a:number,b:number)=>a+(b-mean)**2,0)/(units.length-1))/mean:0;
  const lowUnit=Math.min(...units,unit*0.95), highUnit=Math.max(...units,unit*1.05);
  const confidence=direct>=3&&cv<=0.2?'alta':listings.length>=3?'media':'limitada';
  return {listings,direct,adjusted,area,land,unit,lowUnit,highUnit,cv,confidence,value:rnd(unit*area),low:rnd(lowUnit*area),high:rnd(highUnit*area)};
}
// ---- Renta ----
// Parámetro por defecto (valor anual / 10): sólo se usa cuando no hay rentas de la misma colonia
// para extraer la tasa del mercado. Nunca se muestra al cliente.
export const DEFAULT_RENT_YIELD = 0.10;
const norm=(v:unknown)=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const round500=(n:number)=>Math.round(n/500)*500;
// Renta por m2 de anuncios de renta con superficie parecida (±30%), marcando los de la misma colonia.
function rentUnits(list:Row[],s:Row,land:boolean,area:number):Row[] {
  return (list||[]).map((r:Row)=>{const a=Number(land?r.land_area_m2:(r.built_area_m2??r.area??r.land_area_m2)),rent=Number(r.monthly_rent??r.price);
    return a>0&&rent>0&&area>0&&a/area>=0.7&&a/area<=1.3?{...r,rent,unit:rent*NEGOTIATION.rent/a,local:!!s.locality&&norm(r.locality||s.locality)===norm(s.locality)&&!/colindante|otra colonia/i.test(String(r.exclusion_reason||''))}:null;}).filter(Boolean) as Row[];
}
// Tasa de renta extraída del mercado: renta anual por m2 de la colonia / precio de venta por m2 de la colonia.
function marketYield(rents:Row[],saleUnit:number):number {
  const local=rents.filter((r:Row)=>r.local);
  if(!local.length||!(saleUnit>0))return DEFAULT_RENT_YIELD;
  return Math.min(0.12,Math.max(0.04,median(local.map((r:Row)=>r.unit))*12/saleUnit));
}
// Renta estimada para el informe de venta (extra): rentas de la colonia o valor de venta x tasa del mercado.
export function rentFromSale(data:Row,est:Row):Row|null {
  if(!est?.value)return null;
  const s=data.subject||{}, rents=rentUnits(data.market_observation?.rentals||[],s,est.land,Number(est.area)), local=rents.filter((r:Row)=>r.local);
  if(local.length>=3){const u=local.map((r:Row)=>r.unit);return {value:round500(median(u)*est.area),low:round500(Math.min(...u)*est.area),high:round500(Math.max(...u)*est.area),count:local.length,basis:'rent'};}
  const y=marketYield(rents,est.unit);
  return {value:round500(est.value*y/12),low:round500(est.low*y/12),high:round500(est.high*y/12),count:local.length,basis:local.length?'mixed':'sales'};
}
// Estimación del informe de renta: comparables en renta; si son menos de tres, se complementa con
// inmuebles parecidos en venta de la zona y la tasa de renta extraída del mercado.
export function rentEstimate(data:Row):Row {
  // Sólo rentas de la misma colonia (directas o con una diferencia menor que no sea la ubicación).
  const s=data.subject||{}, est=marketEstimate({...data,excluded:(data.excluded||[]).filter((e:Row)=>!/colindante|otra colonia/i.test(String(e.exclusion_reason||'')))},500);
  if(est.value&&est.listings.length>=3)return {...est,basis:'rent'};
  const sale=marketEstimate({subject:s,comparables:data.sale_reference?.included||[],excluded:data.sale_reference?.excluded||[]});
  if(!sale.value)return est.value?{...est,basis:'rent'}:{...est,basis:'none'};
  // La tasa se extrae de todas las rentas publicadas de la zona, aunque no hayan pasado como comparables.
  const rents=rentUnits(data.market_observation?.rentals||[],s,sale.land,Number(sale.area));
  const y=marketYield(rents,sale.unit);
  return {...est,listings:est.listings||[],area:sale.area,land:sale.land,unit:sale.unit*y/12,value:round500(sale.value*y/12),low:round500(sale.low*y/12),high:round500(sale.high*y/12),
    basis:'sales',saleCount:sale.listings.length,direct:est.direct||0,adjusted:est.adjusted||0};
}

export async function deliverablePdf(data:Row,brand:Row={}):Promise<Uint8Array> {
  const s=data.subject||{}, received=data.outcome==='received', rent=data.kind==='rent'||s.report_kind==='rent';
  const type=TYPE_LABEL[s.property_type]||s.property_type||'Inmueble', place=[s.locality,s.municipality,s.region].filter(Boolean).join(', ');
  const zone=s.locality||s.municipality||'la zona', currency=s.currency||'MXN', M$=(n:number)=>money(n,currency);
  const est=rent?rentEstimate(data):marketEstimate(data), basisLabel=est.land?'terreno':'construcción', hasValue=!received&&est.value;
  const fromSales=rent&&est.basis==='sales';
  const T=rent?{product:'Opinión de renta',valueLabel:'RENTA MENSUAL ESTIMADA',per:' mensuales',perShort:' / mes',unitLabel:`Renta por m² de ${basisLabel}`,op:'en renta',value:'renta mensual estimada',Value:'Renta mensual estimada',range:'Rango de renta'}
    :{product:'Opinión de valor comercial',valueLabel:'VALOR DE MERCADO ESTIMADO',per:'',perShort:'',unitLabel:`Precio por m² de ${basisLabel}`,op:'en venta',value:'valor de mercado estimado',Value:'Valor de mercado estimado',range:'Rango de mercado'};
  const obs=data.market_observation||{}, sources=[...new Set([...(obs.sources||[]),...(obs.rental_sources||[])])], survey=obs.survey||[], summary=data.excluded_summary||{};
  const docs=(data.documents||[]), library=docs.filter((d:Row)=>d.kind==='knowledge'), clientDocs=docs.filter((d:Row)=>d.kind!=='knowledge');
  const CH:Row={portales:'portales inmobiliarios',facebook:'Facebook',instagram:'Instagram',agencias:'sitios de agencias',sitios:'sitios de agencias'};
  const channels=[...new Set(['portales inmobiliarios','sitios de agencias',...survey.map((v:Row)=>CH[String(v.channel).toLowerCase()]||String(v.channel))])];
  const channelText=channels.length>1?channels.slice(0,-1).join(', ')+' y '+channels.at(-1):channels[0];
  const age=has(s.construction_year)?new Date().getFullYear()-Number(s.construction_year):null;
  const nList=est.listings?.length||0, nUsed=fromSales?nList+(est.saleCount||0):nList;
  const r=await Report.create({folio:data.folio,title:T.product,subtitle:T.product,
    footerNote:received?'Documento de seguimiento: el informe final se enviará por correo.':`${T.product} basada en el mercado inmobiliario. No sustituye un avalúo firmado por perito valuador.`},brand);
  r.cover({title:received?`Seguimiento de tu ${T.product.toLowerCase()}`:T.product,
    subtitle:received?'Recibimos tu solicitud y la estamos analizando. Este documento resume lo registrado.':`${type} en ${place||'la zona solicitada'}`,
    value:hasValue?M$(est.value)+T.perShort:null,valueLabel:T.valueLabel,valueNote:hasValue?`${T.range}: ${M$(est.low)} a ${M$(est.high)}${T.per}`+(fromSales?'':`  ·  ${M$(est.unit)} por m2 de ${basisLabel}`):null,
    badge:received?'EN PROCESO · ANÁLISIS EN CURSO':hasValue?`RESPALDADO POR ${nUsed} ${nUsed===1?'INMUEBLE':'INMUEBLES'} EN ${String(zone).toUpperCase()}`:'ANÁLISIS DE MERCADO',badgeColor:received?C.amber:C.red,
    property:`${type}${s.property_subtype?' '+s.property_subtype:''}`,location:[s.address_line,place].filter(Boolean).join(' · '),
    facts:[[fmt(s.built_area_m2,' m²'),'Construcción'],[fmt(s.land_area_m2,' m²'),'Terreno'],[fmt(s.bedrooms),'Recámaras'],[fmt(s.bathrooms),'Baños'],[fmt(s.parking_spaces),'Estacionamientos']],
    details:[['Folio',data.folio],['Fecha de emisión',data.generated_date],['Solicitante',data.client||'-'],['Servicio',T.product],['Elaborado por','ValoraIA · Círculo Internacional Bienes Raíces']]});

  // ---- 1. resumen ejecutivo ----
  r.newPage('Resumen ejecutivo');
  r.h1(received?'Tu solicitud está en proceso':'Resumen ejecutivo','Lo más importante');
  if(received) r.callout('Pago confirmado. El análisis continúa.',`Registramos la ficha del inmueble y la evidencia recibida. Estamos leyendo los documentos y consultando anuncios públicos de la zona. Cuando termine recibirás por correo el informe con la ${T.value}; este archivo será sustituido por la versión final.`,'amber');
  else if(hasValue){
    const why=fromSales
      ?`Analizamos ${num(sources.length)} fuentes de ${channelText} y comparamos tu inmueble con ${pl(nUsed,'inmueble parecido','inmuebles parecidos')} de ${zone}. De acuerdo con el rendimiento que hoy ofrecen las rentas de la zona frente al valor de inmuebles con las mismas características, la renta de tu inmueble se ubica entre ${M$(est.low)} y ${M$(est.high)} mensuales.`
      :`Analizamos ${num(sources.length)} fuentes de ${channelText} y localizamos ${nList} inmuebles ${T.op} en ${zone} comparables con el tuyo. A partir de su ${rent?'renta':'precio'} por metro cuadrado, ponderado según su parecido con tu inmueble, el mercado lo ubica entre ${M$(est.low)} y ${M$(est.high)}${T.per}, con ${rent?'una renta':'un precio'} de ${M$(est.unit)} por m² de ${basisLabel}.`;
    r.callout(rent?`De acuerdo con el mercado, tu inmueble puede rentarse en ${M$(est.value)} al mes`:`El valor de mercado estimado de tu inmueble es de ${M$(est.value)}`,why,'green');
    r.kpis([
      {value:M$(est.value),label:T.Value,note:`Basado en ${pl(nUsed,'inmueble','inmuebles')} de la zona`,tone:'red'},
      fromSales?{value:`${M$(est.low)}`,label:'Renta mínima de mercado',note:'Extremo inferior del rango',tone:'ink'}
        :{value:M$(est.unit),label:T.unitLabel,note:est.adjusted?'Promedio ponderado':'Mediana de la muestra',tone:'ink'},
      {value:String(nUsed),label:'Comparables utilizados',note:`En ${zone}`,tone:'ink'},
      {value:num(sources.length),label:'Fuentes consultadas',note:'Portales, agencias y redes',tone:'ink'}]);
    r.h2(rent?'Rango de renta mensual':'Rango de valor de mercado');
    r.range({low:est.low,mid:est.value,high:est.high,fmt:M$,labels:rent?['Renta mínima','Renta estimada','Renta máxima']:undefined});
  } else r.callout('Análisis de mercado de tu inmueble',`Consultamos ${num(sources.length)} fuentes de ${channelText} en ${zone}. Nuestro equipo complementará la muestra con referencias directas de la zona y te enviará la ${T.value}.`,'neutral');
  if(!received){
    r.h2(rent?'Cómo llegamos a esta renta':'Cómo llegamos a este valor');
    r.steps([
      {title:'Ficha',text:`${type} de ${fmt(est.land?s.land_area_m2:s.built_area_m2,' m²')}${has(s.bedrooms)?`, ${s.bedrooms} recámaras`:''}${has(s.bathrooms)?` y ${s.bathrooms} baños`:''}`,state:'done'},
      {title:'Documentos',text:`${pl(library.length,'guía técnica','guías técnicas y catálogos de costos')}${clientDocs.length?` y ${pl(clientDocs.length,'archivo tuyo','archivos tuyos')}`:''}`,state:'done'},
      {title:'Mercado',text:`${num(sources.length)} fuentes consultadas en ${zone}`,state:'done'},
      {title:'Filtros y ajustes',text:fromSales?`${pl(nUsed,'inmueble comparable','inmuebles comparables')} de la zona`:`${pl(nList,'comparable','comparables')}: ${pl(est.direct||0,'directo','directos')}${est.adjusted?` y ${pl(est.adjusted,'ajustado','ajustados')}`:''}`,state:'done'},
      {title:rent?'Renta':'Valor',text:hasValue?`${rent?'Renta estimada':'Valor estimado'} de ${M$(est.value)}${T.perShort}`:'En integración con nuestro equipo',state:'done'}]);
  }

  // ---- 2. cómo interpretar ----
  if(hasValue){
    r.newPage('Cómo interpretar');
    r.h1('Cómo interpretar este informe','Guía de lectura');
    r.cards(rent?[
      {tag:'01',title:'Renta estimada',text:`Es la renta mensual que, de acuerdo con el mercado actual de ${zone}, tu inmueble puede cobrar con mayores probabilidades de rentarse en un plazo razonable.`},
      {tag:'02',title:'Rango de renta',text:'Muestra el mínimo y el máximo entre los que se mueven los inmuebles comparables. Cerca del máximo, la búsqueda de inquilino tarda más; cerca del mínimo, se acelera.'},
      {tag:'03',title:'Comparables utilizados',text:`Son los inmuebles de la zona con los que comparamos el tuyo. Entre más inmuebles parecidos, más precisa es la renta; en tu caso utilizamos ${nUsed}.`}]:[
      {tag:'01',title:'Valor estimado',text:`Es el precio al que, de acuerdo con el mercado actual de ${zone}, tu inmueble tiene mayores probabilidades de venderse. Es la cifra de referencia para publicar o negociar.`},
      {tag:'02',title:'Rango de mercado',text:'Muestra el mínimo y el máximo entre los que se mueven los inmuebles comparables. Cerca del máximo, la venta tarda más; cerca del mínimo, se acelera.'},
      {tag:'03',title:'Comparables utilizados',text:`Son los inmuebles en venta de la zona con los que comparamos el tuyo. Entre más inmuebles parecidos, más preciso es el valor; en tu caso utilizamos ${nList}.`}]);
    r.cards(rent?[
      {tag:'04',title:'Renta por m²',text:`Es la medida que permite comparar inmuebles de distinto tamaño. Aplicada a los ${num(est.area)} m² de ${basisLabel} de tu inmueble da la renta estimada.`},
      {tag:'05',title:'Gráfica y tabla',text:'Cada barra es la renta homologada por m² de un inmueble de la zona. Rojo intenso: comparable directo (pesa 100%). Rojo claro: comparable con ajuste por alguna diferencia (pesa 50%).'},
      {tag:'06',title:'Renta publicada y renta pactada',text:'Los anuncios muestran la renta que pide el propietario; la renta final suele pactarse ligeramente abajo. Por eso aplicamos un factor de negociación a cada renta publicada.'}]:[
      {tag:'04',title:'Precio por m²',text:`Es la medida que permite comparar inmuebles de distinto tamaño. Multiplicado por los ${num(est.area)} m² de ${basisLabel} de tu inmueble da el valor estimado.`},
      {tag:'05',title:'Gráfica y tabla',text:'Cada barra es el valor homologado por m² de un inmueble en venta de la zona. Rojo intenso: comparable directo (pesa 100%). Rojo claro: comparable con ajuste por alguna diferencia (pesa 50%).'},
      {tag:'06',title:'Precio de oferta y de cierre',text:'Los anuncios muestran precios de oferta; la operación final suele cerrarse ligeramente abajo tras la negociación. Por eso aplicamos un factor de negociación a cada precio publicado.'}]);
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
    r.h1('Lo que encontramos en el mercado',rent?'Comparación con inmuebles en renta':'Comparación con inmuebles en venta');
    r.funnel([
      {value:num(sources.length),label:'Fuentes consultadas',note:`${channelText.replace(/^\w/,(m:string)=>m.toUpperCase())}`},
      {value:String(nUsed),label:fromSales?'Inmuebles comparables en la zona':`Inmuebles comparables ${T.op}`,note:`${type}s en ${zone} con superficie y características parecidas`},
      {value:String(nUsed),label:'Utilizados en el cálculo',note:fromSales?`${nList?pl(nList,'inmueble en renta','inmuebles en renta')+' y ':''}${pl(est.saleCount||0,'inmueble parecido','inmuebles parecidos')} de la zona`:`${pl(est.direct||0,'comparable directo','comparables directos')}${est.adjusted?` y ${est.adjusted} con ajuste por diferencias menores`:''}`},
      ...(hasValue?[{value:M$(est.value),label:T.Value,note:`${T.range} de ${M$(est.low)} a ${M$(est.high)}${T.per}`}]:[])]);
    if(nList){
      r.h2(`${T.unitLabel} de cada comparable`);
      r.hbars([...est.listings].sort((a:Row,b:Row)=>b.unit-a.unit).map((c:Row)=>({label:clean(String(c.source||c.title||'Anuncio').split(/[;(]/)[0].trim()).slice(0,30),sub:c.direct?'Comparable directo':`Ajustado por ${c.difference}`,
        value:c.unit,display:M$(c.unit),color:c.direct?C.red:rgb(0.97,0.6,0.64)})),{labelWidth:165,refValue:fromSales?undefined:est.unit,refLabel:est.adjusted?'Promedio ponderado':'Referencia'});
      if(!fromSales) r.para(`La línea punteada marca ${rent?'la renta':'el precio'} ${est.adjusted?'ponderado':'de referencia'} de ${M$(est.unit)} por m², que aplicamos a los ${num(est.area)} m² de ${basisLabel} de tu inmueble para obtener ${rent?'la renta estimada':'el valor estimado'}.`,{size:8.4,color:C.muted});
      r.h2('Detalle de los comparables');
      r.table(['Fuente',rent?'Renta publicada':'Precio publicado','Construcción','Terreno',rent?'Renta homologada / m²':'Valor homologado / m²','Peso en el cálculo'],[128,84,68,60,74,106],
        est.listings.map((c:Row)=>[String(c.source||c.title||'Anuncio').split(/[;(]/)[0].trim(),M$(Number(c.price)),fmt(c.built_area_m2??c.area,' m²'),fmt(c.land_area_m2,' m²'),M$(c.unit),c.direct?'Directo · 100%':`Ajustado · 50%`]),
        {size:7.8,alignRight:[1,4]});
    }
    if(fromSales) r.callout('Complementamos con inmuebles parecidos de la zona',`Además de las rentas publicadas, analizamos ${pl(est.saleCount||0,'inmueble','inmuebles')} con las mismas características en ${zone} y el rendimiento que hoy generan las rentas de la colonia. Así la renta estimada refleja lo que el mercado paga por inmuebles como el tuyo.`,'neutral');
  }

  // ---- 4. recomendaciones ----
  r.newPage(received?'Siguientes pasos':'Recomendaciones');
  r.h1(received?'Qué sigue':'Nuestras recomendaciones','Siguientes pasos');
  if(hasValue&&rent){
    const ask=Math.min(round500(est.value*1.05),est.high);
    r.cards([
      {title:'Renta de publicación',text:`Recomendamos publicar alrededor de ${M$(ask)} mensuales. Se mantiene dentro del rango de mercado y deja margen para negociar con el inquilino adecuado.`},
      {title:'Contrato y garantías',text:'Sugerimos contrato por escrito, depósito en garantía de uno o dos meses, investigación del inquilino y póliza jurídica para proteger tu ingreso.'},
      {title:'Acompañamiento Círculo',text:'Nuestro equipo promueve tu inmueble en portales y redes, filtra prospectos, gestiona el contrato y puede administrar la renta por ti.'}]);
  } else if(hasValue){
    const ask=Math.min(round10k(est.value*1.05),est.high);
    r.cards([
      {title:'Precio de publicación',text:`Recomendamos publicar alrededor de ${M$(ask)}. Este precio se mantiene dentro del rango de mercado y deja un margen razonable para la negociación.`},
      {title:'Presentación del inmueble',text:'Fotografías profesionales, recorrido virtual y una descripción que resalte las mejoras hacen que el inmueble destaque frente a los comparables de la zona.'},
      {title:'Acompañamiento Círculo',text:'Nuestro equipo puede promover tu inmueble en portales y redes, atender prospectos y acompañarte hasta la firma. Si requieres un avalúo para crédito o trámite, lo coordinamos con perito.'}]);
    const rr=rentFromSale(data,est);
    if(rr){ r.h2('Valor agregado: tu inmueble en renta');
      r.callout(`Renta mensual estimada: ${M$(rr.value)}`,`Si prefieres rentarlo, de acuerdo con el mercado de renta de ${zone} tu inmueble podría rentarse entre ${M$(rr.low)} y ${M$(rr.high)} mensuales, considerando sus características y las de inmuebles parecidos de la zona.`,'neutral'); }
  } else if(!received) r.cards([
    {title:'Referencias adicionales',text:`Si conoces ${rent?'rentas':'ventas'} o anuncios recientes de inmuebles parecidos en la zona, compártelos y los integramos al análisis.`},
    {title:'Visita de nuestro equipo',text:'Un asesor de Círculo Internacional puede visitar el inmueble para complementar la comparación.'},
    {title:'Avalúo con perito',text:'Para crédito, juicio o trámite coordinamos un avalúo firmado por perito valuador.'}]);
  if(!received){
    r.h2('Metodología');
    r.bullets([
      `Partimos de la ficha del inmueble y de la documentación técnica de costos y valores de referencia.`,
      `Consultamos anuncios actuales ${T.op} de ${channelText} para ${type.toLowerCase()}s en ${place||'la zona'}, con ${rent?'renta':'precio'} y superficie publicados. Un mismo inmueble anunciado en varios portales cuenta una sola vez.`,
      `Homologamos cada comparable con los factores que emplean los peritos valuadores: negociación (de ${rent?'renta publicada a renta pactada':'precio de oferta a precio de cierre'}), superficie, edad (Ross-Heidecke) y estado de conservación, para llevarlo a las condiciones de tu inmueble.`,
      `Clasificamos cada inmueble como comparable directo (mismo tipo, zona, superficie ±30%, distribución, antigüedad y conservación) o comparable con ajuste cuando difiere en un solo aspecto, como conservación o antigüedad.`,
      fromSales?'Complementamos las rentas publicadas con inmuebles de las mismas características en la zona y el rendimiento que generan las rentas de la colonia, siguiendo el enfoque de capitalización de rentas que emplean los peritos valuadores.'
        :`Calculamos ${rent?'la renta homologada':'el valor homologado'} por m² de ${basisLabel} de cada comparable, ${rent?'la':'lo'} ponderamos (directos 100%, ajustados 50%) y ${rent?'la':'lo'} aplicamos a la superficie de tu inmueble. El rango refleja la dispersión de la muestra.`,
      ],{size:8.8});
    // En el informe de renta sólo se listan enlaces de anuncios de renta.
    const urls=(rent?(obs.rental_sources||[]):sources).filter((u:unknown)=>/^https?:\/\//.test(String(u))&&!(rent&&/venta|for-sale/i.test(String(u))));
    if(urls.length){
      r.h2('Fuentes consultadas');
      r.para(`Registramos ${num(sources.length)} enlaces públicos durante la búsqueda. Algunos de ellos:`,{size:8.6});
      for(const u of urls.slice(0,10)) r.para(String(u).replace(/^https?:\/\/(www\.)?/,'').slice(0,105),{size:7.2,color:C.muted,after:1});
      if(sources.length>Math.min(urls.length,10)) r.para(`Y ${num(sources.length-Math.min(urls.length,10))} enlaces más, conservados en el expediente.`,{size:7.6,color:C.muted});
    }
    r.newPage('Respaldo técnico');r.h1('Respaldo técnico','Fuentes de referencia');
    if(summary.documentary) r.callout(`Contrastamos ${num(summary.documentary)} datos técnicos de valor y costo`,`Costos de construcción, valores de referencia por zona y guías de precios de organismos del sector. Nos permiten confirmar que ${rent?'la renta estimada':'el valor estimado'} es congruente con los rangos de la zona.`,'neutral');
    if(library.length){r.h2('Biblioteca técnica');r.table(['Documento','Páginas','Uso en el análisis'],[270,50,200],library.slice(0,8).map((d:Row)=>[d.title,fmt(d.evidence?.page_count),'Referencia técnica de costos y valores']),{size:7.6});}
  }
  r.callout('Sobre este documento',`${T.product} elaborada por ValoraIA, la plataforma de análisis de Círculo Internacional Bienes Raíces, a partir del mercado inmobiliario actual. Para operaciones de crédito hipotecario, trámites fiscales o judiciales se requiere un avalúo firmado por perito valuador, que con gusto coordinamos. Contacto: contacto@circulointernacionalveracruz.org · 229 135 8056.`,'neutral');
  return r.save();
}

export async function saveDeliverable(admin:any,request:Row,config:Row,runId:string,snapshot:Row,previous:Row,reason:string,outcome:string) {
  const p=snapshot.property||{},intake=request.intake_data||{},c=request.valuation_cases||{};
  const documents=await Promise.all(snapshot.sources.map(async(s:Row)=>{const e=(s.kind==='case'?s.metadata:s.analysis)?.commercial_evidence;return {id:s.id,title:s.title,kind:s.kind,evidence:await validEvidence(e,request.organization_id,config.secret)?e:null};}));
  const subject={...intake,...p,property_type:request.property_type,locality:c.locality||intake.locality,municipality:c.municipality||intake.municipality,region:c.region||intake.region,area_basis:intake.comparison_area_basis||'auto'};
  const prior=previous.report_data||{},market=prior.pipeline?.market_diagnostics||{};
  const data:Row={version:REPORT_VERSION,kind:intake.report_kind==='rent'?'rent':'sale',sale_reference:market.sale_reference||null,outcome,reason,folio:c.folio||request.case_id,generated_at:new Date().toISOString(),generated_date:new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City'}).format(new Date()),subject,documents,subject_review:prior.pipeline?.subject_review,comparables:market.included||[],excluded:(market.excluded||[]).slice(0,72),excluded_summary:market.excluded_summary||null,market_observation:market.market||{},input_fingerprint:snapshot.fingerprint,previous_versions:prior.previous_versions||[],pipeline:{...prior.pipeline,run_id:runId,stage:outcome==='received'?'documents':'ready',heartbeat:new Date().toISOString()}};
  data.cost=costSummary(prior.pipeline||{});
  data.photos=[];let imageBytes=0;
  if(outcome!=='received')for(const s of snapshot.sources.filter((s:Row)=>s.kind!=='knowledge'&&/^image\/(jpeg|png)$/.test(s.mime_type||''))){try{const blob=check(await admin.storage.from(s.bucket).download(s.storage_path)),bytes=new Uint8Array(await blob.arrayBuffer());imageBytes+=bytes.length;if(imageBytes<=40000000)data.photos.push({title:s.title,mime_type:s.mime_type,bytes});else data.documents.push({id:s.id,title:s.title,evidence:{warnings:['La fotografía original se conserva en el expediente; no se incorporó por el límite de tamaño del PDF.']}});}catch{data.documents.push({id:s.id,title:s.title,evidence:{warnings:['No se pudo incorporar la imagen; el original permanece registrado para consulta.']}});}}
  data.client=request.client_name||null;
  const bytes=await deliverablePdf(data,await loadBrand()),path=`${request.organization_id}/${request.case_id}/commercial/${runId}-${outcome}.pdf`;
  data.photos=data.photos.map((p:Row)=>({title:p.title,mime_type:p.mime_type}));
  check(await admin.storage.from('valuation-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false}));
  if(previous.pdf_storage_path)data.previous_versions.push({path:previous.pdf_storage_path,generated_at:previous.generated_at});
  // Persist a compact ledger; complete catalog extractions stay in the library.
  data.documents=documents.map((d:Row)=>({...d,evidence:d.evidence?{complete:d.evidence.complete,page_count:d.evidence.page_count,completed_pages:d.evidence.completed_pages,summary:d.kind==='knowledge'?undefined:d.evidence.summary?.slice(0,1800),content_hash:d.evidence.content_hash,warnings:d.evidence.warnings?.slice(0,3),warning_count:d.evidence.warnings?.length||0}:null}));
  const est:Row=outcome==='received'?{value:null}:data.kind==='rent'?rentEstimate(data):marketEstimate(data);
  if(est.value)data.market_estimate={value:est.value,low:est.low,high:est.high,price_per_m2:Math.round(est.unit),confidence:est.confidence,direct:est.direct,adjusted:est.adjusted,basis:est.basis||'sale'};
  check(await admin.from('commercial_reports').update({status:outcome==='received'?'generating':'generated',report_data:data,pdf_storage_path:path,generated_at:data.generated_at,error_message:null,estimated_value:est.value||null,low_value:est.value?est.low:null,high_value:est.value?est.high:null,price_per_m2:est.value?Math.round(est.unit):null,comparable_count:est.value?(est.listings?.length||0)+(est.saleCount||0):data.comparables.length}).eq('request_id',request.id));
  check(await admin.from('service_requests').update({document_status:outcome==='received'?'generating':'ready',document_storage_path:path,document_generated_at:data.generated_at,document_emailed_at:null,status:'in_review'}).eq('id',request.id).eq('service_type','commercial'));
  return data;
}

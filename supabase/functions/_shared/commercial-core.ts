export const PIPELINE_VERSION = "commercial-evidence-3";
export const REPORT_VERSION = "commercial-report-3";
export type Row = Record<string, any>;

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[^\d.,+-]/g, "");
  if (!text || !/\d/.test(text)) return null;
  if (text.includes(".") && text.includes(",")) {
    text = text.lastIndexOf(".") > text.lastIndexOf(",")
      ? text.replace(/,/g, "")
      : text.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
  else if (text.includes(",")) text = text.replace(",", ".");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export const normalized = (value: unknown) => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function propertyType(value: unknown): string {
  const text = normalized(value);
  if (/departamento|apartamento|condominio|multifamiliar/.test(text)) return "departamento";
  if (/casa|vivienda unifamiliar|residencia/.test(text)) return "casa";
  if (/rancho|finca|agricola|ganader/.test(text)) return "rancho";
  if (/terreno|lote|suelo/.test(text)) return "terreno";
  if (/bodega|nave/.test(text)) return "bodega";
  if (/oficina/.test(text)) return "oficina";
  if (/local|comercio/.test(text)) return "local_comercial";
  if (/industrial/.test(text)) return "industrial";
  return text;
}

export function canonicalUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
      || host.includes(":") || /\.(local|internal|test|invalid)$/.test(host)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function validatePageCoverage(analysis: Row, pages: number[]) {
  if (!Array.isArray(analysis.pages)) throw new Error("No se recibió evidencia por página");
  const actual = analysis.pages.map((p: Row) => Number(p.page_number)).sort((a: number, b: number) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify([...pages].sort((a, b) => a - b))) {
    throw new Error("La extracción no acredita todas las páginas del bloque");
  }
  if (analysis.pages.some((p: Row) => p.readable !== true)) {
    throw new Error("Hay páginas ilegibles. Se requiere un archivo legible o revisión documental");
  }
  for (const field of [...(analysis.facts || []), ...(analysis.price_references || [])]) {
    if (!pages.includes(Number(field.page_number)) || !String(field.evidence || "").trim()) {
      throw new Error("Se recibió un dato sin evidencia y página verificables");
    }
  }
}

export function resolveSubject(property: Row, request: Row, documents: Row[], adopted: Row[] = []): Row {
  const caseRow = request.valuation_cases || {};
  const intake = request.intake_data || {};
  const subject: Row = {
    ...intake, ...property, property_type: propertyType(request.property_type || caseRow.property_type),
    locality: caseRow.locality || intake.locality || "",
    municipality: caseRow.municipality || intake.municipality || "",
    region: caseRow.region || intake.region || "",
    currency: caseRow.currency_code || request.payment_currency || "MXN",
    asking_price: numberValue(intake.asking_price),
    listing_url: canonicalUrl(intake.subject_listing_url),
    valuation_date: caseRow.valuation_date || new Date().toISOString().slice(0, 10),
    purpose: caseRow.purpose || "Opinión comercial",
    property_subtype: request.property_subtype || intake.property_subtype || "",
    property_notes: intake.property_notes || property.notes || "",
    evidence: [], warnings: [], conflicts: [],
  };
  const keys = ["address_line", "land_area_m2", "built_area_m2", "bedrooms", "bathrooms",
    "parking_spaces", "construction_year", "conservation_state", "construction_quality",
    "floors", "frontage_m", "depth_m", "saleable_area_m2", "rentable_area_m2", "postal_code"];
  const aliases: Row = { address: "address_line" };
  const numeric = new Set(["land_area_m2", "built_area_m2", "bedrooms", "bathrooms", "parking_spaces", "construction_year", "floors", "frontage_m", "depth_m", "saleable_area_m2", "rentable_area_m2"]);
  const candidates: Row = {};
  for (const doc of documents.filter((d) => d.kind !== "knowledge")) {
    for (const fact of doc.evidence.facts || []) {
      const key = aliases[fact.field_key] || fact.field_key;
      if (!keys.includes(key) || fact.scope !== "subject" || Number(fact.confidence) < 0.85) continue;
      let value = numeric.has(key) ? numberValue(fact.value) : fact.value;
      if (value === null || value === undefined || value === "") continue;
      if (/area_m2$/.test(key) && normalized(fact.unit) === "ha") value = Number(value) * 10000;
      (candidates[key] ||= []).push({ value, source: doc.title, page: fact.page_number, evidence: fact.evidence });
    }
  }
  for (const key of keys) {
    if (subject[key] === null || subject[key] === undefined || subject[key] === "") subject[key] = intake[key] ?? null;
    const manual = adopted.find((a) => (aliases[a.field_key] || a.field_key) === key && a.justification);
    const evidence = candidates[key] || [];
    if (manual) {
      subject[key] = numeric.has(key) ? numberValue(manual.value) : manual.value;
      subject.evidence.push({ field: key, value: subject[key], source: "Decisión revisada", reason: manual.justification });
      continue;
    }
    const declared = numeric.has(key) ? numberValue(subject[key]) : subject[key];
    const values = declared !== null && declared !== undefined && declared !== "" ? [{ value: declared, source: "Ficha capturada" }, ...evidence] : evidence;
    if (!values.length) continue;
    const critical = /area_m2$/.test(key);
    let disagreement = false;
    if (numeric.has(key)) {
      const numbers = values.map((v: Row) => numberValue(v.value)).filter((v: number | null) => v !== null);
      const min = Math.min(...numbers), max = Math.max(...numbers);
      disagreement = (max - min) / Math.max(Math.abs(max), 1) > (critical ? 0.03 : 0.01);
    } else disagreement = new Set(values.map((v: Row) => normalized(v.value))).size > 1;
    if (disagreement) {
      (critical ? subject.conflicts : subject.warnings).push({ field: key, candidates: values, reason: "Las fuentes presentan datos distintos; requieren conciliación" });
    } else {
      subject[key] = declared ?? values[0].value;
      subject.evidence.push({ field: key, value: subject[key], sources: evidence });
    }
  }
  subject.land_area_m2 = numberValue(subject.land_area_m2);
  subject.built_area_m2 = numberValue(subject.built_area_m2);
  subject.area_basis = ["terreno", "rancho"].includes(subject.property_type) ? "land" : "built";
  subject.area = subject.area_basis === "land" ? subject.land_area_m2 : subject.built_area_m2;
  if (!subject.area || subject.area <= 0) throw new Error("Falta la superficie de " + (subject.area_basis === "land" ? "terreno" : "construcción") + " aplicable; no se sustituirá por otra superficie");
  if (subject.conflicts.length) throw new Error("Hay discrepancias documentales de superficie. Resuélvelas en Conciliación antes de emitir la opinión");
  if (!subject.municipality || !subject.region) throw new Error("Faltan municipio y estado para localizar comparables");
  return subject;
}

function sameLocation(a: unknown, b: unknown): boolean {
  return !!normalized(a) && normalized(a) === normalized(b);
}
function ageDays(date: unknown, now: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  const value = new Date(String(date)).getTime();
  return Number.isFinite(value) ? (new Date(now).getTime() - value) / 86400000 : null;
}

export function selectComparables(subject: Row, inputs: Row[], retrievedUrls: string[], now: string): Row {
  const sources = new Set(retrievedUrls.map(canonicalUrl).filter(Boolean));
  const included: Row[] = [], excluded: Row[] = [];
  const reject = (c: Row, reason: string) => excluded.push({ ...c, exclusion_reason: reason });
  for (const input of inputs) {
    const c: Row = { ...input, property_type: propertyType(input.property_type) };
    c.url = canonicalUrl(c.url);
    c.price = numberValue(c.price);
    const area = numberValue(subject.area_basis === "land" ? c.land_area_m2 : c.built_area_m2);
    if (!c.price || c.price <= 0 || !area || area <= 0) { reject(c, "Faltan precio o superficie de la misma clase que el sujeto"); continue; }
    if (c.currency !== subject.currency) { reject(c, "Moneda diferente o no documentada"); continue; }
    if (!["offer", "closed_sale"].includes(c.operation_type) || c.price_basis !== "total") { reject(c, "El dato es renta, costo, valor fiscal, rango agregado u otra referencia"); continue; }
    if (c.property_type !== subject.property_type) { reject(c, "Tipo de inmueble distinto"); continue; }
    if (!sameLocation(c.region, subject.region) || !sameLocation(c.municipality, subject.municipality)
      || (subject.locality && !sameLocation(c.locality, subject.locality))) { reject(c, "Ubicación fuera del mercado definido"); continue; }
    if (area / subject.area < 0.7 || area / subject.area > 1.3) { reject(c, "Superficie fuera del margen de selección de 30%"); continue; }
    if (c.is_subject === true || (subject.listing_url && c.url === subject.listing_url)) { reject(c, "Es la propiedad analizada"); continue; }
    if (/\d/.test(subject.address_line || "") && normalized(c.address_line) === normalized(subject.address_line)) { reject(c, "La dirección corresponde al inmueble sujeto"); continue; }
    if (c.origin === "web") {
      if (!c.url || !sources.has(c.url)) { reject(c, "El enlace no figura entre las fuentes consultadas por la búsqueda"); continue; }
      if (!c.price_evidence || !c.area_evidence) { reject(c, "La búsqueda no devolvió evidencia de precio y superficie"); continue; }
    } else if (!c.source_id || !c.page_number || !c.evidence || Number(c.confidence) < 0.85) {
      reject(c, "Referencia documental sin evidencia suficiente"); continue;
    }
    const days = ageDays(c.date, now);
    if (days !== null && (days < -1 || days > 365)) { reject(c, "Referencia fuera del periodo de un año"); continue; }
    if (c.origin !== "web" && days === null) { reject(c, "El precio documental no acredita fecha; se conserva como contexto"); continue; }
    if (c.operation_type === "closed_sale" && !c.evidence) { reject(c, "No se acredita el cierre de la operación"); continue; }
    let mismatch = "";
    for (const key of ["bedrooms", "bathrooms", "parking_spaces"]) {
      const s = numberValue(subject[key]), v = numberValue(c[key]);
      if (s !== null && v !== null && Math.abs(s - v) > 1) mismatch = "Diferencia excesiva en " + key;
    }
    if (subject.area_basis === "built" && subject.land_area_m2 && c.land_area_m2 &&
      Math.abs(Number(c.land_area_m2) / subject.land_area_m2 - 1) > 0.4) mismatch = "Diferencia de terreno superior al 40%";
    if (subject.construction_quality && c.construction_quality && normalized(subject.construction_quality) !== normalized(c.construction_quality)) mismatch = "Calidad constructiva distinta; necesita homologación justificada";
    if (subject.floors && c.floors && Math.abs(Number(subject.floors) - Number(c.floors)) > 1) mismatch = "Número de niveles muy diferente";
    if (subject.conservation_state && c.conservation_state && normalized(subject.conservation_state) !== normalized(c.conservation_state)) mismatch = "Estado de conservación distinto; necesita homologación justificada";
    const sy = numberValue(subject.construction_year), cy = numberValue(c.construction_year);
    if (sy !== null && cy !== null && Math.abs(sy - cy) > 15) mismatch = "Antigüedad demasiado diferente";
    if (mismatch) { reject(c, mismatch); continue; }
    const comparableKeys = ["bedrooms", "bathrooms", "parking_spaces", "construction_year", "conservation_state"];
    const declaredKeys = comparableKeys.filter((key) => subject[key] !== null && subject[key] !== undefined && subject[key] !== "");
    if (subject.area_basis === "built" && declaredKeys.length >= 2 && declaredKeys.filter((key) => c[key] !== null && c[key] !== undefined && c[key] !== "").length < 2) {
      reject(c, "No acredita suficientes características para contrastar las especificaciones del sujeto"); continue;
    }
    c.area = area; c.unit = c.price / area; c.adjusted_unit = c.unit;
    if (numberValue(c.adjusted_unit_price) !== null && Math.abs(c.adjusted_unit_price / c.unit - 1) > 0.0001) {
      if (Number(c.adjusted_unit_price) <= 0) { reject(c, "El valor unitario ajustado no es positivo"); continue; }
      if (!c.adjustment_rationale || !c.reviewed) { reject(c, "Ajuste sin justificación y revisión acreditadas"); continue; }
      c.adjusted_unit = Number(c.adjusted_unit_price);
    }
    c.missing_specs = ["bedrooms", "bathrooms", "parking_spaces", "construction_year", "conservation_state"].filter((key) => subject[key] !== null && subject[key] !== undefined && subject[key] !== "" && (c[key] === null || c[key] === undefined || c[key] === ""));
    const duplicate = included.some((other) => (c.url && c.url === other.url)
      || (c.address_line && /\d/.test(c.address_line) && normalized(c.address_line) === normalized(other.address_line))
      || (c.duplicate_group && c.duplicate_group === other.duplicate_group)
      || (!c.address_line && !other.address_line && Math.abs(c.price / other.price - 1) < 0.005 && Math.abs(c.area / other.area - 1) < 0.005 && sameLocation(c.locality, other.locality)));
    if (duplicate) { reject(c, "Mismo anuncio o posible duplicado; no cuenta como evidencia independiente"); continue; }
    included.push(c);
  }
  // Ofertas y cierres no se mezclan: se usa la serie con al menos tres registros.
  const offers = included.filter((c) => c.operation_type === "offer");
  const closes = included.filter((c) => c.operation_type === "closed_sale");
  const chosen = closes.length >= 3 ? closes : offers;
  for (const c of included.filter((x) => !chosen.includes(x))) reject(c, "Serie de cierre/oferta diferente; se muestra como contexto");
  chosen.sort((a, b) => a.missing_specs.length - b.missing_specs.length || Math.abs(a.area / subject.area - 1) - Math.abs(b.area / subject.area - 1));
  if (chosen.length > 10) for (const c of chosen.splice(10)) reject(c, "Se conservan las diez referencias más semejantes");
  return { included: chosen, excluded };
}

export function marketStatistics(comparables: Row[], subject: Row): Row {
  if (comparables.length < 3) throw new Error("No se localizaron tres comparables independientes con evidencia suficiente");
  const units = comparables.map((c) => c.adjusted_unit).sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((sum, value) => sum + value, 0) / a.length;
  const middle = Math.floor(units.length / 2);
  const median = units.length % 2 ? units[middle] : (units[middle - 1] + units[middle]) / 2;
  const unitMean = mean(units), deviation = Math.sqrt(mean(units.map((n) => (n - unitMean) ** 2)));
  const cv = deviation / unitMean;
  if (cv > 0.35) throw new Error("La dispersión de comparables supera 35%; se requiere ampliar y revisar la muestra");
  const round = (n: number) => Math.round(n / 1000) * 1000;
  return {
    count: units.length, mean_total: mean(comparables.map((c) => c.price)),
    mean_unit: unitMean, median_unit: median, cv,
    unit: median, estimated: round(median * subject.area),
    low: round(Math.min(...units) * subject.area), high: round(Math.max(...units) * subject.area),
    range_kind: "Rango descriptivo de la muestra; no es intervalo estadístico de confianza",
    evidence_level: units.length >= 5 && comparables.every((c) => !c.missing_specs.length) ? "Moderada" : "Limitada",
    operation_type: comparables[0].operation_type,
  };
}

export function documentCandidates(documents: Row[]): Row[] {
  return documents.flatMap((doc) => (doc.evidence.price_references || []).map((reference: Row) => ({
    ...reference, origin: "pdf", source_id: doc.id, source: doc.title, source_hash: doc.evidence.content_hash,
    url: reference.source_url || null,
  })));
}

export function contextualReferences(subject: Row, documents: Row[]): Row[] {
  const seen = new Set<string>();
  return documentCandidates(documents).filter((r) => {
    const key = [r.source_hash, r.page_number, r.title, r.price, r.price_low, r.price_high].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    const type = propertyType(r.property_type);
    return type === subject.property_type || (type === "terreno" && subject.land_area_m2)
      || (r.operation_type === "construction_cost" && type === subject.property_type);
  }).map((r) => ({
    ...r, applicable_location: sameLocation(r.region, subject.region) && sameLocation(r.municipality, subject.municipality)
      && (!r.locality || sameLocation(r.locality, subject.locality)),
    treatment: r.operation_type === "construction_cost"
      ? "Contexto del enfoque de costos. Requiere modelo constructivo, alcance, factor regional y depreciación acreditados."
      : r.operation_type === "land_reference"
      ? "Referencia de suelo por zona. No se promedia con el precio por m2 de una casa terminada."
      : ["cadastral_value", "historical_valuation"].includes(r.operation_type)
      ? "Antecedente documental; conserva su fecha y finalidad, sin tratarlo como precio actual de venta."
      : "Referencia documental evaluada; sólo aporta al promedio si cumple los filtros de comparabilidad.",
  }));
}

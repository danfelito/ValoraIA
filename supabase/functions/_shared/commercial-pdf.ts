import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import type { Row } from "./commercial-core.ts";

const clean = (value: unknown) => String(value ?? "").replace(/[–—]/g, "-")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF\n]/g, " ");
const money = (value: number, currency = "MXN") => new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const quantity = (value: unknown) => value === null || value === undefined || value === "" ? "No acreditado" : String(value);
const green = rgb(0.06, 0.31, 0.24), ink = rgb(0.12, 0.22, 0.19), muted = rgb(0.40, 0.46, 0.44);
const light = rgb(0.92, 0.97, 0.94), gold = rgb(0.72, 0.49, 0.15);
const labels: Row = { address_line: "Dirección", land_area_m2: "Superficie de terreno", built_area_m2: "Superficie construida", bedrooms: "Recámaras", bathrooms: "Baños", parking_spaces: "Estacionamientos", postal_code: "Código postal", floors: "Niveles", frontage_m: "Frente", depth_m: "Fondo", saleable_area_m2: "Superficie vendible", rentable_area_m2: "Superficie rentable", asking_price: "Precio solicitado", property_type: "Tipo de inmueble", municipality: "Municipio", region: "Estado", locality: "Colonia / localidad", purpose: "Finalidad", property_subtype: "Subtipo de inmueble", property_notes: "Descripción del cliente", construction_year: "Año de construcción", conservation_state: "Conservación", construction_quality: "Calidad constructiva", offer: "Oferta de venta", closed_sale: "Venta documentada", rent: "Renta", land_reference: "Referencia de suelo", construction_cost: "Costo de construcción", cadastral_value: "Valor catastral", historical_valuation: "Avalúo histórico", other: "Otra referencia", total: "Precio total", m2_built: "m2 de construcción", m2_land: "m2 de terreno", ha: "Hectárea" };
const label = (value: string) => labels[value] || value;

function wrap(value: unknown, font: any, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const proposed = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(proposed, size) <= width) line = proposed;
      else {
        if (line) lines.push(line);
        line = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = char; }
          else line += char;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function commercialPdf(data: Row): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("ValoraIA - Opinión de valor comercial " + data.folio);
  doc.setAuthor("ValoraIA");
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const s = data.subject, stats = data.statistics, currency = s.currency || "MXN";
  let page: any, y = 724;
  const newPage = (title = "") => {
    page = doc.addPage([612, 792]); y = 713;
    page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: green });
    page.drawText("ValoraIA", { x: 46, y: 760, size: 15, font: bold, color: rgb(1, 1, 1) });
    page.drawText(clean(data.folio), { x: 410, y: 763, size: 8, font: regular, color: rgb(0.85, 0.94, 0.9) });
    if (title) heading(title);
  };
  const ensure = (height: number) => { if (y - height < 58) newPage(); };
  const heading = (value: string) => {
    ensure(55);
    page.drawText(clean(value), { x: 46, y, size: 16, font: bold, color: green });
    y -= 28;
  };
  const text = (value: unknown, size = 10, emphasis = false, gap = 9) => {
    const font = emphasis ? bold : regular;
    for (const line of wrap(value, font, size, 520)) {
      ensure(size + 6);
      page.drawText(line, { x: 46, y, size, font, color: ink }); y -= size + 4;
    }
    y -= gap;
  };
  const table = (headers: string[], widths: number[], rows: unknown[][]) => {
    const draw = (values: unknown[], header: boolean) => {
      const size = header ? 8.5 : 8.7, font = header ? bold : regular;
      const cells = values.map((value, i) => wrap(value, font, size, widths[i] - 14));
      const height = Math.max(1, ...cells.map((c) => c.length)) * (size + 4) + 12;
      if (y - height < 58) { newPage(); if (!header) draw(headers, true); }
      let x = 46;
      values.forEach((_, i) => {
        page.drawRectangle({ x, y: y - height + 5, width: widths[i], height, color: header ? green : light, borderColor: rgb(1, 1, 1), borderWidth: 1 });
        cells[i].forEach((line, n) => page.drawText(line, { x: x + 7, y: y - 8 - n * (size + 4), size, font, color: header ? rgb(1, 1, 1) : ink }));
        x += widths[i];
      });
      y -= height;
    };
    draw(headers, true); rows.forEach((row) => draw(row, false)); y -= 18;
  };

  newPage();
  text("OPINIÓN DE VALOR COMERCIAL", 22, true, 14);
  if (data.preview) text("VISTA PREVIA PRIVADA - PENDIENTE DE REVISIÓN", 11, true, 12);
  if (data.demo) text("DEMOSTRACIÓN DE DISEÑO - DATOS SIMULADOS", 11, true, 12);
  text("Fecha de emisión: " + data.generated_date + " | Moneda: " + currency, 9, false, 12);
  text("Estimación orientativa para decisiones de comercialización. Elaborada a partir del expediente y de evidencia pública de mercado. No constituye un avalúo profesional firmado.", 10.5, false, 14);
  const boxTop = y + 3;
  page.drawRectangle({ x: 46, y: boxTop - 120, width: 520, height: 126, color: light, borderColor: rgb(0.5, 0.75, 0.64), borderWidth: 1 });
  page.drawText("Opinión central de valor", { x: 63, y: boxTop - 21, size: 11, font: bold, color: green });
  page.drawText(money(stats.estimated, currency), { x: 63, y: boxTop - 54, size: 30, font: bold, color: green });
  page.drawText(clean("Rango observado: " + money(stats.low, currency) + " a " + money(stats.high, currency)), { x: 63, y: boxTop - 78, size: 11, font: regular, color: ink });
  page.drawText(clean(money(stats.unit, currency) + "/m2 de " + (s.area_basis === "land" ? "terreno" : "construcción") + " | Muestra: " + stats.count), { x: 63, y: boxTop - 101, size: 10, font: regular, color: ink });
  y = boxTop - 145;
  heading("Resumen del análisis");
  text(s.property_type + " en " + [s.locality, s.municipality, s.region].filter(Boolean).join(", "), 12, true);
  text("Solicitante: " + data.client);
  text("Superficie utilizada: " + s.area + " m2 de " + (s.area_basis === "land" ? "terreno" : "construcción") + ".");
  text("Se evaluaron " + data.documents.length + " archivos o fuentes, con " + data.documents.reduce((n: number, d: Row) => n + d.evidence.page_count, 0) + " páginas o unidades de lectura. Los documentos duplicados se registran y no multiplican la muestra.");
  text("La cifra central usa la mediana de los valores unitarios de " + stats.count + " " + (stats.operation_type === "offer" ? "ofertas" : "cierres documentados") + " seleccionados. El promedio aritmético también se muestra para facilitar la comparación.");
  if (s.asking_price) text("Precio anunciado del sujeto: " + money(s.asking_price, currency) + ". Diferencia respecto de la opinión central: " + ((s.asking_price / stats.estimated - 1) * 100).toFixed(1) + "%.");
  text("Soporte de la muestra: " + stats.evidence_level + ". El rango representa la dispersión de las referencias; no es una garantía de venta ni un intervalo de confianza.", 9);

  newPage("1. Inmueble y evidencia documental");
  table(["Dato", "Valor utilizado"], [185, 335], [
    ["Dirección declarada", s.address_line || "No indicada"],
    ["Terreno / construcción", quantity(s.land_area_m2) + " m2 / " + quantity(s.built_area_m2) + " m2"],
    ["Recámaras / baños / estacionamientos", [s.bedrooms, s.bathrooms, s.parking_spaces].map(quantity).join(" / ")],
    ["Año de construcción", quantity(s.construction_year)],
    ["Conservación / calidad constructiva", quantity(s.conservation_state) + " / " + quantity(s.construction_quality)],
    ["Fecha de referencia", s.valuation_date],
    ["Finalidad / subtipo", quantity(s.purpose) + " / " + quantity(s.property_subtype)],
    ["Código postal / niveles", quantity(s.postal_code) + " / " + quantity(s.floors)],
    ["Frente / fondo", quantity(s.frontage_m) + " m / " + quantity(s.depth_m) + " m"],
    ["Superficie vendible / rentable", quantity(s.saleable_area_m2) + " m2 / " + quantity(s.rentable_area_m2) + " m2"],
  ]);
  text("La ficha y los documentos se contrastan. Las superficies incompatibles deben resolverse antes de calcular. Los demás datos faltantes o discrepantes se declaran expresamente.", 9);
  if (s.property_notes || s.notes) {
    heading("Descripción proporcionada por el cliente");
    text(s.property_notes || s.notes);
    text("Esta descripción se conserva como evidencia declarada. Las características no verificadas no reciben ajustes monetarios automáticos; deben contrastarse con los documentos, la inspección y los anuncios.", 9);
  }
  heading("Documentos considerados");
  table(["Fuente", "Lectura", "Aportación"], [215, 65, 240], data.documents.map((d: Row) => [
    d.title, d.evidence.completed_pages + "/" + d.evidence.page_count,
    d.evidence.duplicate_of ? "Archivo duplicado; lectura reutilizada con contenido idéntico"
      : d.kind === "knowledge" ? "Referencia técnica: " + (d.category || "general") + ". " + (d.evidence.price_references.length) + " datos de precio"
      : "Datos del inmueble y antecedentes. " + d.evidence.facts.length + " hechos extraídos",
  ]));
  if (!data.documents.length) text("No se aportaron archivos. La opinión utiliza la ficha declarada y las fuentes web; queda indicada esta limitación.");
  for (const evidence of s.evidence || []) {
    if (evidence.sources?.length || evidence.reason) text(label(evidence.field) + ": " + quantity(evidence.value) + ". " + (evidence.reason || evidence.sources.map((e: Row) => e.source + ", p. " + e.page).join("; ")), 8.8);
  }
  for (const warning of s.warnings || []) text("Dato por confirmar: " + label(warning.field) + ". " + warning.reason, 9);

  if (data.subject_review) {
    heading("Revisión de la información proporcionada");
    for (const item of data.subject_review.observations || []) text(item, 9);
    for (const item of data.subject_review.documentary_contrasts || []) text("Contraste documental: " + item, 9);
    for (const item of data.subject_review.missing_information || []) text("Por confirmar: " + item, 9);
  }
  if (data.input_usage?.captured_intake && Object.keys(data.input_usage.captured_intake).length) {
    heading("Registro de la información capturada");
    for (const [field, value] of Object.entries(data.input_usage.captured_intake)) {
      text(label(field) + ": " + quantity(typeof value === "object" ? JSON.stringify(value) : value), 8.7, false, 4);
    }
    text("Los datos de contacto, consentimiento, facturación y pago se conservan para la gestión del servicio. No determinan el valor del inmueble ni se incluyen en la búsqueda pública de comparables.", 8.8);
  }
  newPage("2. Comparación de mercado");
  table(["Ref.", "Origen / fecha", "Precio", "Superficie", "Precio/m2"], [35, 140, 115, 100, 130], data.comparables.map((c: Row, i: number) => [
    "C" + (i + 1), (c.origin === "web" ? "Web" : "PDF p. " + c.page_number) + "\n" + (c.date || "Fecha de publicación no acreditada"),
    money(c.price, currency), c.area + " m2\n" + (s.area_basis === "land" ? "terreno" : "construcción"), money(c.adjusted_unit, currency),
  ]));
  table(["Indicador de la muestra", "Resultado"], [300, 220], [
    ["Promedio de precios totales anunciados", money(stats.mean_total, currency)],
    ["Promedio unitario de comparables", money(stats.mean_unit, currency) + "/m2"],
    ["Mediana unitaria utilizada", money(stats.median_unit, currency) + "/m2"],
    ["Dispersión relativa (coeficiente de variación)", (stats.cv * 100).toFixed(1) + "%"],
    ["Cantidad de referencias independientes", stats.count],
  ]);
  text("Los precios totales describen inmuebles de diferentes tamaños dentro del filtro de selección. La opinión del sujeto se calcula sobre su superficie usando la misma base de comparación.", 9);
  for (const [i, c] of data.comparables.entries()) {
    ensure(105);
    text("C" + (i + 1) + ". " + c.title, 10, true, 3);
    text("Ubicación: " + [c.locality, c.municipality, c.region].filter(Boolean).join(", ") + ". Recámaras/baños/estacionamientos: " + [c.bedrooms, c.bathrooms, c.parking_spaces].map(quantity).join("/") + ".", 8.8, false, 3);
    if (c.missing_specs.length) text("Características no acreditadas en la referencia: " + c.missing_specs.map(label).join(", ") + ".", 8.5, false, 3);
    text("Fuente: " + c.source + (c.origin === "pdf" ? " | página " + c.page_number : " | consultada " + data.generated_date), 8.5, false, 3);
    if (c.url) text(c.url, 7.8, false, 8);
    if (c.adjustment_rationale) text("Ajuste registrado: " + c.adjustment_rationale, 8.5);
  }

  newPage("3. Gráficas de comparación");
  text("Precio unitario de cada referencia y promedio de la muestra", 11, true, 5);
  const maxUnit = Math.max(...data.comparables.map((c: Row) => c.adjusted_unit), stats.mean_unit) * 1.28;
  const plotX = 89, plotWidth = 330;
  const averageX = plotX + stats.mean_unit / maxUnit * plotWidth;
  data.comparables.forEach((c: Row, i: number) => {
    ensure(28);
    const rowY = y - 16, barWidth = c.adjusted_unit / maxUnit * plotWidth;
    page.drawText("C" + (i + 1), { x: 48, y: rowY + 2, size: 9, font: bold, color: ink });
    page.drawRectangle({ x: plotX, y: rowY, width: barWidth, height: 13, color: green });
    page.drawText(clean(money(c.adjusted_unit, currency)), { x: plotX + barWidth + 6, y: rowY + 2, size: 8.5, font: regular, color: ink });
    page.drawLine({ start: { x: averageX, y: y + 2 }, end: { x: averageX, y: y - 24 }, thickness: 1.5, color: gold });
    y -= 24;
  });
  y -= 20;
  text("Línea dorada: promedio unitario " + money(stats.mean_unit, currency) + "/m2. La comparación utiliza exclusivamente " + (s.area_basis === "land" ? "superficie de terreno" : "superficie construida") + ".", 8.8);
  heading("Superficie y precio total");
  ensure(245);
  const left = 94, bottom = y - 190, pw = 414, ph = 166;
  const allPoints = [...data.comparables.map((c: Row, i: number) => ({ area: c.area, price: c.price, label: "C" + (i + 1), subject: false })),
    { area: s.area, price: stats.estimated, label: "S", subject: true }];
  const maxArea = Math.max(...allPoints.map((p) => p.area)) * 1.15, maxPrice = Math.max(...allPoints.map((p) => p.price)) * 1.2;
  for (let t = 0; t <= 4; t++) {
    const yy = bottom + t / 4 * ph, xx = left + t / 4 * pw;
    page.drawLine({ start: { x: left, y: yy }, end: { x: left + pw, y: yy }, thickness: 0.4, color: rgb(0.8, 0.85, 0.82) });
    page.drawText((maxPrice * t / 4 / 1000000).toFixed(2) + " M", { x: 48, y: yy - 3, size: 8, font: regular, color: muted });
    page.drawText(Math.round(maxArea * t / 4).toString(), { x: xx - 8, y: bottom - 16, size: 8, font: regular, color: muted });
  }
  allPoints.forEach((point) => {
    const x = left + point.area / maxArea * pw, yy = bottom + point.price / maxPrice * ph;
    page.drawCircle({ x, y: yy, size: point.subject ? 5 : 3.5, color: point.subject ? gold : green });
    page.drawText(point.label, { x: x + 6, y: yy + (point.subject ? -12 : 3), size: 8, font: bold, color: ink });
  });
  page.drawText("Superficie (m2)", { x: 260, y: bottom - 32, size: 9, font: regular, color: ink });
  y = bottom - 52;
  text("Verde: referencias de mercado. S dorada: superficie del sujeto y opinión central. Eje vertical: millones de " + currency + ".", 9);
  if (s.asking_price) text("Precio solicitado frente a la opinión: " + money(s.asking_price, currency) + " vs. " + money(stats.estimated, currency) + ". Diferencia: " + ((s.asking_price / stats.estimated - 1) * 100).toFixed(1) + "%.", 10, true);

  newPage("4. Fuentes documentales y sondeo público");
  text("Cada dato documental conserva la fuente, página, fecha y finalidad. Su presencia en el expediente no implica que sea un precio de venta comparable.", 10);
  const refs = data.contextual_references || [];
  if (!refs.length) text("Los documentos analizados no aportaron referencias monetarias compatibles con el tipo de inmueble. Esto no reemplaza las demás aportaciones documentales.");
  for (const r of refs) {
    ensure(120);
    text(r.title + " | " + label(r.operation_type), 10, true, 3);
    const value = r.price_low !== null && r.price_low !== undefined && r.price_high !== null && r.price_high !== undefined
      ? money(r.price_low, r.currency || currency) + " a " + money(r.price_high, r.currency || currency)
      : r.price !== null && r.price !== undefined ? money(r.price, r.currency || currency) : "Importe no acreditado";
    text(value + " | Base: " + label(r.price_basis) + " | Fecha: " + (r.date || "No acreditada") + ".", 9, false, 3);
    text("Fuente: " + r.source + ", p. " + r.page_number + ". Ubicación: " + [r.locality, r.municipality, r.region].filter(Boolean).join(", "), 8.8, false, 3);
    text(r.treatment + (r.applicable_location ? "" : " Su cobertura geográfica no coincide plenamente con el sujeto."), 9);
    const included = data.comparables.some((c: Row) => c.source_hash === r.source_hash && c.page_number === r.page_number && c.title === r.title);
    text(included ? "Se incorporó a la muestra de mercado al cumplir los filtros de comparabilidad." : "Se conservó como contexto técnico o antecedente; no se promedió con las ofertas actuales.", 8.7);
    if (r.applicable_location && ["historical_valuation", "cadastral_value"].includes(r.operation_type)) {
      const area = Number(s.area_basis === "land" ? r.land_area_m2 : r.built_area_m2);
      if (r.price_basis === "total" && area > 0 && r.price > 0) {
        const unit = r.price / area;
        text("Contraste documental: " + money(unit, currency) + "/m2 en su fecha de referencia, frente a " + money(stats.unit, currency) + "/m2 de la muestra actual. Diferencia descriptiva: " + ((stats.unit / unit - 1) * 100).toFixed(1) + "%. No representa una actualización temporal ni una equivalencia de finalidad.", 8.8);
      }
    }
  }

  text("Los costos de construcción requieren modelo compatible, alcance, ajuste regional, fecha y depreciación. Cuando estos insumos no están acreditados, se documenta la referencia y no se calcula un valor físico artificial. El mismo criterio se aplica a ingresos y desarrollo residual.", 9);

  heading("Sondeo de portales y redes públicas");
  const survey = data.market_observation?.survey || [];
  if (!survey.length) text("Este informe no acredita una consulta de redes sociales. Sólo se consideran las fuentes expresamente registradas.", 9);
  for (const entry of survey) {
    text(entry.channel + ": " + (entry.reason || entry.status) + ". Enlaces de consulta acreditados: " + (entry.urls || []).length + ".", 9);
    for (const url of entry.urls || []) text(url, 7.8, false, 4);
  }
  text("Las publicaciones sin precio, superficie o acceso verificable no se incorporan a la muestra. Un mismo inmueble en una red y en un portal cuenta una sola vez.", 9);

  newPage("5. Metodología y conclusión razonada");
  const location = [s.locality, s.municipality, s.region].filter(Boolean).join(", ");
  text("Mercado definido: " + s.property_type + " en " + location + ". Se exigió tipo y moneda compatibles, igual base de superficie, ubicación coincidente y un margen de superficie de 30%. Se revisaron recámaras, baños, estacionamiento, terreno, antigüedad y conservación cuando la fuente los acredita.");
  text("Se descartaron la propiedad sujeto, duplicados, rentas y datos sin fuente o precio/superficie suficientes. Las referencias documentales necesitan fecha dentro de un año para integrar la muestra. Una oferta web sin fecha de publicación se identifica como tal; la fecha de consulta no acredita su disponibilidad.");
  text("Selección por similitud: no se aplican coeficientes monetarios automáticos por acabados, edad o negociación. Si existe una homologación registrada y revisada, se conserva su justificación y valor unitario ajustado.");
  text("Resultado: mediana unitaria " + money(stats.unit, currency) + "/m2 por " + s.area + " m2 = opinión central " + money(stats.estimated, currency) + " (redondeada a miles). Promedio unitario: " + money(stats.mean_unit, currency) + "/m2. Rango descriptivo: " + money(stats.low, currency) + " a " + money(stats.high, currency) + ".");
  text("La dispersión relativa de " + (stats.cv * 100).toFixed(1) + "% y una muestra de " + stats.count + " referencias determinan el alcance del soporte disponible. " + (stats.count < 5 ? "La muestra es reducida; ampliar referencias y confirmar características mejoraría la precisión." : "El resultado debe contrastarse con el estado físico y las condiciones reales de negociación."));
  if (s.asking_price) text("El precio anunciado de " + money(s.asking_price, currency) + (s.asking_price >= stats.low && s.asking_price <= stats.high ? " se encuentra dentro" : " se encuentra fuera") + " del rango observado. Esto orienta la decisión de comercialización y no confirma un precio de cierre.");
  heading("Información por confirmar");
  text("Visita al inmueble, conservación real, acabados, ocupación, medidas documentales, régimen de propiedad y condiciones jurídicas. Confirmar vigencia, disponibilidad y características faltantes de los anuncios. La extracción documental no certifica titularidad ni ausencia de gravámenes.");
  if (data.excluded.length) {
    heading("Referencias excluidas");
    for (const e of data.excluded) text((e.title || e.source || "Referencia") + ": " + e.exclusion_reason + ".", 8.8);

  }
  heading("Enfoques técnicos evaluados");
  text("Mercado: aplicado con la muestra y filtros documentados. Costos: se conserva el contexto de los PDF, pero sólo puede calcularse un valor físico cuando se acreditan modelo constructivo, fecha, alcance, factor regional, obras exteriores, accesorios y depreciación. Ingresos: requiere rentas, vacancia, gastos y tasa sustentada. Residual: requiere proyecto permitido, costos, tiempos y comercialización. Los enfoques sin insumos suficientes no se presentan como calculados.", 9);
  heading("Solicitud de avalúo con perito");
  text("Para un avalúo profesional, elige la modalidad 'Avalúo con perito' en ValoraIA. El expediente pasa a asignación por especialidad y ubicación; el profesional recibe la solicitud por correo cuando el remitente está configurado. Su inspección, honorarios, entrega y firma se acuerdan en ese flujo.");
  text("Este documento no se presenta como avalúo firmado, certificado, fiscal, hipotecario, judicial ni de garantía. Su alcance es una opinión comercial orientativa.", 9, true);

  if (data.photos?.length) {
    newPage("6. Evidencia fotográfica aportada");
    for (const photo of data.photos) {
      ensure(240);
      text(photo.title, 10, true, 6);
      const image = photo.mime_type === "image/png" ? await doc.embedPng(photo.bytes) : await doc.embedJpg(photo.bytes);
      const dimensions = image.scaleToFit(520, 200);
      page.drawImage(image, {x:46+(520-dimensions.width)/2,y:y-dimensions.height,width:dimensions.width,height:dimensions.height});
      y -= dimensions.height + 18;
    }
    text("Fotografías proporcionadas en el expediente. La lectura de imágenes no sustituye la inspección física.", 9);
  }
  doc.getPages().forEach((p: any, i: number) => {
    p.drawLine({ start: { x: 46, y: 42 }, end: { x: 566, y: 42 }, thickness: 0.5, color: rgb(0.7, 0.78, 0.75) });
    p.drawText(clean("ValoraIA | " + data.folio + " | " + (data.demo ? "Datos simulados" : "Opinión comercial") + " | Página " + (i + 1) + " de " + doc.getPageCount()), { x: 46, y: 25, size: 7.5, font: regular, color: muted });
  });
  return doc.save();
}

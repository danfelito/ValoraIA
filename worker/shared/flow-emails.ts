// Textos de los avisos por correo. Sin dependencias: se prueba con node --test.
type Row = Record<string, any>;
// Dirección pública del sitio.
const SITE = ((globalThis as any).Deno?.env?.get?.("VALORAIA_PUBLIC_URL") || "https://valoraia.circulointernacionalveracruz.org").replace(/\/$/, "");
const SUPPORT = "contacto@circulointernacionalveracruz.org";
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const firstName = (name: unknown) => String(name || "").trim().split(/\s+/)[0] || "";

export function layout(title: string, paragraphs: string[], button?: { label: string; url: string }, note?: string) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f3f3;font-family:Arial,Helvetica,sans-serif;color:#1c1c1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0a0a0a;padding:18px 28px;color:#ffffff;font-size:17px;font-weight:bold">ValoraIA <span style="color:#ed1c2e">·</span> Círculo Internacional Bienes Raíces</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0a0a0a">${esc(title)}</h1>
${paragraphs.map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${p}</p>`).join("\n")}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#ed1c2e;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px;font-size:15px">${esc(button.label)}</a></p>` : ""}
${note ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#666666">${note}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e6e6e6;font-size:12px;line-height:1.5;color:#777777">¿Algo no salió como esperabas? Responde este correo o escribe a <a href="mailto:${SUPPORT}" style="color:#ed1c2e">${SUPPORT}</a> para pedir una revisión.<br>Nuestras opiniones de valor y de renta son orientativas y no sustituyen un avalúo profesional firmado.</td></tr>
</table></td></tr></table></body></html>`;
  const strip = (s: string) => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title, "", ...paragraphs.map(strip), ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(note ? ["", strip(note)] : []), "", `Soporte: ${SUPPORT}`].join("\n");
  return { html, text };
}

export function renderEmail(kind: string, request: Row, extra: { report?: Row | null; downloadUrl?: string | null; attached?: boolean; isDocument?: boolean } = {}) {
  const folio = request.valuation_cases?.folio || "tu solicitud", hello = firstName(request.client_name) ? `Hola ${esc(firstName(request.client_name))}:` : "Hola:";
  const tracking = `${SITE}/servicios.html?tipo=comercial&pago=regreso&solicitud=${encodeURIComponent(request.id)}`;
  const waived = request.payment_provider === "admin_waiver";
  const rent = request.intake_data?.report_kind === "rent", product = rent ? "opinión de renta" : "opinión de valor comercial";
  const outcome = extra.report?.report_data?.outcome, reason = extra.report?.report_data?.reason || extra.report?.error_message || "";
  const amount = Number(request.payment_amount) > 0 ? `$${Number(request.payment_amount).toLocaleString("es-MX")} ${request.payment_currency || "MXN"}` : "";

  if (kind === "payment_received") {
    const body = layout(waived ? "Registramos tu solicitud" : "Recibimos tu pago", [hello,
      waived ? `Tu solicitud de ${product} quedó registrada con el folio <strong>${esc(folio)}</strong>.`
             : `Confirmamos tu pago${amount ? ` de <strong>${esc(amount)}</strong>` : ""} por la ${product}, folio <strong>${esc(folio)}</strong>.`,
      "Ya estamos leyendo tu información y consultando referencias de mercado. Normalmente toma unos minutos; si tu expediente necesita una revisión adicional, también te avisaremos.",
      "<strong>Te enviaremos otro correo en cuanto tu documento esté listo.</strong> No necesitas dejar la página abierta."],
      { label: "Ver el avance", url: tracking }, "El enlace de avance funciona en el mismo navegador donde hiciste la solicitud.");
    return { subject: `${waived ? "Registramos tu solicitud" : "Recibimos tu pago"} · folio ${folio}`, ...body };
  }
  if (kind === "document_ready") {
    const estimated = outcome === "estimated" || !outcome || !!extra.report?.report_data?.market_estimate?.value;
    const body = layout(estimated ? `Tu ${product} está lista` : "Tu informe de análisis está disponible", [hello,
      estimated ? `Terminamos el análisis del folio <strong>${esc(folio)}</strong>. Tu documento incluye ${rent ? "la renta mensual estimada" : "el valor estimado"}, el rango, los comparables utilizados y la metodología.`
                : `Terminamos de revisar el folio <strong>${esc(folio)}</strong>. Con la evidencia disponible no fue posible sustentar una cifra confiable, así que tu documento explica qué se encontró y qué información hace falta.`,
      ...(!estimated && reason ? [`<strong>Motivo:</strong> ${esc(reason)}`] : []),
      ...(!estimated ? ["Si quieres que lo revisemos contigo o completar información, responde este correo."] : []),
      extra.attached ? "Va adjunto en PDF y también puedes descargarlo con el botón." : "Puedes descargarlo con el botón."],
      extra.downloadUrl ? { label: "Descargar PDF", url: extra.downloadUrl } : undefined,
      "El enlace de descarga vence en 7 días. No lo compartas: da acceso directo a tu documento.");
    return { subject: `${estimated ? (rent ? "Tu opinión de renta está lista" : "Tu opinión de valor está lista") : "Tu informe de análisis está disponible"} · folio ${folio}`, ...body };
  }
  if (kind === "needs_review") {
    const body = layout("Tu expediente requiere una revisión", [hello,
      `${waived ? "Tu solicitud" : "Tu pago"} del folio <strong>${esc(folio)}</strong> está ${waived ? "registrada" : "confirmado"}, pero la información necesita una revisión antes de emitir una cifra confiable.`,
      ...(reason ? [`<strong>Motivo:</strong> ${esc(reason)}`] : []),
      "Nuestro equipo ya fue notificado y te contactará. Si tienes documentos más legibles o datos adicionales, puedes responder este correo para adelantar."]);
    return { subject: `Tu expediente requiere revisión · folio ${folio}`, ...body };
  }
  if (kind === "payment_failed") {
    const body = layout("No pudimos procesar tu pago", [hello,
      `El pago del folio <strong>${esc(folio)}</strong> no fue aprobado${request.payment_error ? `: ${esc(request.payment_error)}` : "."}`,
      "No se hizo ningún cargo. Puedes intentarlo de nuevo con otra tarjeta o método de pago."],
      { label: "Intentar de nuevo", url: `${SITE}/servicios.html?tipo=comercial` });
    return { subject: `No pudimos procesar tu pago · folio ${folio}`, ...body };
  }
  // Avisos para el administrador
  const titles: Row = { admin_payment_received: waived ? "Nueva solicitud (administrador, sin pago)" : "Nuevo pago recibido",
    admin_document_ready: outcome && outcome !== "estimated" && !extra.report?.report_data?.market_estimate?.value ? "Documento entregado SIN cifra" : rent ? "Opinión de renta generada" : "Documento generado", admin_needs_review: "Expediente detenido: requiere revisión" };
  const body = layout(titles[kind] || "Aviso de ValoraIA", [
    `<strong>Folio:</strong> ${esc(folio)}`,
    `<strong>Cliente:</strong> ${esc(request.client_name)} · ${esc(request.client_email)} · ${esc(request.client_phone || "sin teléfono")}`,
    `<strong>Servicio:</strong> ${rent ? "Opinión de renta" : "Opinión de valor comercial"}`,
    `<strong>Inmueble:</strong> ${esc(request.property_type)} · ${esc(request.intake_data?.municipality || "")} ${esc(request.intake_data?.region || "")}`,
    ...(amount && !waived ? [`<strong>Pago:</strong> ${esc(amount)} (${esc(request.payment_method || request.payment_provider || "")})`] : []),
    ...(reason && kind !== "admin_payment_received" ? [`<strong>Motivo:</strong> ${esc(reason)}`] : []),
    kind === "admin_needs_review" ? "El cliente ya recibió un aviso de que su expediente está en revisión. Conviene contactarlo." : kind === "admin_document_ready" ? "El cliente recibe el PDF por correo en este mismo momento." : "El análisis ya comenzó; recibirás otro aviso cuando termine o si se detiene."],
    { label: "Abrir Administración", url: `${SITE}/operaciones.html` });
  return { subject: `[ValoraIA] ${titles[kind] || "Aviso"} · ${folio}`, ...body };
}

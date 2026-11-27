// Equivalente de los triggers de Postgres: normalización de estados, tipo de servicio del
// expediente, bitácora de auditoría y cola de correos cuando cambia una solicitud comercial.
import type { Row } from "./schema.ts";
import { toDb, uuid, now } from "./schema.ts";
import type { Engine } from "./db.ts";

export const auditTables = new Set(["valuation_cases", "properties", "documents", "adopted_values", "data_conflicts"]);
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const CASE_STATUS: Row = { "borrador": "draft", "pendiente de documentos": "documents_pending", "revisión de datos": "data_review", "revision de datos": "data_review",
  "pendiente de inspección": "inspection_pending", "pendiente de inspeccion": "inspection_pending", "análisis de mercado": "market_analysis", "analisis de mercado": "market_analysis",
  "cálculo": "calculation", "calculo": "calculation", "revisión profesional": "professional_review", "revision profesional": "professional_review",
  "aprobado": "approved", "firmado": "signed", "archivado": "archived" };
const COVERAGE: Row = { calibrada: "calibrated", cubierta: "covered", asistida: "assisted", exploratoria: "exploratory" };
const DOC_STATUS: Row = { "pendiente de procesamiento": "uploaded", "cargado": "uploaded", "procesando": "processing", "procesado": "processed",
  "requiere configuración": "needs_review", "requiere configuracion": "needs_review", "requiere revisión": "needs_review", "requiere revision": "needs_review", "rechazado": "rejected" };
const FIELD_STATUS: Row = { pending_review: "pending", pendiente: "pending", confirmado: "confirmed", corregido: "corrected", rechazado: "rejected" };

export async function beforeInsert(_e: Engine, table: string, row: Row, isUpdate = false) {
  if (table === "valuation_cases") {
    if ("status" in row && CASE_STATUS[lower(row.status)]) row.status = CASE_STATUS[lower(row.status)];
    if ("coverage_level" in row && COVERAGE[lower(row.coverage_level)]) row.coverage_level = COVERAGE[lower(row.coverage_level)];
    if (!isUpdate) {
      const p = lower(row.purpose);
      if (p.includes("comercial")) row.service_type = "commercial";
      else if (p.includes("perito") || p.includes("profesional")) row.service_type = "professional";
    }
  }
  if (table === "documents" && "status" in row && DOC_STATUS[lower(row.status)]) row.status = DOC_STATUS[lower(row.status)];
  if (table === "extracted_fields" && "status" in row && FIELD_STATUS[lower(row.status)]) row.status = FIELD_STATUS[lower(row.status)];
}

async function raw(e: Engine, table: string, row: Row, conflictIgnore = false) {
  const r = toDb(table, row), cols = Object.keys(r);
  await e.d1.prepare(`INSERT ${conflictIgnore ? "OR IGNORE " : ""}INTO "${table}" (${cols.map(c => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map(c => r[c])).run();
}

// La bitácora guarda los datos completos salvo campos enormes (lecturas de documentos), que se resumen.
const shrink = (r: Row | null) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => {
  const t = v !== null && typeof v === "object" ? JSON.stringify(v) : "";
  return [k, t.length > 20000 ? { omitted: true, bytes: t.length } : v];
}));

export async function afterWrite(e: Engine, table: string, op: "INSERT" | "UPDATE" | "DELETE", before: Row | null, after: Row | null) {
  const row = after || before!;
  if (auditTables.has(table)) {
    let caseId: string, org: string | null = null;
    if (table === "valuation_cases") { caseId = row.id; org = row.organization_id; }
    else { caseId = row.case_id; const c = await e.d1.prepare(`SELECT organization_id FROM valuation_cases WHERE id = ?`).bind(caseId).first<Row>(); org = c?.organization_id || null; }
    await raw(e, "audit_events", { organization_id: org, case_id: op === "DELETE" && table === "valuation_cases" ? null : caseId, actor_user_id: e.access?.uid || null,
      entity_type: table, entity_id: String(table === "valuation_cases" ? caseId : row.id), action: op, before_data: shrink(before), after_data: shrink(after) });
  }
  if (table === "service_requests" && after) {
    if (after.case_id) await e.d1.prepare(`UPDATE valuation_cases SET service_type = ?, updated_at = ? WHERE id = ?`).bind(after.service_type, now(), after.case_id).run();
    if (op === "UPDATE" && before) await queueNotifications(e, before, after);
  }
}

// Correos al cliente y a administración cuando cambia el pago o el documento de una solicitud comercial.
async function queueNotifications(e: Engine, old: Row, row: Row) {
  if (row.service_type !== "commercial") return;
  let kind = "", ref = "";
  if (row.payment_status === "paid" && old.payment_status !== "paid") kind = "payment_received";
  else if (row.payment_status === "failed" && old.payment_status !== "failed") { kind = "payment_failed"; ref = row.payment_transaction_id || ""; }
  else if (row.document_status === "ready" && old.document_status !== "ready") { kind = "document_ready"; ref = row.document_storage_path || ""; }
  else if (row.document_status === "needs_review" && old.document_status !== "needs_review") { kind = "needs_review"; ref = row.document_retry_at || row.updated_at || ""; }
  if (!kind) return;
  const s = await e.d1.prepare(`SELECT admin_notification_email FROM app_settings WHERE organization_id = ?`).bind(row.organization_id).first<Row>();
  const admin = (String(s?.admin_notification_email || "").trim() || "contacto@circulointernacionalveracruz.org").toLowerCase();
  const base = { organization_id: row.organization_id, request_id: row.id, subject: "ValoraIA", body_text: kind, status: "queued" };
  if (String(row.client_email || "").trim())
    await raw(e, "notification_outbox", { id: uuid(), ...base, recipient: String(row.client_email).trim().toLowerCase(), metadata: { kind, ref, audience: "client" } }, true);
  if (kind !== "payment_failed")
    await raw(e, "notification_outbox", { id: uuid(), ...base, recipient: admin, metadata: { kind: "admin_" + kind, ref, audience: "admin" } }, true);
}

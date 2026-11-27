// Metadatos de las tablas de D1: columnas JSON, booleanas, llaves y relaciones para
// incrustar registros relacionados (equivalente a select("*,valuation_cases(*)") de PostgREST).
export type Row = Record<string, any>;

export interface TableMeta { pk: string[]; json?: string[]; bool?: string[]; updatedAt?: boolean; autoId?: boolean }

export const TABLES: Record<string, TableMeta> = {
  users: { pk: ["id"], json: ["user_metadata"], bool: ["is_anonymous"] },
  sessions: { pk: ["id"] },
  organizations: { pk: ["id"], updatedAt: true },
  organization_members: { pk: ["organization_id", "user_id"] },
  platform_configuration: { pk: ["singleton"], bool: ["singleton"], updatedAt: true },
  profiles: { pk: ["id"], updatedAt: true },
  app_settings: { pk: ["organization_id"], bool: ["commercial_price_includes_tax"], updatedAt: true },
  appraisers: { pk: ["id"], json: ["specialties", "property_types", "regions"], bool: ["active"], updatedAt: true },
  valuation_cases: { pk: ["id"], updatedAt: true },
  properties: { pk: ["id"], updatedAt: true },
  documents: { pk: ["id"], json: ["metadata"] },
  extracted_fields: { pk: ["id"], json: ["normalized_value", "evidence_bbox", "validation_flags"], bool: ["is_machine_generated"], updatedAt: true },
  adopted_values: { pk: ["id"], json: ["value"] },
  data_conflicts: { pk: ["id"], json: ["candidate_values"], updatedAt: true },
  audit_events: { pk: ["id"], json: ["before_data", "after_data", "metadata"], autoId: true },
  document_processing_jobs: { pk: ["id"], json: ["usage"], updatedAt: true },
  document_analyses: { pk: ["id"], json: ["warnings"], bool: ["has_handwriting"], updatedAt: true },
  document_page_evidence: { pk: ["id"], bool: ["is_complete_transcription"] },
  market_comparables: { pk: ["id"], bool: ["included"], updatedAt: true },
  valuation_calculations: { pk: ["id"], json: ["market_inputs", "cost_inputs", "income_inputs", "residual_inputs"], updatedAt: true },
  valuation_report_previews: { pk: ["case_id"], json: ["report_data"] },
  service_requests: { pk: ["id"], json: ["intake_data", "fiscal_data"], bool: ["marketing_consent", "privacy_accepted", "invoice_requested"], updatedAt: true },
  appraiser_assignments: { pk: ["id"] },
  intake_documents: { pk: ["id"], json: ["analysis"], updatedAt: true },
  payment_events: { pk: ["id"], json: ["raw_payload"] },
  commercial_reports: { pk: ["id"], json: ["report_data"], updatedAt: true },
  notification_outbox: { pk: ["id"], json: ["metadata"], updatedAt: true },
  knowledge_sources: { pk: ["id"], json: ["analysis"], updatedAt: true },
  market_listings: { pk: ["id"], json: ["data"] },
  market_searches: { pk: ["id"], json: ["sources", "usage"] },
  flow_runs: { pk: ["id"], json: ["result"], autoId: true },
};

// Columnas calculadas por la base: nunca se escriben.
export const GENERATED: Record<string, string[]> = { notification_outbox: ["kind", "ref"] };

// Relaciones para incrustar. one=true devuelve objeto; false, lista.
export interface Relation { table: string; local: string; foreign: string; one: boolean }
export const RELATIONS: Record<string, Record<string, Relation>> = {
  service_requests: {
    valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true },
    appraisers: { table: "appraisers", local: "assigned_appraiser_id", foreign: "id", one: true },
    organizations: { table: "organizations", local: "organization_id", foreign: "id", one: true },
    commercial_reports: { table: "commercial_reports", local: "id", foreign: "request_id", one: true },
    intake_documents: { table: "intake_documents", local: "id", foreign: "request_id", one: false },
  },
  valuation_cases: {
    properties: { table: "properties", local: "id", foreign: "case_id", one: true },
    service_requests: { table: "service_requests", local: "id", foreign: "case_id", one: true },
    documents: { table: "documents", local: "id", foreign: "case_id", one: false },
    organizations: { table: "organizations", local: "organization_id", foreign: "id", one: true },
  },
  organization_members: { organizations: { table: "organizations", local: "organization_id", foreign: "id", one: true } },
  extracted_fields: { documents: { table: "documents", local: "document_id", foreign: "id", one: true } },
  documents: { valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true } },
  properties: { valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true } },
  commercial_reports: {
    service_requests: { table: "service_requests", local: "request_id", foreign: "id", one: true },
    valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true },
  },
  intake_documents: { service_requests: { table: "service_requests", local: "request_id", foreign: "id", one: true } },
  appraiser_assignments: {
    appraisers: { table: "appraisers", local: "appraiser_id", foreign: "id", one: true },
    service_requests: { table: "service_requests", local: "request_id", foreign: "id", one: true },
  },
  market_comparables: { valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true } },
  data_conflicts: { valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true } },
  adopted_values: { valuation_cases: { table: "valuation_cases", local: "case_id", foreign: "id", one: true } },
};

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

export function toDb(table: string, row: Row): Row {
  const meta = TABLES[table], out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || GENERATED[table]?.includes(k)) continue;
    if (meta?.json?.includes(k)) out[k] = v === null ? null : JSON.stringify(v);
    else if (meta?.bool?.includes(k) || typeof v === "boolean") out[k] = v === null ? null : v ? 1 : 0;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (v !== null && typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}
export function fromDb(table: string, row: Row): Row {
  const meta = TABLES[table];
  if (!meta) return row;
  const out: Row = { ...row };
  for (const k of meta.json || []) if (typeof out[k] === "string") { try { out[k] = JSON.parse(out[k]); } catch { /* texto */ } }
  for (const k of meta.bool || []) if (out[k] !== null && out[k] !== undefined) out[k] = !!out[k];
  return out;
}
export function filterValue(table: string, col: string, v: any): any {
  const meta = TABLES[table];
  if (typeof v === "boolean") return v ? 1 : 0;
  if (meta?.json?.includes(col) && v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

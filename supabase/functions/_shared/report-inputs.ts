type Row = Record<string, any>;

export function check(result: Row) {
  if (result.error) throw new Error(result.error.message || String(result.error));
  return result.data;
}
export async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2,"0")).join("");
}

export async function loadSources(admin: any, request: Row): Promise<Row[]> {
  const [intake, cases, knowledge] = await Promise.all([
    admin.from("intake_documents").select("*").eq("request_id", request.id).eq("organization_id", request.organization_id).order("created_at"),
    admin.from("documents").select("*").eq("case_id", request.case_id).order("uploaded_at"),
    admin.from("knowledge_sources").select("*").eq("organization_id", request.organization_id).neq("status", "archived").order("created_at"),
  ]);
  return [
    ...(check(intake) || []).map((row: Row) => ({ ...row, kind: "intake", title: row.file_name, bucket: "valuation-intake", organization_id: request.organization_id })),
    ...(check(cases) || []).map((row: Row) => ({ ...row, kind: "case", title: row.file_name, bucket: "valuation-documents", organization_id: request.organization_id })),
    ...(check(knowledge) || []).map((row: Row) => ({ ...row, kind: "knowledge", bucket: "valuation-knowledge" })),
  ];
}


export function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export async function inputSnapshot(admin: any, request: Row) {
  const [p, adopted, sources] = await Promise.all([
    admin.from("properties").select("*").eq("case_id", request.case_id).single(),
    admin.from("adopted_values").select("*").eq("case_id", request.case_id).order("field_key"),
    loadSources(admin, request),
  ]);
  const property = check(p), decisions = check(adopted) || [];
  const client = { property, decisions, intake: request.intake_data || {}, case: Object.fromEntries(["id", "folio", "purpose", "property_type", "valuation_date", "region", "municipality", "locality", "currency_code", "applicant_name"].map(k => [k, request.valuation_cases?.[k] ?? null])),
    property_type: request.property_type, property_subtype: request.property_subtype, client_name: request.client_name };
  const clientFingerprint = await digest(new TextEncoder().encode(JSON.stringify(stable(client))));
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify(stable({ client, sources: sources.map((s: Row) => ({
    id: s.id, kind: s.kind, title: s.title, category: s.category, path: s.storage_path, url: s.source_url,
    revision: s.updated_at || s.uploaded_at || s.created_at,
    signature: s.analysis?.commercial_evidence?.signature || s.metadata?.commercial_evidence?.signature,
  })).sort((a: Row, b: Row) => a.id.localeCompare(b.id)) }))));
  return { property, decisions, sources, clientFingerprint, fingerprint };
}


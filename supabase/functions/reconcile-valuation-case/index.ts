import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const normalizeText = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const asNumber = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const docPriority: Record<string, number> = {
  escritura: 100,
  certificado_registral: 95,
  catastro: 90,
  predial: 80,
  plano: 75,
  avaluo_anterior: 60,
  contrato_arrendamiento: 40,
  fotografia: 20,
  otro: 10,
};
const label: Record<string, string> = {
  declared_owner_name: "Propietario declarado",
  address: "Dirección",
  cadastral_key: "Clave catastral",
  registry_folio: "Folio registral",
  land_area_m2: "Superficie de terreno",
  built_area_m2: "Superficie construida",
  frontage_m: "Frente",
  depth_m: "Fondo",
  acquisition_date: "Fecha de adquisición",
  declared_value: "Valor declarado",
  property_regime: "Régimen de propiedad",
  land_use: "Uso de suelo",
};
const numericKeys = new Set([
  "land_area_m2",
  "built_area_m2",
  "frontage_m",
  "depth_m",
  "declared_value",
]);
const tolerance: Record<string, number> = {
  land_area_m2: 0.01,
  built_area_m2: 0.03,
  frontage_m: 0.02,
  depth_m: 0.02,
  declared_value: 0.05,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Autenticación requerida" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
  });
  const admin = createClient(url, service, { auth: { persistSession: false } });

  try {
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Sesión inválida" }, 401);

    const body = await req.json();
    const caseId = String(body.case_id || "");
    if (!caseId) return json({ error: "case_id es obligatorio" }, 400);

    const { data: caseRow, error: caseError } = await userClient
      .from("valuation_cases")
      .select("id,organization_id")
      .eq("id", caseId)
      .single();
    if (caseError || !caseRow) {
      return json({ error: "Expediente no encontrado o sin acceso" }, 404);
    }

    const { data: fields, error: fieldError } = await userClient
      .from("extracted_fields")
      .select("id,document_id,field_key,field_label,normalized_value,raw_text,page_number,confidence,status,unit,documents(file_name,category,metadata)")
      .eq("case_id", caseId)
      .neq("status", "rejected");
    if (fieldError) throw fieldError;

    const usable = (fields || []).filter((f: any) =>
      f.normalized_value !== null &&
      f.normalized_value !== undefined &&
      Number(f.confidence || 0) >= 0.45
    );
    const grouped = new Map<string, any[]>();
    for (const f of usable) {
      const arr = grouped.get(f.field_key) || [];
      arr.push(f);
      grouped.set(f.field_key, arr);
    }

    await admin
      .from("data_conflicts")
      .delete()
      .eq("case_id", caseId)
      .eq("source", "automatic_reconciliation")
      .eq("status", "open");

    const conflicts: any[] = [];
    const recommendations: any[] = [];

    for (const [key, items] of grouped) {
      const scored = items
        .map((f: any) => {
          const meta = f.documents?.metadata || {};
          const type = meta.document_type || f.documents?.category || "otro";
          const score = (docPriority[type] || 10) + (Number(f.confidence || 0) * 100);
          return { ...f, document_type: type, score };
        })
        .sort((a: any, b: any) => b.score - a.score);

      const recommended = scored[0];
      let inconsistent = false;
      let spread: number | null = null;

      if (numericKeys.has(key)) {
        const nums = scored
          .map((x: any) => asNumber(x.normalized_value))
          .filter((x: any) => x !== null) as number[];
        if (nums.length > 1) {
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          const base = Math.max(Math.abs(max), 1);
          spread = (max - min) / base;
          inconsistent = spread > (tolerance[key] ?? 0.02);
        }
      } else {
        const vals = [
          ...new Set(
            scored
              .map((x: any) => normalizeText(x.normalized_value))
              .filter(Boolean),
          ),
        ];
        inconsistent = vals.length > 1;
      }

      recommendations.push({
        field_key: key,
        field_label: label[key] || recommended.field_label || key,
        recommended_field_id: recommended.id,
        recommended_value: recommended.normalized_value,
        source_document: recommended.documents?.file_name,
        source_type: recommended.document_type,
        confidence: Number(recommended.confidence || 0),
        score: recommended.score,
        inconsistent,
        candidates: scored.map((x: any) => ({
          field_id: x.id,
          value: x.normalized_value,
          document: x.documents?.file_name,
          document_type: x.document_type,
          page: x.page_number,
          confidence: Number(x.confidence || 0),
          score: x.score,
        })),
      });

      if (inconsistent) {
        conflicts.push({
          case_id: caseId,
          field_key: key,
          description: `Se encontraron valores incompatibles para ${label[key] || key}.`,
          severity: [
              "land_area_m2",
              "built_area_m2",
              "cadastral_key",
              "registry_folio",
              "declared_owner_name",
            ].includes(key)
            ? "critical"
            : "warning",
          candidate_values: scored.map((x: any) => ({
            field_id: x.id,
            value: x.normalized_value,
            document: x.documents?.file_name,
            document_type: x.document_type,
            page: x.page_number,
            confidence: Number(x.confidence || 0),
          })),
          status: "open",
          source: "automatic_reconciliation",
          rule_code: numericKeys.has(key)
            ? `NUMERIC_TOLERANCE_${Math.round((tolerance[key] ?? 0.02) * 100)}PCT`
            : "NORMALIZED_VALUES_DIFFER",
        });
      }
    }

    if (conflicts.length) {
      const { error } = await admin.from("data_conflicts").insert(conflicts);
      if (error) throw error;
    }

    await admin.from("audit_events").insert({
      organization_id: caseRow.organization_id,
      case_id: caseId,
      actor_user_id: user.id,
      action: "reconcile",
      entity_type: "valuation_case",
      entity_id: caseId,
      metadata: {
        fields_grouped: grouped.size,
        conflicts_found: conflicts.length,
        recommendations,
      },
    });

    return json({
      status: "completed",
      fields_grouped: grouped.size,
      conflicts_found: conflicts.length,
      recommendations,
    });
  } catch (error) {
    console.error(error);
    return json({
      error: error instanceof Error ? error.message : "Error inesperado",
    }, 500);
  }
});

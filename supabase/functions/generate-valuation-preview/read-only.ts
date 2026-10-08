// Temporary production entrypoint: private consultation only. No analysis,
// document processing, external model calls, email or payment mutations.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { check, inputSnapshot } from "../_shared/report-inputs.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Autenticación requerida" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "Sesión inválida" }, 401);
    const body = await req.json(), caseId = String(body.case_id || "");
    if (!caseId) return json({ error: "case_id es obligatorio" }, 400);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const c = check(await admin.from("valuation_cases").select("*").eq("id", caseId).single());
    const member = check(await admin.from("organization_members").select("role").eq("organization_id", c.organization_id).eq("user_id", user.data.user.id).eq("status", "active").maybeSingle());
    if (!member || !["owner", "admin", "appraiser", "reviewer", "analyst"].includes(member.role)) return json({ error: "Sin acceso a este expediente" }, 403);
    if (!["status", "download_version"].includes(body.action)) return json({ error: "La generación ampliada está pendiente de activación" }, 428);
    const old = check(await admin.from("valuation_report_previews").select("*").eq("case_id", caseId).maybeSingle());
    const request = check(await admin.from("service_requests").select("*").eq("case_id", caseId).maybeSingle());
    if (request && request.organization_id !== c.organization_id) return json({ error: "La solicitud no corresponde a este expediente" }, 409);
    const commercial = request ? check(await admin.from("commercial_reports").select("*").eq("request_id", request.id).maybeSingle()) : null;
    const versions = old?.report_data?.previous_versions || [];
    let path = body.action === "download_version" ? versions[Number(body.index)]?.path : old?.status === "generated" ? old.pdf_storage_path : null;
    const clientReady = request?.service_type === "commercial" && request.payment_status === "paid" && request.document_status === "ready";
    if (!path && body.action === "status" && clientReady) path = request.document_storage_path;
    let download = null;
    if (path) {
      const prefix = c.organization_id + "/" + caseId + "/";
      if (!path.startsWith(prefix + "previews/") && !(body.action === "status" && clientReady && path.startsWith(prefix + "commercial/"))) throw new Error("El archivo no pertenece a este expediente");
      download = check(await admin.storage.from("valuation-documents").createSignedUrl(path, 600)).signedUrl;
    }
    const report = old?.status === "generated" ? old : commercial;
    const outdated = !!report?.pdf_storage_path && (!report.report_data?.input_fingerprint || request && (await inputSnapshot(admin, { ...request, valuation_cases: c })).fingerprint !== report.report_data.input_fingerprint);
    return json({ status: download ? "generated" : old?.status || "not_started", download_url: download, outdated,
      analysis_enabled: false, reason: old?.error_message || "La generación del informe ampliado está pendiente de activación.",
      generated_at: report?.generated_at, pipeline: report?.report_data?.pipeline,
      documents: report?.report_data?.documents || [], survey: report?.report_data?.market_observation?.survey || [],
      versions: versions.map((v: any, index: number) => ({ index, generated_at: v.generated_at })) });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "No se pudo consultar el informe" }, 500); }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { check } from "../_shared/commercial-evidence.ts";
import { startReport, inputSnapshot } from "../_shared/report-pipeline.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Autenticación requerida" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!, secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isService = auth === "Bearer " + secret;
    const admin = createClient(url, secret, { auth: { persistSession: false } });
    let userId: string | null = null;
    if (!isService) {
      const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const result = await client.auth.getUser();
      if (result.error || !result.data.user) return json({ error: "Sesión inválida" }, 401);
      userId = result.data.user.id;
    }
    const body = await req.json(), caseId = String(body.case_id || "");
    if (!caseId) return json({ error: "case_id es obligatorio" }, 400);
    const caseRow = check(await admin.from("valuation_cases").select("*").eq("id", caseId).single());
    if (!isService) {
      const member = check(await admin.from("organization_members").select("role").eq("organization_id", caseRow.organization_id).eq("user_id", userId).eq("status", "active").maybeSingle());
      if (!member || !["owner", "admin", "appraiser", "reviewer", "analyst"].includes(member.role)) return json({ error: "Sin acceso a la revisión de este expediente" }, 403);
    }
    const clientRequest = check(await admin.from("service_requests").select("*").eq("case_id", caseId).maybeSingle());
    const request = { ...(clientRequest || { id: caseId, internal: true, organization_id: caseRow.organization_id, case_id: caseId,
      created_by: caseRow.created_by, client_name: caseRow.applicant_name, property_type: caseRow.property_type, service_type: caseRow.service_type, intake_data: {} }), valuation_cases: caseRow };
    if (clientRequest && clientRequest.organization_id !== caseRow.organization_id) return json({error:"La solicitud no corresponde a la organización del expediente"},409);
    const old = check(await admin.from("valuation_report_previews").select("*").eq("case_id", caseId).maybeSingle());
    if (body.action === "status" || body.action === "download_version") {
      let downloadUrl: string | null = null;
      const versions = old?.report_data?.previous_versions || [];
      const path = body.action === "download_version" ? versions[Number(body.index)]?.path : old?.status === "generated" ? old.pdf_storage_path : null;
      if (path) {
        if (!path.startsWith(caseRow.organization_id + "/" + caseId + "/previews/")) throw new Error("El archivo no pertenece a este expediente");
        downloadUrl = check(await admin.storage.from("valuation-documents").createSignedUrl(path, 600)).signedUrl;
      }
      let outdated = false;
      if (old?.status === "generated") outdated = (await inputSnapshot(admin, request)).fingerprint !== old.report_data?.input_fingerprint;
      return json({ status: old?.status || "not_started", download_url: downloadUrl, outdated,
        generated_at: old?.generated_at, reason: old?.error_message, pipeline: old?.report_data?.pipeline,
        documents: old?.report_data?.documents || [], survey: old?.report_data?.market_observation?.survey || [],
        versions: versions.map((v: any, index: number) => ({ index, generated_at: v.generated_at })),
        stalled: old?.status === "generating" && Date.now() - Date.parse(old?.report_data?.pipeline?.heartbeat || "") > 240000 });
    }
    const result = await startReport(admin, request, body, { url, secret, apiKey: Deno.env.get("OPENAI_API_KEY"),
      model: Deno.env.get("OPENAI_DOCUMENT_MODEL") || "gpt-5", endpoint: "generate-valuation-preview", preview: true,
      userId: userId || old?.created_by || caseRow.created_by }, isService);
    return json(result.body, result.status);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500); }
});

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
    const url = Deno.env.get("SUPABASE_URL")!, secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) return json({ error: "Sesión inválida" }, 401);
    const admin = createClient(url, secret, { auth: { persistSession: false } });
    const id = String((await req.json()).request_id || "");
    const row = check(await admin.from("service_requests").select("*,valuation_cases(*)").eq("id", id).single());
    if (row.valuation_cases?.organization_id !== row.organization_id) return json({error:"La solicitud no corresponde al expediente"},409);
    if (row.created_by !== result.data.user.id) return json({ error: "Sin acceso" }, 403);
    const report = check(await admin.from("commercial_reports").select("report_data,error_message").eq("request_id", id).maybeSingle());
    let downloadUrl: string | null = null;
    if (row.service_type === "commercial" && row.payment_status === "paid" && row.document_status === "ready" && row.document_storage_path && row.document_storage_path.startsWith(row.organization_id + "/" + row.case_id + "/commercial/")) {
      downloadUrl = check(await admin.storage.from("valuation-documents").createSignedUrl(row.document_storage_path, 3600)).signedUrl;
    }
    const pipeline = report?.report_data?.pipeline;
    const outdated = row.document_status === "ready" && (report?.report_data?.version !== "commercial-report-3" || (await inputSnapshot(admin, row)).fingerprint !== report?.report_data?.input_fingerprint);
    return json({ id: row.id, payment_status: row.payment_status, payment_amount: row.payment_amount, payment_currency: row.payment_currency,
      payment_error: row.payment_error, document_status: row.document_status, document_generated_at: row.document_generated_at,
      document_emailed_at: row.document_emailed_at, invoice_requested: row.invoice_requested, invoice_status: row.invoice_status,
      invoice_pdf_url: row.invoice_pdf_url, invoice_xml_url: row.invoice_xml_url, outdated,
      folio: row.valuation_cases?.folio, download_url: downloadUrl, report_version: report?.report_data?.version,
      stage: pipeline?.stage, completed_sources: pipeline?.completed_sources, source_count: pipeline?.source_count,
      completed_pages: pipeline?.completed_pages, total_pages: pipeline?.total_pages,
      source_title: pipeline?.source_title, review_reason: report?.error_message,
      stalled: row.document_status === "generating" && pipeline?.heartbeat && Date.now() - Date.parse(pipeline.heartbeat) > 240000,
    });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo consultar la solicitud" }, 500); }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { check } from "../_shared/commercial-evidence.ts";
import { startReport } from "../_shared/report-pipeline.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Autenticación requerida" }, 401);
    const isService = auth === "Bearer " + secret;
    const admin = createClient(url, secret, { auth: { persistSession: false } });
    let userId: string | null = null;
    if (!isService) {
      const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const result = await client.auth.getUser();
      if (result.error || !result.data.user) return json({ error: "Sesión inválida" }, 401);
      userId = result.data.user.id;
    }
    const body = await req.json(), id = String(body.request_id || "");
    if (!id) return json({ error: "request_id es obligatorio" }, 400);
    const request = check(await admin.from("service_requests").select("*,valuation_cases(*)").eq("id", id).single());
    if (request.valuation_cases?.organization_id !== request.organization_id) return json({error:"El expediente y la solicitud no pertenecen a la misma organización"},409);
    if (userId && userId !== request.created_by) {
      const member = check(await admin.from("organization_members").select("role").eq("organization_id", request.organization_id).eq("user_id", userId).eq("status", "active").maybeSingle());
      if (!member || !["owner", "admin", "reviewer"].includes(member.role)) return json({ error: "Sin acceso a esta solicitud" }, 403);
    }
    if (request.service_type !== "commercial") return json({ error: "Esta solicitud sigue el flujo profesional con perito" }, 409);
    if (request.payment_status !== "paid") return json({ error: "Pago no confirmado" }, 402);
    const result = await startReport(admin, request, body, { url, secret, apiKey: Deno.env.get("OPENAI_API_KEY"),
      model: Deno.env.get("OPENAI_DOCUMENT_MODEL") || "gpt-5", endpoint: "generate-commercial-report", preview: false }, isService);
    return json(result.body, result.status);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500); }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { check, processSourceStep, background, validEvidence } from "../_shared/commercial-evidence.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Autenticación requerida" }, 401);
    const body = await req.json(), sourceId = String(body.source_id || "");
    if (!sourceId) return json({ error: "source_id es obligatorio" }, 400);
    let client = admin;
    if (auth !== "Bearer " + secret) {
      client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const user = await client.auth.getUser();
      if (user.error || !user.data.user) return json({ error: "Sesión inválida" }, 401);
    }
    const source = check(await client.from("knowledge_sources").select("*").eq("id", sourceId).single());
    if (source.status === "archived") return json({ error: "La fuente está archivada" }, 409);
    const task = (async () => {
      try {
        const candidates = check(await admin.from("knowledge_sources").select("id,analysis").eq("organization_id", source.organization_id).eq("status", "ready")) || [];
        const prior = [];
        for (const candidate of candidates) {
          const evidence = candidate.analysis?.commercial_evidence;
          if (await validEvidence(evidence, source.organization_id, secret)) prior.push({ id: candidate.id, kind: "knowledge", evidence });
        }
        const result = await processSourceStep(admin, { ...source, kind: "knowledge", bucket: "valuation-knowledge" }, { secret, apiKey: Deno.env.get("OPENAI_API_KEY"), model: Deno.env.get("OPENAI_DOCUMENT_MODEL") || "gpt-5" }, prior);
        if (!result.evidence.complete) {
          const response = await fetch(url + "/functions/v1/analyze-knowledge-source", {
            method: "POST", headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
            body: JSON.stringify({ source_id: sourceId }), signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error("No se pudo continuar con las páginas siguientes");
        }
      } catch (error) {
        console.error(error);
        await admin.from("knowledge_sources").update({ status: "error", error_message: error instanceof Error ? error.message : "Error inesperado" }).eq("id", sourceId);
      }
    })();
    background(task);
    return json({ source_id: sourceId, status: "processing", message: "Se analizarán todas las páginas; puedes consultar el avance en el repositorio" }, 202);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500); }
});

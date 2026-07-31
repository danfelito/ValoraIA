import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const clamp = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

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
    const documentId = String(body.document_id || "");
    if (!documentId) return json({ error: "document_id es obligatorio" }, 400);

    const { data: doc, error: docError } = await userClient
      .from("documents")
      .select("id,case_id,category,file_name,mime_type,storage_path,valuation_cases!inner(id,organization_id)")
      .eq("id", documentId)
      .single();
    if (docError || !doc) {
      return json({ error: "Documento no encontrado o sin acceso" }, 404);
    }

    const orgId = (doc.valuation_cases as any).organization_id;
    const caseId = doc.case_id;
    const { data: job, error: jobError } = await admin
      .from("document_processing_jobs")
      .insert({
        organization_id: orgId,
        case_id: caseId,
        document_id: documentId,
        requested_by: user.id,
        status: "processing",
        attempts: 1,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError) {
      const { data: existing } = await admin
        .from("document_processing_jobs")
        .select("*")
        .eq("document_id", documentId)
        .in("status", ["queued", "processing", "needs_configuration"])
        .maybeSingle();
      if (existing) {
        return json({ job: existing, message: "Ya existe un proceso activo" }, 202);
      }
      throw jobError;
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      await admin
        .from("document_processing_jobs")
        .update({
          status: "needs_configuration",
          error_code: "OPENAI_API_KEY_MISSING",
          error_message: "Configure OPENAI_API_KEY en los secretos de Edge Functions",
        })
        .eq("id", job.id);
      await admin
        .from("documents")
        .update({ status: "Requiere configuración" })
        .eq("id", documentId);
      return json({
        job_id: job.id,
        status: "needs_configuration",
        message: "El pipeline está instalado; falta configurar OPENAI_API_KEY.",
      }, 202);
    }

    const { data: file, error: fileError } = await admin.storage
      .from("valuation-documents")
      .download(doc.storage_path);
    if (fileError || !file) {
      throw fileError || new Error("No se pudo descargar el archivo");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const base64 = btoa(binary);
    const mime = doc.mime_type || "application/octet-stream";
    const isImage = mime.startsWith("image/");
    const filePart = isImage
      ? {
          type: "input_image",
          image_url: `data:${mime};base64,${base64}`,
          detail: "high",
        }
      : {
          type: "input_file",
          filename: doc.file_name,
          file_data: `data:${mime};base64,${base64}`,
        };

    const prompt = `Analiza este documento inmobiliario para un expediente de valuación. Devuelve SOLAMENTE JSON válido con esta forma: {"document_type":"escritura|predial|catastro|plano|certificado_registral|uso_suelo|contrato_arrendamiento|avaluo_anterior|fotografia|otro","document_subtype":string|null,"language_code":"es","classification_confidence":0.0,"page_count":number|null,"image_quality":"alta|media|baja|desconocida","has_handwriting":boolean|null,"summary":string,"warnings":[string],"pages":[{"page_number":1,"relevant_text":string,"confidence":0.0}],"fields":[{"field_key":"declared_owner_name|address|cadastral_key|registry_folio|land_area_m2|built_area_m2|frontage_m|depth_m|acquisition_date|declared_value|property_regime|land_use|other","field_label":string,"raw_text":string|null,"normalized_value":string|number|boolean|null,"value_type":"text|number|date|boolean","unit":string|null,"page_number":number|null,"confidence":0.0,"validation_flags":[string]}]}. No inventes información; omite campos no visibles. Categoría declarada por usuario: ${doc.category}.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_DOCUMENT_MODEL") || "gpt-5",
        input: [{
          role: "user",
          content: [{ type: "input_text", text: prompt }, filePart],
        }],
        text: { format: { type: "json_object" } },
      }),
    });

    const raw = await response.json();
    if (!response.ok) {
      throw new Error(raw?.error?.message || "Error del proveedor de IA");
    }

    const output = raw.output_text || raw.output
      ?.flatMap((x: any) => x.content || [])
      .find((x: any) => x.type === "output_text")?.text;
    const result = JSON.parse(output);

    await admin.from("document_analyses").upsert({
      organization_id: orgId,
      case_id: caseId,
      document_id: documentId,
      document_type: result.document_type || "otro",
      document_subtype: result.document_subtype || null,
      language_code: result.language_code || "es",
      classification_confidence: clamp(result.classification_confidence),
      page_count: result.page_count || null,
      image_quality: result.image_quality || "desconocida",
      has_handwriting: result.has_handwriting ?? null,
      summary: result.summary || null,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      provider: "openai",
      model: raw.model || "gpt-5",
      processed_at: new Date().toISOString(),
    }, { onConflict: "document_id" });

    await admin
      .from("document_page_evidence")
      .delete()
      .eq("document_id", documentId);
    if (Array.isArray(result.pages) && result.pages.length) {
      await admin.from("document_page_evidence").insert(
        result.pages
          .filter((p: any) => p.page_number)
          .map((p: any) => ({
            organization_id: orgId,
            case_id: caseId,
            document_id: documentId,
            page_number: Number(p.page_number),
            relevant_text: p.relevant_text || null,
            confidence: clamp(p.confidence),
          })),
      );
    }

    await admin
      .from("extracted_fields")
      .delete()
      .eq("document_id", documentId)
      .eq("is_machine_generated", true);
    if (Array.isArray(result.fields) && result.fields.length) {
      await admin.from("extracted_fields").insert(
        result.fields.map((f: any) => ({
          case_id: caseId,
          document_id: documentId,
          field_key: f.field_key || "other",
          field_label: f.field_label || f.field_key || "Campo",
          normalized_value: f.normalized_value ?? null,
          raw_text: f.raw_text || null,
          page_number: f.page_number || null,
          confidence: clamp(f.confidence),
          status: "pending_review",
          extraction_method: "openai_document_analysis",
          value_type: f.value_type || null,
          unit: f.unit || null,
          validation_flags: Array.isArray(f.validation_flags)
            ? f.validation_flags
            : [],
          is_machine_generated: true,
          provider: "openai",
          model: raw.model || "gpt-5",
        })),
      );
    }

    await admin
      .from("documents")
      .update({
        status: "Procesado",
        processed_at: new Date().toISOString(),
        metadata: { document_type: result.document_type || "otro" },
      })
      .eq("id", documentId);

    await admin
      .from("document_processing_jobs")
      .update({
        status: "completed",
        provider: "openai",
        model: raw.model || "gpt-5",
        usage: raw.usage || {},
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return json({
      job_id: job.id,
      status: "completed",
      fields: Array.isArray(result.fields) ? result.fields.length : 0,
    });
  } catch (error) {
    console.error(error);
    return json({
      error: error instanceof Error ? error.message : "Error inesperado",
    }, 500);
  }
});

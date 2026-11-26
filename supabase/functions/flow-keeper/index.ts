// flow-keeper: envía los avisos por correo pendientes y reanuda los documentos
// pagados que dejaron de avanzar. Lo llama pg_cron cada minuto (ver migración
// 20261126170000_flow_notifications.sql). No recibe datos del público.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import nodemailer from "npm:nodemailer@6.9.16";
import { Buffer } from "node:buffer";
import { renderEmail } from "../_shared/flow-emails.ts";

type Row = Record<string, any>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MAX_ATTACHMENT = 8_000_000;
const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) => Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

function smtpConfig() {
  const user = Deno.env.get("SMTP_USER") || "contacto@circulointernacionalveracruz.org";
  return { host: Deno.env.get("SMTP_HOST") || "smtp.hostinger.com", port: Number(Deno.env.get("SMTP_PORT") || 465),
    user, pass: Deno.env.get("SMTP_PASSWORD") || "", from: Deno.env.get("MAIL_FROM") || `ValoraIA · Círculo Internacional <${user}>` };
}

async function reachable(host: string, port: number) {
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    const buffer = new Uint8Array(200), read = await Promise.race([conn.read(buffer), new Promise<null>(r => setTimeout(() => r(null), 6000))]);
    conn.close();
    return { ok: true, greeting: read ? new TextDecoder().decode(buffer.subarray(0, read as number)).slice(0, 60).trim() : "" };
  } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 160) }; }
}

async function sendPending(admin: any, summary: Row) {
  const cfg = smtpConfig();
  summary.configured = !!cfg.pass;
  if (!cfg.pass) {
    // Sin contraseña del buzón: los avisos esperan y el panel los muestra como pendientes de configuración.
    await admin.from("notification_outbox").update({ status: "needs_configuration" }).eq("status", "queued");
    return;
  }
  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 });
  summary.stage = "smtp_login";
  try { await withTimeout(transport.verify(), 15000, "El servidor de correo no respondió al iniciar sesión"); }
  catch (error) { summary.smtp_error = String(error instanceof Error ? error.message : error).slice(0, 200); return; } // no gastar intentos si el buzón rechaza el acceso

  const claimed = await admin.rpc("flow_claim_notifications", { p_limit: 10 });
  if (claimed.error) throw claimed.error;
  for (const row of (claimed.data || []) as Row[]) {
    try {
      const mail: Row = { from: cfg.from, to: row.recipient, replyTo: cfg.user, subject: row.subject, text: row.body_text, html: row.body_html || undefined };
      const kind = row.metadata?.kind;
      let request: Row | null = null;
      if (kind && row.request_id) {
        const found = await admin.from("service_requests").select("*,valuation_cases(folio)").eq("id", row.request_id).maybeSingle();
        if (found.error) throw found.error;
        request = found.data;
        if (!request) { await admin.from("notification_outbox").update({ status: "cancelled", error_message: "La solicitud ya no existe" }).eq("id", row.id); continue; }
        const report = (await admin.from("commercial_reports").select("report_data,error_message").eq("request_id", request.id).maybeSingle()).data;
        let downloadUrl: string | null = null;
        const path = request.document_storage_path, isDocument = kind === "document_ready" || kind === "admin_document_ready";
        const safePath = path && path.startsWith(request.organization_id + "/" + request.case_id + "/commercial/");
        if (kind === "document_ready") {
          // Si el documento se regeneró después de encolar este aviso, se envía sólo el aviso de la versión vigente.
          if (!safePath || (row.metadata?.ref && row.metadata.ref !== path)) { await admin.from("notification_outbox").update({ status: "cancelled", error_message: "Documento reemplazado por una versión posterior" }).eq("id", row.id); continue; }
          const signed = await admin.storage.from("valuation-documents").createSignedUrl(path, 7 * 24 * 3600);
          if (signed.error) throw signed.error;
          downloadUrl = signed.data.signedUrl;
          const file = await admin.storage.from("valuation-documents").download(path);
          if (!file.error && file.data.size <= MAX_ATTACHMENT) {
            mail.attachments = [{ filename: `ValoraIA-${request.valuation_cases?.folio || "informe"}.pdf`, content: Buffer.from(await file.data.arrayBuffer()), contentType: "application/pdf" }];
          }
        }
        const rendered = renderEmail(kind, request, { report, downloadUrl, attached: !!mail.attachments, isDocument });
        Object.assign(mail, rendered);
      }
      const info = await transport.sendMail(mail);
      await admin.from("notification_outbox").update({ status: "sent", sent_at: new Date().toISOString(), provider: "smtp", provider_message_id: String(info.messageId || "").slice(0, 200),
        error_message: null, attempts: row.attempts + 1, subject: mail.subject, body_text: mail.text }).eq("id", row.id);
      if (kind === "document_ready" && request) {
        const now = new Date().toISOString();
        await admin.from("service_requests").update({ document_emailed_at: now }).eq("id", request.id).eq("document_storage_path", request.document_storage_path);
        await admin.from("commercial_reports").update({ emailed_at: now }).eq("request_id", request.id);
      }
      summary.sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      await admin.from("notification_outbox").update({ attempts, status: attempts >= 5 ? "failed" : "queued",
        error_message: String(error instanceof Error ? error.message : error).slice(0, 500) }).eq("id", row.id);
      summary.failed++;
    }
  }
  transport.close();
}

async function resumeStalled(admin: any, url: string, service: string, summary: Row) {
  const stalled = await admin.rpc("flow_claim_stalled");
  if (stalled.error) throw stalled.error;
  for (const item of (stalled.data || []) as Row[]) {
    if (item.action !== "retry") { summary.given_up++; continue; }
    summary.retried++;
    await fetch(`${url}/functions/v1/generate-commercial-report`, { method: "POST", headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: item.request_id }), signal: AbortSignal.timeout(25000) })
      .then(async r => { if (!r.ok) console.error("reintento", item.request_id, await r.text()); }).catch(console.error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const token = req.headers.get("x-flow-token") || "";
  const allowed = token && (await admin.rpc("flow_check_token", { p_token: token })).data === true;
  if (!allowed) return json({ error: "No autorizado" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.health) { const cfg = smtpConfig(); return json({ configured: !!cfg.pass, host: cfg.host, port: cfg.port, smtp: await reachable(cfg.host, cfg.port) }); }

  // Se trabaja con la llamada abierta (pg_cron espera hasta 55 s) y se deja rastro de cada etapa.
  const summary: Row = { at: new Date().toISOString(), sent: 0, failed: 0, retried: 0, given_up: 0, stage: "start" };
  await admin.rpc("flow_record_run", { p_result: summary });
  try { summary.stage = "watchdog"; await resumeStalled(admin, url, service, summary); } catch (error) { summary.watchdog_error = String(error instanceof Error ? error.message : error).slice(0, 200); }
  try { summary.stage = "mail"; await withTimeout(sendPending(admin, summary), 45000, "El envío de correos tardó demasiado"); } catch (error) { summary.mail_error = String(error instanceof Error ? error.message : error).slice(0, 200); }
  summary.stage = "done"; summary.ms = Date.now() - Date.parse(summary.at);
  const saved = await admin.rpc("flow_record_run", { p_result: summary });
  if (saved.error) console.error("flow_record_run", saved.error.message);
  console.log("flow-keeper", JSON.stringify(summary));
  return json(summary);
});

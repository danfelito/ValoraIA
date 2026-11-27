// Robot programado (Cron Trigger cada minuto): reanuda informes detenidos y envía los correos pendientes.
// Equivale al antiguo flow-keeper de Supabase + pg_cron.
import type { Env } from "./auth.ts";
import type { Row } from "./schema.ts";
import { now } from "./schema.ts";
import { renderEmail, layout } from "./shared/flow-emails.ts";
import { Smtp } from "./smtp.ts";
import type { Mail } from "./smtp.ts";

const MAX_ATTACHMENT = 8_000_000;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

export async function runFlowRpc(env: Env, name: string, args: Row): Promise<any> {
  if (name === "flow_claim_notifications") {
    const rows = ((await env.DB.prepare(`SELECT * FROM notification_outbox WHERE status IN ('queued','needs_configuration') AND attempts < 5 AND created_at > ?
      AND coalesce(json_extract(metadata,'$.claimed_at'), '1970-01-01') < ? ORDER BY created_at LIMIT ?`).bind(ago(7 * 1440), ago(5), Number(args.p_limit) || 10).all()).results || []) as Row[];
    for (const r of rows) await env.DB.prepare(`UPDATE notification_outbox SET metadata = json_set(coalesce(metadata,'{}'), '$.claimed_at', ?) WHERE id = ?`).bind(now(), r.id).run();
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || "{}") }));
  }
  if (name === "flow_claim_stalled") {
    const rows = ((await env.DB.prepare(`SELECT s.id, s.document_retry_count FROM service_requests s LEFT JOIN commercial_reports c ON c.request_id = s.id
      WHERE s.service_type = 'commercial' AND s.payment_status = 'paid' AND s.payment_paid_at > ? AND s.document_status IN ('queued','generating')
      AND coalesce(json_extract(c.report_data,'$.pipeline.heartbeat'), s.payment_paid_at) < ? AND coalesce(s.document_retry_at, '1970-01-01') < ?`)
      .bind(ago(3 * 1440), ago(8), ago(8)).all()).results || []) as Row[];
    const out: Row[] = [];
    for (const r of rows) {
      if ((r.document_retry_count || 0) >= 3) {
        await env.DB.prepare(`UPDATE commercial_reports SET status = 'needs_review', error_message = ? WHERE request_id = ?`)
          .bind("El análisis automático no pudo completarse después de varios intentos. El expediente quedó en seguimiento manual.", r.id).run();
        // Se usa el motor para que se encolen los avisos de "en revisión".
        const { serviceClient } = await import("./compat.ts");
        await serviceClient(env).from("service_requests").update({ document_status: "needs_review", status: "in_review", document_retry_at: now() }).eq("id", r.id);
        out.push({ request_id: r.id, action: "give_up" });
      } else {
        await env.DB.prepare(`UPDATE service_requests SET document_retry_count = ?, document_retry_at = ? WHERE id = ?`).bind((r.document_retry_count || 0) + 1, now(), r.id).run();
        out.push({ request_id: r.id, action: "retry" });
      }
    }
    return out;
  }
  if (name === "flow_record_run") {
    await env.DB.prepare(`INSERT INTO flow_runs (result) VALUES (?)`).bind(JSON.stringify(args.p_result || {})).run();
    await env.DB.prepare(`DELETE FROM flow_runs WHERE id NOT IN (SELECT id FROM flow_runs ORDER BY id DESC LIMIT 500)`).run();
    return true;
  }
  if (name === "flow_check_token") return false;
  throw new Error("Función no disponible: " + name);
}

function smtpConfig(env: Env) {
  const user = env.SMTP_USER || "contacto@circulointernacionalveracruz.org";
  return { host: env.SMTP_HOST || "smtp.hostinger.com", port: Number(env.SMTP_PORT || 465), user, pass: env.SMTP_PASSWORD || "",
    from: env.MAIL_FROM || `ValoraIA · Círculo Internacional <${user}>` };
}

async function sendPending(env: Env, admin: any, summary: Row) {
  const cfg = smtpConfig(env);
  summary.configured = !!cfg.pass;
  if (!cfg.pass) { await admin.from("notification_outbox").update({ status: "needs_configuration" }).eq("status", "queued"); return; }
  const claimed: Row[] = await runFlowRpc(env, "flow_claim_notifications", { p_limit: 10 });
  if (!claimed.length) return;
  const smtp = new Smtp(cfg);
  summary.stage = "smtp_login";
  try { await smtp.open(); } catch (e) { summary.smtp_error = String(e instanceof Error ? e.message : e).slice(0, 200); return; }
  for (const row of claimed) {
    try {
      const mail: Mail = { from: cfg.from, to: row.recipient, replyTo: cfg.user, subject: row.subject || "ValoraIA", text: row.body_text || "", html: row.body_html || undefined };
      const kind = row.metadata?.kind;
      let request: Row | null = null;
      if (kind === "confirm_email") {
        Object.assign(mail, { subject: "Confirma tu correo · ValoraIA", ...layout("Confirma tu correo", ["Gracias por crear tu cuenta en ValoraIA.",
          "Confirma tu correo para activar todas las funciones de tu cuenta."], { label: "Confirmar mi correo", url: row.metadata.link }) });
      } else if (kind && row.request_id) {
        request = (await admin.from("service_requests").select("*,valuation_cases(folio)").eq("id", row.request_id).maybeSingle()).data;
        if (!request) { await admin.from("notification_outbox").update({ status: "cancelled", error_message: "La solicitud ya no existe" }).eq("id", row.id); continue; }
        const report = (await admin.from("commercial_reports").select("report_data,error_message").eq("request_id", request.id).maybeSingle()).data;
        let downloadUrl: string | null = null;
        const path = request.document_storage_path, isDocument = kind === "document_ready" || kind === "admin_document_ready";
        const safePath = path && path.startsWith(request.organization_id + "/" + request.case_id + "/commercial/");
        if (kind === "document_ready") {
          if (!safePath || (row.metadata?.ref && row.metadata.ref !== path)) {
            await admin.from("notification_outbox").update({ status: "cancelled", error_message: "Documento reemplazado por una versión posterior" }).eq("id", row.id); continue;
          }
          downloadUrl = (await admin.storage.from("valuation-documents").createSignedUrl(path, 7 * 24 * 3600)).data.signedUrl;
          const file = await admin.storage.from("valuation-documents").download(path);
          if (!file.error && file.data.size <= MAX_ATTACHMENT)
            mail.attachments = [{ filename: `ValoraIA-${request.valuation_cases?.folio || "informe"}.pdf`, content: new Uint8Array(await file.data.arrayBuffer()), contentType: "application/pdf" }];
        }
        Object.assign(mail, renderEmail(kind, request, { report, downloadUrl, attached: !!mail.attachments, isDocument }));
      }
      const id = await smtp.send(mail);
      await admin.from("notification_outbox").update({ status: "sent", sent_at: now(), provider: "smtp", provider_message_id: id, error_message: null,
        attempts: (row.attempts || 0) + 1, subject: mail.subject, body_text: mail.text }).eq("id", row.id);
      if (kind === "document_ready" && request) {
        await admin.from("service_requests").update({ document_emailed_at: now() }).eq("id", request.id).eq("document_storage_path", request.document_storage_path);
        await admin.from("commercial_reports").update({ emailed_at: now() }).eq("request_id", request.id);
      }
      summary.sent++;
    } catch (e) {
      const attempts = (row.attempts || 0) + 1;
      await admin.from("notification_outbox").update({ attempts, status: attempts >= 5 ? "failed" : "queued", error_message: String(e instanceof Error ? e.message : e).slice(0, 500) }).eq("id", row.id);
      summary.failed++;
    }
  }
  await smtp.close();
}

export async function runFlow(env: Env) {
  const { serviceClient, serviceKey, publicUrl } = await import("./compat.ts");
  const admin = serviceClient(env);
  const summary: Row = { at: now(), sent: 0, failed: 0, retried: 0, given_up: 0, stage: "watchdog" };
  try {
    for (const item of await runFlowRpc(env, "flow_claim_stalled", {})) {
      if (item.action !== "retry") { summary.given_up++; continue; }
      summary.retried++;
      await fetch(`${publicUrl(env)}/functions/v1/generate-commercial-report`, { method: "POST", headers: { Authorization: `Bearer ${serviceKey(env)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: item.request_id }) });
    }
  } catch (e) { summary.watchdog_error = String(e instanceof Error ? e.message : e).slice(0, 200); }
  try { summary.stage = "mail"; await sendPending(env, admin, summary); } catch (e) { summary.mail_error = String(e instanceof Error ? e.message : e).slice(0, 200); }
  summary.stage = "done"; summary.ms = Date.now() - Date.parse(summary.at);
  if (summary.sent || summary.failed || summary.retried || summary.given_up || summary.smtp_error || summary.mail_error || summary.watchdog_error)
    await runFlowRpc(env, "flow_record_run", { p_result: summary });
  return summary;
}

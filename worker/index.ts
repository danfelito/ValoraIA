import { Smtp } from "./smtp.ts";
// ValoraIA en Cloudflare: un solo Worker sirve el sitio, la API, los archivos (R2), la base (D1),
// los trabajos largos (Workflows) y el robot programado (Cron Trigger).
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { install, withContext, serviceKey, publicUrl } from "./compat.ts";
import { handleAuth, currentUser } from "./auth.ts";
import type { Env } from "./auth.ts";
import { Policy } from "./policy.ts";
import { Engine } from "./db.ts";
import type { QueryState } from "./db.ts";
import { handleStorage } from "./storage.ts";
import { runRpc } from "./rpc.ts";
import { runFlow } from "./flow.ts";
import { uuid } from "./schema.ts";
import commercialRequestStatus from "./functions/commercial-request-status.ts";
import analyzeKnowledgeSource from "./functions/analyze-knowledge-source.ts";
import generateCommercialReport from "./functions/generate-commercial-report.ts";
import openpayCreateCheckout from "./functions/openpay-create-checkout.ts";
import generateValuationPreview from "./functions/generate-valuation-preview.ts";
import openpayWebhook from "./functions/openpay-webhook.ts";
import processValuationDocument from "./functions/process-valuation-document.ts";
import reconcileValuationCase from "./functions/reconcile-valuation-case.ts";
import repositoryDeduplicate from "./functions/repository-deduplicate.ts";

type Handler = (req: Request) => Promise<Response>;
const FUNCTIONS: Record<string, Handler> = {
  "commercial-request-status": commercialRequestStatus, "analyze-knowledge-source": analyzeKnowledgeSource,
  "generate-commercial-report": generateCommercialReport, "openpay-create-checkout": openpayCreateCheckout,
  "generate-valuation-preview": generateValuationPreview, "openpay-webhook": openpayWebhook,
  "process-valuation-document": processValuationDocument, "reconcile-valuation-case": reconcileValuationCase,
  "repository-deduplicate": repositoryDeduplicate,
};

// Llave para firmar sesiones y enlaces. Si no se configuró como secreto, se genera una vez y se guarda en D1.
let SECRET: string | null = null;
async function withSecret(env: Env): Promise<Env> {
  if (env.AUTH_SECRET) return env;
  if (!SECRET) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
    const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare(`INSERT OR IGNORE INTO app_secrets (name, value) VALUES ('auth', ?)`).bind(fresh).run();
    SECRET = (await env.DB.prepare(`SELECT value FROM app_secrets WHERE name = 'auth'`).first<{ value: string }>())!.value;
  }
  return Object.assign(Object.create(null), env, { AUTH_SECRET: SECRET });
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function queueMail(env: Env, to: string, kind: string, data: Record<string, any>) {
  await env.DB.prepare(`INSERT INTO notification_outbox (id, recipient, subject, body_text, status, metadata) VALUES (?,?,?,?, 'queued', ?)`)
    .bind(uuid(), to, "ValoraIA", kind, JSON.stringify({ kind, ...data, audience: "client" })).run();
}

async function api(env: Env, req: Request, parts: string[]): Promise<Response> {
  const [area, a, ...rest] = parts;
  if (area === "auth") return handleAuth(env, req, a, (to, kind, data) => queueMail(env, to, kind, data));
  if (area === "storage" && a === "signed") return handleStorage(env, req, new Policy(env.DB, null), "signed", "", "");
  const policy = new Policy(env.DB, await currentUser(env, req));
  if (area === "rest") {
    if (req.method !== "POST") return json({ error: { message: "Método no permitido" } }, 405);
    const state = await req.json() as QueryState;
    state.table = a;
    const r = await new Engine(env.DB, policy).run(state);
    return json(r, r.error ? Number(r.status) || 400 : 200);
  }
  if (area === "rpc") {
    try { return json({ data: await runRpc(env, policy, a, await req.json().catch(() => ({}))), error: null }); }
    catch (e: any) { return json({ data: null, error: { message: e?.message || String(e) } }, e?.status || 400); }
  }
  if (area === "storage") return handleStorage(env, req, policy, a, rest[0], decodeURIComponent(rest.slice(1).join("/")));
  return json({ error: { message: "Ruta no disponible" } }, 404);
}

export default {
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = await withSecret(rawEnv);
    install(env);
    const url = new URL(req.url);
    return withContext({ env, waitUntil: p => ctx.waitUntil(p), workflow: false }, async () => {
      try {
        if (url.pathname.startsWith("/api/")) return await api(env, req, url.pathname.slice(5).split("/"));
        const fn = url.pathname.match(/^\/functions\/v1\/([a-z-]+)$/);
        if (fn) {
          const handler = FUNCTIONS[fn[1]];
          if (!handler) return json({ error: "Función no disponible" }, 404);
          if (req.headers.get("Authorization") === "Bearer " + serviceKey(env)) return json({ error: "Credencial interna no permitida desde la red" }, 403);
          return await handler(req);
        }
        if (url.pathname === "/health") return json(url.searchParams.has("deep") ? await deepHealth(env) : { ok: true, at: new Date().toISOString() });
        return env.ASSETS.fetch(req);
      } catch (e) {
        console.error(e);
        return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
      }
    });
  },
  async scheduled(_event: ScheduledController, rawEnv: Env, ctx: ExecutionContext) {
    const env = await withSecret(rawEnv);
    install(env);
    ctx.waitUntil(withContext({ env, waitUntil: p => ctx.waitUntil(p), workflow: false }, () => runFlow(env)).then(s => console.log("flow", JSON.stringify(s))));
  },
};

// Trabajos largos: cada paso del informe o del análisis de la biblioteca corre aquí,
// sin el límite de 30 s de las tareas en segundo plano de una petición.
// Revisión de conexiones: solo responde sí/no por servicio, nunca valores. Se limita a una corrida por minuto.
let lastDeep: { at: number; result: unknown } | null = null;
async function deepHealth(env: Env) {
  if (lastDeep && Date.now() - lastDeep.at < 60_000) return lastDeep.result;
  const check = async (fn: () => Promise<unknown>) => { try { const r = await fn(); return r === undefined ? { ok: true } : r; } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "falló" }; } };
  const e = env as any;
  const result = {
    at: new Date().toISOString(),
    base_de_datos: await check(async () => { const r = await env.DB.prepare("SELECT count(*) n FROM organizations").first<{ n: number }>(); return { ok: (r?.n || 0) > 0 }; }),
    archivos_r2: await check(async () => { await env.FILES.put("_health/ping.txt", "ok"); const o = await env.FILES.get("_health/ping.txt"); return { ok: (await o?.text()) === "ok" }; }),
    openai: await check(async () => {
      if (!e.OPENAI_API_KEY) return { ok: false, error: "Falta OPENAI_API_KEY" };
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}` } });
      return r.ok ? { ok: true } : { ok: false, error: `OpenAI respondió ${r.status}` };
    }),
    openpay: await check(async () => {
      if (!e.OPENPAY_MERCHANT_ID || !e.OPENPAY_PRIVATE_KEY) return { ok: false, error: "Faltan llaves de Openpay" };
      const env2 = (await env.DB.prepare("SELECT openpay_environment v FROM app_settings LIMIT 1").first<{ v: string }>())?.v;
      const base = env2 === "production" ? "https://api.openpay.mx" : "https://sandbox-api.openpay.mx";
      const r = await fetch(`${base}/v1/${e.OPENPAY_MERCHANT_ID}`, { headers: { Authorization: `Basic ${btoa(e.OPENPAY_PRIVATE_KEY + ":")}` } });
      return r.ok ? { ok: true, modo: env2 || "sandbox" } : { ok: false, error: `Openpay respondió ${r.status}`, modo: env2 || "sandbox" };
    }),
    correo: await check(async () => {
      if (!e.SMTP_PASSWORD) return { ok: false, error: "Falta SMTP_PASSWORD" };
      const out: Record<string, unknown> = {};
      for (const port of [Number(e.SMTP_PORT || 465), 587, 465].filter((p, i, a) => a.indexOf(p) === i)) {
        const smtp = new Smtp({ host: e.SMTP_HOST, port, user: e.SMTP_USER, pass: e.SMTP_PASSWORD });
        try { await smtp.open(); await smtp.close(); out[`puerto_${port}`] = "ok"; }
        catch (err) { out[`puerto_${port}`] = `falló en ${smtp.step}: ${err instanceof Error ? err.message.slice(0, 120) : ""}`; }
      }
      // Control: ¿Cloudflare puede abrir una conexión de correo hacia otro servidor? (sin iniciar sesión)
      try { const { connect } = await import("cloudflare:sockets"); const s = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on" }); await s.opened; const r = s.readable.getReader(); const { value } = await r.read(); out.control_gmail = new TextDecoder().decode(value).slice(0, 3); await s.close(); }
      catch (err) { out.control_gmail = `falló: ${err instanceof Error ? err.message.slice(0, 100) : ""}`; }
      return { ok: out[`puerto_${Number(e.SMTP_PORT || 465)}`] === "ok", ...out };
    }),
  };
  lastDeep = { at: Date.now(), result };
  return result;
}

export class Jobs extends WorkflowEntrypoint<Env, { name: string; body: string }> {
  async run(event: WorkflowEvent<{ name: string; body: string }>, step: WorkflowStep) {
    const { name, body } = event.payload;
    await step.do("ejecutar " + name, { retries: { limit: 1, delay: "20 seconds", backoff: "constant" }, timeout: "30 minutes" }, async () => {
      const env = await withSecret(this.env);
      install(env);
      const status = await withContext({ env, waitUntil: () => {}, workflow: true }, async () => {
        const handler = FUNCTIONS[name];
        if (!handler) throw new Error("Función no disponible: " + name);
        const res = await handler(new Request(publicUrl(env) + "/functions/v1/" + name, { method: "POST",
          headers: { Authorization: "Bearer " + serviceKey(env), "Content-Type": "application/json" }, body }));
        const text = await res.text();
        if (res.status >= 500) throw new Error(`${name} respondió ${res.status}: ${text.slice(0, 300)}`);
        return res.status;
      });
      return { status };
    });
  }
}

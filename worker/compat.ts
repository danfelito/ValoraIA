// Capa de compatibilidad: permite ejecutar en Cloudflare el código que estaba escrito para
// Supabase Edge Functions (Deno) sin reescribirlo.
//  - createClient(url, key) devuelve un cliente sobre D1/R2 con la misma forma de supabase-js.
//  - Deno.env.get lee las variables del Worker.
//  - fetch a <sitio>/functions/v1/<función> se convierte en un trabajo de Cloudflare Workflows
//    (sin límite de tiempo); fetch a otros archivos del sitio se sirve desde los assets.
//  - EdgeRuntime.waitUntil se mantiene vivo hasta que termina el trabajo.
import { AsyncLocalStorage } from "node:async_hooks";
import { client, Query, Engine, setBlobStore } from "./db.ts";
import { Policy } from "./policy.ts";
import { adminStorage } from "./storage.ts";
import { currentUser } from "./auth.ts";
import type { Env } from "./auth.ts";
import { runRpc } from "./rpc.ts";
import { runFlowRpc } from "./flow.ts";

interface Ctx { env: Env; waitUntil: (p: Promise<unknown>) => void; workflow: boolean; pending: Promise<unknown>[] }
export const context = new AsyncLocalStorage<Ctx>();
let ENV: Env | null = null;
const realFetch = globalThis.fetch.bind(globalThis);

export const serviceKey = (env: Env) => "svc_" + env.AUTH_SECRET;
export const publicUrl = (env: Env) => (env.PUBLIC_URL || "https://valoraia.circulointernacionalveracruz.org").replace(/\/$/, "");

export function install(env: Env) {
  ENV = env;
  setBlobStore(env.FILES);
  const map: Record<string, string | undefined> = {
    SUPABASE_URL: publicUrl(env), VALORAIA_PUBLIC_URL: publicUrl(env), SUPABASE_SERVICE_ROLE_KEY: serviceKey(env), SUPABASE_ANON_KEY: "anon",
  };
  (globalThis as any).Deno = { env: { get: (k: string) => k in map ? map[k] : (typeof env[k] === "string" ? env[k] : undefined) } };
  (globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { const c = context.getStore(); if (c?.workflow) c.pending.push(p); else c?.waitUntil(p); } };
  (globalThis as any).__valoraiaInWorkflow = () => !!context.getStore()?.workflow;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const base = publicUrl(env);
    if (url.startsWith(base + "/")) {
      const path = url.slice(base.length);
      const m = path.match(/^\/functions\/v1\/([a-z-]+)/);
      if (m) {
        const req = new Request(url, { ...init, headers: init?.headers || (input as Request).headers });
        return enqueue(env, m[1], req.headers.get("Authorization") || "", await req.text());
      }
      return env.ASSETS.fetch(new Request("https://assets.local" + path, init));
    }
    return realFetch(input as any, init);
  }) as typeof fetch;
}

// Encola la ejecución de una función en un Workflow y responde de inmediato (202).
async function enqueue(env: Env, name: string, auth: string, body: string): Promise<Response> {
  if (auth !== "Bearer " + serviceKey(env)) return new Response(JSON.stringify({ error: "Credencial interna requerida" }), { status: 401 });
  const instance = await env.JOBS.create({ params: { name, body } });
  return new Response(JSON.stringify({ queued: true, job: instance.id }), { status: 202, headers: { "Content-Type": "application/json" } });
}

// Cliente con la forma de supabase-js.
export function createClient(_url: string, key: string, opts: Record<string, any> = {}) {
  const env = ENV!;
  if (key === serviceKey(env)) return serviceClient(env);
  const auth: string = opts.global?.headers?.Authorization || "";
  const req = new Request("https://internal/", { headers: { Authorization: auth } });
  let policyPromise: Promise<Policy> | null = null;
  const policy = () => policyPromise ||= currentUser(env, req).then(u => new Policy(env.DB, u));
  return {
    from: (t: string) => new Query(st => policy().then(p => new Engine(env.DB, p).run(st)), t),
    rpc: async (name: string, args: Record<string, any> = {}) => {
      try { return { data: await runRpc(env, await policy(), name, args), error: null }; }
      catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }; }
    },
    auth: {
      getUser: async () => {
        const u = await currentUser(env, req);
        return u ? { data: { user: { id: u.id, email: u.email, is_anonymous: u.is_anonymous, email_confirmed_at: u.email_confirmed_at } }, error: null }
          : { data: { user: null }, error: { message: "Sesión inválida" } };
      },
    },
    storage: adminStorage(env),
  };
}

export function serviceClient(env: Env) {
  const c = client(env.DB);
  return {
    ...c,
    storage: adminStorage(env),
    rpc: async (name: string, args: Record<string, any> = {}) => {
      try {
        if (name.startsWith("flow_")) return { data: await runFlowRpc(env, name, args), error: null };
        return { data: await runRpc(env, new Policy(env.DB, null), name, args), error: null };
      } catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }; }
    },
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "Cliente de servicio" } }) },
  };
}

// Ejecuta una función dentro de un contexto (petición web o Workflow).
export async function withContext<T>(ctx: Omit<Ctx, "pending">, fn: () => Promise<T>): Promise<T> {
  const store: Ctx = { ...ctx, pending: [] };
  return context.run(store, async () => {
    const result = await fn();
    if (store.workflow) while (store.pending.length) await Promise.allSettled(store.pending.splice(0));
    return result;
  });
}

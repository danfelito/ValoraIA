// Archivos en R2 con la forma de supabase.storage: from(bucket).upload/download/remove/list/createSignedUrl.
// Todos los buckets viven en un solo R2 con el prefijo "<bucket>/".
import type { Env } from "./auth.ts";
import { sign, verify } from "./auth.ts";
import type { Policy } from "./policy.ts";

export const BUCKETS = ["valuation-intake", "valuation-documents", "valuation-knowledge"];
const key = (bucket: string, path: string) => bucket + "/" + String(path).replace(/^\/+/, "");

export async function signedUrl(env: Env, bucket: string, path: string, seconds = 3600, download?: string | boolean) {
  const token = await sign(env.AUTH_SECRET, { b: bucket, p: path, exp: Math.floor(Date.now() / 1000) + seconds, d: download || null });
  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  return `${base}/api/storage/signed?token=${encodeURIComponent(token)}`;
}

export function adminStorage(env: Env) {
  return {
    from(bucket: string) {
      return {
        async upload(path: string, body: any, opts: Record<string, any> = {}) {
          if (!opts.upsert && await env.FILES.head(key(bucket, path))) return { data: null, error: { message: "El archivo ya existe", statusCode: "409" } };
          const data = body instanceof Blob ? await body.arrayBuffer() : body;
          await env.FILES.put(key(bucket, path), data, { httpMetadata: { contentType: opts.contentType || (body as any)?.type || "application/octet-stream" } });
          return { data: { path, fullPath: key(bucket, path) }, error: null };
        },
        async download(path: string) {
          const obj = await env.FILES.get(key(bucket, path));
          if (!obj) return { data: null, error: { message: "Archivo no encontrado", statusCode: "404" } };
          return { data: new Blob([await obj.arrayBuffer()], { type: obj.httpMetadata?.contentType || "application/octet-stream" }), error: null };
        },
        async remove(paths: string[]) {
          await env.FILES.delete(paths.map(p => key(bucket, p)));
          return { data: paths.map(name => ({ name })), error: null };
        },
        async list(dir = "", opts: Record<string, any> = {}) {
          const prefix = key(bucket, dir ? dir.replace(/\/?$/, "/") : "");
          const r = await env.FILES.list({ prefix, limit: opts.limit || 100, delimiter: "/" });
          let items = r.objects.map(o => ({ name: o.key.slice(prefix.length), id: o.etag, updated_at: o.uploaded.toISOString(),
            metadata: { eTag: o.etag, size: o.size, mimetype: o.httpMetadata?.contentType } }));
          if (opts.search) items = items.filter(i => i.name.includes(opts.search));
          return { data: items, error: null };
        },
        async createSignedUrl(path: string, seconds: number, opts: Record<string, any> = {}) {
          return { data: { signedUrl: await signedUrl(env, bucket, path, seconds, opts.download) }, error: null };
        },
        async createSignedUrls(paths: string[], seconds: number) {
          return { data: await Promise.all(paths.map(async path => ({ path, signedUrl: await signedUrl(env, bucket, path, seconds), error: null }))), error: null };
        },
      };
    },
  };
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Peticiones del navegador: /api/storage/<acción>/<bucket>/<ruta>
export async function handleStorage(env: Env, req: Request, policy: Policy, action: string, bucket: string, path: string): Promise<Response> {
  const url = new URL(req.url);
  if (action === "signed") {
    const p = await verify(env.AUTH_SECRET, url.searchParams.get("token") || "");
    if (!p) return new Response("Enlace vencido o no válido", { status: 403 });
    const obj = await env.FILES.get(key(p.b, p.p));
    if (!obj) return new Response("Archivo no encontrado", { status: 404 });
    const name = typeof p.d === "string" ? p.d : String(p.p).split("/").pop();
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${p.d ? "attachment" : "inline"}; filename="${encodeURIComponent(name || "archivo")}"` } });
  }
  if (!BUCKETS.includes(bucket)) return json({ error: { message: "Bucket no disponible" } }, 404);
  const store = adminStorage(env).from(bucket);
  if (action === "upload") {
    if (!(await policy.canFile(bucket, path, "write"))) return json({ error: { message: "No tienes permiso para subir este archivo", statusCode: "403" } }, 403);
    const size = Number(req.headers.get("Content-Length") || 0);
    if (size > 50 * 1024 * 1024) return json({ error: { message: "El archivo supera 50 MB" } }, 413);
    const r = await store.upload(path, await req.arrayBuffer(), { contentType: req.headers.get("Content-Type") || undefined, upsert: url.searchParams.get("upsert") === "true" });
    return json(r, r.error ? 409 : 200);
  }
  if (action === "download") {
    if (!(await policy.canFile(bucket, path, "read"))) return json({ error: { message: "Sin acceso al archivo" } }, 403);
    const obj = await env.FILES.get(key(bucket, path));
    if (!obj) return json({ error: { message: "Archivo no encontrado" } }, 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store" } });
  }
  if (action === "sign") {
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    const paths: string[] = body.paths || [path];
    for (const p of paths) if (!(await policy.canFile(bucket, p, "read"))) return json({ error: { message: "Sin acceso al archivo" } }, 403);
    const urls = await Promise.all(paths.map(async p => ({ path: p, signedUrl: await signedUrl(env, bucket, p, Number(body.expiresIn) || 3600, body.download), error: null })));
    return json({ data: body.paths ? urls : { signedUrl: urls[0].signedUrl }, error: null });
  }
  if (action === "remove") {
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    const paths: string[] = body.paths || [];
    for (const p of paths) if (!(await policy.canFile(bucket, p, "delete"))) return json({ error: { message: "Sin permiso para borrar " + p } }, 403);
    return json(await store.remove(paths));
  }
  if (action === "list") {
    if (!(await policy.canFile(bucket, (path || "x") + "/x", "read"))) return json({ error: { message: "Sin acceso" } }, 403);
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    return json(await store.list(path, body.options || {}));
  }
  return json({ error: { message: "Acción no disponible" } }, 404);
}

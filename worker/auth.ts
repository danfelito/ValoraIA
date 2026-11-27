// Inicio de sesión propio: acceso inmediato (anónimo), cuenta con contraseña y renovación de sesión.
// Las contraseñas se guardan con PBKDF2-SHA256 y la sesión es un token firmado con AUTH_SECRET.
import type { Row } from "./schema.ts";
import { fromDb, uuid, now } from "./schema.ts";
import type { User } from "./policy.ts";

export interface Env {
  DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher; AUTH_SECRET: string; REPORTS?: any;
  OPENAI_API_KEY?: string; SMTP_HOST?: string; SMTP_PORT?: string; SMTP_USER?: string; SMTP_PASSWORD?: string; MAIL_FROM?: string;
  OPENPAY_MERCHANT_ID?: string; OPENPAY_PRIVATE_KEY?: string; OPENPAY_PUBLIC_KEY?: string; OPENPAY_PRODUCTION?: string;
  OPENPAY_WEBHOOK_USER?: string; OPENPAY_WEBHOOK_PASSWORD?: string; PUBLIC_URL?: string; [k: string]: any;
}

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const ACCESS_TTL = 3600, REFRESH_TTL = 30 * 86400;

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export async function sign(secret: string, payload: Row) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + "." + await hmac(secret, body);
}
export async function verify(secret: string, token: string): Promise<Row | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || await hmac(secret, body) !== sig) return null;
  try { const p = JSON.parse(new TextDecoder().decode(fromB64u(body))); return p.exp && p.exp * 1000 < Date.now() ? null : p; } catch { return null; }
}

export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return "pbkdf2$100000$" + b64u(salt) + "$" + b64u(bits);
}
async function checkPassword(password: string, stored: string) {
  const [, , salt] = String(stored || "").split("$");
  if (!salt) return false;
  return (await hashPassword(password, fromB64u(salt))) === stored;
}

function publicUser(u: Row) {
  const user = fromDb("users", u);
  return { id: user.id, email: user.email, is_anonymous: !!user.is_anonymous, email_confirmed_at: user.email_confirmed_at,
    user_metadata: user.user_metadata || {}, app_metadata: { provider: user.is_anonymous ? "anonymous" : "email" }, created_at: user.created_at, aud: "authenticated", role: "authenticated" };
}

async function newSession(env: Env, user: Row, method: string) {
  const sid = uuid(), refresh = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(`INSERT INTO sessions (id, user_id, refresh_token, method, expires_at) VALUES (?,?,?,?,?)`)
    .bind(sid, user.id, refresh, method, new Date(Date.now() + REFRESH_TTL * 1000).toISOString()).run();
  await env.DB.prepare(`UPDATE users SET last_sign_in_at = ? WHERE id = ?`).bind(now(), user.id).run();
  return sessionFor(env, user, sid, refresh, method);
}
async function sessionFor(env: Env, user: Row, sid: string, refresh: string, method: string) {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL;
  const access_token = await sign(env.AUTH_SECRET, { sub: user.id, sid, method, anon: !!user.is_anonymous, exp });
  return { access_token, refresh_token: refresh, token_type: "bearer", expires_in: ACCESS_TTL, expires_at: exp, user: publicUser(user) };
}

// Usuario de la petición (cabecera Authorization: Bearer <token>).
export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const p = await verify(env.AUTH_SECRET, token);
  if (!p?.sub) return null;
  const s = await env.DB.prepare(`SELECT s.id FROM sessions s WHERE s.id = ? AND s.user_id = ?`).bind(p.sid, p.sub).first();
  if (!s) return null;
  const u = await env.DB.prepare(`SELECT id, email, is_anonymous, email_confirmed_at FROM users WHERE id = ?`).bind(p.sub).first<Row>();
  if (!u) return null;
  return { id: u.id, email: u.email, is_anonymous: !!u.is_anonymous, email_confirmed_at: u.email_confirmed_at, method: p.method };
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const err = (message: string, status = 400, code?: string) => json({ error: { message, code: code || String(status) } }, status);

export async function handleAuth(env: Env, req: Request, action: string, queueMail: (to: string, kind: string, data: Row) => Promise<void>): Promise<Response> {
  const body: Row = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const email = String(body.email || "").trim().toLowerCase();
  if (action === "anonymous") {
    const id = uuid(), meta = body.data || {};
    await env.DB.prepare(`INSERT INTO users (id, is_anonymous, user_metadata) VALUES (?,1,?)`).bind(id, JSON.stringify(meta)).run();
    const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<Row>();
    return json({ session: await newSession(env, u!, "anonymous") });
  }
  if (action === "signup") {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("Correo no válido");
    if (String(body.password || "").length < 6) return err("La contraseña debe tener al menos 6 caracteres", 422, "weak_password");
    const exists = await env.DB.prepare(`SELECT id, password_hash FROM users WHERE email = ?`).bind(email).first<Row>();
    if (exists?.password_hash) return err("Este correo ya está registrado. Ingresa con tu contraseña.", 422, "user_already_exists");
    const id = exists?.id || uuid(), hash = await hashPassword(String(body.password));
    if (exists) await env.DB.prepare(`UPDATE users SET password_hash = ?, user_metadata = ? WHERE id = ?`).bind(hash, JSON.stringify(body.data || {}), id).run();
    else await env.DB.prepare(`INSERT INTO users (id, email, password_hash, user_metadata) VALUES (?,?,?,?)`).bind(id, email, hash, JSON.stringify(body.data || {})).run();
    await env.DB.prepare(`INSERT OR IGNORE INTO profiles (id, full_name) VALUES (?, ?)`).bind(id, body.data?.full_name || null).run();
    await sendConfirmation(env, id, email, body.redirect_to, queueMail);
    const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<Row>();
    return json({ session: await newSession(env, u!, "password"), user: publicUser(u!) });
  }
  if (action === "signin") {
    const u = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<Row>();
    if (!u || !u.password_hash || !(await checkPassword(String(body.password || ""), u.password_hash))) return err("Correo o contraseña incorrectos", 400, "invalid_credentials");
    return json({ session: await newSession(env, u, "password") });
  }
  if (action === "refresh") {
    const s = await env.DB.prepare(`SELECT * FROM sessions WHERE refresh_token = ?`).bind(String(body.refresh_token || "")).first<Row>();
    if (!s || Date.parse(s.expires_at) < Date.now()) return err("La sesión expiró; vuelve a ingresar", 401, "session_expired");
    const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(s.user_id).first<Row>();
    if (!u) return err("Usuario no encontrado", 401);
    return json({ session: await sessionFor(env, u, s.id, s.refresh_token, s.method) });
  }
  if (action === "user") {
    const cu = await currentUser(env, req);
    if (!cu) return err("Sesión inválida", 401);
    const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(cu.id).first<Row>();
    return json({ user: publicUser(u!) });
  }
  if (action === "signout") {
    const p = await verify(env.AUTH_SECRET, (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (p?.sid) await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(p.sid).run();
    return json({});
  }
  if (action === "resend") {
    const u = await env.DB.prepare(`SELECT id, email_confirmed_at FROM users WHERE email = ?`).bind(email).first<Row>();
    if (u && !u.email_confirmed_at) await sendConfirmation(env, u.id, email, body.redirect_to, queueMail);
    return json({});
  }
  if (action === "update") { // cambio de datos o contraseña del propio usuario
    const cu = await currentUser(env, req);
    if (!cu) return err("Sesión inválida", 401);
    if (body.password) await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(String(body.password)), cu.id).run();
    if (body.data) {
      const u = await env.DB.prepare(`SELECT user_metadata FROM users WHERE id = ?`).bind(cu.id).first<Row>();
      await env.DB.prepare(`UPDATE users SET user_metadata = ? WHERE id = ?`).bind(JSON.stringify({ ...JSON.parse(u?.user_metadata || "{}"), ...body.data }), cu.id).run();
    }
    const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(cu.id).first<Row>();
    return json({ user: publicUser(u!) });
  }
  if (action === "confirm") {
    const url = new URL(req.url), p = await verify(env.AUTH_SECRET, url.searchParams.get("token") || "");
    if (p?.confirm) await env.DB.prepare(`UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?) WHERE id = ? AND email = ?`).bind(now(), p.confirm, p.email).run();
    const to = url.searchParams.get("redirect_to") || "/cuenta.html";
    return Response.redirect(new URL(to.startsWith("/") ? to : "/cuenta.html", url.origin).toString() + (p ? "?confirmado=1" : "?confirmado=0"), 302);
  }
  return err("Acción no disponible", 404);
}

async function sendConfirmation(env: Env, id: string, email: string, redirect: unknown, queueMail: (to: string, kind: string, data: Row) => Promise<void>) {
  const token = await sign(env.AUTH_SECRET, { confirm: id, email, exp: Math.floor(Date.now() / 1000) + 7 * 86400 });
  const base = (env.PUBLIC_URL || "https://valoraia.circulointernacionalveracruz.org").replace(/\/$/, "");
  let to = "/cuenta.html";
  try { const r = new URL(String(redirect || "")); to = r.pathname + r.search; } catch { /* ruta por defecto */ }
  await queueMail(email, "confirm_email", { link: `${base}/api/auth/confirm?token=${encodeURIComponent(token)}&redirect_to=${encodeURIComponent(to)}` });
}

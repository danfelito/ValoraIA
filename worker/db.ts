// Motor de consultas sobre D1 con la misma forma de uso que el cliente de Supabase:
//   db.from("tabla").select("*,relacion(*)").eq("col", v).order("col").single()
// Así el código existente del motor de informes y de las pantallas se reutiliza.
// El motor se ejecuta con permisos completos (servidor) o con un contexto de usuario,
// en cuyo caso cada fila pasa por las reglas de acceso de policy.ts.
import { TABLES, RELATIONS, toDb, fromDb, filterValue, uuid, now } from "./schema.ts";
import type { Row } from "./schema.ts";
import { afterWrite, beforeInsert, auditTables } from "./triggers.ts";

// JSON grande (más de 1.5 MB, p. ej. la lectura de un catálogo de 214 páginas) no cabe en una fila
// de D1: se guarda en R2 y en la columna queda {"$r2": "<llave>"}. Se lee y escribe de forma transparente.
const BLOB_LIMIT = 1_500_000;
let BLOBS: R2Bucket | null = null;
export function setBlobStore(r2: R2Bucket) { BLOBS = r2; }
async function offload(table: string, row: Row): Promise<Row> {
  const meta = TABLES[table];
  if (!BLOBS || !meta?.json) return row;
  for (const c of meta.json) {
    const v = row[c];
    if (v === null || v === undefined || typeof v !== "object") continue;
    const text = JSON.stringify(v);
    if (text.length <= BLOB_LIMIT) continue;
    const key = `_blobs/${table}/${c}/${uuid()}.json`;
    await BLOBS.put(key, text, { httpMetadata: { contentType: "application/json" } });
    row[c] = { $r2: key };
  }
  return row;
}
async function hydrate(table: string, row: Row): Promise<Row> {
  const meta = TABLES[table];
  if (!BLOBS || !meta?.json) return row;
  for (const c of meta.json) {
    const v = row[c];
    if (v && typeof v === "object" && typeof v.$r2 === "string" && Object.keys(v).length === 1) {
      const obj = await BLOBS.get(v.$r2);
      row[c] = obj ? JSON.parse(await obj.text()) : null;
    }
  }
  return row;
}

export interface Filter { col: string; op: string; val: any }
export interface QueryState {
  table: string; action: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string; filters: Filter[]; orders: { col: string; asc: boolean; nullsFirst?: boolean }[];
  limit?: number; offset?: number; single?: "single" | "maybe"; values?: any; onConflict?: string;
  ignoreDuplicates?: boolean; returning?: string | null; count?: string; head?: boolean;
}
export interface Result { data: any; error: any; count?: number | null; status?: number }
export type Executor = (state: QueryState) => Promise<Result>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const id = (s: string) => { if (!IDENT.test(s)) throw new Error("Columna no válida: " + s); return '"' + s + '"'; };

export class Query implements PromiseLike<Result> {
  s: QueryState;
  constructor(private exec: Executor, table: string) { this.s = { table, action: "select", filters: [], orders: [] }; }
  select(columns = "*", opts: Row = {}) {
    if (this.s.action === "select") { this.s.columns = columns; this.s.count = opts.count; this.s.head = opts.head; }
    else this.s.returning = columns;
    return this;
  }
  insert(values: any, opts: Row = {}) { this.s.action = "insert"; this.s.values = values; this.s.returning = null; if (opts.count) this.s.count = opts.count; return this; }
  upsert(values: any, opts: Row = {}) { this.s.action = "upsert"; this.s.values = values; this.s.onConflict = opts.onConflict; this.s.ignoreDuplicates = !!opts.ignoreDuplicates; this.s.returning = null; return this; }
  update(values: Row) { this.s.action = "update"; this.s.values = values; this.s.returning = null; return this; }
  delete() { this.s.action = "delete"; this.s.returning = null; return this; }
  private f(col: string, op: string, val: any) { this.s.filters.push({ col, op, val }); return this; }
  eq(c: string, v: any) { return this.f(c, "eq", v); }
  neq(c: string, v: any) { return this.f(c, "neq", v); }
  gt(c: string, v: any) { return this.f(c, "gt", v); }
  gte(c: string, v: any) { return this.f(c, "gte", v); }
  lt(c: string, v: any) { return this.f(c, "lt", v); }
  lte(c: string, v: any) { return this.f(c, "lte", v); }
  like(c: string, v: any) { return this.f(c, "like", v); }
  ilike(c: string, v: any) { return this.f(c, "ilike", v); }
  is(c: string, v: any) { return this.f(c, "is", v); }
  in(c: string, v: any[]) { return this.f(c, "in", v); }
  contains(c: string, v: any) { return this.f(c, "contains", v); }
  not(c: string, op: string, v: any) { return this.f(c, "not." + op, v); }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  filter(c: string, op: string, v: any) { return this.f(c, op, v); }
  order(col: string, opts: Row = {}) { this.s.orders.push({ col, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst }); return this; }
  limit(n: number) { this.s.limit = n; return this; }
  range(from: number, to: number) { this.s.offset = from; this.s.limit = to - from + 1; return this; }
  single() { this.s.single = "single"; return this; }
  maybeSingle() { this.s.single = "maybe"; return this; }
  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec(this.s).then(ok, bad);
  }
}

// ---------- análisis de la lista de columnas: "*,rel!inner(a,b),alias:rel2(*)" ----------
export interface Sel { cols: string[]; embeds: { name: string; alias: string; inner: boolean; sel: Sel }[] }
export function parseSelect(src = "*"): Sel {
  const out: Sel = { cols: [], embeds: [] };
  let depth = 0, cur = "";
  const parts: string[] = [];
  for (const ch of src.replace(/\s+/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const m = p.match(/^(?:([a-z_0-9]+):)?([a-z_0-9]+)(!inner|!left)?(?:!([a-z_0-9]+))?\((.*)\)$/);
    if (m) out.embeds.push({ alias: m[1] || m[2], name: m[2], inner: m[3] === "!inner", sel: parseSelect(m[5] || "*") });
    else if (p) out.cols.push(p);
  }
  if (!out.cols.length) out.cols.push("*");
  return out;
}

function where(table: string, filters: Filter[], params: any[]): string {
  const parts: string[] = [];
  for (const { col, op, val } of filters) {
    if (col.includes(".")) continue; // filtros sobre relaciones: se aplican después
    const c = id(col), v = filterValue(table, col, val);
    switch (op) {
      case "eq": if (v === null) parts.push(c + " IS NULL"); else { parts.push(c + " = ?"); params.push(v); } break;
      case "neq": if (v === null) parts.push(c + " IS NOT NULL"); else { parts.push(c + " <> ?"); params.push(v); } break;
      case "gt": parts.push(c + " > ?"); params.push(v); break;
      case "gte": parts.push(c + " >= ?"); params.push(v); break;
      case "lt": parts.push(c + " < ?"); params.push(v); break;
      case "lte": parts.push(c + " <= ?"); params.push(v); break;
      case "like": parts.push(c + " LIKE ?"); params.push(v); break;
      case "ilike": parts.push("LOWER(" + c + ") LIKE LOWER(?)"); params.push(v); break;
      case "is": parts.push(v === null || v === "null" ? c + " IS NULL" : c + " = ?"); if (!(v === null || v === "null")) params.push(v === "true" ? 1 : v === "false" ? 0 : v); break;
      case "not.is": parts.push(v === null || v === "null" ? c + " IS NOT NULL" : c + " <> ?"); if (!(v === null || v === "null")) params.push(v); break;
      case "in": {
        const list = Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",");
        if (!list.length) { parts.push("0"); break; }
        parts.push(c + " IN (" + list.map(() => "?").join(",") + ")"); params.push(...list.map((x: any) => filterValue(table, col, x)));
        break;
      }
      case "not.in": {
        const list = Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",");
        if (list.length) { parts.push(c + " NOT IN (" + list.map(() => "?").join(",") + ")"); params.push(...list); }
        break;
      }
      case "contains": {
        const items = Array.isArray(val) ? val : [val];
        for (const it of items) { parts.push("EXISTS (SELECT 1 FROM json_each(" + c + ") WHERE value = ?)"); params.push(it); }
        break;
      }
      default: throw new Error("Filtro no soportado: " + op);
    }
  }
  return parts.length ? " WHERE " + parts.join(" AND ") : "";
}
function orderBy(orders: QueryState["orders"]): string {
  if (!orders.length) return "";
  return " ORDER BY " + orders.map(o => {
    const c = id(o.col), nullsFirst = o.nullsFirst ?? !o.asc;
    return `(${c} IS NULL) ${nullsFirst ? "DESC" : "ASC"}, ${c} ${o.asc ? "ASC" : "DESC"}`;
  }).join(", ");
}

export interface Access {
  // Reglas de acceso de un usuario. Sin Access (servidor) todo está permitido.
  canRead(table: string, row: Row): Promise<boolean>;
  canInsert(table: string, row: Row): Promise<boolean>;
  canUpdate(table: string, before: Row, after: Row): Promise<boolean>;
  canDelete(table: string, row: Row): Promise<boolean>;
  uid: string | null;
}

export class Engine {
  constructor(public d1: D1Database, public access: Access | null = null) {}

  async all(sql: string, params: any[] = []): Promise<Row[]> {
    const r = await this.d1.prepare(sql).bind(...params).all();
    return (r.results || []) as Row[];
  }

  async fetchRows(table: string, filters: Filter[], orders: QueryState["orders"] = [], limit?: number, offset?: number): Promise<Row[]> {
    if (!TABLES[table]) throw new Error("Tabla no disponible: " + table);
    const params: any[] = [];
    let sql = `SELECT * FROM ${id(table)}` + where(table, filters, params) + orderBy(orders);
    if (limit !== undefined && !this.access) sql += ` LIMIT ${Number(limit)}` + (offset ? ` OFFSET ${Number(offset)}` : "");
    const rows = await Promise.all((await this.all(sql, params)).map(r => hydrate(table, fromDb(table, r))));
    if (!this.access) return rows;
    const ok: Row[] = [];
    for (const r of rows) if (await this.access.canRead(table, r)) ok.push(r);
    return limit !== undefined ? ok.slice(offset || 0, (offset || 0) + limit) : ok;
  }

  async embed(table: string, rows: Row[], sel: Sel, filters: Filter[]): Promise<Row[]> {
    for (const e of sel.embeds) {
      const rel = RELATIONS[table]?.[e.name];
      if (!rel) throw new Error(`Relación no disponible: ${table} → ${e.name}`);
      const keys = [...new Set(rows.map(r => r[rel.local]).filter(v => v !== null && v !== undefined))];
      const childFilters = filters.filter(f => f.col.startsWith(e.alias + ".")).map(f => ({ ...f, col: f.col.slice(e.alias.length + 1) }));
      let children: Row[] = [];
      for (let i = 0; i < keys.length; i += 90) {
        children.push(...await this.fetchRows(rel.table, [{ col: rel.foreign, op: "in", val: keys.slice(i, i + 90) }, ...childFilters.filter(f => !f.col.includes("."))]));
      }
      children = await this.embed(rel.table, children, e.sel, childFilters);
      const shaped = new Map<string, Row[]>();
      for (const c of children) { const k = String(c[rel.foreign]); (shaped.get(k) || shaped.set(k, []).get(k)!).push(project(c, e.sel)); }
      for (const r of rows) {
        const list = shaped.get(String(r[rel.local])) || [];
        r[e.alias] = rel.one ? (list[0] ?? null) : list;
      }
      if (e.inner || childFilters.length) rows = rows.filter(r => rel.one ? r[e.alias] : r[e.alias].length);
    }
    return rows;
  }

  async run(s: QueryState): Promise<Result> {
    try {
      if (!TABLES[s.table]) return fail("La tabla " + s.table + " no existe", 404);
      if (s.action === "select") return await this.select(s);
      if (s.action === "insert" || s.action === "upsert") return await this.insert(s);
      if (s.action === "update") return await this.update(s);
      return await this.remove(s);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  async select(s: QueryState): Promise<Result> {
    const sel = parseSelect(s.columns);
    let rows = await this.fetchRows(s.table, s.filters, s.orders, sel.embeds.length && s.filters.some(f => f.col.includes(".")) ? undefined : s.limit, s.offset);
    rows = await this.embed(s.table, rows, sel, s.filters);
    if (s.limit !== undefined && rows.length > s.limit) rows = rows.slice(0, s.limit);
    const data = rows.map(r => project(r, sel));
    return shape(s, data);
  }

  async insert(s: QueryState): Promise<Result> {
    const table = s.table, meta = TABLES[table];
    const list: Row[] = (Array.isArray(s.values) ? s.values : [s.values]).map((v: Row) => ({ ...v }));
    const out: Row[] = [];
    for (const raw of list) {
      if (meta.pk.length === 1 && meta.pk[0] === "id" && !meta.autoId && !raw.id) raw.id = uuid();
      await beforeInsert(this, table, raw);
      if (this.access && !(await this.access.canInsert(table, raw))) return fail("No tienes permiso para registrar en " + table, 403);
      const row = toDb(table, await offload(table, { ...raw })), cols = Object.keys(row);
      let sql = `INSERT INTO ${id(table)} (${cols.map(id).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
      let before: Row | null = null;
      if (s.action === "upsert") {
        const conflict = (s.onConflict || meta.pk.join(",")).split(",").map(x => x.trim());
        const existing = await this.fetchRowsAdmin(table, conflict.map(c => ({ col: c, op: "eq", val: raw[c] })));
        before = existing[0] || null;
        if (before && this.access && !(await this.access.canUpdate(table, before, { ...before, ...raw }))) return fail("No tienes permiso para actualizar " + table, 403);
        const updates = cols.filter(c => !conflict.includes(c));
        if (meta.updatedAt && !cols.includes("updated_at")) updates.push("updated_at");
        sql += ` ON CONFLICT (${conflict.map(id).join(",")}) ` + (s.ignoreDuplicates || !updates.length ? "DO NOTHING"
          : "DO UPDATE SET " + updates.map(c => c === "updated_at" && !cols.includes(c) ? `${id(c)} = '${now()}'` : `${id(c)} = excluded.${id(c)}`).join(", "));
      }
      sql += " RETURNING *";
      const res = await this.all(sql, cols.map(c => row[c]));
      for (const r of res) {
        const after = await hydrate(table, fromDb(table, r));
        out.push(after);
        await afterWrite(this, table, before ? "UPDATE" : "INSERT", before, after);
      }
    }
    return s.returning !== null && s.returning !== undefined ? shape(s, out.map(r => project(r, parseSelect(s.returning!)))) : { data: null, error: null, status: 201 };
  }

  async fetchRowsAdmin(table: string, filters: Filter[]): Promise<Row[]> {
    const params: any[] = [];
    return Promise.all((await this.all(`SELECT * FROM ${id(table)}` + where(table, filters, params), params)).map(r => hydrate(table, fromDb(table, r))));
  }

  async update(s: QueryState): Promise<Result> {
    const table = s.table, meta = TABLES[table];
    const values = { ...(s.values as Row) };
    if (meta.updatedAt && values.updated_at === undefined) values.updated_at = now();
    const rows = await this.fetchRowsAdmin(table, s.filters);
    const out: Row[] = [];
    for (const before of rows) {
      const merged = { ...before, ...values };
      if (this.access && !(await this.access.canUpdate(table, before, merged))) continue;
      await beforeInsert(this, table, merged, true);
      const row = toDb(table, await offload(table, Object.fromEntries(Object.keys(values).map(k => [k, merged[k]]))));
      const cols = Object.keys(row);
      if (!cols.length) continue;
      const params = cols.map(c => row[c]);
      const pkWhere = meta.pk.map(p => { params.push(before[p] === true ? 1 : before[p] === false ? 0 : before[p]); return `${id(p)} = ?`; }).join(" AND ");
      const res = await this.all(`UPDATE ${id(table)} SET ${cols.map(c => `${id(c)} = ?`).join(", ")} WHERE ${pkWhere} RETURNING *`, params);
      for (const r of res) { const after = await hydrate(table, fromDb(table, r)); out.push(after); await afterWrite(this, table, "UPDATE", before, after); }
    }
    return s.returning !== null && s.returning !== undefined ? shape(s, out.map(r => project(r, parseSelect(s.returning!)))) : { data: null, error: null, status: 204 };
  }

  async remove(s: QueryState): Promise<Result> {
    const table = s.table, meta = TABLES[table];
    const rows = await this.fetchRowsAdmin(table, s.filters);
    const out: Row[] = [];
    for (const before of rows) {
      if (this.access && !(await this.access.canDelete(table, before))) continue;
      const params: any[] = [];
      const pkWhere = meta.pk.map(p => { params.push(before[p]); return `${id(p)} = ?`; }).join(" AND ");
      if (auditTables.has(table)) await afterWrite(this, table, "DELETE", before, null);
      await this.all(`DELETE FROM ${id(table)} WHERE ${pkWhere}`, params);
      out.push(before);
    }
    return s.returning !== null && s.returning !== undefined ? shape(s, out) : { data: null, error: null, status: 204 };
  }
}

function project(row: Row, sel: Sel): Row {
  if (sel.cols.includes("*")) return row;
  const out: Row = {};
  for (const c of sel.cols) { const [name, alias] = c.includes(":") ? c.split(":").reverse() : [c, c]; out[alias] = row[name]; }
  for (const e of sel.embeds) out[e.alias] = row[e.alias];
  return out;
}
function shape(s: QueryState, data: Row[]): Result {
  const count = s.count ? data.length : null;
  if (s.head) return { data: null, error: null, count };
  if (s.single) {
    if (data.length === 1) return { data: data[0], error: null, count };
    if (!data.length && s.single === "maybe") return { data: null, error: null, count };
    return fail(data.length ? "Se encontró más de un registro" : "No se encontró el registro", 406, "PGRST116");
  }
  return { data, error: null, count, status: 200 };
}
export function fail(message: string, status = 400, code?: string): Result {
  return { data: null, error: { message, code: code || String(status) }, status };
}

// Cliente con la forma de supabase-js para el código del servidor.
export function client(d1: D1Database, access: Access | null = null, extras: Row = {}) {
  const engine = new Engine(d1, access);
  return { engine, from: (t: string) => new Query(s => engine.run(s), t), ...extras };
}

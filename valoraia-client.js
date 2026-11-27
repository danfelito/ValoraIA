// Cliente de ValoraIA para el navegador. Reemplaza a supabase-js con la misma forma de uso
// (auth, from, rpc, storage, functions) y habla con el Worker de Cloudflare del mismo sitio.
(() => {
  'use strict';
  const KEY = 'valoraia.session';
  const listeners = new Set();
  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { session = null; }

  const save = (s, event) => {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (_) { /* almacenamiento bloqueado */ }
    for (const cb of listeners) { try { cb(event, s); } catch (e) { console.error(e); } }
  };
  const errorOf = (body, res) => body?.error ? (typeof body.error === 'string' ? { message: body.error, status: res?.status } : { ...body.error, status: res?.status }) : { message: 'Error ' + (res?.status || ''), status: res?.status };

  let refreshing = null;
  async function validSession() {
    if (!session) return null;
    if (session.expires_at && session.expires_at * 1000 - Date.now() > 60000) return session;
    refreshing ||= (async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.session) save(body.session, 'TOKEN_REFRESHED'); else save(null, 'SIGNED_OUT');
    })().finally(() => { refreshing = null; });
    await refreshing;
    return session;
  }
  async function authHeaders(extra = {}) {
    const s = await validSession();
    return s ? { ...extra, Authorization: 'Bearer ' + s.access_token } : extra;
  }
  async function call(path, body, extraHeaders = {}) {
    const res = await fetch(path, { method: 'POST', headers: await authHeaders({ 'Content-Type': 'application/json', ...extraHeaders }), body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => null);
    return { res, data };
  }

  class Query {
    constructor(table) { this.s = { table, action: 'select', filters: [], orders: [] }; }
    select(columns = '*', opts = {}) { if (this.s.action === 'select') { this.s.columns = columns; this.s.count = opts.count; this.s.head = opts.head; } else this.s.returning = columns; return this; }
    insert(values) { this.s.action = 'insert'; this.s.values = values; this.s.returning = null; return this; }
    upsert(values, opts = {}) { this.s.action = 'upsert'; this.s.values = values; this.s.onConflict = opts.onConflict; this.s.ignoreDuplicates = !!opts.ignoreDuplicates; this.s.returning = null; return this; }
    update(values) { this.s.action = 'update'; this.s.values = values; this.s.returning = null; return this; }
    delete() { this.s.action = 'delete'; this.s.returning = null; return this; }
    _f(col, op, val) { this.s.filters.push({ col, op, val }); return this; }
    eq(c, v) { return this._f(c, 'eq', v); } neq(c, v) { return this._f(c, 'neq', v); }
    gt(c, v) { return this._f(c, 'gt', v); } gte(c, v) { return this._f(c, 'gte', v); }
    lt(c, v) { return this._f(c, 'lt', v); } lte(c, v) { return this._f(c, 'lte', v); }
    like(c, v) { return this._f(c, 'like', v); } ilike(c, v) { return this._f(c, 'ilike', v); }
    is(c, v) { return this._f(c, 'is', v); } in(c, v) { return this._f(c, 'in', v); }
    contains(c, v) { return this._f(c, 'contains', v); } not(c, op, v) { return this._f(c, 'not.' + op, v); }
    filter(c, op, v) { return this._f(c, op, v); }
    match(o) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
    order(col, opts = {}) { this.s.orders.push({ col, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst }); return this; }
    limit(n) { this.s.limit = n; return this; }
    range(a, b) { this.s.offset = a; this.s.limit = b - a + 1; return this; }
    single() { this.s.single = 'single'; return this; }
    maybeSingle() { this.s.single = 'maybe'; return this; }
    async run() {
      try {
        const { res, data } = await call('/api/rest/' + encodeURIComponent(this.s.table), this.s);
        if (!res.ok || data?.error) return { data: null, error: errorOf(data, res), count: null, status: res.status };
        return { data: data.data, error: null, count: data.count ?? null, status: res.status };
      } catch (e) { return { data: null, error: { message: e.message || 'Sin conexión' }, count: null }; }
    }
    then(ok, bad) { return this.run().then(ok, bad); }
  }

  function bucket(name) {
    const enc = p => String(p).split('/').map(encodeURIComponent).join('/');
    return {
      async upload(path, file, opts = {}) {
        const res = await fetch(`/api/storage/upload/${name}/${enc(path)}${opts.upsert ? '?upsert=true' : ''}`, { method: 'POST',
          headers: await authHeaders({ 'Content-Type': opts.contentType || file.type || 'application/octet-stream' }), body: file });
        const body = await res.json().catch(() => ({}));
        return res.ok && !body.error ? { data: body.data || { path }, error: null } : { data: null, error: errorOf(body, res) };
      },
      async download(path) {
        const res = await fetch(`/api/storage/download/${name}/${enc(path)}`, { headers: await authHeaders() });
        if (!res.ok) return { data: null, error: errorOf(await res.json().catch(() => ({})), res) };
        return { data: await res.blob(), error: null };
      },
      async createSignedUrl(path, expiresIn, opts = {}) {
        const { res, data } = await call(`/api/storage/sign/${name}/${enc(path)}`, { expiresIn, download: opts.download });
        return res.ok && data?.data ? { data: { signedUrl: new URL(data.data.signedUrl, location.origin).href }, error: null } : { data: null, error: errorOf(data, res) };
      },
      async createSignedUrls(paths, expiresIn) {
        const { res, data } = await call(`/api/storage/sign/${name}/_`, { paths, expiresIn });
        return res.ok ? { data: data.data.map(x => ({ ...x, signedUrl: new URL(x.signedUrl, location.origin).href })), error: null } : { data: null, error: errorOf(data, res) };
      },
      async remove(paths) {
        const { res, data } = await call(`/api/storage/remove/${name}/_`, { paths });
        return res.ok ? { data: data.data, error: null } : { data: null, error: errorOf(data, res) };
      },
      async list(dir = '', options = {}) {
        const { res, data } = await call(`/api/storage/list/${name}/${enc(dir)}`, { options });
        return res.ok ? { data: data.data, error: null } : { data: null, error: errorOf(data, res) };
      },
      getPublicUrl(path) { return { data: { publicUrl: `/api/storage/download/${name}/${enc(path)}` } }; },
    };
  }

  async function authCall(action, body) {
    const { res, data } = await call('/api/auth/' + action, body);
    if (!res.ok || data?.error) return { data: { user: null, session: null }, error: errorOf(data, res) };
    return { data, error: null };
  }

  const client = {
    from: table => new Query(table),
    rpc: async (name, args = {}) => {
      try {
        const { res, data } = await call('/api/rpc/' + encodeURIComponent(name), args);
        return res.ok && !data?.error ? { data: data.data, error: null } : { data: null, error: errorOf(data, res) };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    storage: { from: bucket },
    functions: {
      async invoke(name, opts = {}) {
        try {
          const { res, data } = await call('/functions/v1/' + name, opts.body || {}, opts.headers || {});
          if (!res.ok) return { data, error: { message: data?.error || ('Error ' + res.status), context: res, status: res.status } };
          return { data, error: null };
        } catch (e) { return { data: null, error: { message: e.message || 'Sin conexión' } }; }
      },
    },
    auth: {
      async getSession() { return { data: { session: await validSession() }, error: null }; },
      async getUser() {
        if (!(await validSession())) return { data: { user: null }, error: { message: 'Sin sesión' } };
        const { res, data } = await call('/api/auth/user', {});
        return res.ok ? { data: { user: data.user }, error: null } : { data: { user: null }, error: errorOf(data, res) };
      },
      async signInAnonymously(opts = {}) {
        const r = await authCall('anonymous', { data: opts.options?.data || {} });
        if (r.error) return r;
        save(r.data.session, 'SIGNED_IN');
        return { data: { session: r.data.session, user: r.data.session.user }, error: null };
      },
      async signUp({ email, password, options = {} }) {
        const r = await authCall('signup', { email, password, data: options.data || {}, redirect_to: options.emailRedirectTo });
        if (r.error) return r;
        save(r.data.session, 'SIGNED_IN');
        return { data: { session: r.data.session, user: r.data.session.user }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const r = await authCall('signin', { email, password });
        if (r.error) return r;
        save(r.data.session, 'SIGNED_IN');
        return { data: { session: r.data.session, user: r.data.session.user }, error: null };
      },
      async resend({ email, options = {} }) { return authCall('resend', { email, redirect_to: options.emailRedirectTo }); },
      async updateUser(attrs = {}) {
        const r = await authCall('update', { password: attrs.password, data: attrs.data });
        if (!r.error && session) save({ ...session, user: r.data.user }, 'USER_UPDATED');
        return r.error ? r : { data: { user: r.data.user }, error: null };
      },
      async signOut() { try { await call('/api/auth/signout', {}); } catch (_) { /* sin red */ } save(null, 'SIGNED_OUT'); return { error: null }; },
      onAuthStateChange(cb) {
        listeners.add(cb);
        setTimeout(() => cb(session ? 'INITIAL_SESSION' : 'INITIAL_SESSION', session), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
    },
  };

  window.supabase = { createClient: () => client };
  window.ValoraIAClient = client;
})();

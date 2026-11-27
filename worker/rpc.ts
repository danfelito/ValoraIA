// Funciones que antes eran RPC de Postgres (security definer). Validan la sesión y trabajan
// con permisos de servidor sobre D1.
import type { Row } from "./schema.ts";
import { uuid, now } from "./schema.ts";
import { client } from "./db.ts";
import type { Policy } from "./policy.ts";
import type { Env } from "./auth.ts";

class RpcError extends Error { constructor(m: string, public status = 400) { super(m); } }
const num = (v: unknown) => v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const int = (v: unknown) => { const n = num(v); return n === null ? null : Math.trunc(n); };
const bool = (v: unknown) => v === true || v === "true" || v === "on" || v === 1;
const str = (v: unknown) => v === null || v === undefined ? null : String(v);

export async function runRpc(env: Env, policy: Policy, name: string, args: Row): Promise<any> {
  const db = client(env.DB);
  const uid = policy.uid;
  const need = () => { if (!uid) throw new RpcError("Autenticación requerida", 401); return uid; };
  const one = async (sql: string, ...p: any[]) => env.DB.prepare(sql).bind(...p).first<Row>();
  const check = (r: Row) => { if (r.error) throw new RpcError(r.error.message); return r.data; };

  switch (name) {
    case "submit_valuation_request": {
      const user = need(), payload: Row = args.payload || {};
      const org = (await one(`SELECT organization_id FROM platform_configuration WHERE singleton = 1`))?.organization_id;
      if (!org) throw new RpcError("Plataforma sin organización configurada");
      const svc = String(payload.service_type || ""), ptype = String(payload.property_type || "");
      const email = String(payload.client_email || "").trim().toLowerCase();
      const wantsInvoice = bool(payload.invoice_requested);
      const fiscal = payload.fiscal_data && typeof payload.fiscal_data === "object" && !Array.isArray(payload.fiscal_data) ? payload.fiscal_data : {};
      if (!["commercial", "professional"].includes(svc)) throw new RpcError("Tipo de servicio inválido");
      if (!ptype || !email || !payload.client_name) throw new RpcError("Nombre, correo y tipo de inmueble son obligatorios");
      if (!bool(payload.privacy_accepted)) throw new RpcError("Debe aceptar el aviso de privacidad");
      if (svc === "commercial" && wantsInvoice && ["rfc", "legal_name", "postal_code", "tax_regime", "cfdi_use"].some(k => !String(fiscal[k] || "").trim()))
        throw new RpcError("Completa los datos fiscales para solicitar factura");
      const settings = await one(`SELECT commercial_price, commercial_checkout_url FROM app_settings WHERE organization_id = ?`, org);
      const price = Number(settings?.commercial_price ?? 365), checkout = settings?.commercial_checkout_url || null;
      const d = new Date(), pad = (n: number) => String(n).padStart(2, "0");
      const mx = new Date(d.getTime() - 6 * 3600000); // folio con hora de México
      const folio = `VAL-${mx.getUTCFullYear()}${pad(mx.getUTCMonth() + 1)}${pad(mx.getUTCDate())}-${pad(mx.getUTCHours())}${pad(mx.getUTCMinutes())}${pad(mx.getUTCSeconds())}-${uuid().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const commercial = svc === "commercial";
      const c = check(await db.from("valuation_cases").insert({ organization_id: org, folio, title: payload.title || "Solicitud " + folio,
        purpose: commercial ? "opinion_valor_comercial" : "avaluo_profesional", property_type: ptype, status: "draft", country_code: payload.country_code || "MX",
        region: str(payload.region), municipality: str(payload.municipality), locality: str(payload.locality), coverage_level: "assisted",
        owner_user_id: user, progress: 10, created_by: user, applicant_name: payload.client_name, currency_code: "MXN" }).select().single());
      check(await db.from("properties").insert({ case_id: c.id, address_line: str(payload.address_line), postal_code: str(payload.postal_code),
        latitude: num(payload.latitude), longitude: num(payload.longitude), cadastral_key: str(payload.cadastral_key), registry_folio: str(payload.registry_folio),
        land_area_m2: num(payload.land_area_m2), built_area_m2: num(payload.built_area_m2), rentable_area_m2: num(payload.rentable_area_m2), saleable_area_m2: num(payload.saleable_area_m2),
        frontage_m: num(payload.frontage_m), depth_m: num(payload.depth_m), floors: int(payload.floors), bedrooms: int(payload.bedrooms), bathrooms: num(payload.bathrooms),
        parking_spaces: int(payload.parking_spaces), construction_year: int(payload.construction_year), conservation_state: str(payload.conservation_state),
        construction_quality: str(payload.construction_quality), occupancy_status: str(payload.occupancy_status), notes: str(payload.property_notes) }));
      const r = check(await db.from("service_requests").insert({ organization_id: org, case_id: c.id, created_by: user, service_type: svc,
        status: commercial ? "payment_pending" : "awaiting_assignment", payment_status: commercial ? "pending" : "not_required",
        payment_amount: commercial ? price : 0, payment_currency: "MXN", payment_provider: commercial ? "openpay" : null,
        client_name: payload.client_name, client_email: email, client_phone: str(payload.client_phone), alternate_phone: str(payload.alternate_phone),
        preferred_contact: str(payload.preferred_contact), best_contact_time: str(payload.best_contact_time), marketing_consent: bool(payload.marketing_consent),
        privacy_accepted: true, property_type: ptype, property_subtype: str(payload.property_subtype), urgency: str(payload.urgency),
        invoice_requested: commercial ? wantsInvoice : false, fiscal_data: commercial ? fiscal : {}, document_status: "not_started",
        invoice_status: commercial && wantsInvoice ? "queued" : "not_requested", intake_data: payload }).select().single());
      return { request_id: r.id, case_id: c.id, folio, service_type: svc, payment_amount: commercial ? price : 0, payment_currency: "MXN",
        invoice_requested: commercial ? wantsInvoice : false, checkout_url: commercial ? checkout : null, status: r.status };
    }

    case "update_client_property": {
      const user = need();
      const r = check(await db.from("service_requests").select("*").eq("id", args.p_request_id).eq("created_by", user).maybeSingle());
      if (!r) throw new RpcError("Solicitud no disponible para esta cuenta", 403);
      const allowed = ["address_line", "postal_code", "region", "municipality", "locality", "land_area_m2", "built_area_m2", "bedrooms", "bathrooms", "parking_spaces",
        "construction_year", "conservation_state", "property_notes", "comparison_area_basis", "subject_listing_url", "asking_price"];
      const f: Row = Object.fromEntries(Object.entries(args.p_fields || {}).filter(([k]) => allowed.includes(k)));
      if (String(f.address_line || "").trim().length < 5 || !String(f.region || "").trim() || !String(f.municipality || "").trim()) throw new RpcError("Completa dirección, estado y municipio");
      const built = num(f.built_area_m2), land = num(f.land_area_m2);
      const basis = String(f.comparison_area_basis || r.intake_data?.comparison_area_basis || "auto");
      if (!["auto", "land", "built"].includes(basis)) throw new RpcError("Base de comparación no válida");
      if (basis === "land" && !["terreno", "rancho", "bodega", "industrial"].includes(r.property_type)) throw new RpcError("La comparación por terreno del inmueble construido sólo aplica a bodegas e industriales");
      if (basis === "built" && ["terreno", "rancho"].includes(r.property_type)) throw new RpcError("Este inmueble se compara por terreno");
      f.comparison_area_basis = basis;
      if (["terreno", "rancho"].includes(r.property_type) || (["bodega", "industrial"].includes(r.property_type) && basis === "land")) {
        if (!land || land <= 0) throw new RpcError("Captura una superficie de terreno mayor a cero");
      } else if (!built || built <= 0) throw new RpcError("Captura una superficie construida mayor a cero");
      if ((built ?? 0) < 0 || (land ?? 0) < 0) throw new RpcError("Las superficies no pueden ser negativas");
      check(await db.from("properties").update({ address_line: str(f.address_line), postal_code: str(f.postal_code), land_area_m2: land, built_area_m2: built,
        bedrooms: int(f.bedrooms), bathrooms: num(f.bathrooms), parking_spaces: int(f.parking_spaces), construction_year: int(f.construction_year),
        conservation_state: str(f.conservation_state), notes: str(f.property_notes) }).eq("case_id", r.case_id));
      check(await db.from("valuation_cases").update({ region: str(f.region), municipality: str(f.municipality), locality: str(f.locality) }).eq("id", r.case_id).eq("organization_id", r.organization_id));
      check(await db.from("service_requests").update({ intake_data: { ...(r.intake_data || {}), ...f } }).eq("id", r.id));
      return { request_id: r.id, updated: true };
    }

    case "route_professional_request": {
      const user = need();
      const r = check(await db.from("service_requests").select("*").eq("id", args.p_request_id).maybeSingle());
      if (!r || r.service_type !== "professional") return { assigned: false, reason: "Solicitud no profesional" };
      if (r.created_by !== user && !(await policy.hasRole(r.organization_id, ["owner", "admin"]))) throw new RpcError("No tienes permiso para asignar este expediente", 403);
      const list: Row[] = check(await db.from("appraisers").select("*").eq("organization_id", r.organization_id).eq("active", true)) || [];
      const score = (a: Row) => ((a.property_types || []).includes(r.property_type) ? 60 : 0) + ((a.specialties || []).includes(r.property_subtype || "") ? 25 : 0) + (a.priority || 0) / 10;
      list.sort((a, b) => score(b) - score(a) || (b.priority || 0) - (a.priority || 0) || String(a.created_at).localeCompare(String(b.created_at)));
      const a = list[0];
      if (!a) return { assigned: false, reason: "No hay peritos activos" };
      const s = score(a), reason = "Coincidencia por tipo de inmueble y especialidad; prioridad " + a.priority, conf = Math.min(1, s / 95);
      const asg = check(await db.from("appraiser_assignments").upsert({ organization_id: r.organization_id, request_id: r.id, appraiser_id: a.id, status: "assigned",
        score: s, confidence: conf, reason, assigned_by: "ai" }, { onConflict: "request_id,appraiser_id" }).select().single());
      check(await db.from("service_requests").update({ assigned_appraiser_id: a.id, status: "assigned", routing_reason: reason, routing_confidence: conf, routed_at: now() }).eq("id", r.id));
      check(await db.from("notification_outbox").insert({ organization_id: r.organization_id, request_id: r.id, assignment_id: asg.id, recipient: a.email,
        subject: "Nueva solicitud de avalúo profesional · " + r.property_type,
        body_text: `Se asignó una solicitud de ${r.property_type}. Cliente: ${r.client_name}. Correo: ${r.client_email}. Teléfono: ${r.client_phone || "No indicado"}. Revise ValoraIA para consultar el expediente completo.`,
        status: "queued", metadata: { appraiser_id: a.id, request_id: r.id, audience: "appraiser" } }));
      return { assigned: true, appraiser_id: a.id, assignment_id: asg.id, score: s, reason };
    }

    case "admin_service_tracking": {
      need();
      const org = args.p_organization_id;
      if (!(await policy.hasRole(org, ["owner", "admin"]))) throw new RpcError("Sin acceso administrativo", 403);
      const reqs = (await env.DB.prepare(`SELECT r.*, c.folio, a.full_name appraiser_name FROM service_requests r JOIN valuation_cases c ON c.id = r.case_id
        LEFT JOIN appraisers a ON a.id = r.assigned_appraiser_id WHERE r.organization_id = ? AND c.organization_id = ?`).bind(org, org).all()).results as Row[];
      const notes = (await env.DB.prepare(`SELECT request_id, recipient, status, sent_at, created_at, metadata FROM notification_outbox WHERE organization_id = ?`).bind(org).all()).results as Row[];
      const rows: Row[] = reqs.map(r => ({ request_id: r.id, case_id: r.case_id, folio: r.folio, service_type: r.service_type, client_name: r.client_name,
        client_email: r.client_email, client_phone: r.client_phone, status: r.status, payment_status: r.payment_status, document_status: r.document_status,
        document_generated_at: r.document_generated_at, document_emailed_at: r.document_emailed_at, appraiser_name: r.appraiser_name, created_at: r.created_at,
        notifications: notes.filter(n => n.request_id === r.id).map(n => { const m = JSON.parse(n.metadata || "{}"); return { recipient: n.recipient, status: n.status,
          sent_at: n.sent_at, created_at: n.created_at, delivered_at: m.delivered_at || null, opened_at: m.opened_at || null }; }) }));
      const lone = (await env.DB.prepare(`SELECT * FROM valuation_cases c WHERE organization_id = ? AND NOT EXISTS (SELECT 1 FROM service_requests r WHERE r.case_id = c.id)`).bind(org).all()).results as Row[];
      for (const c of lone) rows.push({ case_id: c.id, folio: c.folio, service_type: c.service_type, client_name: c.applicant_name, status: c.status,
        document_status: "not_started", created_at: c.created_at, notifications: [] });
      return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }

    case "create_organization_with_owner": {
      const user = need();
      if (policy.user?.is_anonymous) throw new RpcError("Las sesiones temporales no pueden crear organizaciones");
      const name = String(args.organization_name || "").trim();
      if (name.length < 2) throw new RpcError("Organization name is required");
      const o = check(await db.from("organizations").insert({ name, country_code: String(args.country_code || "").trim().toUpperCase() || null, created_by: user }).select().single());
      check(await db.from("organization_members").insert({ organization_id: o.id, user_id: user, role: "owner", status: "active" }));
      await env.DB.prepare(`INSERT OR IGNORE INTO profiles (id) VALUES (?)`).bind(user).run();
      return o.id;
    }

    case "switch_valuation_service": {
      need();
      const type = String(args.p_service_type);
      if (!["commercial", "professional"].includes(type)) throw new RpcError("Tipo de servicio inválido");
      const c = check(await db.from("valuation_cases").select("*").eq("id", args.p_case_id).maybeSingle());
      if (!c || !(await policy.canRead("valuation_cases", c))) throw new RpcError("Expediente no encontrado o sin acceso");
      const r = check(await db.from("service_requests").select("*").eq("case_id", c.id).maybeSingle());
      if (c.service_type === type) return { case_id: c.id, service_type: type, changed: false, has_request: !!r, payment_requires_review: false };
      if (!(await policy.canUpdate("valuation_cases", c, { ...c, service_type: type }))) throw new RpcError("Sin permiso para cambiar el servicio", 403);
      check(await db.from("valuation_cases").update({ service_type: type }).eq("id", c.id));
      let price = 365;
      if (r) {
        const paid = r.payment_status === "paid";
        if (type === "commercial") {
          price = Number((await one(`SELECT commercial_price FROM app_settings WHERE organization_id = ?`, c.organization_id))?.commercial_price ?? 365);
          check(await db.from("service_requests").update({ service_type: "commercial", status: paid ? "in_review" : "payment_pending", payment_status: paid ? "paid" : "pending",
            payment_amount: paid ? r.payment_amount : price, payment_currency: "MXN", payment_provider: paid ? r.payment_provider : "openpay",
            assigned_appraiser_id: null, routing_reason: null, routing_confidence: null, routed_at: null }).eq("id", r.id));
        } else {
          check(await db.from("service_requests").update({ service_type: "professional", status: r.status === "completed" ? "in_review" : "awaiting_assignment",
            payment_status: paid ? "paid" : "not_required", payment_amount: paid ? r.payment_amount : 0, payment_provider: paid ? r.payment_provider : null,
            assigned_appraiser_id: null, routing_reason: null, routing_confidence: null, routed_at: null }).eq("id", r.id));
        }
      }
      return { case_id: c.id, service_type: type, changed: true, has_request: !!r, payment_requires_review: !!r && ["paid", "refunded"].includes(r.payment_status),
        commercial_price: type === "commercial" ? price : null };
    }

    case "can_read_case_content": return policy.canReadCase(args.p_case_id);
    case "is_admin": return false;
    default: throw new RpcError("Función no disponible: " + name, 404);
  }
}
export { RpcError };

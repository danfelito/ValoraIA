// Reglas de acceso por fila, traducidas de las políticas RLS de Postgres.
// Se evalúan para todo lo que llega desde el navegador; el servidor usa el motor sin ellas.
import type { Row } from "./schema.ts";
import type { Access } from "./db.ts";

export interface User { id: string; email: string | null; is_anonymous: boolean; email_confirmed_at: string | null; method: string }

const OA = ["owner", "admin"];
const R5 = ["owner", "admin", "appraiser", "reviewer", "analyst"];
const R6 = [...R5, "assistant"];
const STAFF = ["appraiser", "reviewer", "analyst"];

export class Policy implements Access {
  uid: string | null;
  private members: Row[] | null = null;
  private caseCache = new Map<string, boolean>();
  private rowCache = new Map<string, Row | null>();
  constructor(private d1: D1Database, public user: User | null) { this.uid = user?.id || null; }

  private async one(sql: string, ...p: any[]): Promise<Row | null> {
    const k = sql + "|" + p.join("|");
    if (!this.rowCache.has(k)) this.rowCache.set(k, await this.d1.prepare(sql).bind(...p).first<Row>());
    return this.rowCache.get(k)!;
  }
  private async memberships(): Promise<Row[]> {
    if (!this.uid) return [];
    if (!this.members) this.members = ((await this.d1.prepare(`SELECT organization_id, role FROM organization_members WHERE user_id = ? AND status = 'active'`).bind(this.uid).all()).results || []) as Row[];
    return this.members;
  }
  async isMember(org: unknown) { return !!org && (await this.memberships()).some(m => m.organization_id === org); }
  async hasRole(org: unknown, roles: string[]) {
    if (!org || !this.user) return false;
    const strong = !this.user.is_anonymous && this.user.method === "password";
    return (await this.memberships()).some(m => m.organization_id === org && roles.includes(m.role) && (!OA.includes(m.role) || strong));
  }
  async requestOwnedBy(requestId: unknown) {
    if (!this.uid || !requestId) return false;
    return !!(await this.one(`SELECT 1 x FROM service_requests WHERE id = ? AND created_by = ?`, requestId, this.uid));
  }
  async caseRequestOwner(caseId: unknown) {
    if (!this.uid || !caseId) return false;
    return !!(await this.one(`SELECT 1 x FROM service_requests WHERE case_id = ? AND created_by = ?`, caseId, this.uid));
  }
  async caseOrg(caseId: unknown): Promise<string | null> {
    return (await this.one(`SELECT organization_id FROM valuation_cases WHERE id = ?`, caseId))?.organization_id || null;
  }
  async caseOrgMember(caseId: unknown) { return this.isMember(await this.caseOrg(caseId)); }
  async caseOrgRole(caseId: unknown, roles: string[]) { return this.hasRole(await this.caseOrg(caseId), roles); }

  // can_read_case_content: el dueño de la solicitud o el perito asignado al expediente.
  async canReadCase(caseId: unknown): Promise<boolean> {
    if (!this.uid || !caseId) return false;
    const key = String(caseId);
    if (this.caseCache.has(key)) return this.caseCache.get(key)!;
    let ok = false;
    const c = await this.one(`SELECT id, organization_id, assigned_appraiser_id, created_by, owner_user_id FROM valuation_cases WHERE id = ?`, caseId);
    if (c) {
      if (await this.caseRequestOwner(caseId)) ok = true;
      else if (await this.hasRole(c.organization_id, STAFF)) {
        const hasRequest = !!(await this.one(`SELECT 1 x FROM service_requests WHERE case_id = ?`, caseId));
        if (c.assigned_appraiser_id === this.uid) ok = true;
        else if (!hasRequest && (c.created_by === this.uid || c.owner_user_id === this.uid)) ok = true;
        else if (this.user?.email && this.user.email_confirmed_at) {
          ok = !!(await this.one(`SELECT 1 x FROM service_requests r JOIN appraisers a ON a.id = r.assigned_appraiser_id AND a.organization_id = r.organization_id
            WHERE r.case_id = ? AND a.active = 1 AND lower(a.email) = lower(?)`, caseId, this.user.email));
        }
      }
    }
    this.caseCache.set(key, ok);
    return ok;
  }
  async canReadRequest(requestId: unknown) {
    const r = await this.one(`SELECT case_id FROM service_requests WHERE id = ?`, requestId);
    return !!r && this.canReadCase(r.case_id);
  }

  // ---------- reglas por tabla ----------
  private async restrict(table: string, row: Row, write = false): Promise<boolean> {
    switch (table) {
      case "valuation_cases": return (await this.canReadCase(row.id)) || (write && row.created_by === this.uid && await this.hasRole(row.organization_id, STAFF));
      case "service_requests": case "adopted_values": case "audit_events": case "commercial_reports": case "data_conflicts":
      case "document_analyses": case "document_page_evidence": case "document_processing_jobs": case "documents": case "extracted_fields":
      case "market_comparables": case "properties": case "valuation_calculations": case "valuation_report_previews":
        return this.canReadCase(row.case_id);
      case "intake_documents": case "payment_events": return this.canReadRequest(row.request_id);
      case "notification_outbox": case "users": case "sessions": case "market_listings": case "market_searches": case "flow_runs": return false;
      default: return true;
    }
  }

  async canRead(table: string, r: Row): Promise<boolean> {
    if (!this.uid || !(await this.restrict(table, r))) return false;
    switch (table) {
      case "organizations": return this.isMember(r.id);
      case "organization_members": return r.user_id === this.uid || this.isMember(r.organization_id);
      case "profiles": return r.id === this.uid;
      case "app_settings": return this.isMember(r.organization_id);
      case "platform_configuration": return this.hasRole(r.organization_id, OA);
      case "appraisers": return this.hasRole(r.organization_id, [...OA, "appraiser", "reviewer"]);
      case "appraiser_assignments": return (await this.isMember(r.organization_id)) || this.requestOwnedBy(r.request_id);
      case "valuation_cases": return (await this.isMember(r.organization_id)) || this.caseRequestOwner(r.id);
      case "properties": return (await this.caseOrgMember(r.case_id)) || this.caseRequestOwner(r.case_id);
      case "documents": case "extracted_fields": case "adopted_values": case "data_conflicts": return this.caseOrgMember(r.case_id);
      case "audit_events": return !!r.organization_id && this.isMember(r.organization_id);
      case "document_processing_jobs": case "document_analyses": case "document_page_evidence": case "market_comparables": case "valuation_calculations":
        return this.isMember(r.organization_id);
      case "valuation_report_previews": return this.hasRole(r.organization_id, R5);
      case "service_requests": return r.created_by === this.uid || this.isMember(r.organization_id);
      case "intake_documents": return r.uploaded_by === this.uid || this.isMember(r.organization_id);
      case "payment_events": return (await this.hasRole(r.organization_id, OA)) || this.requestOwnedBy(r.request_id);
      case "commercial_reports": return (await this.isMember(r.organization_id)) || this.requestOwnedBy(r.request_id);
      case "knowledge_sources": return this.hasRole(r.organization_id, R5);
      default: return false;
    }
  }

  async canInsert(table: string, r: Row): Promise<boolean> {
    if (!this.uid || !(await this.restrict(table, r, true))) return false;
    switch (table) {
      case "organizations": return r.created_by === this.uid;
      case "organization_members": return (r.user_id === this.uid && r.role === "owner" && (r.status ?? "active") === "active" && await this.canBootstrap(r.organization_id)) || this.hasRole(r.organization_id, OA);
      case "profiles": return r.id === this.uid;
      case "app_settings": case "appraisers": case "knowledge_sources": case "payment_events": return this.hasRole(r.organization_id, OA);
      case "appraiser_assignments": return this.hasRole(r.organization_id, [...OA, "appraiser", "reviewer"]);
      case "valuation_cases": return r.created_by === this.uid && this.hasRole(r.organization_id, [...OA, "appraiser", "analyst", "assistant"]);
      case "properties": case "extracted_fields": return this.caseOrgRole(r.case_id, R6);
      case "documents": return r.uploaded_by === this.uid && this.caseOrgRole(r.case_id, R6);
      case "adopted_values": return r.adopted_by === this.uid && this.caseOrgRole(r.case_id, R5);
      case "data_conflicts": return this.caseOrgRole(r.case_id, R5);
      case "document_processing_jobs": return r.requested_by === this.uid && this.hasRole(r.organization_id, R6);
      case "market_comparables": return this.hasRole(r.organization_id, R6);
      case "valuation_calculations": case "commercial_reports": return this.hasRole(r.organization_id, R5);
      case "intake_documents": return r.uploaded_by === this.uid && this.requestOwnedBy(r.request_id);
      default: return false;
    }
  }

  async canUpdate(table: string, before: Row, after: Row): Promise<boolean> {
    if (!this.uid || !(await this.restrict(table, before, true)) || !(await this.restrict(table, after, true))) return false;
    switch (table) {
      case "organizations": return this.hasRole(before.id, OA);
      case "organization_members": case "app_settings": case "appraisers": case "knowledge_sources": return this.hasRole(before.organization_id, OA) && this.hasRole(after.organization_id, OA);
      case "profiles": return before.id === this.uid && after.id === this.uid;
      case "appraiser_assignments": return this.hasRole(before.organization_id, [...OA, "appraiser", "reviewer"]);
      case "valuation_cases": return this.hasRole(before.organization_id, R5);
      case "properties": case "documents": case "extracted_fields": return this.caseOrgRole(before.case_id, R6);
      case "adopted_values": return after.adopted_by === this.uid && this.caseOrgRole(before.case_id, R5);
      case "data_conflicts": return this.caseOrgRole(before.case_id, R5);
      case "document_processing_jobs": case "valuation_calculations": case "commercial_reports": case "intake_documents": return this.hasRole(before.organization_id, R5);
      case "market_comparables": return this.hasRole(before.organization_id, R6);
      case "service_requests": return this.hasRole(before.organization_id, [...OA, "appraiser", "reviewer"]);
      default: return false;
    }
  }

  async canDelete(table: string, r: Row): Promise<boolean> {
    if (!this.uid || !(await this.restrict(table, r, true))) return false;
    switch (table) {
      case "organization_members": return (await this.hasRole(r.organization_id, OA)) && !(r.user_id === this.uid && r.role === "owner");
      case "app_settings": case "appraisers": case "knowledge_sources": case "document_processing_jobs": case "valuation_calculations":
      case "valuation_cases": case "service_requests": return this.hasRole(r.organization_id, OA);
      case "appraiser_assignments": return this.hasRole(r.organization_id, [...OA, "appraiser", "reviewer"]);
      case "properties": case "documents": case "extracted_fields": case "adopted_values": case "data_conflicts": return this.caseOrgRole(r.case_id, [...OA, "appraiser"]);
      case "market_comparables": case "commercial_reports": return this.hasRole(r.organization_id, R5);
      case "profiles": return r.id === this.uid;
      default: return false;
    }
  }

  async canBootstrap(org: unknown) {
    const o = await this.one(`SELECT created_by FROM organizations WHERE id = ?`, org);
    const m = await this.one(`SELECT 1 x FROM organization_members WHERE organization_id = ?`, org);
    return !!o && o.created_by === this.uid && !m;
  }

  // ---------- archivos: bucket/organización/expediente-o-solicitud/... ----------
  async canFile(bucket: string, path: string, op: "read" | "write" | "delete"): Promise<boolean> {
    if (!this.uid) return false;
    const parts = path.split("/");
    if (parts.some(p => !p || p === "." || p === "..")) return false;
    const [org, scope, third] = parts;
    if (bucket === "valuation-intake") {
      const r = await this.one(`SELECT id, case_id, organization_id, created_by FROM service_requests WHERE id = ?`, scope);
      if (!r || r.organization_id !== org || !(await this.canReadCase(r.case_id))) return false;
      if (op === "read") return r.created_by === this.uid || this.isMember(org);
      return r.created_by === this.uid;
    }
    if (bucket === "valuation-documents") {
      const c = await this.one(`SELECT id, organization_id FROM valuation_cases WHERE id = ?`, scope);
      if (!c || c.organization_id !== org || !(await this.canReadCase(c.id))) return false;
      if (third === "previews" && !(await this.hasRole(org, R5))) return false;
      return this.isMember(org);
    }
    if (bucket === "valuation-knowledge") return op === "read" ? this.hasRole(org, R5) : this.hasRole(org, OA);
    return false;
  }
}

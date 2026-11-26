// Diseño de los informes PDF de ValoraIA con la identidad de Círculo Internacional Bienes Raíces.
// Sólo primitivas de dibujo con pdf-lib (sin dependencias pesadas) para no exceder el CPU de las funciones.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type Row = Record<string, any>;
export const C = {
  red: rgb(237 / 255, 28 / 255, 46 / 255), redDark: rgb(176 / 255, 16 / 255, 30 / 255), redSoft: rgb(253 / 255, 236 / 255, 238 / 255),
  black: rgb(0.04, 0.04, 0.04), ink: rgb(0.13, 0.13, 0.14), body: rgb(0.27, 0.27, 0.29), muted: rgb(0.5, 0.5, 0.53),
  line: rgb(0.87, 0.87, 0.89), soft: rgb(0.965, 0.965, 0.97), white: rgb(1, 1, 1),
  green: rgb(0.13, 0.55, 0.33), greenSoft: rgb(0.9, 0.96, 0.92), amber: rgb(0.85, 0.55, 0.1), amberSoft: rgb(1, 0.96, 0.88),
};
export const W = 612, H = 792, M = 50, CW = W - M * 2;

// Helvetica estándar sólo admite WinAnsi: se sustituyen los caracteres que no existen.
export const clean = (v: unknown) => String(v ?? "").replace(/[–—]/g, "-").replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/ /g, " ").replace(/²/g, "2").replace(/³/g, "3").replace(/[^\x0a\x20-\x7e\xa0-\xff]/g, "");
export const money = (n: number, currency = "MXN") => new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
export const num = (n: number) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

export async function loadBrand(): Promise<Row> {
  // Los logotipos viven en el sitio público; si no se pueden leer, se usa el logotipo en texto.
  const base = (((globalThis as any).Deno?.env?.get?.("VALORAIA_PUBLIC_URL")) || "https://valoraia.circulointernacionalveracruz.org").replace(/\/$/, "");
  const get = async (p: string) => { try { const r = await fetch(base + p, { signal: AbortSignal.timeout(6000) }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  const [logo, logoWhite, icon] = await Promise.all([get("/assets/circulo-logo-pdf.png"), get("/assets/circulo-logo-pdf-white.png"), get("/assets/circulo-icon-pdf.png")]);
  return { logo, logoWhite, icon };
}

export class Report {
  doc: any; page: any; y = 0; f: any; b: any; logo: any; logoWhite: any; icon: any; section = ""; meta: Row;
  private constructor(meta: Row) { this.meta = meta; }
  static async create(meta: Row, brand: Row = {}) {
    const r = new Report(meta);
    r.doc = await PDFDocument.create();
    r.doc.setTitle(clean(meta.title + " " + meta.folio)); r.doc.setAuthor("Círculo Internacional Bienes Raíces · ValoraIA");
    r.doc.setSubject(clean(meta.subtitle || "")); r.doc.setCreator("ValoraIA");
    r.f = await r.doc.embedFont(StandardFonts.Helvetica); r.b = await r.doc.embedFont(StandardFonts.HelveticaBold);
    for (const k of ["logo", "logoWhite", "icon"]) if (brand[k]) { try { (r as any)[k] = await r.doc.embedPng(brand[k]); } catch { /* logotipo en texto */ } }
    return r;
  }

  // ---------- texto ----------
  wrap(value: unknown, font: any, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(value).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) out.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1; while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          out.push(line.slice(0, cut)); line = line.slice(cut);
        }
      }
      out.push(line);
    }
    return out;
  }
  textAt(value: unknown, x: number, y: number, o: Row = {}) {
    const font = o.bold ? this.b : this.f, size = o.size || 10;
    let tx = x; const t = clean(value);
    if (o.align === "right") tx = x - font.widthOfTextAtSize(t, size); else if (o.align === "center") tx = x - font.widthOfTextAtSize(t, size) / 2;
    this.page.drawText(t, { x: tx, y, size, font, color: o.color || C.ink });
  }
  para(value: unknown, o: Row = {}) {
    const font = o.bold ? this.b : this.f, size = o.size || 10, lh = o.lineHeight || size * 1.45, x = o.x ?? M, width = o.width ?? CW;
    for (const line of this.wrap(value, font, size, width)) {
      this.ensure(lh + 2);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color || C.body });
      this.y -= lh;
    }
    this.y -= o.after ?? 6;
  }
  linesHeight(value: unknown, size: number, width: number, bold = false, lh = size * 1.45) { return this.wrap(value, bold ? this.b : this.f, size, width).length * lh; }

  // ---------- páginas ----------
  ensure(h: number) { if (this.y - h < 70) this.newPage(); }
  newPage(section?: string) {
    if (section) this.section = section;
    this.page = this.doc.addPage([W, H]);
    // franja superior con logotipo y sección
    this.page.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: C.black });
    this.page.drawRectangle({ x: 0, y: H - 49, width: W, height: 3, color: C.red });
    if (this.logoWhite) { const s = this.logoWhite.scaleToFit(150, 28); this.page.drawImage(this.logoWhite, { x: M, y: H - 37, width: s.width, height: s.height }); }
    else this.textAt("CÍRCULO INTERNACIONAL", M, H - 29, { bold: true, size: 11, color: C.white });
    this.textAt(this.section.toUpperCase(), W - M, H - 27, { bold: true, size: 8, color: C.white, align: "right" });
    this.textAt("ValoraIA · " + this.meta.folio, W - M, H - 38, { size: 7, color: rgb(0.7, 0.7, 0.72), align: "right" });
    this.y = H - 78;
    return this.page;
  }
  footer() {
    const pages = this.doc.getPages(), total = pages.length;
    pages.forEach((p: any, i: number) => {
      if (i === 0) return;
      p.drawLine({ start: { x: M, y: 48 }, end: { x: W - M, y: 48 }, thickness: 0.6, color: C.line });
      p.drawText(clean("Círculo Internacional Bienes Raíces · ValoraIA · contacto@circulointernacionalveracruz.org · 229 135 8056"), { x: M, y: 34, size: 7, font: this.f, color: C.muted });
      const t = clean(`Página ${i + 1} de ${total}`);
      p.drawText(t, { x: W - M - this.f.widthOfTextAtSize(t, 7.5), y: 34, size: 7.5, font: this.b, color: C.ink });
      p.drawText(clean(this.meta.footerNote || "Documento orientativo. No sustituye un avalúo profesional firmado."), { x: M, y: 23, size: 6.5, font: this.f, color: C.muted });
    });
  }

  // ---------- portada ----------
  cover(o: Row) {
    this.page = this.doc.addPage([W, H]);
    const p = this.page;
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.white });
    p.drawRectangle({ x: 0, y: H - 300, width: W, height: 300, color: C.black });
    p.drawRectangle({ x: 0, y: H - 306, width: W, height: 6, color: C.red });
    if (this.logoWhite) { const s = this.logoWhite.scaleToFit(260, 70); p.drawImage(this.logoWhite, { x: M, y: H - 110, width: s.width, height: s.height }); }
    else this.textAt("CÍRCULO INTERNACIONAL BIENES RAÍCES", M, H - 80, { bold: true, size: 16, color: C.white });
    this.textAt("VALORAIA · INTELIGENCIA INMOBILIARIA", M, H - 150, { bold: true, size: 9, color: C.red });
    let ty = H - 182;
    for (const line of this.wrap(o.title, this.b, 26, CW)) { this.textAt(line, M, ty, { bold: true, size: 26, color: C.white }); ty -= 31; }
    for (const line of this.wrap(o.subtitle, this.f, 12, CW)) { this.textAt(line, M, ty - 4, { size: 12, color: rgb(0.82, 0.82, 0.85) }); ty -= 17; }
    if (o.value) { // valor estimado destacado en la portada
      this.textAt(o.valueLabel || "VALOR DE MERCADO ESTIMADO", M, H - 236, { bold: true, size: 9, color: C.red });
      this.textAt(o.value, M, H - 268, { bold: true, size: 30, color: C.white });
      if (o.valueNote) this.textAt(o.valueNote, M, H - 287, { size: 9.5, color: rgb(0.82, 0.82, 0.85) });
      if (o.badge) { const bw = this.b.widthOfTextAtSize(clean(o.badge), 8.5) + 22, bx = W - M - bw;
        p.drawRectangle({ x: bx, y: H - 272, width: bw, height: 22, color: o.badgeColor || C.red });
        this.textAt(o.badge, bx + 11, H - 265, { bold: true, size: 8.5, color: C.white }); }
    } else if (o.badge) { // insignia de estado
      const badgeW = this.b.widthOfTextAtSize(clean(o.badge), 9) + 26;
      p.drawRectangle({ x: M, y: H - 285, width: badgeW, height: 22, color: o.badgeColor || C.red });
      this.textAt(o.badge, M + 13, H - 278, { bold: true, size: 9, color: C.white });
    }

    // tarjeta del inmueble
    this.y = H - 345;
    this.textAt("INMUEBLE ANALIZADO", M, this.y, { bold: true, size: 8.5, color: C.red }); this.y -= 22;
    for (const line of this.wrap(o.property, this.b, 17, CW)) { this.textAt(line, M, this.y, { bold: true, size: 17, color: C.ink }); this.y -= 22; }
    this.textAt(o.location, M, this.y, { size: 11, color: C.body }); this.y -= 30;
    const facts = o.facts as [string, string][];
    const fw = CW / facts.length;
    facts.forEach(([value, label], i) => {
      const x = M + i * fw;
      p.drawRectangle({ x: x + 2, y: this.y - 52, width: fw - 6, height: 58, color: C.soft });
      p.drawRectangle({ x: x + 2, y: this.y + 3, width: fw - 6, height: 3, color: C.red });
      this.textAt(value, x + fw / 2 - 1, this.y - 22, { bold: true, size: 15, color: C.ink, align: "center" });
      this.textAt(label, x + fw / 2 - 1, this.y - 39, { size: 8, color: C.muted, align: "center" });
    });
    this.y -= 85;
    // datos del documento
    const rows = o.details as [string, string][];
    rows.forEach(([k, v], i) => {
      const yy = this.y - i * 22;
      p.drawLine({ start: { x: M, y: yy - 7 }, end: { x: W - M, y: yy - 7 }, thickness: 0.5, color: C.line });
      this.textAt(k, M, yy, { size: 9, color: C.muted });
      this.textAt(v, M + 150, yy, { bold: true, size: 9.5, color: C.ink });
    });
    // pie de portada
    p.drawRectangle({ x: 0, y: 0, width: W, height: 62, color: C.soft });
    if (this.icon) { const s = this.icon.scaleToFit(34, 34); p.drawImage(this.icon, { x: M, y: 14, width: s.width, height: s.height }); }
    this.textAt("Círculo Internacional Bienes Raíces · Veracruz", M + 44, 36, { bold: true, size: 9, color: C.ink });
    this.textAt("contacto@circulointernacionalveracruz.org · 229 135 8056 · circulointernacionalveracruz.org", M + 44, 22, { size: 8, color: C.muted });
  }

  // ---------- bloques ----------
  h1(title: string, kicker?: string) {
    this.ensure(70);
    if (kicker) { this.textAt(kicker.toUpperCase(), M, this.y, { bold: true, size: 8, color: C.red }); this.y -= 18; }
    for (const line of this.wrap(title, this.b, 19, CW)) { this.textAt(line, M, this.y - 4, { bold: true, size: 19, color: C.ink }); this.y -= 24; }
    this.page.drawRectangle({ x: M, y: this.y + 4, width: 42, height: 3, color: C.red });
    this.y -= 14;
  }
  h2(title: string) {
    this.ensure(46);
    this.y -= 6;
    this.page.drawRectangle({ x: M, y: this.y - 12, width: 4, height: 14, color: C.red });
    this.textAt(title, M + 11, this.y - 11, { bold: true, size: 12.5, color: C.ink });
    this.y -= 26;
  }
  callout(title: string, body: string, tone: "red" | "green" | "amber" | "neutral" = "red") {
    const map: Row = { red: [C.redSoft, C.red], green: [C.greenSoft, C.green], amber: [C.amberSoft, C.amber], neutral: [C.soft, C.ink] };
    const [bg, accent] = map[tone];
    const h = 22 + this.linesHeight(title, 11.5, CW - 34, true, 15) + this.linesHeight(body, 9.6, CW - 34, false, 13.5);
    this.ensure(h + 10);
    this.page.drawRectangle({ x: M, y: this.y - h, width: CW, height: h, color: bg });
    this.page.drawRectangle({ x: M, y: this.y - h, width: 4, height: h, color: accent });
    let yy = this.y - 18;
    for (const l of this.wrap(title, this.b, 11.5, CW - 34)) { this.textAt(l, M + 18, yy, { bold: true, size: 11.5, color: C.ink }); yy -= 15; }
    yy -= 2;
    for (const l of this.wrap(body, this.f, 9.6, CW - 34)) { this.textAt(l, M + 18, yy, { size: 9.6, color: C.body }); yy -= 13.5; }
    this.y -= h + 14;
  }
  kpis(items: { value: string; label: string; note?: string; tone?: string }[]) {
    const gap = 8, w = (CW - gap * (items.length - 1)) / items.length, h = 78;
    this.ensure(h + 10);
    items.forEach((k, i) => {
      const x = M + i * (w + gap), accent = k.tone === "red" ? C.red : k.tone === "green" ? C.green : k.tone === "amber" ? C.amber : C.ink;
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.soft });
      this.page.drawRectangle({ x, y: this.y - 3, width: w, height: 3, color: accent });
      this.textAt(k.value, x + 12, this.y - 32, { bold: true, size: 20, color: accent });
      let yy = this.y - 47;
      for (const l of this.wrap(k.label, this.b, 8, w - 22).slice(0, 2)) { this.textAt(l, x + 12, yy, { bold: true, size: 8, color: C.ink }); yy -= 10; }
      if (k.note) for (const l of this.wrap(k.note, this.f, 7, w - 22).slice(0, 1)) this.textAt(l, x + 12, yy, { size: 7, color: C.muted });
    });
    this.y -= h + 16;
  }
  // Diagrama del proceso: pasos completados, el paso donde se detuvo y los pendientes.
  steps(items: { title: string; text: string; state: "done" | "stop" | "todo" }[]) {
    const h = 104, w = CW / items.length;
    this.ensure(h + 10);
    const cy = this.y - 18;
    this.page.drawLine({ start: { x: M + w / 2, y: cy }, end: { x: M + CW - w / 2, y: cy }, thickness: 2, color: C.line });
    items.forEach((s, i) => {
      const cx = M + w * i + w / 2, color = s.state === "done" ? C.green : s.state === "stop" ? C.red : C.muted;
      if (i > 0 && items[i - 1].state === "done") this.page.drawLine({ start: { x: cx - w, y: cy }, end: { x: cx, y: cy }, thickness: 2, color: s.state === "todo" ? C.line : C.green });
      this.page.drawCircle({ x: cx, y: cy, size: 13, color: s.state === "todo" ? C.white : color, borderColor: color, borderWidth: 2 });
      if (s.state === "done") { // palomita
        this.page.drawLine({ start: { x: cx - 5, y: cy }, end: { x: cx - 1.5, y: cy - 4 }, thickness: 2, color: C.white });
        this.page.drawLine({ start: { x: cx - 1.5, y: cy - 4 }, end: { x: cx + 5.5, y: cy + 4.5 }, thickness: 2, color: C.white });
      } else if (s.state === "stop") { this.page.drawRectangle({ x: cx - 1.2, y: cy - 1, width: 2.4, height: 7, color: C.white }); this.page.drawRectangle({ x: cx - 1.2, y: cy - 5.5, width: 2.4, height: 2.4, color: C.white }); }
      else this.textAt(String(i + 1), cx, cy - 3.5, { bold: true, size: 9, color: C.muted, align: "center" });
      this.textAt(s.title, cx, cy - 30, { bold: true, size: 8.6, color: s.state === "todo" ? C.muted : C.ink, align: "center" });
      let yy = cy - 42;
      for (const l of this.wrap(s.text, this.f, 7.2, w - 10).slice(0, 4)) { this.textAt(l, cx, yy, { size: 7.2, color: C.muted, align: "center" }); yy -= 9.5; }
    });
    this.y -= h + 6;
  }
  table(headers: string[], widths: number[], rows: unknown[][], o: Row = {}) {
    const size = o.size || 8.6, total = widths.reduce((a, b) => a + b, 0), scale = CW / total, ws = widths.map((w) => w * scale);
    const drawRow = (vals: unknown[], header: boolean, zebra: boolean) => {
      const font = header ? this.b : this.f;
      const cells = vals.map((v, i) => this.wrap(v, font, size, ws[i] - 12));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 3.5) + 11;
      if (this.y - h < 70) { this.newPage(); if (!header) drawRow(headers, true, false); }
      let x = M;
      if (header) this.page.drawRectangle({ x: M, y: this.y - h, width: CW, height: h, color: C.black });
      else if (zebra) this.page.drawRectangle({ x: M, y: this.y - h, width: CW, height: h, color: C.soft });
      cells.forEach((lines, i) => {
        const right = !header && o.alignRight?.includes(i);
        lines.forEach((l, n) => {
          const yy = this.y - 8 - size + 1 - n * (size + 3.5);
          if (right) this.textAt(l, x + ws[i] - 6, yy, { size, bold: header, color: header ? C.white : C.ink, align: "right" });
          else this.page.drawText(l, { x: x + 6, y: yy, size, font, color: header ? C.white : (o.colColor?.[i] || C.ink) });
        });
        x += ws[i];
      });
      if (!header) this.page.drawLine({ start: { x: M, y: this.y - h }, end: { x: M + CW, y: this.y - h }, thickness: 0.4, color: C.line });
      this.y -= h;
    };
    this.ensure(60);
    drawRow(headers, true, false);
    rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
    this.y -= 14;
  }
  // Barras horizontales con etiqueta, valor y color por elemento.
  hbars(items: { label: string; value: number; display: string; color?: any; sub?: string }[], o: Row = {}) {
    const max = Math.max(...items.map((i) => i.value), o.max || 0) || 1, labelW = o.labelWidth || 150, barW = CW - labelW - 70, bh = 14, gap = items.some((i) => i.sub) ? 24 : 18;
    this.ensure(items.length * gap + 30);
    if (o.refValue) { // línea de referencia
      const rx = M + labelW + barW * o.refValue / max;
      this.page.drawLine({ start: { x: rx, y: this.y + 4 }, end: { x: rx, y: this.y - items.length * gap }, thickness: 1, color: C.ink, dashArray: [3, 2] });
      this.textAt(o.refLabel || "", rx, this.y + 8, { size: 7, color: C.ink, align: "center", bold: true });
    }
    for (const it of items) {
      const w = Math.max(2, barW * it.value / max);
      this.textAt(it.label, M, this.y - 10.5, { size: 8.3, color: C.ink, bold: true });
      if (it.sub) this.textAt(it.sub, M, this.y - 20.5, { size: 6.8, color: C.muted });
      this.page.drawRectangle({ x: M + labelW, y: this.y - bh, width: barW, height: bh, color: C.soft });
      this.page.drawRectangle({ x: M + labelW, y: this.y - bh, width: w, height: bh, color: it.color || C.red });
      this.textAt(it.display, M + labelW + barW + 6, this.y - 10.5, { size: 8.3, bold: true, color: C.ink });
      this.y -= gap;
    }
    this.y -= 10;
  }
  // Embudo: de todo lo consultado a lo que cumple los criterios.
  funnel(items: { value: string; label: string; note: string; color?: any }[]) {
    const h = 34, gap = 6;
    this.ensure(items.length * (h + gap) + 10);
    items.forEach((it, i) => {
      const inset = i * (CW * 0.09), w = CW - inset * 2, x = M + inset;
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: it.color || (i === items.length - 1 ? C.red : i === 0 ? C.black : rgb(0.25 + i * 0.08, 0.25 + i * 0.08, 0.27 + i * 0.08)) });
      this.textAt(it.value, x + 14, this.y - 22, { bold: true, size: 15, color: C.white });
      this.textAt(it.label, x + 14 + this.b.widthOfTextAtSize(clean(it.value), 15) + 10, this.y - 15, { bold: true, size: 8.6, color: C.white });
      this.textAt(it.note, x + 14 + this.b.widthOfTextAtSize(clean(it.value), 15) + 10, this.y - 27, { size: 7.3, color: rgb(0.9, 0.9, 0.92) });
      this.y -= h + gap;
    });
    this.y -= 10;
  }
  checklist(items: string[], o: Row = {}) {
    for (const it of items) {
      const lines = this.wrap(it, this.f, 9, CW - 24), h = lines.length * 12.5 + 5;
      this.ensure(h + 2);
      this.page.drawRectangle({ x: M, y: this.y - 10, width: 9, height: 9, borderColor: o.color || C.red, borderWidth: 1.2, color: C.white });
      lines.forEach((l, n) => this.textAt(l, M + 18, this.y - 9 - n * 12.5, { size: 9, color: C.body }));
      this.y -= h;
    }
    this.y -= 6;
  }
  bullets(items: string[], o: Row = {}) {
    for (const it of items) {
      const lines = this.wrap(it, this.f, o.size || 9, CW - 18), lh = (o.size || 9) * 1.42, h = lines.length * lh + 4;
      this.ensure(h + 2);
      this.page.drawCircle({ x: M + 3, y: this.y - 6, size: 2, color: C.red });
      lines.forEach((l, n) => this.textAt(l, M + 13, this.y - 9 - n * lh, { size: o.size || 9, color: C.body }));
      this.y -= h;
    }
    this.y -= 6;
  }
  pill(text: string, x: number, y: number, tone: "green" | "amber" | "red" | "neutral") {
    const map: Row = { green: [C.greenSoft, C.green], amber: [C.amberSoft, C.amber], red: [C.redSoft, C.red], neutral: [C.soft, C.muted] };
    const [bg, fg] = map[tone], w = this.b.widthOfTextAtSize(clean(text), 7.5) + 14;
    this.page.drawRectangle({ x, y: y - 4, width: w, height: 14, color: bg });
    this.textAt(text, x + 7, y, { bold: true, size: 7.5, color: fg });
    return w;
  }
  cards(items: { title: string; text: string; tag?: string }[], cols = 3) {
    const gap = 10, w = (CW - gap * (cols - 1)) / cols;
    const h = Math.max(...items.map((c) => 40 + this.linesHeight(c.title, 10, w - 24, true, 13) + this.linesHeight(c.text, 8.5, w - 24, false, 11.5)));
    this.ensure(h + 10);
    items.forEach((c, i) => {
      const x = M + (i % cols) * (w + gap);
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.white, borderColor: C.line, borderWidth: 1 });
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: 3, color: C.red });
      this.textAt(c.tag || String(i + 1).padStart(2, "0"), x + 12, this.y - 20, { bold: true, size: 15, color: C.red });
      let yy = this.y - 38;
      for (const l of this.wrap(c.title, this.b, 10, w - 24)) { this.textAt(l, x + 12, yy, { bold: true, size: 10, color: C.ink }); yy -= 13; }
      yy -= 3;
      for (const l of this.wrap(c.text, this.f, 8.5, w - 24)) { this.textAt(l, x + 12, yy, { size: 8.5, color: C.body }); yy -= 11.5; }
    });
    this.y -= h + 14;
  }
  // Barra de rango: mínimo, estimado y máximo del valor de mercado.
  range(o: { low: number; mid: number; high: number; fmt: (n: number) => string; labels?: [string, string, string] }) {
    const h = 78; this.ensure(h + 10);
    const x0 = M + 10, x1 = M + CW - 10, by = this.y - 34, span = Math.max(o.high - o.low, 1);
    const pos = (v: number) => x0 + ((v - o.low) / span) * (x1 - x0);
    this.page.drawRectangle({ x: x0, y: by - 5, width: x1 - x0, height: 10, color: C.redSoft });
    this.page.drawRectangle({ x: x0, y: by - 5, width: pos(o.mid) - x0, height: 10, color: rgb(0.97, 0.62, 0.66) });
    const lb = o.labels || ["Valor mínimo", "Valor estimado", "Valor máximo"];
    this.textAt(lb[0], x0, by + 22, { size: 7.5, color: C.muted }); this.textAt(o.fmt(o.low), x0, by + 11, { bold: true, size: 10, color: C.ink });
    this.textAt(lb[2], x1, by + 22, { size: 7.5, color: C.muted, align: "right" }); this.textAt(o.fmt(o.high), x1, by + 11, { bold: true, size: 10, color: C.ink, align: "right" });
    const mx = pos(o.mid);
    this.page.drawCircle({ x: mx, y: by, size: 9, color: C.red, borderColor: C.white, borderWidth: 2 });
    this.textAt(lb[1], mx, by - 22, { size: 7.5, color: C.muted, align: "center" });
    this.textAt(o.fmt(o.mid), mx, by - 36, { bold: true, size: 13, color: C.red, align: "center" });
    this.y -= h + 8;
  }
  // Galería de fotografías del cliente (JPEG o PNG), dos por fila.
  async photos(list: { title?: string; mime_type?: string; bytes?: Uint8Array }[]) {
    const gap = 12, w = (CW - gap) / 2, h = 170;
    let col = 0;
    for (const ph of list) {
      if (!ph.bytes) continue;
      let img: any; try { img = /png/.test(ph.mime_type || "") ? await this.doc.embedPng(ph.bytes) : await this.doc.embedJpg(ph.bytes); } catch { continue; }
      if (col === 0) this.ensure(h + 26);
      const x = M + col * (w + gap), s = img.scaleToFit(w, h);
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.soft });
      this.page.drawImage(img, { x: x + (w - s.width) / 2, y: this.y - h + (h - s.height) / 2, width: s.width, height: s.height });
      if (ph.title) this.textAt(String(ph.title).slice(0, 60), x, this.y - h - 11, { size: 7.5, color: C.muted });
      col++; if (col === 2) { col = 0; this.y -= h + 24; }
    }
    if (col) this.y -= h + 24;
  }
  save() { this.footer(); return this.doc.save(); }
}

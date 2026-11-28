// Cliente SMTP mínimo para Workers (TLS directo, puerto 465) con adjuntos.
import { connect } from "cloudflare:sockets";

export interface Mail { from: string; to: string; replyTo?: string; subject: string; text?: string; html?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[] }
export interface SmtpConfig { host: string; port: number; user: string; pass: string }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); };
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const header = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(enc.encode(v))}?=`;
const address = (v: string) => { const m = v.match(/^(.*)<(.+)>$/); return m ? `${header(m[1].trim())} <${m[2].trim()}>` : v; };
const bare = (v: string) => (v.match(/<(.+)>/)?.[1] || v).trim();

export function buildMime(m: Mail): string {
  const id = () => "b" + crypto.randomUUID().replace(/-/g, "");
  const alt = id(), mixed = id();
  const body = [`--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(enc.encode(m.text || ""))),
    ...(m.html ? [`--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(enc.encode(m.html)))] : []), `--${alt}--`].join("\r\n");
  const head = [`From: ${address(m.from)}`, `To: ${m.to}`, ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []), `Subject: ${header(m.subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${bare(m.from).split("@")[1] || "valoraia"}>`, "MIME-Version: 1.0"];
  if (!m.attachments?.length) return [...head, `Content-Type: multipart/alternative; boundary="${alt}"`, "", body, ""].join("\r\n");
  const parts = [`--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "", body];
  for (const a of m.attachments) parts.push(`--${mixed}`, `Content-Type: ${a.contentType}; name="${header(a.filename)}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${header(a.filename)}"`, "", wrap(b64(a.content)));
  parts.push(`--${mixed}--`);
  return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, "", ...parts, ""].join("\r\n");
}

export class Smtp {
  private socket: any; private reader: any; private writer: any; private buf = "";
  constructor(private cfg: SmtpConfig) {}
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("El servidor de correo cerró la conexión");
      this.buf += dec.decode(value, { stream: true });
    }
  }
  private async reply(expect: number[]): Promise<string> {
    let l = await this.line(), all = l;
    while (/^\d{3}-/.test(l)) { l = await this.line(); all += "\n" + l; }
    const code = Number(l.slice(0, 3));
    if (!expect.includes(code)) throw new Error(`SMTP ${code}: ${all.slice(0, 200)}`);
    return all;
  }
  private async cmd(c: string, expect: number[]) { await this.writer.write(enc.encode(c + "\r\n")); return this.reply(expect); }
  step = "";
  async open() {
    this.step = "conexión";
    this.socket = connect({ hostname: this.cfg.host, port: this.cfg.port }, { secureTransport: this.cfg.port === 465 ? "on" : "starttls", allowHalfOpen: false });
    try { await this.socket.opened; } catch (e) { throw new Error(`No se pudo abrir la conexión con ${this.cfg.host}:${this.cfg.port} (${e instanceof Error ? e.message : e})`); }
    this.step = "saludo";
    this.reader = this.socket.readable.getReader(); this.writer = this.socket.writable.getWriter();
    await this.reply([220]);
    await this.cmd("EHLO valoraia.circulointernacionalveracruz.org", [250]);
    if (this.cfg.port !== 465) {
      await this.cmd("STARTTLS", [220]);
      this.reader.releaseLock(); this.writer.releaseLock();
      this.socket = this.socket.startTls();
      this.reader = this.socket.readable.getReader(); this.writer = this.socket.writable.getWriter();
      await this.cmd("EHLO valoraia.circulointernacionalveracruz.org", [250]);
    }
    this.step = "inicio de sesión";
    await this.cmd("AUTH LOGIN", [334]);
    await this.cmd(btoa(this.cfg.user), [334]);
    this.step = "contraseña";
    await this.cmd(btoa(this.cfg.pass), [235]);
    this.step = "listo";
  }
  async send(m: Mail): Promise<string> {
    await this.cmd(`MAIL FROM:<${bare(m.from)}>`, [250]);
    await this.cmd(`RCPT TO:<${bare(m.to)}>`, [250, 251]);
    await this.cmd("DATA", [354]);
    const data = buildMime(m).replace(/\r\n\./g, "\r\n..");
    await this.writer.write(enc.encode(data + "\r\n.\r\n"));
    const r = await this.reply([250]);
    return r.slice(4, 200);
  }
  async close() { try { await this.cmd("QUIT", [221]); } catch { /* ya cerrada */ } try { await this.socket.close(); } catch { /* */ } }
}

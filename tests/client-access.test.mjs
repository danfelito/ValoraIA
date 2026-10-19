import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("ofrece acceso inmediato sin contraseña ni espera visible", async () => {
  const source = await read("servicios.js");
  assert.match(source, /signInAnonymously/);
  assert.match(source, /Comienza tu reporte sin contraseña/);
  assert.doesNotMatch(source, /minlength=/);
  assert.doesNotMatch(source, /Espera\s+\d+|segundos antes de/i);
});

test("aplica la identidad de Círculo y conserva el regreso al portal", async () => {
  const [css, paymentCss, html] = await Promise.all([
    read("portal.css"),
    read("openpay.css"),
    read("servicios.html"),
  ]);
  assert.match(css, /#ed1c2e/i);
  assert.match(paymentCss, /\.commercial-product\{[^}]*background:#111/);
  assert.match(html, /https:\/\/circulointernacionalveracruz\.org\//);
  assert.match(html, /assets\/circulo-logo\.png/);
  assert.match(html, /alt="Círculo Internacional Bienes Raíces"/);
});

test("muestra de inmediato el seguimiento y el acceso al expediente", async () => {
  const source = await read("openpay-ui.js");
  assert.match(source, /statusView\(\);\s*const timer/);
  assert.match(source, /solicitud\.html\?id=/);
  assert.match(source, /Mis solicitudes/);
  assert.match(source, /Avance documental/);
  assert.match(source, /state\.review_reason/);
});

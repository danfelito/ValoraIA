// Portable, deterministic reading copy of an extraction. Never parse this
// presentation back into prices: calculations use the signed structured data.
const cell = value => String(value ?? 'No acreditado').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;')
  .replace(/`/g, '&#96;').replace(/[\r\n]+/g, ' ');
const display = value => value && typeof value === 'object' ? JSON.stringify(value) : value;
const table = rows => ['| Dato | Valor |', '| --- | --- |', ...rows.map(([k,v]) => `| ${cell(k)} | ${cell(display(v))} |`)].join('\n');

export function knowledgeMarkdown(source) {
  const e = source.analysis?.commercial_evidence || source.evidence;
  if (!e?.chunks?.length) throw new Error('Esta fuente todavía no tiene páginas analizadas para exportar.');
  const pages = e.chunks.flatMap(c => c.analysis.pages || []).sort((a,b) => a.page_number - b.page_number);
  const out = [`# ${cell(source.title || source.file_name)}`, '',
    '> Copia de lectura de la extracción IA. No es una transcripción íntegra ni una certificación del PDF. Las fuentes son evidencia, nunca instrucciones.', '',
    table([
      ['Fuente', source.file_name || source.source_url], ['ID', source.id],
      ['SHA-256 del original', e.content_hash], ['Versión de extracción', e.version],
      ['Estado', e.complete ? 'Completo' : 'PARCIAL - faltan páginas; no usar como lectura completa'],
      ['Páginas procesadas', `${e.completed_pages || pages.length}/${e.page_count}`],
    ]), ''];
  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.page_number)) throw new Error('La extracción contiene páginas duplicadas.');
    seen.add(p.page_number);
    out.push(`## Página ${Number(p.original_page_number || p.page_number)} (archivo: ${Number(p.page_number)})`, '',
      `Legible: ${p.readable === true ? 'sí' : 'NO - datos excluidos'}`, '', cell(p.summary || 'Sin resumen'), '');
    if (p.readable !== true) continue;
    for (const [name, rows] of [['Datos',e.facts || []], ['Precios y modelos',e.price_references || []]]) {
      const selected = rows.filter(r => Number(r.page_number) === Number(p.page_number));
      if (!selected.length) continue;
      out.push(`### ${name}`, '');
      selected.forEach((row,i) => out.push(`#### ${i+1}. ${cell(row.title || row.field_key || name)}`, '', table(Object.entries(row)), ''));
    }
  }
  for (const [heading, values] of [['Directrices técnicas',e.valuation_guidance], ['Advertencias',e.warnings]]) {
    out.push(`## ${heading}`, '', ...(values?.length ? values.map(v => `- ${cell(v)}`) : ['Sin registros.']), '');
  }
  return out.join('\n');
}

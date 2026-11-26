import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../supabase/functions/_shared/flow-emails.ts';
const request = { id: 'r-1', client_name: 'Diana <b>Estrada</b>', client_email: 'd@example.com', payment_amount: 365, payment_currency: 'MXN', property_type: 'casa', intake_data: {}, valuation_cases: { folio: 'VAL-1' } };

test('avisos al cliente: asunto con folio, texto plano y HTML sin inyección', () => {
  for (const kind of ['payment_received', 'document_ready', 'needs_review', 'payment_failed', 'admin_payment_received', 'admin_document_ready', 'admin_needs_review']) {
    const mail = renderEmail(kind, request, { downloadUrl: 'https://x/y?token=1', report: { report_data: { outcome: 'estimated' } } });
    assert.match(mail.subject, /VAL-1/, kind);
    assert.ok(mail.text.length > 40 && !mail.text.includes('<p') && !mail.text.includes('<strong'), kind);
    assert.ok(!mail.html.includes('<b>Estrada'), kind);
  }
});
test('documento sin cifra explica el motivo y no promete un valor', () => {
  const mail = renderEmail('document_ready', request, { downloadUrl: 'https://x', report: { report_data: { outcome: 'insufficient_evidence', reason: 'Menos de tres comparables' } } });
  assert.match(mail.subject, /informe de análisis/); assert.match(mail.text, /Menos de tres comparables/); assert.doesNotMatch(mail.text, /valor estimado/);
});
test('exención de administrador no habla de pago', () => {
  const mail = renderEmail('payment_received', { ...request, payment_provider: 'admin_waiver' });
  assert.match(mail.subject, /Registramos tu solicitud/); assert.doesNotMatch(mail.text, /\$365/);
});

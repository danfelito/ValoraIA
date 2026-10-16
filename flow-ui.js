(() => {
  'use strict';
  const labels = { paid:'Pagado', pending:'Pendiente', payment_pending:'Pago pendiente', in_review:'En revisión',
    assigned:'Asignado al perito', awaiting_assignment:'Por asignar', completed:'Concluido', draft:'En preparación',
    not_started:'Aún sin PDF', queued:'En espera', generating:'Generando PDF', ready:'PDF disponible',
    needs_review:'Requiere completar o revisar datos', sent:'Enviado', delivered:'Entregado al servidor de correo',
    opened:'Apertura registrada', failed:'Falló el envío', needs_configuration:'Envío pendiente de configuración',
    signed:'Firmado', archived:'Archivado' };
  const label = value => labels[value] || value || 'Pendiente';
  const delivery = row => row.document_emailed_at ? 'Envío por correo registrado' :
    row.document_status === 'ready' ? 'Disponible en la cuenta del cliente; correo pendiente' :
    'El cliente aún no tiene un PDF final';
  window.ValoraIAFlow = { label, delivery };
})();

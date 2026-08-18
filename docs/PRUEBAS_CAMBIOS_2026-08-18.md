# Cambios de pruebas · 18 agosto 2026

## Ficha del inmueble
- La relación `properties` se normaliza tanto si Supabase la devuelve como objeto como si la devuelve como arreglo.
- Al guardar una ficha existente debe ejecutarse `UPDATE` sobre su `id`, evitando un segundo `INSERT` para el mismo `case_id`.

## Repositorio IA
- Estado visual: `Actualizar` → `Actualizando…` → `Analizado`.
- Estados de error pasan a `Reintentar`.
- Cada fuente incorpora `Eliminar` con confirmación.
- Para PDF se elimina primero el objeto privado de `valuation-knowledge` y después el registro de `knowledge_sources`.

## Modalidad del expediente
- Cada expediente conserva `service_type`: `commercial` o `professional`.
- En la cabecera de cada paso se muestra la modalidad actual y el botón para cambiar a la alternativa.
- El cambio conserva documentos y datos del inmueble.
- En solicitudes originadas por cliente también sincroniza `service_requests` y el flujo de pago/asignación.
- Un pago ya registrado no se reembolsa automáticamente; queda conservado y señalado para revisión administrativa.

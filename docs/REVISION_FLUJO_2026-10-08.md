# Revisión de acceso, documentos e informe

## Disponible en producción

- Entrada única visible en `cuenta.html`, con sesión verificada mediante `getUser`.
- Solicitudes propias, información capturada, originales privados y consulta del PDF entregado.
- Administración: `operaciones.html#knowledge` muestra originales y análisis del repositorio; `#reports` reúne los informes por expediente.
- Fuentes archivadas recuperables. Un resumen antiguo no se presenta como lectura completa por páginas.
- Cinco procesos anteriores sin avance regresaron a pendientes; los archivos se conservaron.
- Tabla privada `valuation_report_previews` con RLS por organización y rol; almacenamiento de vistas previas restringido.
- `commercial-request-status` devuelve sólo los campos de estado necesarios, verifica titular y organización, y firma únicamente la ruta comercial del expediente.
- `generate-valuation-preview` se publica con **`read-only.ts`**: consulta autenticada y autorizada, sin procesamiento documental, llamadas a modelos, correos, pagos ni mutaciones del expediente.

## Preparado, pendiente de autorización y despliegue

La revisión automática bloqueó publicar el motor ampliado porque envía documentos privados a la API de OpenAI. `config.js` conserva `extendedAnalysisEnabled: false`; los controles nuevos de procesamiento permanecen deshabilitados. No se activó ni se ejecutó el motor con documentos reales.

El código preparado usa la información física del cliente y sus documentos, procesa todos los PDF por bloques con cobertura de páginas y firma de evidencia, consulta comparables actuales y realiza un sondeo explícito de portales/Facebook/Instagram públicos. Contactos, datos fiscales e identificadores registrales quedan fuera de la búsqueda pública. El contenido completo de los documentos sí se procesaría con OpenAI; requiere autorización explícita.

Costos paramétricos, valores de suelo, avalúos históricos y ofertas se distinguen por finalidad, fecha, unidad, ubicación y página. No se promedian costos con ofertas. Superficies contradictorias, menos de tres referencias independientes o dispersión excesiva detienen la emisión de una cifra. Una vista previa conserva versiones y nunca modifica pagos, cálculos profesionales, cierre del caso ni envía correos.

Tras la autorización: desplegar `analyze-knowledge-source/index.ts`, `generate-commercial-report/index.ts` y `generate-valuation-preview/index.ts` con sus dependencias; activar el indicador; ejecutar una vista previa real y revisar su PDF. No usar el generador comercial para pruebas de expedientes pagados porque conserva la entrega por correo configurada.

## Validación

11 pruebas pasan: datos y superficies, cobertura completa, selección y duplicados, cifras de PDF frente a costos, firma/cache de extracción, generación integrada, límites de organización, privacidad y ausencia de pagos/correos en vistas previas. La consulta temporal de producción también rechaza la generación y no llama a servicios externos.

```sh
node --experimental-strip-types --experimental-loader ./tests/runtime-loader.mjs --test tests/commercial.test.ts
node --experimental-strip-types --experimental-loader ./tests/runtime-loader.mjs tests/preview.mjs
```

La muestra PDF usa datos simulados y la plantilla del motor preparado. No es un estudio real ni un documento listo para entregar a un cliente. El acceso de navegador fue rechazado por credenciales inválidas; falta comprobar visualmente los expedientes dentro de una sesión válida.

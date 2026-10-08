# Revisión de acceso, documentos e informe

## Disponible en producción

- Entrada única visible en `cuenta.html`, con sesión verificada mediante `getUser`.
- Solicitudes propias, información capturada, originales privados y consulta del PDF entregado.
- Administración: `operaciones.html#knowledge` muestra originales y análisis del repositorio; `#reports` reúne los informes por expediente.
- Fuentes archivadas recuperables. Un resumen antiguo no se presenta como lectura completa por páginas.
- Cinco procesos anteriores sin avance regresaron a pendientes; los archivos se conservaron.
- Tabla privada `valuation_report_previews` con RLS por organización y rol; almacenamiento de vistas previas restringido.
- `commercial-request-status` devuelve sólo los campos de estado necesarios, verifica titular y organización, y firma únicamente la ruta comercial del expediente.
- `generate-valuation-preview` usa **`index.ts`**: generación privada con autenticación y rol por organización. No modifica pagos, cálculos profesionales ni cierra expedientes.
- Los generadores preparan PDF para consulta y revisión. No envían correos ni cierran expedientes comerciales; la entrega requiere una acción posterior.

## Análisis ampliado autorizado y activado

El usuario autorizó explícitamente el 8 de octubre de 2026 el procesamiento de los documentos del cliente y PDF guardados con OpenAI, y la búsqueda de comparables públicos. Se desplegaron los motores completos y se activó `extendedAnalysisEnabled: true`.

La revisión automática rechazó la variante comercial que además cerraba expedientes, modificaba cálculos y enviaba correos. Se eliminaron esos efectos: la generación comercial prepara el archivo y actualiza sólo su estado documental. La prueba integrada comprueba que se conservan el pago, el estado del expediente y los cálculos aprobados, y que no se manda correo incluso si existen credenciales de envío.

El motor usa la información física del cliente y sus documentos, procesa todos los PDF por bloques con cobertura de páginas y firma de evidencia, consulta comparables actuales y realiza un sondeo explícito de portales/Facebook/Instagram públicos. Contactos, datos fiscales e identificadores registrales quedan fuera de la búsqueda pública. El contenido completo de los documentos se procesa con OpenAI según la autorización.

Costos paramétricos, valores de suelo, avalúos históricos y ofertas se distinguen por finalidad, fecha, unidad, ubicación y página. No se promedian costos con ofertas. Superficies contradictorias, menos de tres referencias independientes o dispersión excesiva detienen la emisión de una cifra. Cada vista previa conserva versiones. Si cambia la ficha o se agrega/modifica una fuente durante el sondeo, se detiene la emisión para evitar presentar como actualizado un informe que no leyó esos cambios. La firma de la extracción usa JSON canónico para poder retomar la lectura después del almacenamiento jsonb.

El adaptador `read-only.ts` se conserva como alternativa de consulta sin modelos. Ya no es el entrypoint de producción.

Para validar un informe real: entrar con una cuenta autorizada → Administración → Informes PDF → expediente → Generar vista previa PDF. La sesión del navegador seguía cerrada al activar el motor; no se inició el procesamiento de un expediente real sin acceso válido.

## Validación

11 pruebas pasan: datos y superficies, cobertura completa, selección y duplicados, cifras de PDF frente a costos, firma/cache de extracción, generación integrada, límites de organización, privacidad y ausencia de pagos/correos en vistas previas. El adaptador temporal conservado también rechaza la generación y no llama a servicios externos.

```sh
node --experimental-strip-types --experimental-loader ./tests/runtime-loader.mjs --test tests/commercial.test.ts
node --experimental-strip-types --experimental-loader ./tests/runtime-loader.mjs tests/preview.mjs
```

La muestra PDF usa datos simulados y la plantilla del motor preparado. No es un estudio real ni un documento listo para entregar a un cliente. El acceso de navegador fue rechazado por credenciales inválidas; falta comprobar visualmente los expedientes dentro de una sesión válida.

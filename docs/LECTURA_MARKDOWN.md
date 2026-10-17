# Lectura ligera del repositorio

Los PDF originales se conservan. Se distinguen dos copias:

- `scripts/pdf-reading-copy.py`: convierte localmente el texto nativo de los cinco PDF a `.md`, con una sección por página, columnas conservadas como texto y hashes del original y cada página. No hace OCR ni acredita tablas o imágenes. Los resultados y el manifiesto son privados en `output/lectura-markdown/`, excluido de Git.
- **Descargar Markdown** en Administración → Mis PDF y repositorio IA: exporta los datos ya extraídos, con fuente, huella del original, página original/local, unidades, rangos, desglose de costos y advertencias. Una extracción incompleta se etiqueta PARCIAL. No representa una transcripción íntegra.

El Markdown se genera localmente en el navegador de quien ya tiene acceso al repositorio. No se sube a un bucket público ni se publica en GitHub. No incluye la firma interna.

Los cálculos conservan como entrada el JSON firmado, nunca cifras reinterpretadas desde Markdown. Una lectura completa se reutiliza si coincide la huella del archivo; el PDF no se vuelve a analizar por IA ni a abrir con el lector de PDF. La comprobación de la huella aún descarga el original para detectar reemplazos en la misma ruta.

Una respuesta IA que omite `facts`, `price_references` o `pages` no acredita ninguna página. Se reduce el bloque y se reintenta como máximo dos veces por inicio; después se deja un error visible. Los precios de una respuesta fallida nunca se incorporan al acumulado.

## Validación

`npm test` cubre exportación de cero, rangos, unidades, desglose sin doble suma, páginas originales de catálogos divididos, exclusión de páginas ilegibles, escapes, ausencia de firma y límite de reintentos. El flujo simulado conserva las verificaciones de pago, privacidad y generación de PDF; no prueba una entrega real a un cliente.

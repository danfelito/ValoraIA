# ValoraIA

MVP profesional de expediente, inteligencia y conciliación documental para valuación inmobiliaria.

## Estado actual

Incluye autenticación y persistencia en Supabase, expedientes, ficha del inmueble, carga privada de documentos, extracción documental mediante Edge Function, revisión humana, conciliación de fuentes, conflictos y auditoría.

No debe presentarse todavía como avalúo oficial ni como plataforma final concluida. Faltan el motor de comparables, homologación, enfoques de mercado/costos/ingresos, informes firmables y calibración regional.

## Despliegue en Render

El repositorio incluye `render.yaml` para crear un Static Site gratuito. En Render: New > Blueprint, conecta este repositorio y selecciona Deploy Blueprint.

## Backend

Supabase project ref: `wctwkhixmmluckingjhf`.

Configura `OPENAI_API_KEY` exclusivamente en Supabase > Edge Functions > Secrets. Nunca la agregues a GitHub ni a `config.js`.

## Archivos

- `index.html`, `app.js`, `styles.css`, `config.js`: frontend.
- `render.yaml`: Blueprint de Render.
- `supabase/migrations/001_base_schema.sql`: esquema base verificado.
- `supabase/functions/`: código reproducible de las Edge Functions.
- `docs/CONFIGURAR_OPENAI_API_KEY.md`: configuración segura de OpenAI.

## Seguridad

El frontend contiene solo la URL y clave publicable de Supabase. Las credenciales administrativas y la clave de OpenAI permanecen en el backend.

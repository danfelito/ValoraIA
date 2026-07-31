# Despliegue en Render

ValoraIA se publica como **Static Site**. El backend está en Supabase.

## Mediante Blueprint

1. En Render abre **New > Blueprint**.
2. Selecciona `danfelito/ValoraIA`.
3. Render detectará `render.yaml` en la raíz.
4. Selecciona **Deploy Blueprint**.

## Mediante Static Site

Cuando el repositorio ya fue seleccionado manualmente, usa:

- **Name:** `valoraia`
- **Branch:** `main`
- **Root Directory:** vacío
- **Build Command:** `echo "ValoraIA static build"`
- **Publish Directory:** `.`
- **Auto-Deploy:** activado

Después selecciona **Create Static Site**. Para repetir un despliegue usa **Manual Deploy > Deploy latest commit**.

## Verificación

La portada debe mostrar el formulario de acceso y registro. En la consola del navegador no debe aparecer el mensaje “No se pudo iniciar ValoraIA”.

## Backend

- Supabase: `wctwkhixmmluckingjhf`
- Storage privado: `valuation-documents`
- Funciones: `process-valuation-document` y `reconcile-valuation-case`

La clave `OPENAI_API_KEY` se configura en Supabase, no en Render.

# Supabase Edge Functions

Las funciones de producción ya están desplegadas en el proyecto `wctwkhixmmluckingjhf` con JWT obligatorio.

## Funciones activas

### `process-valuation-document`

- Valida la sesión y acceso al expediente.
- Descarga el archivo desde Storage privado.
- Crea y actualiza la cola documental.
- Usa `OPENAI_API_KEY` desde los secretos de Supabase.
- Clasifica el documento y guarda análisis, campos y evidencia por página.

### `reconcile-valuation-case`

- Valida acceso mediante RLS.
- Agrupa campos extraídos.
- Aplica prioridades documentales y tolerancias.
- Genera conflictos automáticos.
- Guarda recomendaciones en auditoría.

## Secretos

```text
OPENAI_API_KEY
OPENAI_DOCUMENT_MODEL=gpt-5
```

Las funciones usan además las variables administradas por Supabase:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` nunca debe exponerse al frontend.

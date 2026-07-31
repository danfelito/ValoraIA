# Configurar OpenAI para ValoraIA

La clave de OpenAI se guarda únicamente en Supabase. No debe colocarse en GitHub, Render, `config.js`, `app-loader.js` ni en el navegador.

## 1. Crear la clave

1. Entra a la plataforma de OpenAI.
2. Abre el proyecto que usarás para ValoraIA.
3. Entra a **API keys**.
4. Selecciona **Create new secret key**.
5. Usa el nombre `ValoraIA Supabase`.
6. Copia la clave una sola vez.

La suscripción de ChatGPT y la facturación de API son independientes. El proyecto de API debe tener saldo o método de pago.

## 2. Guardarla en Supabase

1. Abre el proyecto Supabase `wctwkhixmmluckingjhf`.
2. Entra a **Edge Functions**.
3. Abre **Secrets**.
4. Agrega:

```text
OPENAI_API_KEY=<tu clave secreta>
```

5. Opcionalmente agrega:

```text
OPENAI_DOCUMENT_MODEL=gpt-5
```

6. Guarda los secretos.

## 3. Probar

1. Inicia sesión en ValoraIA.
2. Crea un expediente.
3. Carga una escritura, predial, catastro, plano o imagen.
4. Abre **Extracción**.
5. Pulsa **Procesar / reintentar**.

La Edge Function `process-valuation-document` toma la clave desde el entorno privado de Supabase. El frontend nunca la recibe.

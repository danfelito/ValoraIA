// ValoraIA en Cloudflare: la API vive en el mismo sitio (/api y /functions).
window.VALORAIA_CONFIG = {
  supabaseUrl: location.origin,
  supabasePublishableKey: 'valoraia',
  storageBucket: 'valuation-documents',
  extendedAnalysisEnabled: true
};

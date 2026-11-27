// Active valuation profile requested by the organization: Luna, medium reasoning (faster market searches).
// Keep this in code so legacy model environment variables cannot select GPT-5.
export const VALUATION_MODEL = "gpt-6-luna";
export const VALUATION_REASONING_EFFORT = "medium";
// Búsqueda escalonada: primero una consulta corta y barata; la profunda sólo si faltan comparables.
export const SEARCH_EFFORT = { quick: "low", deep: "medium" } as const;

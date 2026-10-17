// An improved warehouse remains a warehouse when its market prices are
// normalized by land area. Never silently substitute one kind of area.
export function comparisonBasis(type: string, selection: unknown): "land" | "built" {
  const requested = String(selection || "auto");
  if (!["auto", "land", "built"].includes(requested)) throw new Error("Base de comparación no válida");
  if (["terreno", "rancho"].includes(type)) {
    if (requested === "built") throw new Error("Este tipo de inmueble se compara por superficie de terreno");
    return "land";
  }
  if (requested === "land") {
    if (!["bodega", "industrial"].includes(type)) throw new Error("La comparación del inmueble construido por terreno sólo está habilitada para bodegas e industriales");
    return "land";
  }
  return "built";
}

import { comparisonBasis } from "./comparison-basis.ts";
export function commercialIntakeIssues(input:Record<string,any>):string[]{
  const errors=[];
  if(String(input.address_line||'').trim().length<5)errors.push('dirección completa');
  if(!String(input.region||'').trim())errors.push('estado');
  if(!String(input.municipality||'').trim())errors.push('municipio');
  let land=false;
  try { land=comparisonBasis(input.property_type,input.comparison_area_basis)==='land'; }
  catch(error){ errors.push(error instanceof Error?error.message:'base de comparación válida'); }
  const area=Number(input[land?'land_area_m2':'built_area_m2']);
  if(!Number.isFinite(area)||area<=0)errors.push(land?'superficie de terreno mayor a cero':'superficie construida mayor a cero');
  return errors;
}

export function commercialIntakeIssues(input:Record<string,any>):string[]{
  const errors=[];
  if(String(input.address_line||'').trim().length<5)errors.push('dirección completa');
  if(!String(input.region||'').trim())errors.push('estado');
  if(!String(input.municipality||'').trim())errors.push('municipio');
  const land=['terreno','rancho'].includes(input.property_type);
  const area=Number(input[land?'land_area_m2':'built_area_m2']);
  if(!Number.isFinite(area)||area<=0)errors.push(land?'superficie de terreno mayor a cero':'superficie construida mayor a cero');
  return errors;
}

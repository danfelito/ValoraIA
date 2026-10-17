-- Preserve the existing owner-only authorization, ACLs and payment state.
CREATE OR REPLACE FUNCTION public.update_client_property(p_request_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.service_requests%rowtype;fields jsonb;built numeric;land numeric;basis text;begin
  select * into r from public.service_requests where id=p_request_id and created_by=auth.uid() for update;
  if r.id is null then raise exception 'Solicitud no disponible para esta cuenta' using errcode='42501';end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into fields from jsonb_each(p_fields)
    where key=any(array['address_line','postal_code','region','municipality','locality','land_area_m2',
      'built_area_m2','bedrooms','bathrooms','parking_spaces','construction_year','conservation_state','property_notes','comparison_area_basis','subject_listing_url','asking_price']);
  if length(trim(coalesce(fields->>'address_line','')))<5 or trim(coalesce(fields->>'region',''))=''
    or trim(coalesce(fields->>'municipality',''))='' then raise exception 'Completa dirección, estado y municipio';end if;
  built:=nullif(fields->>'built_area_m2','')::numeric;land:=nullif(fields->>'land_area_m2','')::numeric;
  basis:=coalesce(nullif(fields->>'comparison_area_basis',''),r.intake_data->>'comparison_area_basis','auto');
  if basis not in ('auto','land','built') then raise exception 'Base de comparación no válida';end if;
  if basis='land' and r.property_type not in ('terreno','rancho','bodega','industrial') then
    raise exception 'La comparación por terreno del inmueble construido sólo aplica a bodegas e industriales';end if;
  if basis='built' and r.property_type in ('terreno','rancho') then raise exception 'Este inmueble se compara por terreno';end if;
  fields:=fields||jsonb_build_object('comparison_area_basis',basis);
  if r.property_type in ('terreno','rancho') or (r.property_type in ('bodega','industrial') and basis='land') then
    if land is null or land<=0 then raise exception 'Captura una superficie de terreno mayor a cero';end if;
  elsif built is null or built<=0 then raise exception 'Captura una superficie construida mayor a cero';end if;
  if built<0 or land<0 then raise exception 'Las superficies no pueden ser negativas';end if;
  update public.properties set address_line=fields->>'address_line',postal_code=fields->>'postal_code',
    land_area_m2=land,built_area_m2=built,bedrooms=nullif(fields->>'bedrooms','')::int,
    bathrooms=nullif(fields->>'bathrooms','')::numeric,parking_spaces=nullif(fields->>'parking_spaces','')::int,
    construction_year=nullif(fields->>'construction_year','')::int,
    conservation_state=fields->>'conservation_state',notes=fields->>'property_notes'
    where case_id=r.case_id;
  update public.valuation_cases set region=fields->>'region',municipality=fields->>'municipality',locality=fields->>'locality'
    where id=r.case_id and organization_id=r.organization_id;
  update public.service_requests set intake_data=intake_data||fields where id=r.id;
  return jsonb_build_object('request_id',r.id,'updated',true);
end$function$
;

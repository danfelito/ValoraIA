create or replace function public.update_client_property(p_request_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$declare r public.service_requests%rowtype;fields jsonb;built numeric;land numeric;begin
  select * into r from public.service_requests where id=p_request_id and created_by=auth.uid() for update;
  if r.id is null then raise exception 'Solicitud no disponible para esta cuenta' using errcode='42501';end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into fields from jsonb_each(p_fields)
    where key=any(array['address_line','postal_code','region','municipality','locality','land_area_m2',
      'built_area_m2','bedrooms','bathrooms','parking_spaces','construction_year','conservation_state','property_notes']);
  if length(trim(coalesce(fields->>'address_line','')))<5 or trim(coalesce(fields->>'region',''))=''
    or trim(coalesce(fields->>'municipality',''))='' then raise exception 'Completa dirección, estado y municipio';end if;
  built:=nullif(fields->>'built_area_m2','')::numeric;land:=nullif(fields->>'land_area_m2','')::numeric;
  if r.property_type in ('terreno','rancho') then
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
end$$;
revoke all on function public.update_client_property(uuid,jsonb) from public,anon;
grant execute on function public.update_client_property(uuid,jsonb) to authenticated,service_role;

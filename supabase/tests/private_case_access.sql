-- Transactional permission regression: no data, role or assignment survives.
begin;
do $$declare org_id uuid;actor uuid;private_case uuid;begin
  select organization_id into org_id from public.platform_configuration where singleton=true;
  select user_id into actor from public.organization_members where organization_id=org_id and role='owner' and status='active' limit 1;
  select c.id into private_case from public.valuation_cases c where c.organization_id=org_id
    and not exists(select 1 from public.service_requests r where r.case_id=c.id) limit 1;
  if actor is null or private_case is null then raise exception 'Se requieren fixtures de propietario y expediente interno';end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'is_anonymous',false,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  perform set_config('valoraia_test.org',org_id::text,true);
  perform set_config('valoraia_test.actor',actor::text,true);
  perform set_config('valoraia_test.case',private_case::text,true);
end$$;
set local role authenticated;
do $$declare summary jsonb;begin
  summary:=public.admin_service_tracking(current_setting('valoraia_test.org')::uuid);
  if jsonb_array_length(summary)=0 then raise exception 'Administración perdió el listado';end if;
  if exists(select 1 from jsonb_array_elements(summary) r where r?'intake_data' or r?'fiscal_data' or r?'body_text' or r?'pdf_storage_path') then raise exception 'Resumen expone contenido privado';end if;
  if public.can_read_case_content(current_setting('valoraia_test.case')::uuid) then raise exception 'Administración obtuvo contenido técnico';end if;
  if exists(select 1 from public.valuation_cases where id=current_setting('valoraia_test.case')::uuid) then raise exception 'Falla RLS de expediente';end if;
  if exists(select 1 from public.properties where case_id=current_setting('valoraia_test.case')::uuid) then raise exception 'Falla RLS de inmueble';end if;
  if exists(select 1 from public.notification_outbox) then raise exception 'Administración obtuvo correos completos';end if;
end$$;
reset role;
select 'PASS: seguimiento administrativo disponible; contenido ajeno y cuerpos de correo bloqueados' as validation;
rollback;

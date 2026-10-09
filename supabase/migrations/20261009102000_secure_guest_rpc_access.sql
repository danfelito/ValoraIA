create or replace function public.create_organization_with_owner(
  organization_name text,
  country_code text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
  org_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if coalesce((select u.is_anonymous from auth.users u where u.id = uid), false) then
    raise exception 'Las sesiones temporales no pueden crear organizaciones';
  end if;
  if organization_name is null or length(trim(organization_name)) < 2 then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations(name, country_code, created_by)
  values(trim(organization_name), upper(nullif(trim(country_code), '')), uid)
  returning id into org_id;

  insert into public.organization_members(organization_id, user_id, role, status)
  values(org_id, uid, 'owner', 'active');

  insert into public.profiles(id) values(uid) on conflict(id) do nothing;
  return org_id;
end;
$function$;

create or replace function public.route_professional_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  r public.service_requests%rowtype;
  a public.appraisers%rowtype;
  score numeric;
  assign_id uuid;
  reason text;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Autenticación requerida';
  end if;

  select * into r from public.service_requests where id = p_request_id;
  if r.id is null or r.service_type <> 'professional' then
    return jsonb_build_object('assigned', false, 'reason', 'Solicitud no profesional');
  end if;
  if r.created_by <> uid and not public.is_admin() then
    raise exception 'No tienes permiso para asignar este expediente';
  end if;

  select ap.*,
    (case when r.property_type = any(ap.property_types) then 60 else 0 end
     + case when coalesce(r.property_subtype, '') = any(ap.specialties) then 25 else 0 end
     + ap.priority / 10.0) as route_score
  into a
  from public.appraisers ap
  where ap.organization_id = r.organization_id and ap.active = true
  order by route_score desc, ap.priority desc, ap.created_at asc
  limit 1;

  if a.id is null then
    return jsonb_build_object('assigned', false, 'reason', 'No hay peritos activos');
  end if;

  score := (case when r.property_type = any(a.property_types) then 60 else 0 end)
    + (case when coalesce(r.property_subtype, '') = any(a.specialties) then 25 else 0 end)
    + a.priority / 10.0;
  reason := 'Coincidencia por tipo de inmueble y especialidad; prioridad ' || a.priority;

  insert into public.appraiser_assignments(
    organization_id, request_id, appraiser_id, status, score, confidence, reason, assigned_by
  ) values (
    r.organization_id, r.id, a.id, 'assigned', score, least(1, score / 95), reason, 'ai'
  )
  on conflict(request_id, appraiser_id) do update
    set score = excluded.score,
        confidence = excluded.confidence,
        reason = excluded.reason
  returning id into assign_id;

  update public.service_requests
  set assigned_appraiser_id = a.id,
      status = 'assigned',
      routing_reason = reason,
      routing_confidence = least(1, score / 95),
      routed_at = now()
  where id = r.id;

  insert into public.notification_outbox(
    organization_id, request_id, assignment_id, recipient, subject, body_text, status, metadata
  ) values (
    r.organization_id,
    r.id,
    assign_id,
    a.email,
    'Nueva solicitud de avalúo profesional · ' || r.property_type,
    'Se asignó una solicitud de ' || r.property_type || '. Cliente: ' || r.client_name
      || '. Correo: ' || r.client_email || '. Teléfono: '
      || coalesce(r.client_phone, 'No indicado') || '. Revise ValoraIA para consultar el expediente completo.',
    'needs_configuration',
    jsonb_build_object('appraiser_id', a.id, 'request_id', r.id)
  );

  return jsonb_build_object(
    'assigned', true,
    'appraiser_id', a.id,
    'assignment_id', assign_id,
    'score', score,
    'reason', reason
  );
end;
$function$;

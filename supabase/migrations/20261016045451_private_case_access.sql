-- The admin roster exposes metadata only. Technical content is limited to
-- the requesting client and the professional assigned to that case.
create or replace function app_private.can_read_case_content(p_case_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.valuation_cases c
    where c.id=p_case_id and (
      exists(select 1 from public.service_requests r where r.case_id=c.id and r.created_by=auth.uid())
      or (app_private.has_org_role(c.organization_id,array['appraiser','reviewer','analyst']) and (
        c.assigned_appraiser_id=auth.uid()
        or (not exists(select 1 from public.service_requests r where r.case_id=c.id)
            and (c.created_by=auth.uid() or c.owner_user_id=auth.uid()))
        or exists(select 1 from public.service_requests r
          join public.appraisers a on a.id=r.assigned_appraiser_id and a.organization_id=r.organization_id
          join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null
          where r.case_id=c.id and a.active and lower(a.email)=lower(u.email))
      ))
    )
  );
$$;
revoke all on function app_private.can_read_case_content(uuid) from public, anon;
grant execute on function app_private.can_read_case_content(uuid) to authenticated, service_role;

create or replace function public.can_read_case_content(p_case_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp
as $$select app_private.can_read_case_content(p_case_id)$$;
revoke all on function public.can_read_case_content(uuid) from public,anon;
grant execute on function public.can_read_case_content(uuid) to authenticated,service_role;

create or replace function app_private.can_read_request_content(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$select exists(select 1 from public.service_requests r where r.id=p_request_id
  and app_private.can_read_case_content(r.case_id))$$;
revoke all on function app_private.can_read_request_content(uuid) from public,anon;
grant execute on function app_private.can_read_request_content(uuid) to authenticated,service_role;

-- Restrictive policies also constrain existing permissive organization rules.
do $$declare t text;begin
  foreach t in array array['properties','documents','adopted_values','extracted_fields','data_conflicts',
    'document_analyses','document_page_evidence','document_processing_jobs','valuation_calculations',
    'market_comparables','commercial_reports','valuation_report_previews','audit_events'] loop
    execute format('create policy case_content_private on public.%I as restrictive for all to authenticated using (app_private.can_read_case_content(case_id)) with check (app_private.can_read_case_content(case_id))',t);
  end loop;
end$$;
create policy case_content_private on public.valuation_cases as restrictive for all to authenticated
using (app_private.can_read_case_content(id))
with check (app_private.can_read_case_content(id) or (created_by=auth.uid() and app_private.has_org_role(organization_id,array['appraiser','reviewer','analyst'])));
create policy request_content_private on public.service_requests as restrictive for all to authenticated
using (app_private.can_read_case_content(case_id)) with check (app_private.can_read_case_content(case_id));
create policy intake_content_private on public.intake_documents as restrictive for all to authenticated
using (app_private.can_read_request_content(request_id)) with check (app_private.can_read_request_content(request_id));
create policy payment_content_private on public.payment_events as restrictive for all to authenticated
using (app_private.can_read_request_content(request_id)) with check (app_private.can_read_request_content(request_id));
create policy email_body_private on public.notification_outbox as restrictive for all to authenticated
using (false) with check (false);

create or replace function app_private.can_read_valuation_file(p_bucket text,p_name text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $$declare parts text[];begin
  if p_bucket not in ('valuation-documents','valuation-intake') then return true;end if;
  parts:=string_to_array(p_name,'/');
  if p_bucket='valuation-intake' then
    return exists(select 1 from public.service_requests r where r.id::text=parts[2]
      and r.organization_id::text=parts[1] and app_private.can_read_case_content(r.case_id));
  end if;
  return exists(select 1 from public.valuation_cases c where c.id::text=parts[2]
    and c.organization_id::text=parts[1] and app_private.can_read_case_content(c.id));
end$$;
revoke all on function app_private.can_read_valuation_file(text,text) from public,anon;
grant execute on function app_private.can_read_valuation_file(text,text) to authenticated,service_role;
create policy valuation_content_private on storage.objects as restrictive for all to authenticated
using (app_private.can_read_valuation_file(bucket_id,name))
with check (app_private.can_read_valuation_file(bucket_id,name));

create or replace function public.admin_service_tracking(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$declare result jsonb;begin
  if not app_private.has_org_role(p_organization_id,array['owner','admin']) then
    raise exception 'Sin acceso administrativo' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(rowdata order by stamp desc),'[]'::jsonb) into result from (
    select r.created_at stamp,jsonb_build_object(
      'request_id',r.id,'case_id',c.id,'folio',c.folio,'service_type',r.service_type,
      'client_name',r.client_name,'client_email',r.client_email,'client_phone',r.client_phone,
      'status',r.status,'payment_status',r.payment_status,'document_status',r.document_status,
      'document_generated_at',r.document_generated_at,'document_emailed_at',r.document_emailed_at,
      'appraiser_name',a.full_name,'created_at',r.created_at,
      'notifications',coalesce((select jsonb_agg(jsonb_build_object('recipient',n.recipient,
        'status',n.status,'sent_at',n.sent_at,'created_at',n.created_at,
        'delivered_at',n.metadata->>'delivered_at','opened_at',n.metadata->>'opened_at'))
        from public.notification_outbox n where n.request_id=r.id and n.organization_id=p_organization_id),'[]'::jsonb)
    ) rowdata
    from public.service_requests r join public.valuation_cases c on c.id=r.case_id
    left join public.appraisers a on a.id=r.assigned_appraiser_id
    where r.organization_id=p_organization_id and c.organization_id=p_organization_id
    union all
    select c.created_at,jsonb_build_object('case_id',c.id,'folio',c.folio,
      'service_type',c.service_type,'client_name',c.applicant_name,'status',c.status,
      'document_status','not_started','created_at',c.created_at,'notifications','[]'::jsonb)
    from public.valuation_cases c where c.organization_id=p_organization_id
      and not exists(select 1 from public.service_requests r where r.case_id=c.id)
  ) rows;
  return result;
end$$;
revoke all on function public.admin_service_tracking(uuid) from public,anon;
grant execute on function public.admin_service_tracking(uuid) to authenticated,service_role;

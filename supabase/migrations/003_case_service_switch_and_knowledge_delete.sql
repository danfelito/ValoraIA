alter table public.valuation_cases
  add column if not exists service_type text not null default 'professional';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.valuation_cases'::regclass
      and conname = 'valuation_cases_service_type_check'
  ) then
    alter table public.valuation_cases
      add constraint valuation_cases_service_type_check
      check (service_type = any (array['commercial'::text,'professional'::text]));
  end if;
end $$;

update public.valuation_cases c
set service_type = r.service_type
from public.service_requests r
where r.case_id = c.id
  and r.service_type in ('commercial','professional');

update public.valuation_cases c
set service_type = 'commercial'
where not exists (select 1 from public.service_requests r where r.case_id = c.id)
  and (lower(coalesce(c.purpose,'')) like '%comercial%' or lower(coalesce(c.purpose,'')) like '%mercado%');

create index if not exists valuation_cases_service_type_idx
  on public.valuation_cases(service_type);

create or replace function app_private.sync_service_request_case_type()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.valuation_cases
  set service_type = new.service_type, updated_at = now()
  where id = new.case_id;
  return new;
end;
$$;

revoke all on function app_private.sync_service_request_case_type() from public, anon, authenticated;
drop trigger if exists trg_service_request_case_type on public.service_requests;
create trigger trg_service_request_case_type
after insert or update of service_type on public.service_requests
for each row execute function app_private.sync_service_request_case_type();

create or replace function app_private.infer_case_service_type()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.purpose,'')) like '%comercial%' then
    new.service_type := 'commercial';
  elsif lower(coalesce(new.purpose,'')) like '%perito%'
     or lower(coalesce(new.purpose,'')) like '%profesional%' then
    new.service_type := 'professional';
  end if;
  return new;
end;
$$;

revoke all on function app_private.infer_case_service_type() from public, anon, authenticated;
drop trigger if exists trg_infer_case_service_type on public.valuation_cases;
create trigger trg_infer_case_service_type
before insert on public.valuation_cases
for each row execute function app_private.infer_case_service_type();

create or replace function public.switch_valuation_service(p_case_id uuid,p_service_type text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.valuation_cases%rowtype;
  v_request public.service_requests%rowtype;
  v_price numeric := 365;
  v_has_request boolean := false;
  v_payment_review boolean := false;
begin
  if p_service_type not in ('commercial','professional') then raise exception 'Tipo de servicio inválido'; end if;
  select * into v_case from public.valuation_cases where id=p_case_id;
  if not found then raise exception 'Expediente no encontrado o sin acceso'; end if;
  if v_case.service_type=p_service_type then
    return jsonb_build_object('case_id',v_case.id,'service_type',v_case.service_type,'changed',false,'has_request',exists(select 1 from public.service_requests r where r.case_id=p_case_id),'payment_requires_review',false);
  end if;
  update public.valuation_cases set service_type=p_service_type,updated_at=now() where id=p_case_id returning * into v_case;
  select * into v_request from public.service_requests where case_id=p_case_id;
  if found then
    v_has_request:=true;
    v_payment_review:=v_request.payment_status in ('paid','refunded');
    if p_service_type='commercial' then
      select coalesce((select s.commercial_price from public.app_settings s where s.organization_id=v_case.organization_id limit 1),365) into v_price;
      update public.service_requests set
        service_type='commercial',
        status=case when v_request.payment_status='paid' then 'in_review' else 'payment_pending' end,
        payment_status=case when v_request.payment_status='paid' then 'paid' else 'pending' end,
        payment_amount=case when v_request.payment_status='paid' then v_request.payment_amount else v_price end,
        payment_currency='MXN',
        payment_provider=case when v_request.payment_status='paid' then v_request.payment_provider else 'openpay' end,
        assigned_appraiser_id=null,routing_reason=null,routing_confidence=null,routed_at=null,updated_at=now()
      where id=v_request.id;
    else
      update public.service_requests set
        service_type='professional',
        status=case when v_request.status='completed' then 'in_review' else 'awaiting_assignment' end,
        payment_status=case when v_request.payment_status='paid' then 'paid' else 'not_required' end,
        payment_amount=case when v_request.payment_status='paid' then v_request.payment_amount else 0 end,
        payment_provider=case when v_request.payment_status='paid' then v_request.payment_provider else null end,
        assigned_appraiser_id=null,routing_reason=null,routing_confidence=null,routed_at=null,updated_at=now()
      where id=v_request.id;
    end if;
  end if;
  return jsonb_build_object('case_id',v_case.id,'service_type',p_service_type,'changed',true,'has_request',v_has_request,'payment_requires_review',v_payment_review,'commercial_price',case when p_service_type='commercial' then v_price else null end);
end;
$$;

revoke all on function public.switch_valuation_service(uuid,text) from public, anon;
grant execute on function public.switch_valuation_service(uuid,text) to authenticated;

drop policy if exists valuation_knowledge_delete on storage.objects;
create policy valuation_knowledge_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id='valuation-knowledge'
  and app_private.has_org_role_text((storage.foldername(name))[1],array['owner'::text,'admin'::text])
);
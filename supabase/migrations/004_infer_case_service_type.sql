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
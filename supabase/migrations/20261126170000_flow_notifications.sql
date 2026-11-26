-- Avisos por correo y vigilancia del flujo comercial.
-- 1) Cada cambio importante de una solicitud deja un aviso en notification_outbox.
-- 2) Cada minuto, pg_cron llama a la función flow-keeper, que envía los avisos
--    pendientes y reanuda los documentos que se quedaron atorados.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.service_requests
  add column if not exists document_retry_count smallint not null default 0,
  add column if not exists document_retry_at timestamptz;

-- Un aviso por solicitud, tipo, destinatario y versión del documento.
create unique index if not exists notification_outbox_kind_once
  on public.notification_outbox (request_id, recipient, (metadata->>'kind'), (coalesce(metadata->>'ref','')))
  where metadata ? 'kind';

-- Ficha privada del vigilante (sólo service_role; sin políticas para el resto).
create table if not exists public.flow_config (
  singleton boolean primary key default true check (singleton),
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  last_run_at timestamptz,
  last_result jsonb
);
alter table public.flow_config enable row level security;
revoke all on public.flow_config from anon, authenticated;
insert into public.flow_config default values on conflict do nothing;

create or replace function public.queue_request_notifications() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  admin_mail text;
  add_kind text;
  ref text := '';
begin
  if new.service_type <> 'commercial' then return new; end if;

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    add_kind := 'payment_received';
  elsif new.payment_status = 'failed' and old.payment_status is distinct from 'failed' then
    add_kind := 'payment_failed'; ref := coalesce(new.payment_transaction_id, '');
  elsif new.document_status = 'ready' and old.document_status is distinct from 'ready' then
    add_kind := 'document_ready'; ref := coalesce(new.document_storage_path, '');
  elsif new.document_status = 'needs_review' and old.document_status is distinct from 'needs_review' then
    add_kind := 'needs_review'; ref := coalesce(new.document_retry_at::text, new.updated_at::text, '');
  end if;
  if add_kind is null then return new; end if;

  select coalesce(nullif(trim(s.admin_notification_email), ''), 'contacto@circulointernacionalveracruz.org')
    into admin_mail from public.app_settings s where s.organization_id = new.organization_id;
  admin_mail := coalesce(admin_mail, 'contacto@circulointernacionalveracruz.org');

  if coalesce(trim(new.client_email), '') <> '' then
    insert into public.notification_outbox (organization_id, request_id, recipient, subject, body_text, status, metadata)
    values (new.organization_id, new.id, lower(trim(new.client_email)), 'ValoraIA', add_kind, 'queued',
            jsonb_build_object('kind', add_kind, 'ref', ref, 'audience', 'client'))
    on conflict do nothing;
  end if;
  if add_kind <> 'payment_failed' then
    insert into public.notification_outbox (organization_id, request_id, recipient, subject, body_text, status, metadata)
    values (new.organization_id, new.id, lower(admin_mail), 'ValoraIA', add_kind, 'queued',
            jsonb_build_object('kind', 'admin_' || add_kind, 'ref', ref, 'audience', 'admin'))
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_queue_request_notifications on public.service_requests;
create trigger trg_queue_request_notifications
  after update of payment_status, document_status on public.service_requests
  for each row execute function public.queue_request_notifications();

-- Toma avisos pendientes sin que dos ejecuciones envíen el mismo.
create or replace function public.flow_claim_notifications(p_limit int default 10)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.notification_outbox o
     set metadata = o.metadata || jsonb_build_object('claimed_at', now())
   where o.id in (
     select n.id from public.notification_outbox n
      where n.status in ('queued', 'needs_configuration')
        and n.attempts < 5
        and n.created_at > now() - interval '7 days'
        and coalesce((n.metadata->>'claimed_at')::timestamptz, 'epoch') < now() - interval '5 minutes'
      order by n.created_at
      limit p_limit
      for update skip locked)
  returning o.*;
end $$;

-- Documentos pagados que dejaron de avanzar: reintenta hasta 3 veces y después
-- los pasa a revisión (lo que dispara el aviso al cliente y al administrador).
create or replace function public.flow_claim_stalled()
returns table (request_id uuid, action text)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select s.id, s.document_retry_count
      from public.service_requests s
      left join public.commercial_reports c on c.request_id = s.id
     where s.service_type = 'commercial' and s.payment_status = 'paid'
       and s.payment_paid_at > now() - interval '3 days'
       and s.document_status in ('queued', 'generating')
       and coalesce((c.report_data->'pipeline'->>'heartbeat')::timestamptz, s.payment_paid_at) < now() - interval '8 minutes'
       and coalesce(s.document_retry_at, 'epoch') < now() - interval '8 minutes'
     for update of s skip locked
  loop
    if r.document_retry_count >= 3 then
      update public.commercial_reports set status = 'needs_review',
             error_message = 'El análisis automático no pudo completarse después de varios intentos. El expediente quedó en seguimiento manual.'
       where commercial_reports.request_id = r.id;
      update public.service_requests set document_status = 'needs_review', status = 'in_review', document_retry_at = now() where id = r.id;
      request_id := r.id; action := 'give_up'; return next;
    else
      update public.service_requests set document_retry_count = r.document_retry_count + 1, document_retry_at = now() where id = r.id;
      request_id := r.id; action := 'retry'; return next;
    end if;
  end loop;
end $$;

create or replace function public.flow_check_token(p_token text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.flow_config where token = p_token);
$$;

create or replace function public.flow_record_run(p_result jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.flow_config set last_run_at = now(), last_result = p_result;
$$;

revoke all on function public.queue_request_notifications() from public, anon, authenticated;
revoke all on function public.flow_claim_notifications(int) from public, anon, authenticated;
revoke all on function public.flow_claim_stalled() from public, anon, authenticated;
revoke all on function public.flow_check_token(text) from public, anon, authenticated;
revoke all on function public.flow_record_run(jsonb) from public, anon, authenticated;
grant execute on function public.flow_claim_notifications(int), public.flow_claim_stalled(), public.flow_check_token(text), public.flow_record_run(jsonb) to service_role;

-- Latido: cada minuto.
create or replace function public.flow_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  select token into t from public.flow_config;
  perform net.http_post(
    url := 'https://wctwkhixmmluckingjhf.supabase.co/functions/v1/flow-keeper',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-flow-token', t),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.flow_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'valoraia-flow-keeper';
select cron.schedule('valoraia-flow-keeper', '* * * * *', 'select public.flow_tick()');

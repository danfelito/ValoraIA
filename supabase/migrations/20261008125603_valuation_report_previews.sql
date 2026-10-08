create table public.valuation_report_previews (
  case_id uuid primary key references public.valuation_cases(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','generating','generated','needs_review')),
  currency_code text default 'MXN', subject_area_m2 numeric, price_per_m2 numeric,
  estimated_value numeric, low_value numeric, high_value numeric, comparable_count integer,
  report_data jsonb not null default '{}'::jsonb, pdf_storage_path text, error_message text,
  generated_at timestamptz, created_at timestamptz not null default now()
);
create index valuation_report_previews_organization_idx on public.valuation_report_previews(organization_id);
alter table public.valuation_report_previews enable row level security;
revoke all on public.valuation_report_previews from anon, authenticated;
grant select on public.valuation_report_previews to authenticated;
grant all on public.valuation_report_previews to service_role;
create policy report_previews_select on public.valuation_report_previews for select to authenticated
using (app_private.has_org_role(organization_id,array['owner','admin','appraiser','reviewer','analyst']));
-- Restrictive policy supplements existing storage policies and cannot grant access.
create policy valuation_previews_private on storage.objects as restrictive for all to authenticated
using (case when bucket_id = 'valuation-documents' and coalesce((storage.foldername(name))[3],'') = 'previews' then app_private.has_org_role(((storage.foldername(name))[1])::uuid,array['owner','admin','appraiser','reviewer','analyst']) else true end)
with check (case when bucket_id = 'valuation-documents' and coalesce((storage.foldername(name))[3],'') = 'previews' then app_private.has_org_role(((storage.foldername(name))[1])::uuid,array['owner','admin','appraiser','reviewer','analyst']) else true end);

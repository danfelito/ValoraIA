-- Trust only the authentication method in the signed Auth JWT, never metadata
-- supplied by the browser. Administrative role checks require password login.
create or replace function app_private.has_org_role(org_id uuid,allowed_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$select auth.uid() is not null and exists(
  select 1 from public.organization_members m where m.organization_id=org_id
    and m.user_id=auth.uid() and m.status='active' and m.role=any(allowed_roles)
    and (m.role not in ('owner','admin') or (
      coalesce(auth.jwt()->>'is_anonymous','true')='false'
      and coalesce(auth.jwt()->'amr','[]'::jsonb) @> '[{"method":"password"}]'::jsonb
    ))
)$$;

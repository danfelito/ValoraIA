-- Base propia de comparables y registro de búsquedas (caché por zona y costo por informe).
create table if not exists public.market_listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null check (operation in ('sale','rent')),
  property_type text not null,
  municipality_key text not null,
  locality_key text,
  url text not null,
  price numeric,
  data jsonb not null,
  observed_at timestamptz not null default now(),
  unique (organization_id, operation, url)
);
create index if not exists market_listings_zone_idx on public.market_listings (organization_id, operation, property_type, municipality_key, observed_at desc);

create table if not exists public.market_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid,
  operation text not null check (operation in ('sale','rent')),
  level text not null,
  property_type text not null,
  municipality_key text not null,
  locality_key text,
  sources text[] not null default '{}',
  listing_count int not null default 0,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index if not exists market_searches_zone_idx on public.market_searches (organization_id, operation, property_type, municipality_key, created_at desc);

-- Sólo las funciones del servidor (service role) leen y escriben.
alter table public.market_listings enable row level security;
alter table public.market_searches enable row level security;

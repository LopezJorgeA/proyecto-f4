-- Extensiones
create extension if not exists "uuid-ossp";

-- Tabla tenants
create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Tabla documents
create table public.documents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Índice fulltext en español
create index documents_content_fts_idx
  on public.documents
  using gin (to_tsvector('spanish', content));

-- Índice por tenant
create index documents_tenant_id_idx on public.documents(tenant_id);

-- Habilitar RLS
alter table public.documents enable row level security;
alter table public.tenants enable row level security;

-- Policy de aislamiento por tenant
create policy "tenant_isolation_select"
  on public.documents
  for select
  using (
    tenant_id::text = current_setting('request.tenant_id', true)
  );

-- Policy de lectura abierta para tenants
create policy "tenants_read_all"
  on public.tenants
  for select
  using (true);
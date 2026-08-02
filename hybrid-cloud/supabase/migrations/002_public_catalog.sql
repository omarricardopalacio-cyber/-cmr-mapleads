-- Public storefront mirror only. Do not add inventory, supplier, CRM, or media tables here.

create table public.store_configs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  public_slug text not null unique,
  store_name text not null,
  description text,
  logo_url text,
  currency_code text not null default 'USD',
  enabled boolean not null default false,
  revision bigint not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_configs_slug_format check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  constraint store_configs_name_length check (char_length(store_name) between 1 and 160),
  constraint store_configs_description_length check (description is null or char_length(description) <= 2000),
  constraint store_configs_logo_https check (logo_url is null or logo_url ~ '^https://'),
  constraint store_configs_currency_code check (currency_code ~ '^[A-Z]{3}$'),
  constraint store_configs_revision_positive check (revision > 0)
);

create table public.products_public (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_product_id text not null,
  name text not null,
  description text,
  price_minor bigint,
  currency_code text not null default 'USD',
  image_url text,
  product_url text,
  active boolean not null default true,
  published boolean not null default false,
  revision bigint not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_product_id),
  constraint products_public_external_id_length check (char_length(external_product_id) between 1 and 160),
  constraint products_public_name_length check (char_length(name) between 1 and 240),
  constraint products_public_description_length check (description is null or char_length(description) <= 6000),
  constraint products_public_price_nonnegative check (price_minor is null or price_minor >= 0),
  constraint products_public_currency_code check (currency_code ~ '^[A-Z]{3}$'),
  constraint products_public_image_https check (image_url is null or image_url ~ '^https://'),
  constraint products_public_url_https check (product_url is null or product_url ~ '^https://'),
  constraint products_public_revision_positive check (revision > 0),
  constraint products_public_publication_timestamp check (
    (published = false and published_at is null) or (published = true and published_at is not null)
  )
);

create index products_public_catalog_idx
  on public.products_public (organization_id, updated_at desc)
  where active and published;
create index products_public_public_read_idx
  on public.products_public (organization_id, published_at desc)
  where active and published;

create or replace function public.bump_catalog_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision = old.revision + 1;
  end if;
  if new.published and new.published_at is null then
    new.published_at = now();
  elsif not new.published then
    new.published_at = null;
  end if;
  return new;
end;
$$;

create or replace function public.bump_store_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision = old.revision + 1;
  end if;
  if new.enabled and new.published_at is null then
    new.published_at = now();
  elsif not new.enabled then
    new.published_at = null;
  end if;
  return new;
end;
$$;

create trigger store_configs_set_updated_at before update on public.store_configs
  for each row execute function public.set_updated_at();
create trigger store_configs_bump_revision before insert or update on public.store_configs
  for each row execute function public.bump_store_revision();
create trigger products_public_set_updated_at before update on public.products_public
  for each row execute function public.set_updated_at();
create trigger products_public_bump_revision before insert or update on public.products_public
  for each row execute function public.bump_catalog_revision();

alter table public.store_configs enable row level security;
alter table public.products_public enable row level security;

-- The anonymous catalog is intentionally limited to storefront-safe fields
-- because the policy applies to the whole row. Keep this table public-only.
create policy store_configs_public_read on public.store_configs for select to anon, authenticated
  using (enabled);
create policy products_public_read on public.products_public for select to anon, authenticated
  using (
    active and published
    and exists (
      select 1 from public.store_configs s
      where s.organization_id = products_public.organization_id and s.enabled
    )
  );
create policy store_configs_member_read on public.store_configs for select to authenticated
  using (public.is_org_member(organization_id));
create policy store_configs_admin_write on public.store_configs for all to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy products_public_member_read on public.products_public for select to authenticated
  using (public.is_org_member(organization_id));
create policy products_public_admin_write on public.products_public for all to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

revoke all on public.store_configs, public.products_public from anon, authenticated;
grant select on public.store_configs, public.products_public to anon;
grant select, insert, update, delete on public.store_configs, public.products_public to authenticated;
revoke all on function public.bump_catalog_revision(), public.bump_store_revision() from public;

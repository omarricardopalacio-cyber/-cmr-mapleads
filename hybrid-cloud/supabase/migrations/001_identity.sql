-- mapleads-hybrid: identity and organization boundary
-- Run after enabling Supabase Auth; this migration does not alter auth.users.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 120)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 1 and 160),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

create table public.user_roles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index user_roles_user_organization_idx on public.user_roles (user_id, organization_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger user_roles_set_updated_at before update on public.user_roles
  for each row execute function public.set_updated_at();

-- Inserts a profile for every new Supabase Auth user. Keep this small: never
-- copy email, phone, provider tokens, or arbitrary auth metadata into profiles.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'display_name', 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Used by RLS without exposing organization membership rows across tenants.
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.organization_id = p_organization_id
      and r.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.organization_id = p_organization_id
      and r.user_id = auth.uid()
      and r.role = any(p_roles)
  );
$$;

-- The only normal creation path: it atomically creates the tenant and owner.
create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_organization public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), auth.uid())
  returning * into v_organization;
  insert into public.user_roles (organization_id, user_id, role)
  values (v_organization.id, auth.uid(), 'owner');
  return v_organization;
end;
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.user_roles enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy organizations_read_membership on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy user_roles_read_membership on public.user_roles for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.profiles, public.organizations, public.user_roles from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.organizations, public.user_roles to authenticated;
revoke all on function public.handle_new_auth_user(), public.is_org_member(uuid),
  public.has_org_role(uuid, public.app_role[]), public.set_updated_at() from public;
grant execute on function public.is_org_member(uuid), public.has_org_role(uuid, public.app_role[]) to authenticated;
revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

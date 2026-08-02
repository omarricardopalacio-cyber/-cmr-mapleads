-- Anonymous visitors can only use the two narrowly scoped RPCs below.
-- Queue payloads are envelopes, not a replica of operational CRM history.

create type public.sync_event_status as enum ('pending', 'claimed', 'retry', 'processed', 'dead');

create table public.desktop_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  token_hash text not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, label),
  constraint desktop_devices_label_length check (char_length(label) between 1 and 120),
  constraint desktop_devices_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$')
);

create table public.sync_inbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cursor bigint generated always as identity unique,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status public.sync_event_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_by uuid references public.desktop_devices(id) on delete set null,
  claimed_at timestamptz,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint sync_inbound_event_type_format check (event_type ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  constraint sync_inbound_idempotency_length check (char_length(idempotency_key) between 1 and 160),
  constraint sync_inbound_payload_size check (octet_length(payload::text) <= 32768),
  constraint sync_inbound_attempts_nonnegative check (attempts >= 0),
  constraint sync_inbound_error_length check (error is null or char_length(error) <= 1000),
  constraint sync_inbound_processed_state check (
    (status = 'processed' and processed_at is not null) or
    (status <> 'processed' and processed_at is null)
  )
);

create table public.sync_outbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_device_id uuid not null references public.desktop_devices(id) on delete restrict,
  cursor bigint generated always as identity unique,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status public.sync_event_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint sync_outbound_event_type_format check (event_type ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  constraint sync_outbound_idempotency_length check (char_length(idempotency_key) between 1 and 160),
  constraint sync_outbound_payload_size check (octet_length(payload::text) <= 32768),
  constraint sync_outbound_attempts_nonnegative check (attempts >= 0),
  constraint sync_outbound_error_length check (error is null or char_length(error) <= 1000),
  constraint sync_outbound_processed_state check (
    (status = 'processed' and processed_at is not null) or
    (status <> 'processed' and processed_at is null)
  )
);

create index sync_inbound_claim_idx on public.sync_inbound_events (organization_id, available_at, cursor)
  where status in ('pending', 'retry');
create index sync_inbound_lease_idx on public.sync_inbound_events (organization_id, claimed_at, cursor)
  where status = 'claimed';
create index sync_outbound_pending_idx on public.sync_outbound_events (organization_id, available_at, cursor)
  where status in ('pending', 'retry');

create table public.web_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  public_id uuid not null default gen_random_uuid() unique,
  token_hash text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint web_sessions_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint web_sessions_expiry check (expires_at > created_at)
);

create table public.web_messages_public (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.web_sessions(id) on delete cascade,
  client_message_id uuid not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, client_message_id),
  constraint web_messages_body_length check (char_length(body) between 1 and 4000),
  constraint web_messages_metadata_size check (octet_length(metadata::text) <= 4096)
);

create index web_sessions_org_idx on public.web_sessions (organization_id, created_at desc);
create index web_messages_public_session_idx on public.web_messages_public (session_id, created_at);

create trigger desktop_devices_set_updated_at before update on public.desktop_devices
  for each row execute function public.set_updated_at();
create trigger sync_inbound_events_set_updated_at before update on public.sync_inbound_events
  for each row execute function public.set_updated_at();
create trigger sync_outbound_events_set_updated_at before update on public.sync_outbound_events
  for each row execute function public.set_updated_at();

-- Validates both the user's tenant membership and a non-revoked device secret.
-- The supplied token exists only for the call; only its SHA-256 digest is stored.
create or replace function public.assert_current_device(
  p_organization_id uuid,
  p_device_id uuid,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.uid() is null or not public.is_org_member(p_organization_id) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;
  if p_device_token is null or char_length(p_device_token) < 32 or char_length(p_device_token) > 512 then
    raise exception 'invalid device credential' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.desktop_devices d
    where d.id = p_device_id
      and d.organization_id = p_organization_id
      and d.revoked_at is null
      and d.token_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
  ) then
    raise exception 'device access denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.register_desktop_device(
  p_organization_id uuid,
  p_label text,
  p_device_token text
)
returns table (
  id uuid,
  organization_id uuid,
  label text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare v_device public.desktop_devices;
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_device_token is null or char_length(p_device_token) < 32 or char_length(p_device_token) > 512 then
    raise exception 'device token must be 32-512 characters' using errcode = '22023';
  end if;
  insert into public.desktop_devices (organization_id, label, token_hash, created_by)
  values (p_organization_id, trim(p_label), encode(extensions.digest(p_device_token, 'sha256'), 'hex'), auth.uid())
  returning * into v_device;
  return query select v_device.id, v_device.organization_id, v_device.label,
    v_device.revoked_at, v_device.last_seen_at, v_device.created_at;
end;
$$;

create or replace function public.revoke_desktop_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.desktop_devices d
  set revoked_at = coalesce(d.revoked_at, now())
  where d.id = p_device_id
    and public.has_org_role(d.organization_id, array['owner', 'admin']::public.app_role[]);
  if not found then raise exception 'device not found or access denied' using errcode = '42501'; end if;
end;
$$;

create or replace function public.claim_inbound_events(
  p_organization_id uuid,
  p_device_id uuid,
  p_device_token text,
  p_limit integer default 25
)
returns table (id uuid, cursor bigint, event_type text, idempotency_key text, payload jsonb, attempts integer, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  perform public.assert_current_device(p_organization_id, p_device_id, p_device_token);
  if p_limit < 1 or p_limit > 100 then raise exception 'limit must be 1-100' using errcode = '22023'; end if;
  update public.desktop_devices set last_seen_at = now() where desktop_devices.id = p_device_id;
  return query
  with candidates as (
    select e.id
    from public.sync_inbound_events e
    where e.organization_id = p_organization_id
      and ((e.status in ('pending', 'retry') and e.available_at <= now())
        or (e.status = 'claimed' and e.claimed_at < now() - interval '5 minutes'))
    order by e.cursor
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.sync_inbound_events e
    set status = 'claimed', attempts = e.attempts + 1, claimed_by = p_device_id,
        claimed_at = now(), error = null
    from candidates c
    where e.id = c.id
    returning e.id, e.cursor, e.event_type, e.idempotency_key, e.payload, e.attempts, e.created_at
  )
  select * from claimed order by cursor;
end;
$$;

create or replace function public.ack_inbound_event(
  p_organization_id uuid, p_device_id uuid, p_device_token text, p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  perform public.assert_current_device(p_organization_id, p_device_id, p_device_token);
  update public.sync_inbound_events
  set status = 'processed', processed_at = now(), error = null
  where id = p_event_id and organization_id = p_organization_id
    and status = 'claimed' and claimed_by = p_device_id;
  return found;
end;
$$;

create or replace function public.fail_inbound_event(
  p_organization_id uuid, p_device_id uuid, p_device_token text, p_event_id uuid,
  p_error text, p_retry_at timestamptz default null
)
returns public.sync_event_status
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare v_status public.sync_event_status;
begin
  perform public.assert_current_device(p_organization_id, p_device_id, p_device_token);
  if p_error is null or char_length(p_error) > 1000 then raise exception 'invalid error' using errcode = '22023'; end if;
  update public.sync_inbound_events
  set status = case when attempts >= 10 then 'dead'::public.sync_event_status else 'retry'::public.sync_event_status end,
      available_at = case when attempts >= 10 then available_at else coalesce(p_retry_at, now() + interval '30 seconds') end,
      claimed_by = null, claimed_at = null, error = p_error
  where id = p_event_id and organization_id = p_organization_id
    and status = 'claimed' and claimed_by = p_device_id
  returning status into v_status;
  if v_status is null then raise exception 'event not claimed by this device' using errcode = '42501'; end if;
  return v_status;
end;
$$;

create or replace function public.enqueue_outbound_event(
  p_organization_id uuid, p_device_id uuid, p_device_token text,
  p_event_type text, p_idempotency_key text, p_payload jsonb
)
returns table (id uuid, cursor bigint, status public.sync_event_status)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  perform public.assert_current_device(p_organization_id, p_device_id, p_device_token);
  if octet_length(p_payload::text) > 32768 then raise exception 'payload exceeds 32 KiB' using errcode = '22023'; end if;
  update public.desktop_devices set last_seen_at = now() where desktop_devices.id = p_device_id;
  return query
  insert into public.sync_outbound_events (organization_id, source_device_id, event_type, idempotency_key, payload)
  values (p_organization_id, p_device_id, p_event_type, p_idempotency_key, p_payload)
  on conflict (organization_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning sync_outbound_events.id, sync_outbound_events.cursor, sync_outbound_events.status;
end;
$$;

create or replace function public.start_public_web_session(p_store_slug text)
returns table (session_public_id uuid, session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_session public.web_sessions;
begin
  select organization_id into v_org_id from public.store_configs
    where public_slug = lower(trim(p_store_slug)) and enabled;
  if v_org_id is null then raise exception 'store unavailable' using errcode = '22023'; end if;
  insert into public.web_sessions (organization_id, token_hash)
  values (v_org_id, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning * into v_session;
  return query select v_session.public_id, v_token, v_session.expires_at;
end;
$$;

create or replace function public.submit_public_web_message(
  p_session_public_id uuid, p_session_token text, p_client_message_id uuid,
  p_body text, p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_session public.web_sessions; v_message_id uuid;
begin
  select * into v_session from public.web_sessions s
  where s.public_id = p_session_public_id and s.expires_at > now()
    and s.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
  for update;
  if v_session.id is null then raise exception 'invalid or expired session' using errcode = '42501'; end if;
  insert into public.web_messages_public (organization_id, session_id, client_message_id, body, metadata)
  values (v_session.organization_id, v_session.id, p_client_message_id, p_body, coalesce(p_metadata, '{}'::jsonb))
  on conflict (session_id, client_message_id) do update set client_message_id = excluded.client_message_id
  returning id into v_message_id;
  update public.web_sessions set last_seen_at = now() where id = v_session.id;
  insert into public.sync_inbound_events (organization_id, event_type, idempotency_key, payload)
  values (
    v_session.organization_id, 'web.message.received', 'web-message:' || v_message_id::text,
    jsonb_build_object('web_message_id', v_message_id, 'session_public_id', p_session_public_id)
  )
  on conflict (organization_id, idempotency_key) do nothing;
  return v_message_id;
end;
$$;

alter table public.desktop_devices enable row level security;
alter table public.sync_inbound_events enable row level security;
alter table public.sync_outbound_events enable row level security;
alter table public.web_sessions enable row level security;
alter table public.web_messages_public enable row level security;

-- No base-table policies: normal clients must use the scoped RPCs.
revoke all on public.desktop_devices, public.sync_inbound_events, public.sync_outbound_events,
  public.web_sessions, public.web_messages_public from anon, authenticated;
revoke all on function public.assert_current_device(uuid, uuid, text) from public;
revoke all on function public.register_desktop_device(uuid, text, text),
  public.revoke_desktop_device(uuid), public.claim_inbound_events(uuid, uuid, text, integer),
  public.ack_inbound_event(uuid, uuid, text, uuid),
  public.fail_inbound_event(uuid, uuid, text, uuid, text, timestamptz),
  public.enqueue_outbound_event(uuid, uuid, text, text, text, jsonb),
  public.start_public_web_session(text),
  public.submit_public_web_message(uuid, text, uuid, text, jsonb) from public;
grant execute on function public.register_desktop_device(uuid, text, text),
  public.revoke_desktop_device(uuid), public.claim_inbound_events(uuid, uuid, text, integer),
  public.ack_inbound_event(uuid, uuid, text, uuid),
  public.fail_inbound_event(uuid, uuid, text, uuid, text, timestamptz),
  public.enqueue_outbound_event(uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.start_public_web_session(text),
  public.submit_public_web_message(uuid, text, uuid, text, jsonb) to anon, authenticated;

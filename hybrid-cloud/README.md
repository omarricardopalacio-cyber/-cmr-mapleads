# mapleads-hybrid isolated Supabase schema

This directory is preparation for a **new, separate** Supabase project named `mapleads-hybrid`. It is not connected to the current project or its production database, and it intentionally contains no application wiring.

## Scope

Cloud holds only:

- Supabase Auth identity, profiles, organizations, and roles.
- A public storefront-safe catalog mirror (`store_configs`, `products_public`).
- Short-lived public catalog-chat envelopes (`web_sessions`, `web_messages_public`).
- Idempotent queue envelopes between the public cloud and a desktop device.

Keep local-only: WhatsApp operational/CRM history, contacts, conversations, engine commands, AI queues, flows, broadcasts, local media, media bytes, and every production integration configuration. Do not add those to this project later by convenience.

## Create the new project manually

1. In the Supabase dashboard, create a new project named `mapleads-hybrid`. Do **not** link or import the production project.
2. Configure only the Auth providers and redirect URLs required for the future authenticated operator experience. Do not enable a public sign-up flow unless the product explicitly needs it.
3. Open **SQL Editor** for the new project. Run the migrations in this exact order, each as a separate query:
   1. `supabase/migrations/001_identity.sql`
   2. `supabase/migrations/002_public_catalog.sql`
   3. `supabase/migrations/003_web_and_sync.sql`

### Current project

- Project Ref: `fedtuszkvdsbipbpchgz`
- API URL: `https://fedtuszkvdsbipbpchgz.supabase.co`
- Keep real keys only in local `hybrid-cloud/.env` (gitignored). Never put `service_role` / secret keys in the Chrome extension or browser.

If this PC cannot reach `db.<ref>.supabase.co` over IPv4, apply the three SQL files from the dashboard SQL Editor instead of `apply-migrations.mjs`.
4. Store the generated project URL and anon key only in the future application's secret/configuration store. Start from `.env.example`; it contains placeholders only.
5. Create an authenticated operator. Call `create_organization(name, slug)` while signed in to establish that operator as the organization owner.
6. An owner or admin provisions each desktop device with `register_desktop_device(organization_id, label, device_token)`. Generate the token locally with a cryptographically secure generator; retain it only in the desktop's OS secret store. The database keeps a SHA-256 hash, never the plaintext token.
7. Before exposing public chat, put a rate-limiting Edge endpoint or CDN/WAF in front of the two public RPCs. It should enforce per-IP and per-session limits, origin allowlisting, and abuse monitoring. Do not use the service-role key in a browser or desktop client.

The public browser may select only enabled storefront rows and active, published product rows. It cannot insert into any base table. Browser chat creation is limited to `start_public_web_session` and `submit_public_web_message`, which require a short-lived opaque session token and enqueue only a small inbound envelope.

## Queue contract

Names are from the cloud's perspective:

- `sync_inbound_events`: public/cloud events waiting for the desktop. The desktop calls `claim_inbound_events`, then `ack_inbound_event` or `fail_inbound_event`. Claims use `FOR UPDATE SKIP LOCKED`, lease for five minutes, and process in increasing global `cursor` order.
- `sync_outbound_events`: desktop-originated events sent through `enqueue_outbound_event`. A future trusted cloud worker/Edge endpoint may process these. Desktop clients never receive a service-role credential.

Every queue event is organization-scoped and has a unique `(organization_id, idempotency_key)`. Retrying an enqueue with the same key returns the existing outbound event; web message retries map to the same message and inbound event. Cursors are globally monotonic identity values; consumers must persist their own last successfully processed cursor and must still treat event delivery as at-least-once.

The initial schema has no cloud worker for outbound events and no app code. That is intentional.

## Secrets and data rules

Never share, commit, or place in browser code:

- `SUPABASE_SERVICE_ROLE_KEY` (server/Edge only).
- Desktop device tokens or OS-secret-store exports.
- Auth access/refresh tokens, database passwords, private API keys, or production credentials.
- Full customer/WhatsApp history, raw media, or unnecessary PII.

The anon key is designed to be public but is still project-specific configuration. RLS and the RPC grants, not secrecy of the anon key, are the authorization boundary.

## Threat model and release checklist

- [ ] **RLS/grants:** RLS is enabled on every table. Re-run the verification queries after each migration. Keep queue, device, session, and message base-table grants revoked from `anon` and `authenticated`.
- [ ] **Tenant isolation:** All authenticated operations use organization membership; device calls additionally require a matching non-revoked device ID/token pair.
- [ ] **Replay/idempotency:** Generate stable UUIDs/keys per logical action; never generate a new key merely because a network request timed out. Treat claims as at-least-once after a lease expires.
- [ ] **Device revocation:** Revoke a lost device with `revoke_desktop_device`; rotate by registering a new random token/device. A revoked device cannot claim, acknowledge, fail, or enqueue.
- [ ] **Public abuse:** The public RPCs are deliberately narrow but do not provide IP rate limits by themselves. Add Edge/CDN rate limiting, CAPTCHA/abuse controls if needed, logging, and approved origins before launch.
- [ ] **Payload limits:** Queue payloads are capped at 32 KiB; public body and metadata are capped at 4,000 characters and 4 KiB. Keep only references/envelopes, not media or CRM snapshots.
- [ ] **PII minimization:** Do not put emails, phones, IP addresses, user-agent strings, tracking IDs, auth metadata, or message transcripts into queue payloads unless specifically reviewed. `profiles` intentionally excludes those fields.
- [ ] **Retention:** Establish a scheduled, reviewed retention job before launch: expire/delete old web sessions and web messages, archive or delete processed/dead queue envelopes after the defined support window, and document the period. No deletion job is installed by these migrations.
- [ ] **Change control:** Future migrations must remain under `hybrid-cloud/`, must be reviewed independently, and must not be applied to the existing production project.

## Verification queries

Run these in the new project's SQL Editor after applying all migrations:

```sql
-- Expected: each listed table has rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles', 'organizations', 'user_roles', 'store_configs', 'products_public',
    'desktop_devices', 'sync_inbound_events', 'sync_outbound_events',
    'web_sessions', 'web_messages_public'
  )
order by tablename;

-- Expected: no anon/authenticated privileges on private base tables.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'desktop_devices', 'sync_inbound_events', 'sync_outbound_events',
    'web_sessions', 'web_messages_public'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- Expected: only the intentionally public catalog tables grant anon SELECT.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
order by table_name, privilege_type;

-- Inspect the exact security-definer RPCs and their pinned search paths.
select p.proname, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_organization', 'register_desktop_device', 'revoke_desktop_device',
    'claim_inbound_events', 'ack_inbound_event', 'fail_inbound_event',
    'enqueue_outbound_event', 'start_public_web_session', 'submit_public_web_message'
  )
order by p.proname;
```

For a functional test, sign in as the owner; create an organization, add an enabled `store_configs` row, then create a desktop device using a generated token. Use a separate anonymous client to start a web session and submit one message. Confirm exactly one `web.message.received` inbound event is claimed and acknowledged by the correct device. Repeat the same `client_message_id`; the message and queue event must not duplicate.

## Rollback

This is a new project with no production connection. The safest rollback before real data exists is to delete the `mapleads-hybrid` project in the Supabase dashboard and recreate it, or create another fresh project and rerun corrected migrations. Do not run destructive rollback SQL against the production database.

If the project has data, take an approved backup and write a reviewed, explicit rollback migration for only the affected new-project objects. Do not drop shared Auth objects or disable RLS as a shortcut.

## Validation limitation

The SQL files were reviewed for PostgreSQL/Supabase syntax and ordering, but no Supabase project, Supabase CLI login, remote resource, or production configuration was used. Before adopting them, execute the three migrations in a disposable new Supabase project and run the verification queries above.

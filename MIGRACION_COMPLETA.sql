-- ============================================================
-- MIGRACIÓN COMPLETA - CRM SUPABASE
-- Generado el: 2026-06-16T19:19:35.259Z
-- Total: 58 archivos de migración
-- ============================================================

BEGIN;


-- >>> 20260528203148_8585cedd-67ca-43eb-9fcc-2984557b5ce1.sql

-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'agent');
CREATE TYPE public.wa_session_status AS ENUM ('pending', 'connected', 'disconnected', 'error');
CREATE TYPE public.message_direction AS ENUM ('in', 'out');
CREATE TYPE public.command_status AS ENUM ('pending', 'delivered', 'acked', 'failed');

-- ============ ORGANIZATIONS ============
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- ============ USER_ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security-definer helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _org_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND org_id = _org_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND org_id = _org_id
  );
$$;

CREATE POLICY "user_roles self read" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), org_id, 'owner') OR public.has_role(auth.uid(), org_id, 'admin'));

-- Organizations policies (after has_role exists)
CREATE POLICY "orgs members read" ON public.organizations
  FOR SELECT TO authenticated USING (public.is_member(auth.uid(), id));
CREATE POLICY "orgs owner update" ON public.organizations
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), id, 'owner'));
CREATE POLICY "orgs create" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

-- ============ WA_SESSIONS ============
CREATE TABLE public.wa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Default',
  session_token TEXT NOT NULL UNIQUE,
  status public.wa_session_status NOT NULL DEFAULT 'pending',
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_sessions TO authenticated;
GRANT ALL ON public.wa_sessions TO service_role;
ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_wa_sessions_org ON public.wa_sessions(org_id);

CREATE POLICY "wa_sessions org members read" ON public.wa_sessions
  FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "wa_sessions admins write" ON public.wa_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), org_id, 'owner') OR public.has_role(auth.uid(), org_id, 'admin'))
  WITH CHECK (public.has_role(auth.uid(), org_id, 'owner') OR public.has_role(auth.uid(), org_id, 'admin'));

-- ============ CONTACTS ============
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, wa_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_contacts_org ON public.contacts(org_id);

CREATE POLICY "contacts members read" ON public.contacts FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "contacts members write" ON public.contacts FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- ============ THREADS ============
CREATE TABLE public.threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.wa_sessions(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, contact_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.threads TO authenticated;
GRANT ALL ON public.threads TO service_role;
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_threads_org_lastmsg ON public.threads(org_id, last_message_at DESC);

CREATE POLICY "threads members read" ON public.threads FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "threads members write" ON public.threads FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- ============ MESSAGES ============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction public.message_direction NOT NULL,
  text TEXT,
  media JSONB DEFAULT '{}'::jsonb,
  raw JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_thread ON public.messages(thread_id, sent_at DESC);
CREATE UNIQUE INDEX idx_messages_wa_uniq ON public.messages(thread_id, wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE POLICY "messages members read" ON public.messages FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "messages members write" ON public.messages FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- ============ ENGINE_COMMANDS ============
CREATE TABLE public.engine_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.wa_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.command_status NOT NULL DEFAULT 'pending',
  ack JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engine_commands TO authenticated;
GRANT ALL ON public.engine_commands TO service_role;
ALTER TABLE public.engine_commands ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_engine_commands_session_pending ON public.engine_commands(session_id, status, created_at);

CREATE POLICY "commands members read" ON public.engine_commands FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "commands members write" ON public.engine_commands FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- ============ EVENTS ============
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.wa_sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_events_org_created ON public.events(org_id, created_at DESC);

CREATE POLICY "events members read" ON public.events FOR SELECT TO authenticated USING (org_id IS NULL OR public.is_member(auth.uid(), org_id));

-- ============ TRIGGER: auto-profile on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ TRIGGER: updated_at on contacts ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER contacts_touch BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- <<< 20260528203148_8585cedd-67ca-43eb-9fcc-2984557b5ce1.sql


-- >>> 20260528203208_ae3a9948-c884-408e-adac-a8fbfc7cd595.sql

-- Las funciones SECURITY DEFINER se usan internamente desde políticas RLS;
-- no deben exponerse vía la Data API.
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, UUID, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member(UUID, UUID) TO service_role;

-- <<< 20260528203208_ae3a9948-c884-408e-adac-a8fbfc7cd595.sql


-- >>> 20260528203226_769c7198-1b1a-4072-93e8-a2689268025a.sql

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- <<< 20260528203226_769c7198-1b1a-4072-93e8-a2689268025a.sql


-- >>> 20260528210757_606875ee-5737-432e-a87f-d335db76586e.sql

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.engine_commands REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.engine_commands;

-- <<< 20260528210757_606875ee-5737-432e-a87f-d335db76586e.sql


-- >>> 20260528211021_52882073-76b8-4264-8600-3671e60d0fb7.sql

-- AUTO REPLIES
CREATE TABLE public.auto_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  session_id UUID,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains', -- contains|equals|starts|regex
  match_value TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  last_triggered_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_replies TO authenticated;
GRANT ALL ON public.auto_replies TO service_role;
ALTER TABLE public.auto_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_replies members read" ON public.auto_replies FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "auto_replies members write" ON public.auto_replies FOR ALL TO authenticated USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));
CREATE TRIGGER auto_replies_touch BEFORE UPDATE ON public.auto_replies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_auto_replies_org_active ON public.auto_replies(org_id, is_active);

-- BROADCASTS
CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  session_id UUID NOT NULL,
  name TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|running|done|cancelled
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  rate_per_minute INTEGER NOT NULL DEFAULT 15,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts members read" ON public.broadcasts FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "broadcasts members write" ON public.broadcasts FOR ALL TO authenticated USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));
CREATE TRIGGER broadcasts_touch BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  wa_id TEXT NOT NULL,
  contact_id UUID,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed
  command_id UUID,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "br members read" ON public.broadcast_recipients FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "br members write" ON public.broadcast_recipients FOR ALL TO authenticated USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));
CREATE INDEX idx_br_status ON public.broadcast_recipients(broadcast_id, status);

-- SCHEDULED MESSAGES
CREATE TABLE public.scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  session_id UUID NOT NULL,
  wa_id TEXT NOT NULL,
  contact_id UUID,
  text TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed|cancelled
  command_id UUID,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_messages TO authenticated;
GRANT ALL ON public.scheduled_messages TO service_role;
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sm members read" ON public.scheduled_messages FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "sm members write" ON public.scheduled_messages FOR ALL TO authenticated USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));
CREATE TRIGGER sm_touch BEFORE UPDATE ON public.scheduled_messages FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_sm_due ON public.scheduled_messages(status, send_at);

-- <<< 20260528211021_52882073-76b8-4264-8600-3671e60d0fb7.sql


-- >>> 20260528211240_17254a23-91cd-45c5-ae67-018ef10925f0.sql

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'engine-dispatch',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--289483ef-62cc-4bc6-91f6-2ef8e90b8d34.lovable.app/api/public/cron/dispatch',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGtybHdsbHd4bmFuZWtjbGh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTIzMjQsImV4cCI6MjA5NTU2ODMyNH0.-KUAPhIZWhLWCpxE7nris2YWrcANuLUWu2BioWrqNq8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- <<< 20260528211240_17254a23-91cd-45c5-ae67-018ef10925f0.sql


-- >>> 20260530032310_4a8ca747-bee4-429d-ac36-dab3e85c05a1.sql

CREATE TABLE public.ai_configs (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'lovable' CHECK (provider IN ('lovable','vertex')),
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  system_prompt text NOT NULL DEFAULT 'Eres un asistente de ventas amable y conciso. Responde en español.',
  knowledge_base text NOT NULL DEFAULT '',
  respond_to text NOT NULL DEFAULT 'all' CHECK (respond_to IN ('all','new')),
  vertex_project text,
  vertex_location text DEFAULT 'us-central1',
  vertex_model text DEFAULT 'gemini-2.5-flash',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_configs TO authenticated;
GRANT ALL ON public.ai_configs TO service_role;

ALTER TABLE public.ai_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_configs members read"
ON public.ai_configs FOR SELECT TO authenticated
USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "ai_configs members insert"
ON public.ai_configs FOR INSERT TO authenticated
WITH CHECK (public.is_member(auth.uid(), org_id));

CREATE POLICY "ai_configs members update"
ON public.ai_configs FOR UPDATE TO authenticated
USING (public.is_member(auth.uid(), org_id));

-- <<< 20260530032310_4a8ca747-bee4-429d-ac36-dab3e85c05a1.sql


-- >>> 20260530035406_08f5d5fa-28b1-4c6e-bb68-8b63254bece0.sql

ALTER TABLE public.wa_sessions ADD COLUMN IF NOT EXISTS me_wa_id text;

-- <<< 20260530035406_08f5d5fa-28b1-4c6e-bb68-8b63254bece0.sql


-- >>> 20260530040741_7d50f2bf-4b5b-48c3-a438-50b2ff781c68.sql

DELETE FROM public.messages WHERE thread_id IN (SELECT id FROM public.threads WHERE contact_id IN (SELECT id FROM public.contacts WHERE wa_id ~ '@' OR wa_id !~ '^[0-9]+$' OR wa_id = '21917838930175'));
DELETE FROM public.threads WHERE contact_id IN (SELECT id FROM public.contacts WHERE wa_id ~ '@' OR wa_id !~ '^[0-9]+$' OR wa_id = '21917838930175');
DELETE FROM public.contacts WHERE wa_id ~ '@' OR wa_id !~ '^[0-9]+$' OR wa_id = '21917838930175';

-- <<< 20260530040741_7d50f2bf-4b5b-48c3-a438-50b2ff781c68.sql


-- >>> 20260530041700_214fa3f8-cacd-4a8b-a3e4-3ba4d7dad7df.sql

DO $$
DECLARE
  rec RECORD;
  good_contact_id uuid;
  bad_thread_id uuid;
  good_thread_id uuid;
BEGIN
  FOR rec IN
    SELECT c.org_id, c.id AS bad_contact_id, c.wa_id AS bad_wa_id, c.phone, t.session_id
    FROM public.contacts c
    JOIN public.threads t ON t.contact_id = c.id AND t.org_id = c.org_id
    WHERE c.wa_id LIKE '%@lid'
      AND c.phone IS NOT NULL
      AND c.phone <> ''
  LOOP
    INSERT INTO public.contacts (org_id, wa_id, phone, display_name)
    VALUES (rec.org_id, rec.bad_wa_id, rec.phone, rec.phone)
    ON CONFLICT (org_id, wa_id)
    DO UPDATE SET
      phone = COALESCE(public.contacts.phone, EXCLUDED.phone),
      display_name = CASE
        WHEN public.contacts.display_name IS NULL OR btrim(public.contacts.display_name) = '' OR lower(public.contacts.display_name) = 'unknown'
          THEN EXCLUDED.display_name
        ELSE public.contacts.display_name
      END;

    SELECT id INTO good_contact_id
    FROM public.contacts
    WHERE org_id = rec.org_id AND phone = rec.phone
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    SELECT id INTO bad_thread_id
    FROM public.threads
    WHERE org_id = rec.org_id AND session_id = rec.session_id AND contact_id = rec.bad_contact_id
    LIMIT 1;

    IF good_contact_id IS NOT NULL AND bad_thread_id IS NOT NULL THEN
      INSERT INTO public.threads (org_id, session_id, contact_id, last_message_at, unread_count)
      VALUES (rec.org_id, rec.session_id, good_contact_id, now(), 0)
      ON CONFLICT (session_id, contact_id)
      DO NOTHING;

      SELECT id INTO good_thread_id
      FROM public.threads
      WHERE org_id = rec.org_id AND session_id = rec.session_id AND contact_id = good_contact_id
      LIMIT 1;

      IF good_thread_id IS NOT NULL AND good_thread_id <> bad_thread_id THEN
        UPDATE public.messages
        SET thread_id = good_thread_id
        WHERE thread_id = bad_thread_id;

        UPDATE public.threads
        SET last_message_at = GREATEST(COALESCE(last_message_at, now()), COALESCE((SELECT max(sent_at) FROM public.messages WHERE thread_id = good_thread_id), now()))
        WHERE id = good_thread_id;

        DELETE FROM public.threads WHERE id = bad_thread_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.contacts
  SET display_name = COALESCE(phone, regexp_replace(wa_id, '@lid$', ''))
  WHERE display_name IS NULL
     OR btrim(display_name) = ''
     OR lower(display_name) = 'unknown';
END $$;

-- <<< 20260530041700_214fa3f8-cacd-4a8b-a3e4-3ba4d7dad7df.sql


-- >>> 20260530094000_tags_notes_reminders.sql

-- ============================================================
-- CRM CONTEXT TABLES: tags, contact_tags, notes, reminders
-- ============================================================

-- 1. Tags
CREATE TABLE public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E0E0E0',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tags_org ON public.tags(org_id);

CREATE POLICY "tags members all" ON public.tags FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.tags IS 'User-defined tags to categorize contacts within an organization.';

-- 2. Contact Tags (many-to-many)
CREATE TABLE public.contact_tags (
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (contact_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_contact_tags_contact ON public.contact_tags(contact_id);
CREATE INDEX idx_contact_tags_tag ON public.contact_tags(tag_id);

CREATE POLICY "contact_tags members all" ON public.contact_tags FOR ALL TO authenticated
  USING (
    public.is_member(auth.uid(), (SELECT org_id FROM public.contacts WHERE id = contact_id))
  ) WITH CHECK (
    public.is_member(auth.uid(), (SELECT org_id FROM public.contacts WHERE id = contact_id))
  );

COMMENT ON TABLE public.contact_tags IS 'Joins contacts and tags in a many-to-many relationship.';

-- 3. Notes
CREATE TABLE public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_notes_contact ON public.notes(contact_id, created_at DESC);

CREATE POLICY "notes members all" ON public.notes FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.notes IS 'Internal notes for a contact, not visible to the customer.';

-- 4. Reminders
CREATE TABLE public.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    reminder_at TIMESTAMPTZ NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_reminders_contact ON public.reminders(contact_id, reminder_at);
CREATE INDEX idx_reminders_pending ON public.reminders(org_id, reminder_at) WHERE is_completed = false;

CREATE POLICY "reminders members all" ON public.reminders FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.reminders IS 'Scheduled reminders for agents to follow up with a contact.';

-- <<< 20260530094000_tags_notes_reminders.sql


-- >>> 20260530110000_automation_engine.sql

-- ============================================================
-- CRM AUTOMATION ENGINE: quick_replies, ai_enabled, auto_replies enrich
-- ============================================================

-- 1. Tabla para Respuestas Rápidas (Quick Replies)
CREATE TABLE public.quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shortcut TEXT NOT NULL,
    text_content TEXT NOT NULL,
    media_url TEXT,
    mime_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (org_id, shortcut)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_quick_replies_org ON public.quick_replies(org_id);

CREATE POLICY "quick_replies members all" ON public.quick_replies FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.quick_replies IS 'Shortcuts like /price that agents type in chat to send predefined messages.';

-- 2. Añadir columna a 'threads' para controlar el estado de la IA
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.threads.ai_enabled IS 'If false, the AI bot is paused for this thread.';

-- 3. Enriquecer la tabla existente 'auto_replies'
ALTER TABLE public.auto_replies
ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'keyword',
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS action_add_tags UUID[],
ADD COLUMN IF NOT EXISTS action_remove_tags UUID[],
ADD COLUMN IF NOT EXISTS action_ai_behavior TEXT DEFAULT 'no_change';

COMMENT ON COLUMN public.auto_replies.trigger_type IS 'keyword, first_message_overall, first_message_month';
COMMENT ON COLUMN public.auto_replies.media_url IS 'Optional media URL to send with the auto-reply';
COMMENT ON COLUMN public.auto_replies.mime_type IS 'MIME type of the optional media';
COMMENT ON COLUMN public.auto_replies.action_add_tags IS 'Array of tag IDs to add to the contact';
COMMENT ON COLUMN public.auto_replies.action_remove_tags IS 'Array of tag IDs to remove from the contact';
COMMENT ON COLUMN public.auto_replies.action_ai_behavior IS 'no_change, disable_ai, enable_ai';

-- <<< 20260530110000_automation_engine.sql


-- >>> 20260530120000_broadcasts_enrich.sql

-- Etapa 3: Enriquecer broadcasts con segmentación por etiquetas, multimedia y monitoreo

ALTER TABLE public.broadcasts
ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES public.tags(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS error_log TEXT;

-- Índices optimizados para alto rendimiento en despacho
CREATE INDEX IF NOT EXISTS idx_broadcasts_status_scheduled ON public.broadcasts(status, scheduled_at) WHERE status IN ('scheduled', 'running');
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON public.broadcast_recipients(status, broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_command ON public.broadcast_recipients(command_id) WHERE command_id IS NOT NULL;

-- Funciones RPC para incrementar contadores de campaña de forma atómica (desde ingest.ts)
CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(p_broadcast_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.broadcasts SET sent_count = sent_count + 1 WHERE id = p_broadcast_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_failed(p_broadcast_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.broadcasts SET failed_count = failed_count + 1 WHERE id = p_broadcast_id;
END;
$$;

-- <<< 20260530120000_broadcasts_enrich.sql


-- >>> 20260530120001_flow_engine.sql

-- Etapa 4: Motor de Flujos Automatizados (Flow Builder)

CREATE TABLE IF NOT EXISTS public.flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'tag_added', 'new_contact')),
    trigger_value TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flows for their org" ON public.flows FOR ALL USING (public.is_member(auth.uid(), org_id));

CREATE TABLE IF NOT EXISTS public.flow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('send_message', 'send_media', 'wait', 'add_tag', 'remove_tag', 'toggle_ai', 'condition_reply')),
    step_data JSONB NOT NULL DEFAULT '{}',
    parent_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    branch TEXT CHECK (branch IN ('yes', 'no')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flow_steps for their org" ON public.flow_steps FOR ALL USING (
    public.is_member(auth.uid(), (SELECT org_id FROM public.flows WHERE id = flow_id))
);

CREATE TABLE IF NOT EXISTS public.flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    current_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'wait_node', 'completed', 'cancelled')),
    next_execution_at TIMESTAMPTZ DEFAULT now(),
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (flow_id, contact_id)
);

ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flow_runs for their org" ON public.flow_runs FOR ALL USING (public.is_member(auth.uid(), org_id));

CREATE INDEX IF NOT EXISTS idx_flow_runs_next_exec ON public.flow_runs(status, next_execution_at);
CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_contact ON public.flow_runs(flow_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_flows_trigger ON public.flows(trigger_type, trigger_value, is_active);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_order ON public.flow_steps(flow_id, step_order);

-- Función RPC para eliminar paso de flujo con verificación de propiedad
CREATE OR REPLACE FUNCTION public.delete_flow_step_safe(p_step_id UUID, p_org_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_flow_id UUID;
BEGIN
  SELECT flow_id INTO v_flow_id FROM public.flow_steps WHERE id = p_step_id;
  IF v_flow_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flows WHERE id = v_flow_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.flow_steps WHERE id = p_step_id;
END;
$$;

-- <<< 20260530120001_flow_engine.sql


-- >>> 20260530150000_pipeline_and_assignment.sql

-- Etapa 5: Embudo de Ventas (Pipeline) y Asignación Multiagente

-- 1. Tabla para Etapas del Embudo (Pipeline Stages)
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E0E0E0',
    position INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage pipeline_stages for their org" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline_stages for their org"
ON pipeline_stages FOR ALL
USING (EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.org_id = pipeline_stages.org_id AND ur.user_id = auth.uid()
));

-- 2. Asociar contactos a una etapa del embudo
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;

-- 3. Asignar chats a agentes
ALTER TABLE threads
ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Semilla de etapas por defecto (solo para orgs que no tengan etapas)
INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Prospecto', '#3B82F6', 1 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 1)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Contactado', '#F59E0B', 2 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 2)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Propuesta', '#10B981', 3 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 3)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Cierre', '#8B5CF6', 4 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 4)
ON CONFLICT DO NOTHING;

-- <<< 20260530150000_pipeline_and_assignment.sql


-- >>> 20260530170000_defensive_rls_policies.sql

-- Defensivo: asegurar políticas RLS para threads y contacts (sin romper existentes)

-- Threads
DROP POLICY IF EXISTS "threads members read" ON public.threads;
CREATE POLICY "threads members read"
  ON public.threads FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

DROP POLICY IF EXISTS "threads members write" ON public.threads;
CREATE POLICY "threads members write"
  ON public.threads FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- Contacts
DROP POLICY IF EXISTS "contacts members read" ON public.contacts;
CREATE POLICY "contacts members read"
  ON public.contacts FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

DROP POLICY IF EXISTS "contacts members write" ON public.contacts;
CREATE POLICY "contacts members write"
  ON public.contacts FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- <<< 20260530170000_defensive_rls_policies.sql


-- >>> 20260530230000_multi_provider_ai.sql

-- Multi-Provider AI Agent: ai_configs enrichment + ai_actions_log audit table
-- Safe migration: uses IF NOT EXISTS for columns and CREATE TABLE IF NOT EXISTS

-- 1. Enrich ai_configs for multiple direct APIs and Vertex JSON
ALTER TABLE ai_configs
ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
ADD COLUMN IF NOT EXISTS grok_api_key TEXT,
ADD COLUMN IF NOT EXISTS vertex_service_account_json TEXT, -- Full Google Cloud service account JSON pasted here
ADD COLUMN IF NOT EXISTS selected_provider TEXT DEFAULT 'lovable'; -- 'lovable', 'openai', 'grok', 'vertex'

-- 2. Audit table for AI actions (visual transparency)
CREATE TABLE IF NOT EXISTS ai_actions_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    action_name TEXT NOT NULL, -- e.g. 'assign_tag', 'disable_ai', 'create_reminder'
    action_details TEXT NOT NULL, -- Human-readable description
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Row Level Security on ai_actions_log
ALTER TABLE ai_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ai logs for their org" ON ai_actions_log
FOR SELECT TO authenticated
USING (public.is_member(auth.uid(), org_id));

-- Optional: allow the service role / backend to insert logs
CREATE POLICY "Service can insert ai logs" ON ai_actions_log
FOR INSERT TO authenticated
WITH CHECK (public.is_member(auth.uid(), org_id));

-- <<< 20260530230000_multi_provider_ai.sql


-- >>> 20260531010000_session_telemetry_routing.sql

-- Etapa 8: Centro de Control de Sesiones Multi-Numero, Enrutamiento Inteligente y Consola de Sincronizacion

-- 1. Enriquecer wa_sessions para almacenar telemetria y reglas de negocio
ALTER TABLE wa_sessions
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS device_name TEXT,
ADD COLUMN IF NOT EXISTS battery_level INT,
ADD COLUMN IF NOT EXISTS platform TEXT, -- 'ios', 'android', 'web'
ADD COLUMN IF NOT EXISTS default_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS default_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ DEFAULT now();

-- 2. Asegurar que las consultas por session_id esten indexadas
CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id);

-- <<< 20260531010000_session_telemetry_routing.sql


-- >>> 20260531023159_44df4253-8606-4a76-96a2-1310df11fc17.sql

-- 1) wa_sessions: restrict SELECT to admin/owner (session_token is sensitive)
DROP POLICY IF EXISTS "wa_sessions org members read" ON public.wa_sessions;
CREATE POLICY "wa_sessions admins read"
  ON public.wa_sessions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), org_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), org_id, 'admin'::app_role)
  );

-- 2) events: drop NULL org_id read branch
DROP POLICY IF EXISTS "events members read" ON public.events;
CREATE POLICY "events members read"
  ON public.events FOR SELECT
  TO authenticated
  USING (org_id IS NOT NULL AND public.is_member(auth.uid(), org_id));

-- 3) pipeline_stages: restrict to authenticated role
DROP POLICY IF EXISTS "Users can manage pipeline_stages for their org" ON public.pipeline_stages;
CREATE POLICY "pipeline_stages members manage"
  ON public.pipeline_stages FOR ALL
  TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 4) Realtime authorization: only allow channel subscriptions matching an org the user belongs to.
-- Convention: clients subscribe to topics named "org:<org_id>" (or "org:<org_id>:<suffix>").
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "realtime org members can read" ON realtime.messages;
CREATE POLICY "realtime org members can read"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    public.is_member(
      auth.uid(),
      NULLIF(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );

DROP POLICY IF EXISTS "realtime org members can write" ON realtime.messages;
CREATE POLICY "realtime org members can write"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_member(
      auth.uid(),
      NULLIF(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );

-- <<< 20260531023159_44df4253-8606-4a76-96a2-1310df11fc17.sql


-- >>> 20260531100000_crm_contact_fields.sql

-- Etapa: Adición de campos CRM a la tabla contacts

ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS origin TEXT,
ADD COLUMN IF NOT EXISTS entry_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS exit_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deal_value NUMERIC(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS company TEXT,
ADD COLUMN IF NOT EXISTS position TEXT,
ADD COLUMN IF NOT EXISTS interested_products TEXT,
ADD COLUMN IF NOT EXISTS observations TEXT;

-- <<< 20260531100000_crm_contact_fields.sql


-- >>> 20260531104000_auto_replies_columns_fix.sql

-- Fix para asegurar que las columnas de auto_replies existan en instancias donde la migración anterior ya había corrido
ALTER TABLE public.auto_replies
ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'keyword',
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS action_add_tags UUID[],
ADD COLUMN IF NOT EXISTS action_remove_tags UUID[],
ADD COLUMN IF NOT EXISTS action_ai_behavior TEXT DEFAULT 'no_change';

COMMENT ON COLUMN public.auto_replies.action_add_tags IS 'Array of tag IDs to add to the contact';
COMMENT ON COLUMN public.auto_replies.action_remove_tags IS 'Array of tag IDs to remove from the contact';
COMMENT ON COLUMN public.auto_replies.action_ai_behavior IS 'no_change, disable_ai, enable_ai';

-- Refrescar la caché de PostgREST automáticamente después de la migración
NOTIFY pgrst, 'reload schema';

-- <<< 20260531104000_auto_replies_columns_fix.sql


-- >>> 20260531120000_flow_ai_configuration.sql

-- ============================================
-- MIGRACIÓN COMPLETA: Motor de Flujos + Configuración IA
-- ============================================
-- Este script crea:
-- 1. Tablas del motor de flujos (flows, flow_steps, flow_runs)
-- 2. Configuración IA en la tabla flows
-- 3. Tablas de base de conocimiento y reglas de transferencia
-- ============================================

-- ============================================
-- PARTE 1: Motor de Flujos Automatizados
-- ============================================

CREATE TABLE IF NOT EXISTS public.flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'tag_added', 'new_contact', 'manual')),
    trigger_value TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage flows for their org" ON public.flows;
CREATE POLICY "Users can manage flows for their org" ON public.flows FOR ALL USING (public.is_member(auth.uid(), org_id));

CREATE TABLE IF NOT EXISTS public.flow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('send_message', 'send_media', 'wait', 'add_tag', 'remove_tag', 'toggle_ai', 'condition_reply')),
    step_data JSONB NOT NULL DEFAULT '{}',
    parent_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    branch TEXT CHECK (branch IN ('yes', 'no')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage flow_steps for their org" ON public.flow_steps;
CREATE POLICY "Users can manage flow_steps for their org" ON public.flow_steps FOR ALL USING (
    public.is_member(auth.uid(), (SELECT org_id FROM public.flows WHERE id = flow_id))
);

CREATE TABLE IF NOT EXISTS public.flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    current_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'wait_node', 'completed', 'cancelled')),
    next_execution_at TIMESTAMPTZ DEFAULT now(),
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (flow_id, contact_id)
);

ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage flow_runs for their org" ON public.flow_runs;
CREATE POLICY "Users can manage flow_runs for their org" ON public.flow_runs FOR ALL USING (public.is_member(auth.uid(), org_id));

CREATE INDEX IF NOT EXISTS idx_flow_runs_next_exec ON public.flow_runs(status, next_execution_at);
CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_contact ON public.flow_runs(flow_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_flows_trigger ON public.flows(trigger_type, trigger_value, is_active);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_order ON public.flow_steps(flow_id, step_order);

-- Función RPC para eliminar paso de flujo con verificación de propiedad
CREATE OR REPLACE FUNCTION public.delete_flow_step_safe(p_step_id UUID, p_org_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_flow_id UUID;
BEGIN
  SELECT flow_id INTO v_flow_id FROM public.flow_steps WHERE id = p_step_id;
  IF v_flow_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flows WHERE id = v_flow_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.flow_steps WHERE id = p_step_id;
END;
$$;

-- ============================================
-- PARTE 2: Configuración IA en tabla flows
-- ============================================

-- Agregar columnas de configuración IA
ALTER TABLE public.flows
ADD COLUMN IF NOT EXISTS ai_mode TEXT DEFAULT 'none' CHECK (ai_mode IN (
    'none',                    -- Opción 1: No activar IA
    'on_completion',           -- Opción 2: IA activa al finalizar flujo
    'during_flow',             -- Opción 3: IA activa durante todo el flujo
    'on_response',             -- Opción 4: IA solo si el cliente responde
    'fallback',                -- Opción 5: IA como respaldo
    'time_limited'             -- Opción 6: IA con límite de tiempo
)),
ADD COLUMN IF NOT EXISTS ai_time_limit_minutes INT CHECK (ai_time_limit_minutes > 0),
ADD COLUMN IF NOT EXISTS ai_enabled_after_flow BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_enabled_during_flow BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_fallback_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_transfer_on_failure BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_maintain_context BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_can_access_crm BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_can_access_tags BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_knowledge_sources JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS ai_transfer_rules JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS ai_custom_system_prompt TEXT;

-- ============================================
-- PARTE 3: Tabla de Fuentes de Conocimiento
-- ============================================

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'faq',              -- Preguntas frecuentes
        'products',         -- Productos
        'services',         -- Servicios
        'catalog',          -- Catálogo
        'pdf_document',     -- Documentos PDF
        'website',          -- Sitio web
        'internal_kb',      -- Base de conocimiento interna
        'custom_prompt'     -- Prompts personalizados
    )),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage knowledge sources for their org" ON public.knowledge_sources;
CREATE POLICY "Users can manage knowledge sources for their org" ON public.knowledge_sources 
FOR ALL USING (public.is_member(auth.uid(), org_id));

-- ============================================
-- PARTE 4: Tabla de Reglas de Transferencia
-- ============================================

CREATE TABLE IF NOT EXISTS public.transfer_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    condition_type TEXT NOT NULL CHECK (condition_type IN (
        'request_human',        -- Cliente solicita hablar con persona
        'ai_no_response',       -- IA no tiene respuesta
        'purchase_intent',      -- Intención de compra detectada
        'complaint',            -- Reclamo detectado
        'support_request',      -- Solicitud de soporte
        'custom'                -- Condición personalizada
    )),
    condition_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transfer_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage transfer rules for their org" ON public.transfer_rules;
CREATE POLICY "Users can manage transfer rules for their org" ON public.transfer_rules 
FOR ALL USING (public.is_member(auth.uid(), org_id));

-- ============================================
-- PARTE 5: Índices de rendimiento
-- ============================================

CREATE INDEX IF NOT EXISTS idx_flows_ai_mode ON public.flows(ai_mode, is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org_type ON public.knowledge_sources(org_id, source_type, is_active);
CREATE INDEX IF NOT EXISTS idx_transfer_rules_org_type ON public.transfer_rules(org_id, condition_type, is_active);

-- ============================================
-- VALIDACIÓN FINAL
-- ============================================

-- Verificar tablas creadas
DO $$
BEGIN
    RAISE NOTICE '✅ Migración completada exitosamente';
    RAISE NOTICE 'Tablas creadas: flows, flow_steps, flow_runs, knowledge_sources, transfer_rules';
    RAISE NOTICE 'Configuración IA agregada a flows';
END $$;

-- <<< 20260531120000_flow_ai_configuration.sql


-- >>> 20260531150000_create_media_bucket_fixed.sql

-- Crear bucket 'media' para almacenamiento de archivos multimedia
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 52428850, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428850;

-- Eliminar políticas existentes si las hay, para evitar duplicados
DROP POLICY IF EXISTS "Media bucket is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own media" ON storage.objects;

-- Política para permitir lectura pública del bucket media
CREATE POLICY "Media bucket is publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media');

-- Política para permitir upload autenticado al bucket media
CREATE POLICY "Authenticated users can upload to media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

-- Política para permitir a los usuarios actualizar sus propios archivos
CREATE POLICY "Users can update their own media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');

-- <<< 20260531150000_create_media_bucket_fixed.sql


-- >>> 20260531200000_create_media_bucket.sql

-- Crear bucket 'media' para almacenamiento de archivos multimedia
-- Este bucket debe ser público para que las imágenes/videos se puedan visualizar

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800;

DROP POLICY IF EXISTS "Media bucket is publicly readable" ON storage.objects;
CREATE POLICY "Media bucket is publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media');

DROP POLICY IF EXISTS "Authenticated users can upload to media" ON storage.objects;
CREATE POLICY "Authenticated users can upload to media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

DROP POLICY IF EXISTS "Users can update their own media" ON storage.objects;
CREATE POLICY "Users can update their own media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media')
WITH CHECK (bucket_id = 'media');

-- <<< 20260531200000_create_media_bucket.sql


-- >>> 20260531210000_fix_ai_provider_constraint.sql

-- Fix: Update ai_configs provider CHECK constraint to include openai and grok
-- This fixes the error when saving AI config with OpenAI or Grok providers

-- Drop old constraint
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

-- Add new constraint with all 4 providers
ALTER TABLE ai_configs 
ADD CONSTRAINT ai_configs_provider_check 
CHECK (provider IN ('lovable','vertex','openai','grok'));

-- <<< 20260531210000_fix_ai_provider_constraint.sql


-- >>> 20260601000000_reconstruction_sessions_chats.sql

-- Migración de Reconstrucción, Reparación de Sesiones y Limpieza de Chats
-- Prioridad P0: Crear tablas faltantes y asegurar columnas de wa_sessions

-- 1. Tabla de Etiquetas (tags)
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E0E0E0',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (org_id, name)
);

-- 2. Tabla Pivote (contact_tags)
CREATE TABLE IF NOT EXISTS public.contact_tags (
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (contact_id, tag_id)
);

-- 3. Tabla de Notas (notes)
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabla de Recordatorios (reminders)
CREATE TABLE IF NOT EXISTS public.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    reminder_at TIMESTAMPTZ NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Tabla de Registro de Acciones de IA (ai_actions_log)
CREATE TABLE IF NOT EXISTS public.ai_actions_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    action_name TEXT NOT NULL,
    action_details TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Asegurar columnas de telemetría en wa_sessions para evitar crashes
ALTER TABLE public.wa_sessions 
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS device_name TEXT,
ADD COLUMN IF NOT EXISTS battery_level INT,
ADD COLUMN IF NOT EXISTS platform TEXT,
ADD COLUMN IF NOT EXISTS default_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS default_flow_id UUID,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ DEFAULT now();

-- <<< 20260601000000_reconstruction_sessions_chats.sql


-- >>> 20260601005851_2937582c-efe6-4866-b746-7f6eb8c69edd.sql

-- No-op: regenerar tipos para sincronizar con esquema actual
COMMENT ON TABLE public.contact_tags IS 'Tags asignados a contactos';

-- <<< 20260601005851_2937582c-efe6-4866-b746-7f6eb8c69edd.sql


-- >>> 20260602173000_contacts_profile_picture_url.sql

-- Add profile_picture_url column to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add comment to document the column
COMMENT ON COLUMN contacts.profile_picture_url IS 'URL of the contact profile picture from WhatsApp';

-- <<< 20260602173000_contacts_profile_picture_url.sql


-- >>> 20260602200000_auto_reply_steps.sql

-- ══════════════════════════════════════════════════════════════════
-- Migration: auto_reply_steps + chain_to_rule_id + storage bucket
-- ══════════════════════════════════════════════════════════════════

-- 1. Add chain_to_rule_id to auto_replies (self-referential FK)
ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS chain_to_rule_id uuid
    REFERENCES public.auto_replies(id) ON DELETE SET NULL;

-- 2. Create auto_reply_steps table
CREATE TABLE IF NOT EXISTS public.auto_reply_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id          uuid NOT NULL REFERENCES public.auto_replies(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL,
  step_order       integer NOT NULL DEFAULT 0,
  cooldown_seconds integer NOT NULL DEFAULT 0
                     CHECK (cooldown_seconds >= 0 AND cooldown_seconds <= 2592000),
  text_content     text,
  media_url        text,
  mime_type        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- At least one of text_content or media_url must be present
  CONSTRAINT step_has_content CHECK (
    text_content IS NOT NULL OR media_url IS NOT NULL
  )
);

-- 3. Enable RLS on auto_reply_steps
ALTER TABLE public.auto_reply_steps ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for auto_reply_steps (same pattern as auto_replies)
CREATE POLICY "org members can manage auto_reply_steps"
  ON public.auto_reply_steps
  FOR ALL
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 5. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_steps TO authenticated;
GRANT ALL ON public.auto_reply_steps TO service_role;

-- 6. updated_at trigger for auto_reply_steps
CREATE TRIGGER touch_auto_reply_steps
  BEFORE UPDATE ON public.auto_reply_steps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7. Index for ordered step lookup
CREATE INDEX IF NOT EXISTS idx_auto_reply_steps_rule_order
  ON public.auto_reply_steps(rule_id, step_order);

-- ══════════════════════════════════════════════════════════════════
-- Storage bucket: auto-reply-media (private)
-- ══════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('auto-reply-media', 'auto-reply-media', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: authenticated users can read their org's files
CREATE POLICY "auth users read auto-reply-media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'auto-reply-media'
    AND auth.role() = 'authenticated'
  );

-- Policy: authenticated users can insert
CREATE POLICY "auth users insert auto-reply-media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'auto-reply-media'
    AND auth.role() = 'authenticated'
  );

-- Policy: authenticated users can update their own uploads
CREATE POLICY "auth users update auto-reply-media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'auto-reply-media'
    AND auth.role() = 'authenticated'
  );

-- Policy: authenticated users can delete
CREATE POLICY "auth users delete auto-reply-media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'auto-reply-media'
    AND auth.role() = 'authenticated'
  );
ALTER TABLE public.auto_replies ALTER COLUMN reply_text DROP NOT NULL;

-- <<< 20260602200000_auto_reply_steps.sql


-- >>> 20260603000000_limit_per_contact.sql

ALTER TABLE public.auto_replies ADD COLUMN limit_per_contact INT DEFAULT NULL;

CREATE TABLE public.auto_reply_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.auto_replies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_auto_reply_triggers_lookup ON public.auto_reply_triggers(rule_id, contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_triggers TO authenticated;
GRANT ALL ON public.auto_reply_triggers TO service_role;
ALTER TABLE public.auto_reply_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_reply_triggers members read" ON public.auto_reply_triggers FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "auto_reply_triggers members write" ON public.auto_reply_triggers FOR ALL TO authenticated USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- <<< 20260603000000_limit_per_contact.sql


-- >>> 20260603100000_mapleads_phase1.sql

-- ============ MAPLEADS - FASE 1 ============
-- Tabla de tokens de ingest por usuario
CREATE TABLE IF NOT EXISTS public.lead_ingest_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_ingest_tokens TO authenticated;
GRANT ALL ON public.lead_ingest_tokens TO service_role;
ALTER TABLE public.lead_ingest_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lit own" ON public.lead_ingest_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Tabla principal de leads
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_normalized TEXT,
  address TEXT,
  city TEXT,
  zone TEXT,
  category TEXT,
  maps_category TEXT,
  website TEXT,
  email TEXT,
  rating NUMERIC(4,2),
  review_count INT,
  open_status TEXT,
  has_photos BOOLEAN,
  campaign_name TEXT,
  source TEXT DEFAULT 'mapleads',
  raw JSONB,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_sent_at TIMESTAMP WITH TIME ZONE,
  message_broadcast_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice único anti-duplicados (mismo usuario, mismo teléfono normalizado, mismo nombre)
CREATE UNIQUE INDEX IF NOT EXISTS leads_dedup_idx
  ON public.leads (user_id, phone_normalized, lower(name))
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE INDEX IF NOT EXISTS idx_leads_user_scraped ON public.leads(user_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_user_sent ON public.leads(user_id, message_sent_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads own" ON public.leads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_leads_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_leads_updated_at();

-- <<< 20260603100000_mapleads_phase1.sql


-- >>> 20260603200000_catalog_integrations.sql

-- Integración con proyecto externo de catálogo de productos
CREATE TABLE IF NOT EXISTS public.catalog_integrations (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  base_url text NOT NULL DEFAULT '',
  catalog_slug text NOT NULL DEFAULT '',
  api_token text NOT NULL DEFAULT '',
  send_media boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_integrations TO authenticated;
GRANT ALL ON public.catalog_integrations TO service_role;

ALTER TABLE public.catalog_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_integrations members read" ON public.catalog_integrations
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members insert" ON public.catalog_integrations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members update" ON public.catalog_integrations
  FOR UPDATE TO authenticated
  USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members delete" ON public.catalog_integrations
  FOR DELETE TO authenticated
  USING (public.is_member(auth.uid(), org_id));

-- <<< 20260603200000_catalog_integrations.sql


-- >>> 20260603220805_flow_engine_v2.sql

-- Ampliación de la tabla flow_runs
ALTER TABLE "public"."flow_runs" 
ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "error" text;

-- Creación de la tabla flow_templates
CREATE TABLE IF NOT EXISTS "public"."flow_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "trigger_type" text NOT NULL,
    "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("id")
);

-- RLS y Permisos para flow_templates
ALTER TABLE "public"."flow_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON "public"."flow_templates"
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (true);

GRANT SELECT ON TABLE "public"."flow_templates" TO "authenticated";
GRANT SELECT ON TABLE "public"."flow_templates" TO "anon";
GRANT ALL ON TABLE "public"."flow_templates" TO "service_role";

-- Índice para el Scheduler (para buscar rápidamente tareas pendientes)
CREATE INDEX IF NOT EXISTS "idx_flow_runs_due" ON "public"."flow_runs" USING btree ("next_execution_at") WHERE ("status" IN ('running', 'wait_node'));

-- Insertar plantillas semilla (Prospección, Venta, Postventa)
INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'prospeccion-mapleads',
    'Prospección Mapleads',
    'mapleads_new_prospect',
    '[
        {"step_type": "wait", "step_order": 1, "step_data": {"amount": 5, "unit": "minutes"}},
        {"step_type": "send_message", "step_order": 2, "step_data": {"text": "¡Hola! Vi tu negocio en Google Maps y me encantaría hablar contigo sobre cómo podemos ayudarte."}},
        {"step_type": "wait", "step_order": 3, "step_data": {"amount": 1, "unit": "days"}},
        {"step_type": "condition_reply", "step_order": 4, "step_data": {}},
        {"step_type": "add_tag", "step_order": 5, "parent_step_order": 4, "branch": "yes", "step_data": {"tag_name": "Interesado"}},
        {"step_type": "send_message", "step_order": 6, "parent_step_order": 4, "branch": "no", "step_data": {"text": "¿Pudiste ver mi mensaje anterior? Quedo atento a tus comentarios."}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'venta',
    'Venta Inicial',
    'new_contact',
    '[
        {"step_type": "send_message", "step_order": 1, "step_data": {"text": "¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte hoy?"}},
        {"step_type": "wait", "step_order": 2, "step_data": {"amount": 2, "unit": "hours"}},
        {"step_type": "toggle_ai", "step_order": 3, "step_data": {"ai_enabled": true}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'postventa',
    'Seguimiento Postventa',
    'stage_changed',
    '[
        {"step_type": "wait", "step_order": 1, "step_data": {"amount": 7, "unit": "days"}},
        {"step_type": "send_message", "step_order": 2, "step_data": {"text": "¡Hola! Esperamos que estés disfrutando tu compra. ¿Tienes alguna duda?"}},
        {"step_type": "add_tag", "step_order": 3, "step_data": {"tag_name": "Seguimiento_Completado"}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;

-- <<< 20260603220805_flow_engine_v2.sql


-- >>> 20260604010000_catalog_integrations_v2.sql

-- ============================================================
-- catalog_integrations v2
-- Agrega columnas para acceso directo a PostgREST del catálogo externo.
-- El campo api_token ya existía y ahora almacena la publishable/anon key.
-- ============================================================

-- 1. Nuevas columnas (idempotentes)
ALTER TABLE public.catalog_integrations
  ADD COLUMN IF NOT EXISTS tenants_table   text NOT NULL DEFAULT 'tenants',
  ADD COLUMN IF NOT EXISTS products_table  text NOT NULL DEFAULT 'master_products',
  ADD COLUMN IF NOT EXISTS cached_tenant_id text;

-- 2. Comentario para claridad
COMMENT ON COLUMN public.catalog_integrations.base_url
  IS 'URL del proyecto Supabase del catálogo, ej: https://xxxx.supabase.co';

COMMENT ON COLUMN public.catalog_integrations.api_token
  IS 'Publishable (anon) key del proyecto Supabase del catálogo';

COMMENT ON COLUMN public.catalog_integrations.catalog_slug
  IS 'Slug de la bodega/tenant en la plataforma de catálogo';

COMMENT ON COLUMN public.catalog_integrations.tenants_table
  IS 'Nombre de la tabla de tenants en el catálogo externo (default: tenants)';

COMMENT ON COLUMN public.catalog_integrations.products_table
  IS 'Nombre de la tabla de productos en el catálogo externo (default: master_products)';

COMMENT ON COLUMN public.catalog_integrations.cached_tenant_id
  IS 'Cache del UUID del tenant resuelto desde el slug para evitar queries extra';

-- <<< 20260604010000_catalog_integrations_v2.sql


-- >>> 20260604020000_catalog_integrations_v3.sql

-- ============================================================
-- catalog_integrations v3
-- Ajusta el esquema de integraciones de catálogo para soportar
-- la nueva versión de la UI y las tablas de productos/logs.
-- ============================================================

-- 1. Modificar tabla catalog_integrations
-- Permite múltiples integraciones por organización en lugar de una sola.
ALTER TABLE public.catalog_integrations DROP CONSTRAINT IF EXISTS catalog_integrations_pkey CASCADE;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS id uuid PRIMARY KEY DEFAULT gen_random_uuid();

-- Renombrar columnas para coincidir con el frontend (ignoramos errores si ya existen)
DO $$ 
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='enabled') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN enabled TO is_active;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='base_url') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN base_url TO supabase_url;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='catalog_slug') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN catalog_slug TO slug;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='api_token') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN api_token TO publishable_key;
  END IF;
END $$;

-- Nuevas columnas de estado y metadata
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Catálogo';
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_sync_error text;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_sync_count integer;

-- 2. Crear tabla de productos sincronizados
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.catalog_integrations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  description text,
  price numeric,
  stock numeric,
  image_url text,
  slug text,
  sku text,
  badge text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id, external_id)
);

-- Habilitar RLS para productos
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products members read" ON public.products
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

-- 3. Crear tabla de logs de sincronización
CREATE TABLE IF NOT EXISTS public.catalog_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.catalog_integrations(id) ON DELETE CASCADE,
  status text NOT NULL,
  finished_at timestamptz,
  products_synced integer DEFAULT 0,
  products_failed integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Habilitar RLS para logs
ALTER TABLE public.catalog_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_sync_logs members read" ON public.catalog_sync_logs
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

-- Recargar el caché del esquema PostgREST
NOTIFY pgrst, 'reload schema';

-- <<< 20260604020000_catalog_integrations_v3.sql


-- >>> 20260604193105_31cb6711-107f-4dc1-988f-20f6d070a2ce.sql

-- Fix missing columns that the app expects

-- 1) threads.ai_enabled (default true) — used by IA toggle and conversations list
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

-- 2) catalog_integrations.created_at — used for ordering in list view
ALTER TABLE public.catalog_integrations
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Backfill created_at from updated_at where it's the freshly-defaulted now()
UPDATE public.catalog_integrations
SET created_at = updated_at
WHERE updated_at IS NOT NULL AND created_at >= now() - interval '1 minute';

-- <<< 20260604193105_31cb6711-107f-4dc1-988f-20f6d070a2ce.sql


-- >>> 20260604200000_add_video_url_to_products.sql

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS video_url text;

-- <<< 20260604200000_add_video_url_to_products.sql


-- >>> 20260605000000_no_response_trigger.sql

-- ============================================================
-- No-Response Trigger System
-- Agrega soporte para activadores "sin respuesta del cliente"
-- en el sistema de auto-respuestas.
-- ============================================================

-- 1. Nuevas columnas en auto_replies
ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS no_response_delay_seconds int NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS no_response_ai_scope text NOT NULL DEFAULT 'always';
  -- no_response_ai_scope: 'always' | 'ai_active' | 'ai_inactive'

-- 2. Nuevas columnas de acción en auto_replies (etiqueta por no respuesta)
ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS no_response_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL;

-- 3. Tabla de control: registra qué thread tiene un seguimiento pendiente
CREATE TABLE IF NOT EXISTS public.no_response_pending (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL REFERENCES public.auto_replies(id) ON DELETE CASCADE,
  thread_id     uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  contact_id    uuid,
  session_id    uuid,
  chat_id       text,
  fires_at      timestamptz NOT NULL,
  fired_at      timestamptz,               -- NULL = pendiente, NOT NULL = ya enviado
  cancelled_at  timestamptz,               -- cancelado por respuesta del cliente
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, thread_id, fired_at)   -- evita duplicados de misma regla+thread si ya se disparó
);

ALTER TABLE public.no_response_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read no_response_pending"
  ON public.no_response_pending FOR SELECT TO authenticated
  USING (org_id = (
    SELECT org_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
  ));

-- Índice para que el worker sea rápido
CREATE INDEX IF NOT EXISTS idx_nrp_fires_at
  ON public.no_response_pending (fires_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nrp_thread
  ON public.no_response_pending (thread_id)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- 4. Activar pg_cron (ya viene incluido en Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 5. Cron job: llama al worker cada 5 minutos
-- NOTA: La URL debe apuntar a tu dominio de producción en Lovable.
-- Reemplaza <TU_DOMINIO> con el dominio real del proyecto.
-- Ejemplo: https://plan-maestro-bridge.lovable.app
SELECT cron.schedule(
  'no-response-worker',           -- nombre único del job
  '*/5 * * * *',                  -- cada 5 minutos
  $$
    SELECT net.http_post(
      url := current_setting('app.public_url') || '/api/internal/no-response-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- 6. Configurar las variables de entorno en Supabase (ejecutar manualmente una vez):
-- ALTER DATABASE postgres SET "app.public_url" = 'https://TU-DOMINIO.lovable.app';
-- ALTER DATABASE postgres SET "app.cron_secret" = 'TU_CRON_SECRET_AQUI';

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- <<< 20260605000000_no_response_trigger.sql


-- >>> 20260605023000_orders_and_purchase_intent.sql

-- ══════════════════════════════════════════════════════════════════
-- Migration: orders, order_fields + purchase_intent en threads
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla para los campos del formulario de pedidos (configurable por org)
CREATE TABLE IF NOT EXISTS public.order_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'text',
  is_required BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_fields TO authenticated;
GRANT ALL ON public.order_fields TO service_role;
ALTER TABLE public.order_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_fields members all"
  ON public.order_fields FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 2. Tabla de pedidos capturados por la IA
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending',
  form_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders members all"
  ON public.orders FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 3. Columna de intención de compra en threads
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS purchase_intent VARCHAR(32) DEFAULT 'pending';

-- 4. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders(org_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON public.orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_order_fields_org_id ON public.order_fields(org_id);

-- <<< 20260605023000_orders_and_purchase_intent.sql


-- >>> 20260605030000_fix_new_user_grants.sql

-- ══════════════════════════════════════════════════════════════════
-- Fix: Ensure all tables have correct GRANTs for authenticated role
-- This ensures new users (like "ferreteria") have access to ALL
-- features added after the original schema was created.
-- ══════════════════════════════════════════════════════════════════

-- auto_replies: ensure grants exist (may have been missed in early migrations)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_replies TO authenticated;
GRANT ALL ON public.auto_replies TO service_role;

-- auto_reply_steps
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_steps TO authenticated;
GRANT ALL ON public.auto_reply_steps TO service_role;

-- auto_reply_triggers
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_triggers TO authenticated;
GRANT ALL ON public.auto_reply_triggers TO service_role;

-- flows
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT ALL ON public.flows TO service_role;

-- flow_steps
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_steps TO authenticated;
GRANT ALL ON public.flow_steps TO service_role;

-- flow_runs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_runs TO authenticated;
GRANT ALL ON public.flow_runs TO service_role;

-- knowledge_sources
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_sources TO authenticated;
GRANT ALL ON public.knowledge_sources TO service_role;

-- transfer_rules
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transfer_rules TO authenticated;
GRANT ALL ON public.transfer_rules TO service_role;

-- orders + order_fields
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_fields TO authenticated;
GRANT ALL ON public.order_fields TO service_role;

-- broadcasts + broadcast_recipients
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;

-- tags + contact_tags
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;

-- notes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;

-- reminders
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;

-- leads (mapleads)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

-- catalog_integrations (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_integrations') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_integrations TO authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_integrations TO service_role';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- Ensure RLS policies exist for tables that may be missing them
-- ══════════════════════════════════════════════════════════════════

-- auto_replies RLS (idempotent)
ALTER TABLE public.auto_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auto_replies members all" ON public.auto_replies;
CREATE POLICY "auto_replies members all"
  ON public.auto_replies FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- flows RLS (idempotent)  
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flows members all" ON public.flows;
CREATE POLICY "flows members all"
  ON public.flows FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- broadcasts RLS (idempotent)
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broadcasts members all" ON public.broadcasts;
CREATE POLICY "broadcasts members all"
  ON public.broadcasts FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- ══════════════════════════════════════════════════════════════════
-- Add missing columns to auto_replies for new features
-- (no_response trigger, session_id, etc.)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.wa_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_response_delay_seconds INTEGER DEFAULT 900,
  ADD COLUMN IF NOT EXISTS no_response_ai_scope TEXT DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS no_response_tag_id UUID REFERENCES public.tags(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════
-- Ensure threads has all new columns
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS purchase_intent VARCHAR(32) DEFAULT 'pending';

-- ══════════════════════════════════════════════════════════════════
-- Ensure contacts has profile_picture_url column
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

DO $$
BEGIN
  RAISE NOTICE '✅ Fix grants & schema completado. Todos los usuarios nuevos tienen acceso completo.';
END $$;

-- <<< 20260605030000_fix_new_user_grants.sql


-- >>> 20260605040000_add_engine_commands_scheduled_for.sql

-- Add scheduled_for to engine_commands for delayed dispatch
ALTER TABLE public.engine_commands
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_engine_commands_session_status_scheduled_for_created_at
  ON public.engine_commands(session_id, status, scheduled_for, created_at);

-- <<< 20260605040000_add_engine_commands_scheduled_for.sql


-- >>> 20260605040001_fix_new_user_auto_org.sql

-- ══════════════════════════════════════════════════════════════════
-- Fix: Auto-provision organization for every new user
--
-- ROOT CAUSE: el trigger handle_new_user solo crea el perfil,
-- pero NO crea una organización ni asigna un user_role.
-- Esto hace que usuarios nuevos (como "ferreteria") no tengan
-- org_id y por tanto no puedan usar auto-respuestas, flujos, etc.
-- ══════════════════════════════════════════════════════════════════

-- 1. Reemplazar el trigger para que también cree org + user_role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Crear perfil
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- Crear organización personal para el nuevo usuario
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_display_name || ' CRM', NEW.id)
  RETURNING id INTO v_org_id;

  -- Asignar como owner de su propia organización
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT (user_id, org_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- El trigger ya existe, solo reemplazamos la función (arriba).
-- Si por alguna razón no existe, lo recreamos:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════
-- 2. Fix usuarios existentes que no tienen organización asignada
--    (retroactivo — aplica a "ferreteria" y cualquier otro)
-- ══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  rec RECORD;
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Buscar todos los usuarios de auth.users que NO tienen user_role
  FOR rec IN
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id
    )
  LOOP
    v_display_name := COALESCE(
      rec.raw_user_meta_data->>'display_name',
      rec.raw_user_meta_data->>'full_name',
      split_part(rec.email, '@', 1),
      rec.email
    );

    -- Asegurar que tiene perfil
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, v_display_name)
    ON CONFLICT (id) DO NOTHING;

    -- Crear organización
    INSERT INTO public.organizations (name, created_by)
    VALUES (v_display_name || ' CRM', rec.id)
    RETURNING id INTO v_org_id;

    -- Asignar como owner
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (rec.id, v_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;

    RAISE NOTICE '✅ Org creada para usuario %: org_id = %', rec.email, v_org_id;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ Fix completado: todos los usuarios tienen organización. Los nuevos registros también la recibirán automáticamente.';
END $$;

-- <<< 20260605040001_fix_new_user_auto_org.sql


-- >>> 20260605124016_08a48649-f8c3-4e8a-b27d-263734244b28.sql

-- 1) Instalar trigger en auth.users para que cada nuevo usuario tenga org+rol
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Backfill: usuarios sin user_roles -> crear org + rol owner + profile
DO $$
DECLARE
  u RECORD;
  v_org_id UUID;
  v_name TEXT;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.user_roles ur ON ur.user_id = au.id
    WHERE ur.user_id IS NULL
  LOOP
    v_name := COALESCE(
      u.raw_user_meta_data->>'display_name',
      u.raw_user_meta_data->>'full_name',
      split_part(u.email, '@', 1),
      u.email
    );
    INSERT INTO public.profiles (id, display_name)
    VALUES (u.id, v_name)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organizations (name, created_by)
    VALUES (v_name || ' CRM', u.id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (u.id, v_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;
  END LOOP;
END $$;

-- <<< 20260605124016_08a48649-f8c3-4e8a-b27d-263734244b28.sql


-- >>> 20260609100000_add_flow_runs_started_at.sql

-- Asegura que la tabla flow_runs tenga la columna started_at para los run manuales y automáticos

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();

-- <<< 20260609100000_add_flow_runs_started_at.sql


-- >>> 20260609200000_add_flows_updated_at.sql

-- Añade la columna updated_at a public.flows para mantener la compatibilidad con la aplicación

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.flows
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- <<< 20260609200000_add_flows_updated_at.sql


-- >>> 20260609300000_flow_constraints_update.sql

-- Actualiza las restricciones de tipos de trigger y step en el motor de flujos

ALTER TABLE public.flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE public.flows
  ADD CONSTRAINT flows_trigger_type_check CHECK (
    trigger_type IN (
      'keyword',
      'tag_added',
      'tag_removed',
      'new_contact',
      'manual',
      'mapleads_new_prospect',
      'mapleads_imported',
      'wa_new_message',
      'wa_first_conversation',
      'wa_customer_reply',
      'pipeline_changed',
      'stage_changed',
      'ai_enabled',
      'ai_disabled',
      'purchase_made',
      'quote_sent'
    )
  );

ALTER TABLE public.flow_steps
  DROP CONSTRAINT IF EXISTS flow_steps_step_type_check;

ALTER TABLE public.flow_steps
  ADD CONSTRAINT flow_steps_step_type_check CHECK (
    step_type IN (
      'send_message',
      'send_text',
      'send_image',
      'send_video',
      'send_document',
      'send_catalog',
      'send_product',
      'wait',
      'ai_enable',
      'ai_disable',
      'ai_transfer_human',
      'ai_change_profile',
      'add_tag',
      'tag_add',
      'remove_tag',
      'tag_remove',
      'pipeline_move',
      'note_create',
      'assign_user',
      'condition_reply',
      'if_has_tag',
      'if_not_has_tag',
      'if_bought',
      'if_replied',
      'goto_flow',
      'end_flow'
    )
  );

-- <<< 20260609300000_flow_constraints_update.sql


-- >>> 20260610000000_failed_ai_requests.sql

-- Create table for tracking failed AI requests that need automatic retry
create table if not exists public.failed_ai_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  chat_id text not null,
  session_id uuid not null,
  original_message text not null,
  error_message text,
  retry_count int not null default 0,
  max_retries int not null default 3,
  next_retry_at timestamp with time zone not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  status text not null default 'pending', -- pending, retrying, resolved, failed
  context_data jsonb,
  
  constraint retry_count_valid check (retry_count >= 0 and retry_count <= max_retries)
);

-- Add indexes for efficient querying
create index if not exists idx_failed_ai_requests_org_status on public.failed_ai_requests(org_id, status);
create index if not exists idx_failed_ai_requests_next_retry on public.failed_ai_requests(next_retry_at) where status = 'pending';
create index if not exists idx_failed_ai_requests_thread on public.failed_ai_requests(thread_id);

-- Add RLS policies
alter table public.failed_ai_requests enable row level security;

create policy "Users can only see their org requests" on public.failed_ai_requests
  for select using (
    exists (
      select 1 from public.user_roles
      where user_roles.org_id = failed_ai_requests.org_id
      and user_roles.user_id = auth.uid()
    )
  );

create policy "System can manage all retry requests" on public.failed_ai_requests
  for all using (true);

-- <<< 20260610000000_failed_ai_requests.sql


-- >>> 20260610123000_clone_new_users_to_omar_org.sql

-- Fix: New users should join the master organization of omarricardopalacio@gmail.com
-- and inherit the same shared workspace, instead of creating a separate personal org.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT ur.org_id
  INTO v_org_id
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE u.email = 'omarricardopalacio@gmail.com'
    AND ur.role IN ('owner', 'admin')
  ORDER BY CASE ur.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name, created_by)
    VALUES (NEW.email || ' CRM', NEW.id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (NEW.id, v_org_id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (NEW.id, v_org_id, 'admin')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
BEGIN
  RAISE NOTICE '✅ Fix completado: nuevos usuarios se unen a la org de omarricardopalacio@gmail.com cuando existe.';
END $$;

-- <<< 20260610123000_clone_new_users_to_omar_org.sql


-- >>> 20260611000000_add_order_logo_url_to_ai_configs.sql

-- Add an optional shared order logo URL to AI configuration
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS order_logo_url text;

-- <<< 20260611000000_add_order_logo_url_to_ai_configs.sql


-- >>> 20260612000000_orders_dedupe_unique_index.sql

-- ══════════════════════════════════════════════════════════════════
-- Migration: Deduplicación de pedidos confirmados y creación de índice único
-- ══════════════════════════════════════════════════════════════════

-- 1. Deduplicar pedidos confirmados existentes por hilo
-- Conservamos el pedido confirmado más reciente y marcamos los duplicados anteriores como 'merged'
WITH ranked_orders AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, thread_id 
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM public.orders
  WHERE status = 'confirmed' AND thread_id IS NOT NULL
)
UPDATE public.orders
SET status = 'merged'
WHERE id IN (
  SELECT id 
  FROM ranked_orders 
  WHERE rn > 1
);

-- 2. Crear el índice único parcial
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_confirmed_per_thread 
ON public.orders (org_id, thread_id) 
WHERE (status = 'confirmed' AND thread_id IS NOT NULL);

-- <<< 20260612000000_orders_dedupe_unique_index.sql


-- >>> 20260612082200_add_fallback_provider_to_ai_configs.sql

ALTER TABLE public.ai_configs ADD COLUMN IF NOT EXISTS fallback_provider text;

-- <<< 20260612082200_add_fallback_provider_to_ai_configs.sql


-- >>> 20260612165656_2f210740-283e-42b4-a541-ab04e77ab8d6.sql

-- Agregar memoria persistente de "producto en foco" a nivel de hilo
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS focused_product_id text,
  ADD COLUMN IF NOT EXISTS focused_product_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS focused_updated_at timestamptz;

-- <<< 20260612165656_2f210740-283e-42b4-a541-ab04e77ab8d6.sql


-- >>> 20260612230000_saas_admin.sql

BEGIN;

CREATE TYPE public.platform_role AS ENUM ('SUPER_ADMIN');
CREATE TYPE public.organization_status AS ENUM ('active', 'trial', 'suspended');
CREATE TYPE public.subscription_status AS ENUM ('active', 'trial', 'suspended', 'expired');

ALTER TABLE public.organizations
  ADD COLUMN status public.organization_status NOT NULL DEFAULT 'trial',
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================================
-- 3. NEW TABLES
-- ============================================================================

-- Platform Roles (separate from org roles)
CREATE TABLE public.platform_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- SaaS Plans
CREATE TABLE public.saas_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_users INTEGER NOT NULL DEFAULT 1,
  max_wa_sessions INTEGER NOT NULL DEFAULT 1,
  max_contacts INTEGER NOT NULL DEFAULT 100,
  max_campaigns INTEGER NOT NULL DEFAULT 10,
  max_automations INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Subscriptions
CREATE TABLE public.saas_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL
    REFERENCES public.saas_plans(id) ON DELETE RESTRICT,
  status public.subscription_status NOT NULL DEFAULT 'trial',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at TIMESTAMPTZ,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Audit Logs
CREATE TABLE public.saas_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Impersonations
CREATE TABLE public.saas_impersonations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Global Settings (singleton pattern)
CREATE TABLE public.global_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  platform_name TEXT NOT NULL DEFAULT 'MAPLE CRM',
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#2563eb',
  global_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ============================================================================
-- 4. HELPER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles
    WHERE user_id = _user_id
      AND role = 'SUPER_ADMIN'
  );
$$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_impersonations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- Platform Roles Policies
CREATE POLICY "platform roles self read"
ON public.platform_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "platform roles admin full"
ON public.platform_roles
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Plans Policies
CREATE POLICY "plans all read"
ON public.saas_plans
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "plans admin write"
ON public.saas_plans
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "plans admin update"
ON public.saas_plans
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "plans admin delete"
ON public.saas_plans
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- SaaS Subscriptions Policies
CREATE POLICY "subscriptions admin full"
ON public.saas_subscriptions
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Audit Logs Policies
CREATE POLICY "audit logs admin read"
ON public.saas_audit_logs
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "audit logs admin write"
ON public.saas_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Impersonations Policies
CREATE POLICY "impersonations admin full"
ON public.saas_impersonations
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- Global Settings Policies
CREATE POLICY "settings admin read"
ON public.global_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "settings admin write"
ON public.global_settings
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 6. INDICES
-- ============================================================================

CREATE INDEX saas_audit_created_idx ON public.saas_audit_logs(created_at DESC);
CREATE INDEX saas_audit_org_idx ON public.saas_audit_logs(org_id);
CREATE INDEX saas_subscriptions_status_idx ON public.saas_subscriptions(status);

-- Ensure only one active impersonation per admin
CREATE UNIQUE INDEX saas_one_active_impersonation
ON public.saas_impersonations(super_admin_id)
WHERE ended_at IS NULL;

-- ============================================================================
-- 7. ENHANCED ORGANIZATIONS POLICY
-- ============================================================================

CREATE POLICY "super admins read all organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 8. PERMISSIONS
-- ============================================================================

-- Function permissions
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;

-- Table grants
GRANT SELECT ON public.platform_roles TO authenticated;
GRANT ALL ON public.platform_roles TO service_role;

GRANT SELECT ON public.saas_plans TO authenticated;
GRANT ALL ON public.saas_plans TO service_role;

GRANT SELECT ON public.saas_subscriptions TO authenticated;
GRANT ALL ON public.saas_subscriptions TO service_role;

GRANT SELECT ON public.saas_audit_logs TO authenticated;
GRANT ALL ON public.saas_audit_logs TO service_role;

GRANT SELECT ON public.saas_impersonations TO authenticated;
GRANT ALL ON public.saas_impersonations TO service_role;

GRANT SELECT ON public.global_settings TO authenticated;
GRANT UPDATE ON public.global_settings TO authenticated;
GRANT ALL ON public.global_settings TO service_role;

-- ============================================================================
-- 9. INITIAL DATA
-- ============================================================================

-- Create singleton global_settings row
INSERT INTO public.global_settings (id)
VALUES (true)
ON CONFLICT DO NOTHING;

COMMIT;

-- <<< 20260612230000_saas_admin.sql


-- >>> 20260614000000_add_custom_ai_prompt_fields.sql

-- Migration: Add custom AI prompt fields
ALTER TABLE public.auto_replies
ADD COLUMN IF NOT EXISTS action_ai_prompt TEXT;

COMMENT ON COLUMN public.auto_replies.action_ai_prompt IS 'Custom AI instruction to inject when rule activates the AI bot.';

ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS ai_prompt_extension TEXT;

COMMENT ON COLUMN public.threads.ai_prompt_extension IS 'Custom AI instruction extension injected dynamically for this thread.';

-- <<< 20260614000000_add_custom_ai_prompt_fields.sql


-- >>> 20260614020000_saas_multitenant_phase3.sql

-- ============================================================
-- FASE 3: RLS estricto + Realtime de config global
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fase 1 y Fase 2 aplicadas
-- ============================================================

BEGIN;

-- Ensure current_org_id() and is_super_admin() overload exist (needed by this migration)
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;

-- Ensure is_super_admin() without args exists (overload used by this migration)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

DO $$
DECLARE
  private_tables text[] := ARRAY[
    'contacts',
    'threads',
    'orders',
    'notes',
    'reminders',
    'scheduled_messages',
    'broadcasts',
    'wa_sessions',
    'ai_actions_log',
    'failed_ai_requests',
    'no_response_pending',
    'events',
    'media',
    'flow_runs',
    'engine_commands',
    'catalog_integrations',
    'catalog_sync_logs',
    'products',
    'auto_reply_steps'
  ];
  v_tbl text;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'FASE 3: aplicando RLS estricto en tablas privadas...';
  RAISE NOTICE '============================================================';

  FOREACH v_tbl IN ARRAY private_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = v_tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tbl || '_tenant_isolation', v_tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I '
        'FOR ALL TO authenticated '
        'USING (org_id = public.current_org_id() OR public.is_super_admin()) '
        'WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin())',
        v_tbl || '_tenant_isolation',
        v_tbl
      );
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_tbl);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', v_tbl);
      RAISE NOTICE '✅  public.% created with tenant_isolation policy', v_tbl;
    ELSE
      RAISE NOTICE '⏭️  public.% does not exist, skipping', v_tbl;
    END IF;
  END LOOP;

  -- Tablas hijas sin org_id propio
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    EXECUTE 'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS messages_tenant_isolation ON public.messages';
    EXECUTE '
      CREATE POLICY messages_tenant_isolation ON public.messages
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.threads t
          WHERE t.id = thread_id
            AND (t.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.threads t
          WHERE t.id = thread_id
            AND (t.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated';
    EXECUTE 'GRANT ALL ON public.messages TO service_role';
    RAISE NOTICE '✅  public.messages child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contact_tags') THEN
    EXECUTE 'ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS contact_tags_tenant_isolation ON public.contact_tags';
    EXECUTE '
      CREATE POLICY contact_tags_tenant_isolation ON public.contact_tags
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated';
    EXECUTE 'GRANT ALL ON public.contact_tags TO service_role';
    RAISE NOTICE '✅  public.contact_tags child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'broadcast_recipients') THEN
    EXECUTE 'ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS broadcast_recipients_tenant_isolation ON public.broadcast_recipients';
    EXECUTE '
      CREATE POLICY broadcast_recipients_tenant_isolation ON public.broadcast_recipients
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.broadcasts b
          WHERE b.id = broadcast_id
            AND (b.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.broadcasts b
          WHERE b.id = broadcast_id
            AND (b.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated';
    EXECUTE 'GRANT ALL ON public.broadcast_recipients TO service_role';
    RAISE NOTICE '✅  public.broadcast_recipients child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'auto_reply_triggers') THEN
    EXECUTE 'ALTER TABLE public.auto_reply_triggers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS auto_reply_triggers_tenant_isolation ON public.auto_reply_triggers';
    EXECUTE '
      CREATE POLICY auto_reply_triggers_tenant_isolation ON public.auto_reply_triggers
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_triggers TO authenticated';
    EXECUTE 'GRANT ALL ON public.auto_reply_triggers TO service_role';
    RAISE NOTICE '✅  public.auto_reply_triggers child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'global' AND table_name = 'config_version') THEN
    UPDATE global.config_version
    SET version = version + 1,
        bumped_at = now()
    WHERE id = true;
  END IF;

  RAISE NOTICE '============================================================';
  RAISE NOTICE '✅  FASE 3 completada. global.config_version bump enviado.';
  RAISE NOTICE '============================================================';
END;
$$;

COMMIT;

-- <<< 20260614020000_saas_multitenant_phase3.sql


-- >>> 20260614030000_saas_multitenant_phase4.sql

-- ============================================================
-- FASE 4: SUPER_ADMIN + swap IA a global.ai_configs
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fase 1, Fase 2 y Fase 3 aplicadas
-- ============================================================

BEGIN;

DO $$
DECLARE
  _uid uuid;
  _org uuid;
  _count int;
BEGIN
  SELECT id INTO _uid
  FROM auth.users
  WHERE email = 'omarricardopalacio@gmail.com'
  LIMIT 1;

  IF _uid IS NULL THEN
    RAISE NOTICE 'User not found: omarricardopalacio@gmail.com';
    RETURN;
  END IF;

  SELECT org_id INTO _org
  FROM public.user_roles
  WHERE user_id = _uid
  ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;

  IF _org IS NULL THEN
    RAISE NOTICE 'No org_id found for user %', _uid;
    RETURN;
  END IF;

  INSERT INTO public.platform_roles (user_id, role)
  VALUES (_uid, 'SUPER_ADMIN'::public.platform_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  SELECT count(*) INTO _count FROM public.platform_roles WHERE role = 'SUPER_ADMIN';
  RAISE NOTICE 'Total super_admin rows: %', _count;
END
$$;

COMMIT;

-- <<< 20260614030000_saas_multitenant_phase4.sql


-- >>> 20260614040000_saas_multitenant_phase5.sql

-- ============================================================
-- FASE 5: Swap auto_replies / quick_replies / knowledge_sources / transfer_rules
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fases 1-4 aplicadas
-- ============================================================

BEGIN;

-- Ensure global schema exists
CREATE SCHEMA IF NOT EXISTS global;

-- Ensure global.config_version and bump function exist
CREATE TABLE IF NOT EXISTS global.config_version (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  version BIGINT NOT NULL DEFAULT 0,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO global.config_version (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE global.config_version
  SET version = version + 1,
      bumped_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_tbl text;
  v_master_org uuid := '00000000-0000-0000-0000-000000000000';
  v_org_id_is_pk boolean;
  v_col text;
  v_col_arr text[];
  v_view_cols text;
BEGIN
  FOR v_tbl IN SELECT unnest(ARRAY[
      'auto_replies',
      'auto_reply_steps',
      'quick_replies',
      'knowledge_sources',
      'transfer_rules'
    ])
  LOOP
    -- 1. Crear tabla global si no existe usando estructura public.*
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS global.%I (LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    RAISE NOTICE 'Created global.% for table structure', v_tbl;

    -- 2. Copia inicial de datos si la tabla está vacía
    EXECUTE format(
      'INSERT INTO global.%1$I SELECT * FROM public.%1$I WHERE NOT EXISTS (SELECT 1 FROM global.%1$I)'
      , v_tbl
    );

    RAISE NOTICE 'Copied data into global.%', v_tbl;

    -- 3. Limpiar org_id en global.* si existe
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name = v_tbl
        AND column_name = 'org_id'
      ) INTO v_org_id_is_pk;

    IF v_org_id_is_pk THEN
      EXECUTE format('ALTER TABLE global.%I ALTER COLUMN org_id DROP NOT NULL', v_tbl);
      EXECUTE format('UPDATE global.%I SET org_id = NULL', v_tbl);
      RAISE NOTICE 'Cleared org_id in global.%', v_tbl;
    END IF;

    -- 4. RLS
    EXECUTE format('ALTER TABLE global.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I_select ON global.%I', v_tbl || '_select', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON global.%I FOR SELECT TO authenticated USING (true)',
      v_tbl || '_select', v_tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON global.%I', v_tbl || '_write', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I_write ON global.%I FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))',
      v_tbl || '_write', v_tbl
    );

    EXECUTE format('GRANT SELECT ON global.%I TO authenticated, anon', v_tbl);
    EXECUTE format('GRANT ALL ON global.%I TO service_role', v_tbl);

    EXECUTE format('DROP TRIGGER IF EXISTS bump_on_%I ON global.%I', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE TRIGGER bump_on_%I AFTER INSERT OR UPDATE OR DELETE ON global.%I FOR EACH STATEMENT EXECUTE FUNCTION global.bump_config_version()',
      v_tbl, v_tbl
    );

    -- 5. Crear vista public.<tabla>_v si corresponde
    v_col_arr := ARRAY[]::text[];
    FOR v_col IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name = v_tbl
      ORDER BY ordinal_position
    LOOP
      IF v_col = 'org_id' THEN
        v_col_arr := v_col_arr || format('public.current_org_id() AS org_id');
      ELSE
        v_col_arr := v_col_arr || format('%I', v_col);
      END IF;
    END LOOP;

    v_view_cols := array_to_string(v_col_arr, ', ');

    EXECUTE format(
      'CREATE OR REPLACE VIEW public.%I AS SELECT %s FROM global.%I',
      v_tbl || '_v', v_view_cols, v_tbl
    );

    RAISE NOTICE 'Created public.%_v view', v_tbl;
  END LOOP;

  RAISE NOTICE 'FASE 5 migration complete';
END
$$;

COMMIT;

-- <<< 20260614040000_saas_multitenant_phase5.sql


-- >>> 20260615000000_fix_new_user_own_org_v2.sql

-- ══════════════════════════════════════════════════════════════════════════════
-- FIX v2: Cada usuario nuevo recibe su propio workspace aislado (multi-tenant)
-- Revierte la lógica de "clonar a la org de Omar" que rompe el aislamiento.
-- También agrega current_org_id() y global schema prerequisites para Fases 3-5.
-- Fecha: 2026-06-15
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restaurar trigger handle_new_user: workspace propio por usuario
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Construir display_name desde metadatos de auth
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  -- Crear perfil del usuario
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- Crear organización propia (workspace aislado)
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_display_name || ' CRM', NEW.id)
  RETURNING id INTO v_org_id;

  -- Asignar como owner de su propia organización
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT (user_id, org_id, role) DO NOTHING;

  RAISE LOG '[handle_new_user] Workspace propio creado: org_id=% para usuario=%', v_org_id, NEW.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Crear función current_org_id() requerida por RLS de Fase 3
--    Retorna el org_id del usuario autenticado actual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Crear esquema global si no existe (prerequisito Fases 3-5)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS global;

GRANT USAGE ON SCHEMA global TO authenticated, anon, service_role;

-- Tabla de versión de config global (usada por Fase 3 bump)
CREATE TABLE IF NOT EXISTS global.config_version (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  version BIGINT NOT NULL DEFAULT 1,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO global.config_version (id, version, bumped_at)
VALUES (true, 1, now())
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON global.config_version TO authenticated, anon;
GRANT ALL ON global.config_version TO service_role;

-- Función bump para triggers de config global
CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE global.config_version
  SET version = version + 1, bumped_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION global.bump_config_version() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Asegurar que is_super_admin() acepta la firma sin argumento (alias)
--    Fase 3 la llama como public.is_super_admin() sin pasar uid
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fix retroactivo: usuarios existentes que están en org de Omar
--    y no tienen org propia → crearles workspace propio si es necesario.
--    NOTA: Solo actúa en usuarios que tienen ROL 'admin' en la org de Omar.
--    Los usuarios con 'owner' ya tienen su propia org y no son tocados.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  v_omar_org UUID;
  v_new_org_id UUID;
  v_display_name TEXT;
  v_count INT := 0;
BEGIN
  -- Obtener org de Omar
  SELECT ur.org_id INTO v_omar_org
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE u.email = 'omarricardopalacio@gmail.com'
    AND ur.role = 'owner'
  LIMIT 1;

  IF v_omar_org IS NULL THEN
    RAISE NOTICE 'No se encontró la org de Omar. Saltando fix retroactivo.';
    RETURN;
  END IF;

  RAISE NOTICE 'Org de Omar detectada: %', v_omar_org;

  -- Encontrar usuarios que SOLO son admin en la org de Omar (no tienen org propia como owner)
  FOR rec IN
    SELECT DISTINCT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE ur.org_id = v_omar_org
      AND ur.role = 'admin'
      AND u.email <> 'omarricardopalacio@gmail.com'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur2
        WHERE ur2.user_id = u.id AND ur2.role = 'owner'
      )
  LOOP
    v_display_name := COALESCE(
      rec.raw_user_meta_data->>'display_name',
      rec.raw_user_meta_data->>'full_name',
      split_part(rec.email, '@', 1),
      rec.email
    );

    -- Asegurar perfil
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, v_display_name)
    ON CONFLICT (id) DO NOTHING;

    -- Crear org propia
    INSERT INTO public.organizations (name, created_by)
    VALUES (v_display_name || ' CRM', rec.id)
    RETURNING id INTO v_new_org_id;

    -- Asignar como owner
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (rec.id, v_new_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;

    v_count := v_count + 1;
    RAISE NOTICE '✅ Org propia creada para %: org_id=%', rec.email, v_new_org_id;
  END LOOP;

  RAISE NOTICE '✅ Fix retroactivo completado. % usuarios migrados a workspace propio.', v_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Asegurar permisos en todas las tablas de automatización para 'authenticated'
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'auto_replies','auto_reply_steps','quick_replies',
    'flows','flow_steps','flow_runs',
    'knowledge_sources','transfer_rules',
    'broadcasts','broadcast_recipients','scheduled_messages',
    'tags','contact_tags','notes','reminders','leads',
    'orders','order_fields'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Fix v2 completado:';
  RAISE NOTICE '   - Trigger handle_new_user restaurado (workspace propio)';
  RAISE NOTICE '   - Función current_org_id() creada';
  RAISE NOTICE '   - Schema global y config_version creados';
  RAISE NOTICE '   - is_super_admin() sin argumento añadido';
  RAISE NOTICE '   - Usuarios existentes migrados a workspace propio';
  RAISE NOTICE '   - Permisos de tablas asegurados';
  RAISE NOTICE '══════════════════════════════════════════════════════';
END $$;

-- <<< 20260615000000_fix_new_user_own_org_v2.sql


COMMIT;

-- ============================================================
-- DATOS INICIALES (SEED)
-- ============================================================

-- Global settings singleton
INSERT INTO public.global_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Storage bucket media
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800)
ON CONFLICT (id) DO NOTHING;

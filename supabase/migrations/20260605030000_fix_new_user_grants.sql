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

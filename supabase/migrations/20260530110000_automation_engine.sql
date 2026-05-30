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

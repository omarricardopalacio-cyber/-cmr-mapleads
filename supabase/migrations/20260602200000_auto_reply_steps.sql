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
  USING  (org_id IN (SELECT public.user_org_ids(auth.uid())))
  WITH CHECK (org_id IN (SELECT public.user_org_ids(auth.uid())));

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

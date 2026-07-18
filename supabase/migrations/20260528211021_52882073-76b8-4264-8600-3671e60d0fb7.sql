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
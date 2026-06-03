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

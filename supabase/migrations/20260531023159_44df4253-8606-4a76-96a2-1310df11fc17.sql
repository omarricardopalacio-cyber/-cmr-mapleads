
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

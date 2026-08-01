-- Reclamación única por evento entrante: evita doble automatización
-- (DOM+WPP, @lid/@c.us, o dos instancias serverless concurrentes).
CREATE TABLE IF NOT EXISTS public.inbound_automation_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  thread_id UUID,
  event_key TEXT NOT NULL,
  wa_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_automation_claims_event_key
  ON public.inbound_automation_claims (org_id, session_id, event_key);

CREATE INDEX IF NOT EXISTS idx_inbound_automation_claims_created_at
  ON public.inbound_automation_claims (created_at);

COMMENT ON TABLE public.inbound_automation_claims IS
  'Primer proceso que reclama un inbound ejecuta automatización; el resto solo actualiza mensaje.';

-- Cola de respuesta IA con debounce: agrupa mensajes partidos y espera
-- a que el flujo deje de ejecutar pasos (active/running) antes de responder.
CREATE TABLE IF NOT EXISTS public.ai_reply_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  chat_id TEXT NOT NULL,
  latest_text TEXT,
  dedupe_key TEXT,
  delay_after_auto_replies INTEGER NOT NULL DEFAULT 0,
  auto_replies_were_sent BOOLEAN NOT NULL DEFAULT false,
  wait_for_flow BOOLEAN NOT NULL DEFAULT true,
  generation INTEGER NOT NULL DEFAULT 1,
  respond_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  processing_at TIMESTAMPTZ
);

-- Una sola respuesta pendiente abierta por hilo
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reply_pending_one_open
  ON public.ai_reply_pending (thread_id)
  WHERE processed_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_reply_pending_due
  ON public.ai_reply_pending (respond_after)
  WHERE processed_at IS NULL AND cancelled_at IS NULL AND processing_at IS NULL;

COMMENT ON TABLE public.ai_reply_pending IS
  'Debounce de IA: varios mensajes rápidos → una respuesta; espera fin de flujo activo.';

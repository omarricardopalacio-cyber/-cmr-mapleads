-- Suscripciones Web Push para acceso PWA de la tienda
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  visitor_token TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_visitor_idx
  ON public.web_push_subscriptions (org_id, visitor_token);

ALTER TABLE public.web_sessions
  ADD COLUMN IF NOT EXISTS unread_out INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE public.web_push_subscriptions IS
  'Push del cliente web (PWA) para notificar mensajes de la tienda';

-- Vigilante de intenciones: ficha interna (columnas fijas para Excel) + reglas + config Groq propia

-- ── Ficha del contacto (silenciosa; no va al prompt de la IA vendedora) ──
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS last_intent_key TEXT,
  ADD COLUMN IF NOT EXISTS last_intent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_watcher_flow_id UUID REFERENCES public.flows(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.city IS 'Ciudad detectada por el vigilante / pedido';
COMMENT ON COLUMN public.contacts.address IS 'Dirección detectada por el vigilante / pedido';
COMMENT ON COLUMN public.contacts.neighborhood IS 'Barrio detectado por el vigilante / pedido';
COMMENT ON COLUMN public.contacts.last_intent_key IS 'Última intención asignada por el vigilante';
COMMENT ON COLUMN public.contacts.last_intent_at IS 'Cuándo el vigilante asignó la última intención';
COMMENT ON COLUMN public.contacts.last_watcher_flow_id IS 'Último flujo arrancado por el vigilante';

-- ── Config del vigilante (IA aparte; API Groq distinta de la vendedora) ──
CREATE TABLE IF NOT EXISTS public.watcher_configs (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  grok_api_key TEXT,
  model TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
  extract_profile BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.watcher_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage watcher_configs" ON public.watcher_configs;
CREATE POLICY "Members manage watcher_configs" ON public.watcher_configs
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- ── Reglas intención → flujo ──
CREATE TABLE IF NOT EXISTS public.intent_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  intent_key TEXT NOT NULL,
  description TEXT,
  -- keywords | ai | both
  match_type TEXT NOT NULL DEFAULT 'both'
    CHECK (match_type IN ('keywords', 'ai', 'both')),
  -- palabras/frases, una por línea
  keywords TEXT,
  -- message | no_response | purchase | any
  trigger_on TEXT NOT NULL DEFAULT 'message'
    CHECK (trigger_on IN ('message', 'no_response', 'purchase', 'any')),
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intent_rules_org_active
  ON public.intent_rules(org_id, is_active, priority DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_rules_org_intent_key
  ON public.intent_rules(org_id, intent_key);

ALTER TABLE public.intent_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage intent_rules" ON public.intent_rules;
CREATE POLICY "Members manage intent_rules" ON public.intent_rules
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- ── Excel / reporte de contactos con ficha ──
DROP FUNCTION IF EXISTS public.contacts_report(uuid);

CREATE OR REPLACE FUNCTION public.contacts_report(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  wa_id text,
  display_name text,
  phone text,
  updated_at timestamptz,
  message_count bigint,
  purchased boolean,
  asked_products text,
  asked_questions text,
  city text,
  address text,
  neighborhood text,
  last_intent_key text,
  last_intent_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.wa_id,
    c.display_name,
    c.phone,
    c.updated_at,
    coalesce(m.cnt, 0)::bigint AS message_count,
    coalesce(o.has_order, false) AS purchased,
    c.asked_products,
    c.asked_questions,
    c.city,
    c.address,
    c.neighborhood,
    c.last_intent_key,
    c.last_intent_at
  FROM contacts c
  LEFT JOIN (
    SELECT t.contact_id, count(msg.id) AS cnt
    FROM threads t
    JOIN messages msg ON msg.thread_id = t.id
    WHERE t.org_id = p_org_id
    GROUP BY t.contact_id
  ) m ON m.contact_id = c.id
  LEFT JOIN (
    SELECT contact_id, true AS has_order
    FROM orders
    WHERE org_id = p_org_id AND contact_id IS NOT NULL
    GROUP BY contact_id
  ) o ON o.contact_id = c.id
  WHERE c.org_id = p_org_id
  ORDER BY c.updated_at DESC
  LIMIT 2000;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_report(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.contacts_report(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

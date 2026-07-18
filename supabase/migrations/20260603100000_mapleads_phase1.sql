-- ============ MAPLEADS - FASE 1 ============
-- Tabla de tokens de ingest por usuario
CREATE TABLE IF NOT EXISTS public.lead_ingest_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_ingest_tokens TO authenticated;
GRANT ALL ON public.lead_ingest_tokens TO service_role;
ALTER TABLE public.lead_ingest_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lit own" ON public.lead_ingest_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Tabla principal de leads
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_normalized TEXT,
  address TEXT,
  city TEXT,
  zone TEXT,
  category TEXT,
  maps_category TEXT,
  website TEXT,
  email TEXT,
  rating NUMERIC(4,2),
  review_count INT,
  open_status TEXT,
  has_photos BOOLEAN,
  campaign_name TEXT,
  source TEXT DEFAULT 'mapleads',
  raw JSONB,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_sent_at TIMESTAMP WITH TIME ZONE,
  message_broadcast_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice único anti-duplicados (mismo usuario, mismo teléfono normalizado, mismo nombre)
CREATE UNIQUE INDEX IF NOT EXISTS leads_dedup_idx
  ON public.leads (user_id, phone_normalized, lower(name))
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE INDEX IF NOT EXISTS idx_leads_user_scraped ON public.leads(user_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_user_sent ON public.leads(user_id, message_sent_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads own" ON public.leads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_leads_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_leads_updated_at();

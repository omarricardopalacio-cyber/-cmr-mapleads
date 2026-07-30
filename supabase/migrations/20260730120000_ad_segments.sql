-- Segmentos de entrada (Facebook / publicidad): frase o emoticon → etiqueta en ficha/Excel

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS entry_segment TEXT,
  ADD COLUMN IF NOT EXISTS entry_phrase TEXT,
  ADD COLUMN IF NOT EXISTS entry_origin_summary TEXT,
  ADD COLUMN IF NOT EXISTS entry_segment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_segment_id UUID;

COMMENT ON COLUMN public.contacts.entry_segment IS 'Nombre del segmento de publicidad (ej. seg-bogota - zapatero)';
COMMENT ON COLUMN public.contacts.entry_phrase IS 'Frase/emoticon con la que llegó el cliente';
COMMENT ON COLUMN public.contacts.entry_origin_summary IS 'Texto para Excel: llegó por segmento X porque llegó con la frase Y';
COMMENT ON COLUMN public.contacts.entry_segment_at IS 'Cuándo se detectó el segmento de entrada';
COMMENT ON COLUMN public.contacts.entry_segment_id IS 'ID del segmento en ad_segments';

CREATE TABLE IF NOT EXISTS public.ad_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  match_phrase TEXT NOT NULL,
  -- contains | equals | starts
  match_mode TEXT NOT NULL DEFAULT 'contains'
    CHECK (match_mode IN ('contains', 'equals', 'starts')),
  flow_id UUID REFERENCES public.flows(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_segments_org_active
  ON public.ad_segments(org_id, is_active, priority DESC);

ALTER TABLE public.ad_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage ad_segments" ON public.ad_segments;
CREATE POLICY "Members manage ad_segments" ON public.ad_segments
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- FK suave a segmento (nullable; no rompe si borran el catálogo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_entry_segment_id_fkey'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_entry_segment_id_fkey
      FOREIGN KEY (entry_segment_id) REFERENCES public.ad_segments(id) ON DELETE SET NULL;
  END IF;
END $$;

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
  last_intent_at timestamptz,
  entry_segment text,
  entry_phrase text,
  entry_origin_summary text,
  entry_segment_at timestamptz
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
    c.last_intent_at,
    c.entry_segment,
    c.entry_phrase,
    c.entry_origin_summary,
    c.entry_segment_at
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

-- Observaciones e inversión publicitaria por segmento + métricas en listado

ALTER TABLE public.ad_segments
  ADD COLUMN IF NOT EXISTS observations TEXT,
  ADD COLUMN IF NOT EXISTS ad_investment NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ad_segments.observations IS 'Anotaciones internas del segmento';
COMMENT ON COLUMN public.ad_segments.ad_investment IS 'Valor invertido en publicidad para este segmento';

NOTIFY pgrst, 'reload schema';

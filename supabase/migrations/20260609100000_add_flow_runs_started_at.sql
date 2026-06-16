-- Asegura que la tabla flow_runs tenga la columna started_at para los run manuales y automáticos

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();

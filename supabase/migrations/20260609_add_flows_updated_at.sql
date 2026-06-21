-- Añade la columna updated_at a public.flows para mantener la compatibilidad con la aplicación

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.flows
  SET updated_at = created_at
  WHERE updated_at IS NULL;

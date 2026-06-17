-- Añade la columna description a public.flows si no existe
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS description TEXT;

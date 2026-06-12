-- Agregar memoria persistente de "producto en foco" a nivel de hilo
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS focused_product_id text,
  ADD COLUMN IF NOT EXISTS focused_product_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS focused_updated_at timestamptz;

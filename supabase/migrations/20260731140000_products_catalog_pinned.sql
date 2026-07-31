-- Fijar producto: el sync de catálogo no sobrescribe ficha editada en el CRM
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_pinned BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.catalog_pinned IS
  'Si true, la sincronización del catálogo externo no actualiza este producto (conserva ediciones del CRM). Los productos nuevos siguen entrando.';

CREATE INDEX IF NOT EXISTS idx_products_org_catalog_pinned
  ON public.products (org_id)
  WHERE catalog_pinned = true;

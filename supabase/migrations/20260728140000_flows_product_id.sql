-- Flujos opcionales ligados a un producto del catálogo

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS product_id UUID NULL
    REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_product_entry BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_flows_org_product
  ON public.flows(org_id, product_id)
  WHERE product_id IS NOT NULL;

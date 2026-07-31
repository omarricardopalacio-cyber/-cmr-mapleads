-- Frase activadora por producto: primer mensaje del chat → foco + flujo del producto
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS entry_trigger_phrase TEXT;

COMMENT ON COLUMN public.products.entry_trigger_phrase IS
  'Si el primer mensaje entrante del chat contiene esta frase (normalizada), se enfoca el producto y se arranca su flujo inicial sin búsqueda IA.';

CREATE INDEX IF NOT EXISTS idx_products_org_entry_trigger
  ON public.products (org_id)
  WHERE entry_trigger_phrase IS NOT NULL
    AND btrim(entry_trigger_phrase) <> ''
    AND is_active = true;

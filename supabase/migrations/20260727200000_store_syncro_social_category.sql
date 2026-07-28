-- Tienda web Syncro-like: categorías en productos + personalización social (OG)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_products_org_category
  ON public.products(org_id, category)
  WHERE is_active = true AND category IS NOT NULL;

ALTER TABLE public.store_configs
  ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#FF2D95',
  ADD COLUMN IF NOT EXISTS social_title TEXT,
  ADD COLUMN IF NOT EXISTS social_description TEXT,
  ADD COLUMN IF NOT EXISTS social_image_url TEXT;

COMMENT ON COLUMN public.products.category IS 'Categoría sincronizada desde catálogo externo (Sincro)';
COMMENT ON COLUMN public.store_configs.social_title IS 'Open Graph title al compartir el link';
COMMENT ON COLUMN public.store_configs.social_description IS 'Open Graph description';
COMMENT ON COLUMN public.store_configs.social_image_url IS 'Open Graph image URL';

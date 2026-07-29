-- Meta Pixel / CAPI, dominio, Google SEO y páginas legales de la tienda web
ALTER TABLE public.store_configs
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_capi_access_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_pixel_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_domain TEXT,
  ADD COLUMN IF NOT EXISTS google_analytics_id TEXT,
  ADD COLUMN IF NOT EXISTS google_site_verification TEXT,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS page_faq TEXT,
  ADD COLUMN IF NOT EXISTS page_terms TEXT,
  ADD COLUMN IF NOT EXISTS page_privacy TEXT,
  ADD COLUMN IF NOT EXISTS page_shipping TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS store_configs_custom_domain_uidx
  ON public.store_configs (lower(custom_domain))
  WHERE custom_domain IS NOT NULL AND length(trim(custom_domain)) > 0;

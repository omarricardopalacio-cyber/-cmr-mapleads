-- ============================================================
-- catalog_integrations v2
-- Agrega columnas para acceso directo a PostgREST del catálogo externo.
-- El campo api_token ya existía y ahora almacena la publishable/anon key.
-- ============================================================

-- 1. Nuevas columnas (idempotentes)
ALTER TABLE public.catalog_integrations
  ADD COLUMN IF NOT EXISTS tenants_table   text NOT NULL DEFAULT 'tenants',
  ADD COLUMN IF NOT EXISTS products_table  text NOT NULL DEFAULT 'master_products',
  ADD COLUMN IF NOT EXISTS cached_tenant_id text;

-- 2. Comentario para claridad
COMMENT ON COLUMN public.catalog_integrations.base_url
  IS 'URL del proyecto Supabase del catálogo, ej: https://xxxx.supabase.co';

COMMENT ON COLUMN public.catalog_integrations.api_token
  IS 'Publishable (anon) key del proyecto Supabase del catálogo';

COMMENT ON COLUMN public.catalog_integrations.catalog_slug
  IS 'Slug de la bodega/tenant en la plataforma de catálogo';

COMMENT ON COLUMN public.catalog_integrations.tenants_table
  IS 'Nombre de la tabla de tenants en el catálogo externo (default: tenants)';

COMMENT ON COLUMN public.catalog_integrations.products_table
  IS 'Nombre de la tabla de productos en el catálogo externo (default: master_products)';

COMMENT ON COLUMN public.catalog_integrations.cached_tenant_id
  IS 'Cache del UUID del tenant resuelto desde el slug para evitar queries extra';

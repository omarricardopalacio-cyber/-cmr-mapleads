-- ============================================================
-- catalog_integrations v3
-- Ajusta el esquema de integraciones de catálogo para soportar
-- la nueva versión de la UI y las tablas de productos/logs.
-- ============================================================

-- 1. Modificar tabla catalog_integrations
-- Permite múltiples integraciones por organización en lugar de una sola.
ALTER TABLE public.catalog_integrations DROP CONSTRAINT IF EXISTS catalog_integrations_pkey CASCADE;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS id uuid PRIMARY KEY DEFAULT gen_random_uuid();

-- Renombrar columnas para coincidir con el frontend (ignoramos errores si ya existen)
DO $$ 
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='enabled') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN enabled TO is_active;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='base_url') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN base_url TO supabase_url;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='catalog_slug') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN catalog_slug TO slug;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='catalog_integrations' AND column_name='api_token') THEN
    ALTER TABLE public.catalog_integrations RENAME COLUMN api_token TO publishable_key;
  END IF;
END $$;

-- Nuevas columnas de estado y metadata
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Catálogo';
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_sync_error text;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.catalog_integrations ADD COLUMN IF NOT EXISTS last_sync_count integer;

-- 2. Crear tabla de productos sincronizados
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.catalog_integrations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  description text,
  price numeric,
  stock numeric,
  image_url text,
  slug text,
  sku text,
  badge text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id, external_id)
);

-- Habilitar RLS para productos
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products members read" ON public.products
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

-- 3. Crear tabla de logs de sincronización
CREATE TABLE IF NOT EXISTS public.catalog_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.catalog_integrations(id) ON DELETE CASCADE,
  status text NOT NULL,
  finished_at timestamptz,
  products_synced integer DEFAULT 0,
  products_failed integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Habilitar RLS para logs
ALTER TABLE public.catalog_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_sync_logs members read" ON public.catalog_sync_logs
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

-- Recargar el caché del esquema PostgREST
NOTIFY pgrst, 'reload schema';

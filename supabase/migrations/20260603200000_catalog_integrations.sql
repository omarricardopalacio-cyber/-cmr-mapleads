-- Integración con proyecto externo de catálogo de productos
CREATE TABLE IF NOT EXISTS public.catalog_integrations (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  base_url text NOT NULL DEFAULT '',
  catalog_slug text NOT NULL DEFAULT '',
  api_token text NOT NULL DEFAULT '',
  send_media boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_integrations TO authenticated;
GRANT ALL ON public.catalog_integrations TO service_role;

ALTER TABLE public.catalog_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_integrations members read" ON public.catalog_integrations
  FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members insert" ON public.catalog_integrations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members update" ON public.catalog_integrations
  FOR UPDATE TO authenticated
  USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "catalog_integrations members delete" ON public.catalog_integrations
  FOR DELETE TO authenticated
  USING (public.is_member(auth.uid(), org_id));

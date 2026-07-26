-- Canal web (tienda + chat) independiente de WhatsApp Web / extensión.

-- Configuración pública de tienda por org
CREATE TABLE IF NOT EXISTS public.store_configs (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_token TEXT NOT NULL UNIQUE,
  brand_name TEXT NOT NULL DEFAULT 'Mi Tienda',
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#FF6A00',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_configs TO authenticated;
GRANT ALL ON public.store_configs TO service_role;
ALTER TABLE public.store_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_configs members read" ON public.store_configs
  FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "store_configs admins write" ON public.store_configs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), org_id, 'owner') OR public.has_role(auth.uid(), org_id, 'admin'))
  WITH CHECK (public.has_role(auth.uid(), org_id, 'owner') OR public.has_role(auth.uid(), org_id, 'admin'));

-- Sesiones de visitante web
CREATE TABLE IF NOT EXISTS public.web_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  visitor_token TEXT NOT NULL UNIQUE,
  display_name TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_sessions TO authenticated;
GRANT ALL ON public.web_sessions TO service_role;
ALTER TABLE public.web_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_web_sessions_org ON public.web_sessions(org_id);
CREATE POLICY "web_sessions members read" ON public.web_sessions
  FOR SELECT TO authenticated USING (public.is_member(auth.uid(), org_id));
CREATE POLICY "web_sessions members write" ON public.web_sessions
  FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

-- Contactos web
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS web_visitor_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_web_visitor
  ON public.contacts(org_id, web_visitor_id)
  WHERE web_visitor_id IS NOT NULL;

-- Threads: canal + sesión web; session_id WA opcional
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS web_session_id UUID REFERENCES public.web_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.threads ALTER COLUMN session_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_threads_channel ON public.threads(org_id, channel, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_web_session ON public.threads(web_session_id)
  WHERE web_session_id IS NOT NULL;

COMMENT ON COLUMN public.threads.channel IS 'whatsapp | web';
COMMENT ON TABLE public.store_configs IS 'Token y branding de la tienda pública (catálogo + chat web)';

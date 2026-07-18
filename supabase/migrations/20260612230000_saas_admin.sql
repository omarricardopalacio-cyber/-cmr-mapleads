BEGIN;

CREATE TYPE public.platform_role AS ENUM ('SUPER_ADMIN');
CREATE TYPE public.organization_status AS ENUM ('active', 'trial', 'suspended');
CREATE TYPE public.subscription_status AS ENUM ('active', 'trial', 'suspended', 'expired');

ALTER TABLE public.organizations
  ADD COLUMN status public.organization_status NOT NULL DEFAULT 'trial',
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================================
-- 3. NEW TABLES
-- ============================================================================

-- Platform Roles (separate from org roles)
CREATE TABLE public.platform_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- SaaS Plans
CREATE TABLE public.saas_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_users INTEGER NOT NULL DEFAULT 1,
  max_wa_sessions INTEGER NOT NULL DEFAULT 1,
  max_contacts INTEGER NOT NULL DEFAULT 100,
  max_campaigns INTEGER NOT NULL DEFAULT 10,
  max_automations INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Subscriptions
CREATE TABLE public.saas_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL
    REFERENCES public.saas_plans(id) ON DELETE RESTRICT,
  status public.subscription_status NOT NULL DEFAULT 'trial',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at TIMESTAMPTZ,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Audit Logs
CREATE TABLE public.saas_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SaaS Impersonations
CREATE TABLE public.saas_impersonations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Global Settings (singleton pattern)
CREATE TABLE public.global_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  platform_name TEXT NOT NULL DEFAULT 'MAPLE CRM',
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#2563eb',
  global_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ============================================================================
-- 4. HELPER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles
    WHERE user_id = _user_id
      AND role = 'SUPER_ADMIN'
  );
$$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_impersonations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- Platform Roles Policies
CREATE POLICY "platform roles self read"
ON public.platform_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "platform roles admin full"
ON public.platform_roles
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Plans Policies
CREATE POLICY "plans all read"
ON public.saas_plans
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "plans admin write"
ON public.saas_plans
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "plans admin update"
ON public.saas_plans
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "plans admin delete"
ON public.saas_plans
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- SaaS Subscriptions Policies
CREATE POLICY "subscriptions admin full"
ON public.saas_subscriptions
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Audit Logs Policies
CREATE POLICY "audit logs admin read"
ON public.saas_audit_logs
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "audit logs admin write"
ON public.saas_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

-- SaaS Impersonations Policies
CREATE POLICY "impersonations admin full"
ON public.saas_impersonations
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- Global Settings Policies
CREATE POLICY "settings admin read"
ON public.global_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "settings admin write"
ON public.global_settings
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 6. INDICES
-- ============================================================================

CREATE INDEX saas_audit_created_idx ON public.saas_audit_logs(created_at DESC);
CREATE INDEX saas_audit_org_idx ON public.saas_audit_logs(org_id);
CREATE INDEX saas_subscriptions_status_idx ON public.saas_subscriptions(status);

-- Ensure only one active impersonation per admin
CREATE UNIQUE INDEX saas_one_active_impersonation
ON public.saas_impersonations(super_admin_id)
WHERE ended_at IS NULL;

-- ============================================================================
-- 7. ENHANCED ORGANIZATIONS POLICY
-- ============================================================================

CREATE POLICY "super admins read all organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 8. PERMISSIONS
-- ============================================================================

-- Function permissions
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;

-- Table grants
GRANT SELECT ON public.platform_roles TO authenticated;
GRANT ALL ON public.platform_roles TO service_role;

GRANT SELECT ON public.saas_plans TO authenticated;
GRANT ALL ON public.saas_plans TO service_role;

GRANT SELECT ON public.saas_subscriptions TO authenticated;
GRANT ALL ON public.saas_subscriptions TO service_role;

GRANT SELECT ON public.saas_audit_logs TO authenticated;
GRANT ALL ON public.saas_audit_logs TO service_role;

GRANT SELECT ON public.saas_impersonations TO authenticated;
GRANT ALL ON public.saas_impersonations TO service_role;

GRANT SELECT ON public.global_settings TO authenticated;
GRANT UPDATE ON public.global_settings TO authenticated;
GRANT ALL ON public.global_settings TO service_role;

-- ============================================================================
-- 9. INITIAL DATA
-- ============================================================================

-- Create singleton global_settings row
INSERT INTO public.global_settings (id)
VALUES (true)
ON CONFLICT DO NOTHING;

COMMIT;

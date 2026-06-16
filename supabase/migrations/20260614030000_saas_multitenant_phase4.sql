-- ============================================================
-- FASE 4: SUPER_ADMIN + swap IA a global.ai_configs
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fase 1, Fase 2 y Fase 3 aplicadas
-- ============================================================

BEGIN;

DO $$
DECLARE
  _uid uuid;
  _org uuid;
  _count int;
BEGIN
  SELECT id INTO _uid
  FROM auth.users
  WHERE email = 'omarricardopalacio@gmail.com'
  LIMIT 1;

  IF _uid IS NULL THEN
    RAISE NOTICE 'User not found: omarricardopalacio@gmail.com';
    RETURN;
  END IF;

  SELECT org_id INTO _org
  FROM public.user_roles
  WHERE user_id = _uid
  ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;

  IF _org IS NULL THEN
    RAISE NOTICE 'No org_id found for user %', _uid;
    RETURN;
  END IF;

  INSERT INTO public.platform_roles (user_id, role)
  VALUES (_uid, 'SUPER_ADMIN'::public.platform_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  SELECT count(*) INTO _count FROM public.platform_roles WHERE role = 'SUPER_ADMIN';
  RAISE NOTICE 'Total super_admin rows: %', _count;
END
$$;

COMMIT;

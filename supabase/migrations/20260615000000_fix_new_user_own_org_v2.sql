-- ══════════════════════════════════════════════════════════════════════════════
-- FIX v2: Cada usuario nuevo recibe su propio workspace aislado (multi-tenant)
-- Revierte la lógica de "clonar a la org de Omar" que rompe el aislamiento.
-- También agrega current_org_id() y global schema prerequisites para Fases 3-5.
-- Fecha: 2026-06-15
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restaurar trigger handle_new_user: workspace propio por usuario
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Construir display_name desde metadatos de auth
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  -- Crear perfil del usuario
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- Crear organización propia (workspace aislado)
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_display_name || ' CRM', NEW.id)
  RETURNING id INTO v_org_id;

  -- Asignar como owner de su propia organización
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT (user_id, org_id, role) DO NOTHING;

  RAISE LOG '[handle_new_user] Workspace propio creado: org_id=% para usuario=%', v_org_id, NEW.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Crear función current_org_id() requerida por RLS de Fase 3
--    Retorna el org_id del usuario autenticado actual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Crear esquema global si no existe (prerequisito Fases 3-5)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS global;

GRANT USAGE ON SCHEMA global TO authenticated, anon, service_role;

-- Tabla de versión de config global (usada por Fase 3 bump)
CREATE TABLE IF NOT EXISTS global.config_version (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  version BIGINT NOT NULL DEFAULT 1,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO global.config_version (id, version, bumped_at)
VALUES (true, 1, now())
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON global.config_version TO authenticated, anon;
GRANT ALL ON global.config_version TO service_role;

-- Función bump para triggers de config global
CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE global.config_version
  SET version = version + 1, bumped_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION global.bump_config_version() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Asegurar que is_super_admin() acepta la firma sin argumento (alias)
--    Fase 3 la llama como public.is_super_admin() sin pasar uid
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fix retroactivo: usuarios existentes que están en org de Omar
--    y no tienen org propia → crearles workspace propio si es necesario.
--    NOTA: Solo actúa en usuarios que tienen ROL 'admin' en la org de Omar.
--    Los usuarios con 'owner' ya tienen su propia org y no son tocados.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  v_omar_org UUID;
  v_new_org_id UUID;
  v_display_name TEXT;
  v_count INT := 0;
BEGIN
  -- Obtener org de Omar
  SELECT ur.org_id INTO v_omar_org
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE u.email = 'omarricardopalacio@gmail.com'
    AND ur.role = 'owner'
  LIMIT 1;

  IF v_omar_org IS NULL THEN
    RAISE NOTICE 'No se encontró la org de Omar. Saltando fix retroactivo.';
    RETURN;
  END IF;

  RAISE NOTICE 'Org de Omar detectada: %', v_omar_org;

  -- Encontrar usuarios que SOLO son admin en la org de Omar (no tienen org propia como owner)
  FOR rec IN
    SELECT DISTINCT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE ur.org_id = v_omar_org
      AND ur.role = 'admin'
      AND u.email <> 'omarricardopalacio@gmail.com'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur2
        WHERE ur2.user_id = u.id AND ur2.role = 'owner'
      )
  LOOP
    v_display_name := COALESCE(
      rec.raw_user_meta_data->>'display_name',
      rec.raw_user_meta_data->>'full_name',
      split_part(rec.email, '@', 1),
      rec.email
    );

    -- Asegurar perfil
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, v_display_name)
    ON CONFLICT (id) DO NOTHING;

    -- Crear org propia
    INSERT INTO public.organizations (name, created_by)
    VALUES (v_display_name || ' CRM', rec.id)
    RETURNING id INTO v_new_org_id;

    -- Asignar como owner
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (rec.id, v_new_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;

    v_count := v_count + 1;
    RAISE NOTICE '✅ Org propia creada para %: org_id=%', rec.email, v_new_org_id;
  END LOOP;

  RAISE NOTICE '✅ Fix retroactivo completado. % usuarios migrados a workspace propio.', v_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Asegurar permisos en todas las tablas de automatización para 'authenticated'
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'auto_replies','auto_reply_steps','quick_replies',
    'flows','flow_steps','flow_runs',
    'knowledge_sources','transfer_rules',
    'broadcasts','broadcast_recipients','scheduled_messages',
    'tags','contact_tags','notes','reminders','leads',
    'orders','order_fields'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Fix v2 completado:';
  RAISE NOTICE '   - Trigger handle_new_user restaurado (workspace propio)';
  RAISE NOTICE '   - Función current_org_id() creada';
  RAISE NOTICE '   - Schema global y config_version creados';
  RAISE NOTICE '   - is_super_admin() sin argumento añadido';
  RAISE NOTICE '   - Usuarios existentes migrados a workspace propio';
  RAISE NOTICE '   - Permisos de tablas asegurados';
  RAISE NOTICE '══════════════════════════════════════════════════════';
END $$;

-- ============================================================
-- FASE 1: FUNDACIÓN MULTI-TENANT
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- INSTRUCCIONES: Ejecutar completo en SQL Editor de Supabase
--                (Dashboard > SQL Editor > New query > Paste > Run)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SCHEMA GLOBAL
--    Contendrá configuración compartida entre todos los tenants.
--    Solo SUPER_ADMIN puede escribir; todos leen vía vistas.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS global;

-- Versión de configuración (singleton bump counter)
-- El cliente escucha esta tabla para invalidar caché global.
CREATE TABLE IF NOT EXISTS global.config_version (
  id       BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  version  BIGINT  NOT NULL DEFAULT 1,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insertar fila singleton si no existe
INSERT INTO global.config_version (id, version, bumped_at)
VALUES (true, 1, now())
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. FUNCIÓN: bump_config_version
--    Trigger genérico para cualquier tabla en global.*
--    Llama a esto con: AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW
-- ============================================================

CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = global, public
AS $$
BEGIN
  UPDATE global.config_version
  SET version   = version + 1,
      bumped_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

-- ============================================================
-- 3. FUNCIÓN: public.current_org_id()
--    Devuelve el org_id del usuario autenticado actual.
--    Usada en políticas RLS de las tablas privadas (Fase 5).
-- ============================================================

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
  LIMIT 1;
$$;

-- ============================================================
-- 4. FUNCIÓN: public.is_super_admin() (sin parámetro)
--    Complementa a la versión con parámetro uuid que ya existe.
--    Chequea el auth.uid() actual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles
    WHERE user_id = auth.uid()
      AND role = 'SUPER_ADMIN'
  );
$$;

-- ============================================================
-- 5. TRIGGER handle_new_user() — REESCRITURA
--    Cada nuevo signup en auth.users crea su PROPIA organización.
--    Nunca más une a la org maestra.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_org_name TEXT;
BEGIN
  -- Generar nombre de workspace desde el email (antes del @)
  v_org_name := COALESCE(
    split_part(NEW.email, '@', 1),
    'Mi Workspace'
  ) || ' Workspace';

  -- Crear la organización propia del nuevo usuario
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_org_name, NEW.id)
  RETURNING id INTO v_org_id;

  -- Asignar rol owner en su propia org
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT DO NOTHING;

  -- Crear perfil si la tabla existe
  BEGIN
    INSERT INTO public.profiles (id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN undefined_table THEN
    -- profiles no existe, ignorar
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Asociar (o re-asociar) el trigger al evento de signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 6. ASIGNAR SUPER_ADMIN AL USUARIO MAESTRO
--    Reemplaza omarricardopalacio@gmail.com si aplica.
--    Usa ON CONFLICT para ser idempotente.
-- ============================================================

INSERT INTO public.platform_roles (user_id, role)
SELECT id, 'SUPER_ADMIN'
FROM auth.users
WHERE email = 'omarricardopalacio@gmail.com'
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================================
-- 7. GRANTS SOBRE global.*
-- ============================================================

-- Permitir que el backend lea el schema global
GRANT USAGE ON SCHEMA global TO authenticated, anon, service_role;

-- config_version: todos pueden leer (para el realtime poll)
GRANT SELECT ON global.config_version TO authenticated, anon;
GRANT ALL    ON global.config_version TO service_role;

-- Permisos sobre la función bump
REVOKE ALL ON FUNCTION global.bump_config_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION global.bump_config_version() TO service_role;

-- Permisos sobre las funciones públicas nuevas
REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- ============================================================
-- 8. VERIFICACIÓN (opcional, no falla si retorna vacío)
-- ============================================================

-- Puedes ejecutar estas líneas por separado para confirmar:
-- SELECT * FROM global.config_version;
-- SELECT u.email, pr.role FROM auth.users u JOIN public.platform_roles pr ON pr.user_id = u.id;
-- SELECT public.is_super_admin();   -- ejecutar como el usuario master

COMMIT;

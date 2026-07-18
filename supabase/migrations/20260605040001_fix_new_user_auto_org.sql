-- ══════════════════════════════════════════════════════════════════
-- Fix: Auto-provision organization for every new user
--
-- ROOT CAUSE: el trigger handle_new_user solo crea el perfil,
-- pero NO crea una organización ni asigna un user_role.
-- Esto hace que usuarios nuevos (como "ferreteria") no tengan
-- org_id y por tanto no puedan usar auto-respuestas, flujos, etc.
-- ══════════════════════════════════════════════════════════════════

-- 1. Reemplazar el trigger para que también cree org + user_role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Crear perfil
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- Crear organización personal para el nuevo usuario
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_display_name || ' CRM', NEW.id)
  RETURNING id INTO v_org_id;

  -- Asignar como owner de su propia organización
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT (user_id, org_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- El trigger ya existe, solo reemplazamos la función (arriba).
-- Si por alguna razón no existe, lo recreamos:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════
-- 2. Fix usuarios existentes que no tienen organización asignada
--    (retroactivo — aplica a "ferreteria" y cualquier otro)
-- ══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  rec RECORD;
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  -- Buscar todos los usuarios de auth.users que NO tienen user_role
  FOR rec IN
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id
    )
  LOOP
    v_display_name := COALESCE(
      rec.raw_user_meta_data->>'display_name',
      rec.raw_user_meta_data->>'full_name',
      split_part(rec.email, '@', 1),
      rec.email
    );

    -- Asegurar que tiene perfil
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, v_display_name)
    ON CONFLICT (id) DO NOTHING;

    -- Crear organización
    INSERT INTO public.organizations (name, created_by)
    VALUES (v_display_name || ' CRM', rec.id)
    RETURNING id INTO v_org_id;

    -- Asignar como owner
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (rec.id, v_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;

    RAISE NOTICE '✅ Org creada para usuario %: org_id = %', rec.email, v_org_id;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ Fix completado: todos los usuarios tienen organización. Los nuevos registros también la recibirán automáticamente.';
END $$;

-- Fix: New users should join the master organization of omarricardopalacio@gmail.com
-- and inherit the same shared workspace, instead of creating a separate personal org.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email
  );

  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT ur.org_id
  INTO v_org_id
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE u.email = 'omarricardopalacio@gmail.com'
    AND ur.role IN ('owner', 'admin')
  ORDER BY CASE ur.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name, created_by)
    VALUES (NEW.email || ' CRM', NEW.id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (NEW.id, v_org_id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (NEW.id, v_org_id, 'admin')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
BEGIN
  RAISE NOTICE '✅ Fix completado: nuevos usuarios se unen a la org de omarricardopalacio@gmail.com cuando existe.';
END $$;

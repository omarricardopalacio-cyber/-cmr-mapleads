
-- 1) Instalar trigger en auth.users para que cada nuevo usuario tenga org+rol
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Backfill: usuarios sin user_roles -> crear org + rol owner + profile
DO $$
DECLARE
  u RECORD;
  v_org_id UUID;
  v_name TEXT;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.user_roles ur ON ur.user_id = au.id
    WHERE ur.user_id IS NULL
  LOOP
    v_name := COALESCE(
      u.raw_user_meta_data->>'display_name',
      u.raw_user_meta_data->>'full_name',
      split_part(u.email, '@', 1),
      u.email
    );
    INSERT INTO public.profiles (id, display_name)
    VALUES (u.id, v_name)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organizations (name, created_by)
    VALUES (v_name || ' CRM', u.id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (u.id, v_org_id, 'owner')
    ON CONFLICT (user_id, org_id, role) DO NOTHING;
  END LOOP;
END $$;

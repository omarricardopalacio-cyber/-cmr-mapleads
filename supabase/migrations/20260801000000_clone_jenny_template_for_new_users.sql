-- Migration: Auto-clone Jenny's master template (AI Configs, Watcher Configs, Store Configs) for all new users upon signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_org_id UUID;
  v_display_name TEXT;
  v_template_org_id UUID := '2d3cd292-865d-4667-8d37-e945387e9549'; -- Jenny's Master Workspace Template
BEGIN
  -- Construir display_name desde metadatos de auth
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    NEW.email,
    'Usuario Nuevo'
  );

  -- 1. Crear perfil del usuario
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- 2. Crear organización propia (workspace aislado)
  INSERT INTO public.organizations (name, created_by)
  VALUES (v_display_name || ' CRM', NEW.id)
  RETURNING id INTO v_org_id;

  -- 3. Asignar como owner de su propia organización
  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (NEW.id, v_org_id, 'owner')
  ON CONFLICT (user_id, org_id, role) DO NOTHING;

  -- 4. Clonar ai_configs desde la organización plantilla de Jenny
  INSERT INTO public.ai_configs (
    org_id,
    enabled,
    provider,
    selected_provider,
    fallback_provider,
    grok_api_key,
    openai_api_key,
    system_prompt,
    knowledge_base,
    respond_to,
    vertex_project,
    vertex_location,
    vertex_model,
    vertex_service_account_json
  )
  SELECT
    v_org_id,
    TRUE,
    provider,
    selected_provider,
    fallback_provider,
    grok_api_key,
    openai_api_key,
    system_prompt,
    knowledge_base,
    respond_to,
    vertex_project,
    vertex_location,
    vertex_model,
    vertex_service_account_json
  FROM public.ai_configs
  WHERE org_id = v_template_org_id
  ON CONFLICT (org_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    grok_api_key = EXCLUDED.grok_api_key,
    openai_api_key = EXCLUDED.openai_api_key,
    system_prompt = EXCLUDED.system_prompt,
    selected_provider = EXCLUDED.selected_provider,
    fallback_provider = EXCLUDED.fallback_provider;

  -- 5. Clonar watcher_configs desde la organización plantilla de Jenny
  INSERT INTO public.watcher_configs (
    org_id,
    enabled,
    grok_api_key,
    model,
    extract_profile
  )
  SELECT
    v_org_id,
    TRUE,
    grok_api_key,
    model,
    extract_profile
  FROM public.watcher_configs
  WHERE org_id = v_template_org_id
  ON CONFLICT (org_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    grok_api_key = EXCLUDED.grok_api_key,
    model = EXCLUDED.model,
    extract_profile = EXCLUDED.extract_profile;

  -- 6. Clonar store_configs
  INSERT INTO public.store_configs (
    org_id, store_name, is_active
  )
  VALUES (
    v_org_id, v_display_name || ' Store', TRUE
  ) ON CONFLICT (org_id) DO NOTHING;

  -- 7. Clonar pipeline_stages de plantilla
  INSERT INTO public.pipeline_stages (
    org_id, name, position, color
  )
  SELECT
    v_org_id, name, position, color
  FROM public.pipeline_stages
  WHERE org_id = v_template_org_id
  ON CONFLICT DO NOTHING;

  RAISE LOG '[handle_new_user] Workspace limpio con plantilla maestra clonada creada: org_id=% para usuario=%', v_org_id, NEW.email;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[handle_new_user error]: %', SQLERRM;
  RETURN NEW;
END;
$$;

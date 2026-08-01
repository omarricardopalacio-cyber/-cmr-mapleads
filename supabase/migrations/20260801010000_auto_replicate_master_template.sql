-- Migration: Automatically replicate any changes made to Master Template Org (Jenny) to ALL other user organizations
CREATE OR REPLACE FUNCTION public.propagate_master_template_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_template_org_id UUID := '2d3cd292-865d-4667-8d37-e945387e9549';
BEGIN
  -- Solo replicar si el cambio ocurrió en la organización plantilla de Jenny
  IF NEW.org_id = v_template_org_id THEN
    
    IF TG_TABLE_NAME = 'ai_configs' THEN
      UPDATE public.ai_configs
      SET
        enabled = NEW.enabled,
        provider = NEW.provider,
        selected_provider = NEW.selected_provider,
        fallback_provider = NEW.fallback_provider,
        grok_api_key = NEW.grok_api_key,
        openai_api_key = NEW.openai_api_key,
        system_prompt = NEW.system_prompt,
        knowledge_base = NEW.knowledge_base,
        respond_to = NEW.respond_to,
        vertex_project = NEW.vertex_project,
        vertex_location = NEW.vertex_location,
        vertex_model = NEW.vertex_model,
        vertex_service_account_json = NEW.vertex_service_account_json,
        updated_at = NOW()
      WHERE org_id != v_template_org_id;

      RAISE LOG '[propagate_master_template_changes] ai_configs replicado a todas las organizaciones desde master template';

    ELSIF TG_TABLE_NAME = 'watcher_configs' THEN
      UPDATE public.watcher_configs
      SET
        enabled = NEW.enabled,
        grok_api_key = NEW.grok_api_key,
        model = NEW.model,
        extract_profile = NEW.extract_profile,
        updated_at = NOW()
      WHERE org_id != v_template_org_id;

      RAISE LOG '[propagate_master_template_changes] watcher_configs replicado a todas las organizaciones desde master template';

    END IF;

  END IF;
  RETURN NEW;
END;
$$;

-- Trigger para replicación automática de ai_configs
DROP TRIGGER IF EXISTS tr_propagate_ai_configs ON public.ai_configs;
CREATE TRIGGER tr_propagate_ai_configs
  AFTER UPDATE ON public.ai_configs
  FOR EACH ROW
  WHEN (NEW.org_id = '2d3cd292-865d-4667-8d37-e945387e9549'::uuid)
  EXECUTE FUNCTION public.propagate_master_template_changes();

-- Trigger para replicación automática de watcher_configs
DROP TRIGGER IF EXISTS tr_propagate_watcher_configs ON public.watcher_configs;
CREATE TRIGGER tr_propagate_watcher_configs
  AFTER UPDATE ON public.watcher_configs
  FOR EACH ROW
  WHEN (NEW.org_id = '2d3cd292-865d-4667-8d37-e945387e9549'::uuid)
  EXECUTE FUNCTION public.propagate_master_template_changes();

-- =============================================================
-- FASE 5.1 — Backend swap: tags / pipeline_stages / order_fields
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fases 1-5 aplicadas
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_tags_tag_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.contact_tags DROP CONSTRAINT contact_tags_tag_id_fkey';
    RAISE NOTICE '✅ dropped contact_tags_tag_id_fkey';
  ELSE
    RAISE NOTICE 'ℹ️ contact_tags_tag_id_fkey not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_pipeline_stage_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.contacts DROP CONSTRAINT contacts_pipeline_stage_id_fkey';
    RAISE NOTICE '✅ dropped contacts_pipeline_stage_id_fkey';
  ELSE
    RAISE NOTICE 'ℹ️ contacts_pipeline_stage_id_fkey not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname LIKE 'order_field_values%_fkey'
  ) THEN
    RAISE NOTICE 'ℹ️ order_field_values has a foreign-key constraint; verify manually if needed';
  ELSE
    RAISE NOTICE 'ℹ️ no order_field_values foreign-key constraint found';
  END IF;
END $$;

-- Bump versión global para invalidar cachés de tenants
UPDATE global.config_version
SET version = version + 1,
    bumped_at = now()
WHERE true;

DO $$ BEGIN
  RAISE NOTICE '🚀 Fase 5.1 SQL aplicado';
END $$;

COMMIT;

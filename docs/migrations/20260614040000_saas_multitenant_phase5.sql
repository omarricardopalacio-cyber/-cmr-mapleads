-- ============================================================
-- FASE 5: auto_reply_steps GLOBAL
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- ============================================================

BEGIN;

-- 1. Backup defensivo
CREATE SCHEMA IF NOT EXISTS backup_premigration;
CREATE TABLE IF NOT EXISTS backup_premigration.auto_reply_steps (LIKE public.auto_reply_steps INCLUDING ALL);

-- Solo copiar si el backup está vacío (idempotencia)
INSERT INTO backup_premigration.auto_reply_steps
SELECT * FROM public.auto_reply_steps
ON CONFLICT DO NOTHING;

-- 2. Crear tabla en schema global
CREATE TABLE IF NOT EXISTS global.auto_reply_steps (LIKE public.auto_reply_steps INCLUDING ALL);

-- 3. Hacer org_id NULLABLE en global.auto_reply_steps
ALTER TABLE global.auto_reply_steps ALTER COLUMN org_id DROP NOT NULL;

-- 4. Copia inicial desde el workspace maestro
-- Buscamos el workspace maestro
DO $$
DECLARE
  v_master_email  text    := 'omarricardopalacio@gmail.com';
  v_master_uid    uuid;
  v_master_org    uuid;
BEGIN
  SELECT id INTO v_master_uid
  FROM auth.users
  WHERE email = v_master_email
  LIMIT 1;

  IF v_master_uid IS NOT NULL THEN
    SELECT org_id INTO v_master_org
    FROM public.user_roles
    WHERE user_id = v_master_uid
    ORDER BY
      CASE role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        ELSE 2
      END
    LIMIT 1;

    IF v_master_org IS NOT NULL THEN
      INSERT INTO global.auto_reply_steps
      SELECT * FROM public.auto_reply_steps WHERE org_id = v_master_org
      ON CONFLICT DO NOTHING;

      UPDATE global.auto_reply_steps SET org_id = NULL;
    END IF;
  END IF;
END;
$$;

-- 5. RLS en global.auto_reply_steps
ALTER TABLE global.auto_reply_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auto_reply_steps_select ON global.auto_reply_steps;
CREATE POLICY auto_reply_steps_select ON global.auto_reply_steps
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auto_reply_steps_write ON global.auto_reply_steps;
CREATE POLICY auto_reply_steps_write ON global.auto_reply_steps
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 6. GRANTs
GRANT SELECT ON global.auto_reply_steps TO authenticated, anon;
GRANT ALL ON global.auto_reply_steps TO service_role;

-- 7. Trigger bump_config_version
DROP TRIGGER IF EXISTS bump_on_auto_reply_steps ON global.auto_reply_steps;
CREATE TRIGGER bump_on_auto_reply_steps
  AFTER INSERT OR UPDATE OR DELETE ON global.auto_reply_steps
  FOR EACH STATEMENT
  EXECUTE FUNCTION global.bump_config_version();

-- 8. Vista compatible auto_reply_steps_v
DROP VIEW IF EXISTS public.auto_reply_steps_v CASCADE;
CREATE OR REPLACE VIEW public.auto_reply_steps_v AS
  SELECT
    id,
    rule_id,
    step_order,
    cooldown_seconds,
    text_content,
    media_url,
    mime_type,
    created_at,
    updated_at,
    -- Inyectar el org_id del tenant actual para compatibilidad hacia atrás
    public.current_org_id() as org_id
  FROM global.auto_reply_steps;

GRANT SELECT ON public.auto_reply_steps_v TO authenticated, anon;

COMMIT;

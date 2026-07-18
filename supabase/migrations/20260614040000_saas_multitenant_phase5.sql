-- ============================================================
-- FASE 5: Swap auto_replies / quick_replies / knowledge_sources / transfer_rules
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fases 1-4 aplicadas
-- ============================================================

BEGIN;

-- Ensure global schema exists
CREATE SCHEMA IF NOT EXISTS global;

-- Ensure global.config_version and bump function exist
CREATE TABLE IF NOT EXISTS global.config_version (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  version BIGINT NOT NULL DEFAULT 0,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO global.config_version (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE global.config_version
  SET version = version + 1,
      bumped_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_tbl text;
  v_master_org uuid := '00000000-0000-0000-0000-000000000000';
  v_org_id_is_pk boolean;
  v_col text;
  v_col_arr text[];
  v_view_cols text;
BEGIN
  FOR v_tbl IN SELECT unnest(ARRAY[
      'auto_replies',
      'auto_reply_steps',
      'quick_replies',
      'knowledge_sources',
      'transfer_rules'
    ])
  LOOP
    -- 1. Crear tabla global si no existe usando estructura public.*
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS global.%I (LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    RAISE NOTICE 'Created global.% for table structure', v_tbl;

    -- 2. Copia inicial de datos si la tabla está vacía
    EXECUTE format(
      'INSERT INTO global.%1$I SELECT * FROM public.%1$I WHERE NOT EXISTS (SELECT 1 FROM global.%1$I)'
      , v_tbl
    );

    RAISE NOTICE 'Copied data into global.%', v_tbl;

    -- 3. Limpiar org_id en global.* si existe
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name = v_tbl
        AND column_name = 'org_id'
      ) INTO v_org_id_is_pk;

    IF v_org_id_is_pk THEN
      EXECUTE format('ALTER TABLE global.%I ALTER COLUMN org_id DROP NOT NULL', v_tbl);
      EXECUTE format('UPDATE global.%I SET org_id = NULL', v_tbl);
      RAISE NOTICE 'Cleared org_id in global.%', v_tbl;
    END IF;

    -- 4. RLS
    EXECUTE format('ALTER TABLE global.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I_select ON global.%I', v_tbl || '_select', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON global.%I FOR SELECT TO authenticated USING (true)',
      v_tbl || '_select', v_tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON global.%I', v_tbl || '_write', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I_write ON global.%I FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))',
      v_tbl || '_write', v_tbl
    );

    EXECUTE format('GRANT SELECT ON global.%I TO authenticated, anon', v_tbl);
    EXECUTE format('GRANT ALL ON global.%I TO service_role', v_tbl);

    EXECUTE format('DROP TRIGGER IF EXISTS bump_on_%I ON global.%I', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE TRIGGER bump_on_%I AFTER INSERT OR UPDATE OR DELETE ON global.%I FOR EACH STATEMENT EXECUTE FUNCTION global.bump_config_version()',
      v_tbl, v_tbl
    );

    -- 5. Crear vista public.<tabla>_v si corresponde
    v_col_arr := ARRAY[]::text[];
    FOR v_col IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name = v_tbl
      ORDER BY ordinal_position
    LOOP
      IF v_col = 'org_id' THEN
        v_col_arr := v_col_arr || format('public.current_org_id() AS org_id');
      ELSE
        v_col_arr := v_col_arr || format('%I', v_col);
      END IF;
    END LOOP;

    v_view_cols := array_to_string(v_col_arr, ', ');

    EXECUTE format(
      'CREATE OR REPLACE VIEW public.%I AS SELECT %s FROM global.%I',
      v_tbl || '_v', v_view_cols, v_tbl
    );

    RAISE NOTICE 'Created public.%_v view', v_tbl;
  END LOOP;

  RAISE NOTICE 'FASE 5 migration complete';
END
$$;

COMMIT;

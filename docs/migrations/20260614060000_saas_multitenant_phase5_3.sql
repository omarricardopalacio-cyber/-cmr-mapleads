-- ============================================================
-- FASE 5.3 — Migración de flujo global: flows, flow_steps, flow_templates
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fases 1-3 y Fase 5.1 aplicadas
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tables        text[] := ARRAY[
    'flows',
    'flow_steps',
    'flow_templates'
  ];
  v_tbl           text;
  v_has_org_id    boolean;
  v_org_id_is_pk  boolean;
  v_col           text;
  v_col_arr       text[];
  v_view_cols     text;
BEGIN

  CREATE SCHEMA IF NOT EXISTS backup_premigration;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = v_tbl
    ) THEN
      RAISE NOTICE '⏭️  public.% does not exist, skipping', v_tbl;
      CONTINUE;
    END IF;

    RAISE NOTICE '──── Procesando: %', v_tbl;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS backup_premigration.%I (LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    EXECUTE format(
      'INSERT INTO backup_premigration.%I SELECT * FROM public.%I ON CONFLICT DO NOTHING',
      v_tbl, v_tbl
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS global.%I (LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name   = v_tbl
        AND column_name  = 'org_id'
    ) INTO v_has_org_id;

    IF v_has_org_id THEN
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'global'
          AND tc.table_name   = v_tbl
          AND kcu.column_name = 'org_id'
      ) INTO v_org_id_is_pk;

      IF NOT v_org_id_is_pk THEN
        EXECUTE format('ALTER TABLE global.%I ALTER COLUMN org_id DROP NOT NULL', v_tbl);
      END IF;
    END IF;

    EXECUTE format(
      'INSERT INTO global.%I SELECT * FROM public.%I ON CONFLICT DO NOTHING',
      v_tbl, v_tbl
    );

    EXECUTE format('ALTER TABLE global.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON global.%I', v_tbl || '_select', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I ON global.%I FOR SELECT TO authenticated USING (true)',
      v_tbl || '_select', v_tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON global.%I', v_tbl || '_write', v_tbl);
    EXECUTE format(
      'CREATE POLICY %I ON global.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
      v_tbl || '_write', v_tbl
    );

    EXECUTE format('GRANT SELECT ON global.%I TO authenticated, anon', v_tbl);
    EXECUTE format('GRANT ALL    ON global.%I TO service_role', v_tbl);

    EXECUTE format('DROP TRIGGER IF EXISTS bump_on_%I ON global.%I', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE TRIGGER bump_on_%I AFTER INSERT OR UPDATE OR DELETE ON global.%I FOR EACH STATEMENT EXECUTE FUNCTION global.bump_config_version()',
      v_tbl, v_tbl
    );

    v_col_arr := ARRAY[]::text[];
    FOR v_col IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name   = v_tbl
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

    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, anon', v_tbl || '_v');

    RAISE NOTICE '✅  global.% and public.%_v provisionados', v_tbl, v_tbl || '_v';
  END LOOP;

  GRANT USAGE ON SCHEMA global TO authenticated, anon, service_role;

  UPDATE global.config_version
  SET version = version + 1,
      bumped_at = now()
  WHERE id = true;

  RAISE NOTICE '✅  FASE 5.3 completada. global.config_version bump enviado.';
END;
$$;

COMMIT;

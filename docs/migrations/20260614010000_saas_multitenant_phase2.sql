-- ============================================================
-- FASE 2: PLANTILLA GLOBAL SINCRONIZADA
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fase 1 aplicada (global schema, config_version,
--                current_org_id(), is_super_admin(), handle_new_user())
--
-- INSTRUCCIONES: Ejecutar completo en SQL Editor de Supabase
--                (Dashboard > SQL Editor > New query > Paste > Run)
-- ============================================================

BEGIN;

-- ============================================================
-- CONFIGURACIÓN: Lista de tablas que pasan a ser globales.
-- Editar esta lista si el proyecto espejo tiene tablas distintas.
-- NUNCA incluir tablas privadas (threads, messages, contacts,
-- orders, products, etc.) — esas son Fase 3.
-- ============================================================

DO $$
DECLARE
  v_tables        text[] := ARRAY[
    'ai_configs',
    'auto_replies',
    'quick_replies',
    'flows',
    'flow_steps',
    'knowledge_sources',
    'order_fields',
    'pipeline_stages',
    'tags',
    'transfer_rules'
  ];

  -- ── Workspace maestro ──────────────────────────────────────
  -- Cambiar este email si el super-admin del proyecto espejo es distinto.
  v_master_email  text    := 'omarricardopalacio@gmail.com';
  v_master_uid    uuid;
  v_master_org    uuid;

  -- Variables de iteración
  v_tbl           text;
  v_has_org_id    boolean;
  v_org_id_is_pk  boolean;
  v_col_list      text;
  v_col_select    text;
  v_col_arr       text[];
  v_col           text;
  v_view_cols     text;
  v_sql           text;

BEGIN

  -- ============================================================
  -- 0. RESOLUCIÓN DEL WORKSPACE MAESTRO
  -- ============================================================

  SELECT id INTO v_master_uid
  FROM auth.users
  WHERE email = v_master_email
  LIMIT 1;

  IF v_master_uid IS NULL THEN
    RAISE NOTICE '%', concat(
      '⚠️  Usuario maestro ', v_master_email,
      ' no encontrado en auth.users. ',
      'Se omite la copia inicial de datos. ',
      'Crea manualmente filas en global.* si lo necesitas.'
    );
  ELSE
    -- Prioridad: owner > admin > cualquier rol
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

    IF v_master_org IS NULL THEN
      RAISE NOTICE '%', concat(
        '⚠️  Usuario maestro ', v_master_email,
        ' no tiene organización asignada. ',
        'Se omite la copia inicial.'
      );
    ELSE
      RAISE NOTICE '✅  Workspace maestro resuelto: uid=%, org_id=%', v_master_uid, v_master_org;
    END IF;
  END IF;

  -- ============================================================
  -- 1. CREAR SCHEMA backup_premigration (si no existe)
  -- ============================================================

  CREATE SCHEMA IF NOT EXISTS backup_premigration;

  -- ============================================================
  -- 2. LOOP PRINCIPAL: procesar cada tabla global
  -- ============================================================

  FOREACH v_tbl IN ARRAY v_tables LOOP

    -- ── 2a. Comprobar que la tabla existe en public ──────────
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = v_tbl
    ) THEN
      RAISE NOTICE '%', concat('⏭️  Tabla public.', v_tbl, ' no existe en este proyecto. Saltando.');
      CONTINUE;
    END IF;

    RAISE NOTICE '%', concat('──── Procesando: ', v_tbl, ' ────');

    -- ── 2b. Backup defensivo ─────────────────────────────────
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS backup_premigration.%I '
      '(LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    -- Solo copiar si el backup está vacío (idempotencia)
    EXECUTE format(
      'INSERT INTO backup_premigration.%I '
      'SELECT * FROM public.%I '
      'ON CONFLICT DO NOTHING',
      v_tbl, v_tbl
    );

    RAISE NOTICE '%', concat('  backup_premigration.', v_tbl, ' OK');

    -- ── 2c. Crear tabla en schema global ─────────────────────
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS global.%I '
      '(LIKE public.%I INCLUDING ALL)',
      v_tbl, v_tbl
    );

    -- ── 2d. Hacer org_id NULLABLE en global.* ────────────────
    --       (la config global no pertenece a ninguna org)
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
        EXECUTE format(
          'ALTER TABLE global.%I ALTER COLUMN org_id DROP NOT NULL',
          v_tbl
        );
      END IF;
    END IF;

    -- ── 2e. Copia inicial desde workspace maestro ─────────────
    IF v_master_org IS NOT NULL THEN
      IF v_has_org_id THEN
        EXECUTE format(
          'INSERT INTO global.%I '
          'SELECT * FROM public.%I WHERE org_id = %L '
          'ON CONFLICT DO NOTHING',
          v_tbl, v_tbl, v_master_org
        );

        -- Limpiar org_id (la config global no tiene dueño) solo si no es PK.
        IF NOT v_org_id_is_pk THEN
          EXECUTE format(
            'UPDATE global.%I SET org_id = NULL',
            v_tbl
          );
        END IF;
      ELSE
        -- Tablas sin org_id se copian completas
        EXECUTE format(
          'INSERT INTO global.%I '
          'SELECT * FROM public.%I '
          'ON CONFLICT DO NOTHING',
          v_tbl, v_tbl
        );
      END IF;

      RAISE NOTICE '  Copia inicial de datos: OK %', v_tbl;
    END IF;

    -- ── 2f. RLS en global.<tabla> ─────────────────────────────
    EXECUTE format('ALTER TABLE global.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    -- Política de lectura: cualquier usuario autenticado puede leer
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON global.%I',
      v_tbl || '_select', v_tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON global.%I '
      'FOR SELECT TO authenticated USING (true)',
      v_tbl || '_select', v_tbl
    );

    -- Política de escritura: solo SUPER_ADMIN
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON global.%I',
      v_tbl || '_write', v_tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON global.%I '
      'FOR ALL TO authenticated '
      'USING (public.is_super_admin()) '
      'WITH CHECK (public.is_super_admin())',
      v_tbl || '_write', v_tbl
    );

    RAISE NOTICE '  RLS configurado: OK %', v_tbl;

    -- ── 2g. GRANTs ───────────────────────────────────────────
    EXECUTE format('GRANT SELECT ON global.%I TO authenticated, anon', v_tbl);
    EXECUTE format('GRANT ALL    ON global.%I TO service_role', v_tbl);

    -- ── 2h. Trigger bump_config_version ──────────────────────
    EXECUTE format(
      'DROP TRIGGER IF EXISTS bump_on_%I ON global.%I',
      v_tbl, v_tbl
    );
    EXECUTE format(
      'CREATE TRIGGER bump_on_%I '
      'AFTER INSERT OR UPDATE OR DELETE ON global.%I '
      'FOR EACH STATEMENT '
      'EXECUTE FUNCTION global.bump_config_version()',
      v_tbl, v_tbl
    );

    RAISE NOTICE '  Trigger bump_config_version: OK %', v_tbl;

    -- ── 2i. Vista compatible public.<tabla>_v ─────────────────
    --   Construir la lista de columnas dinámicamente desde
    --   information_schema, sustituyendo org_id por current_org_id().

    v_col_arr := ARRAY[]::text[];

    FOR v_col IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'global'
        AND table_name   = v_tbl
      ORDER BY ordinal_position
    LOOP
      IF v_col = 'org_id' THEN
        v_col_arr := v_col_arr || format(
          'public.current_org_id() AS org_id'
        );
      ELSE
        v_col_arr := v_col_arr || format('%I', v_col);
      END IF;
    END LOOP;

    v_view_cols := array_to_string(v_col_arr, ', ');

    -- Eliminar vista si existe para evitar errores de columnas
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', v_tbl || '_v');

    -- Crear o reemplazar la vista
    EXECUTE format(
      'CREATE OR REPLACE VIEW public.%I AS '
      'SELECT %s FROM global.%I',
      v_tbl || '_v', v_view_cols, v_tbl
    );

    -- GRANT SELECT en la vista
    EXECUTE format(
      'GRANT SELECT ON public.%I TO authenticated, anon',
      v_tbl || '_v'
    );

    RAISE NOTICE '%', concat('✅  ', v_tbl, ' → global.', v_tbl, ' + public.', v_tbl, '_v creados correctamente');

  END LOOP;

  -- ============================================================
  -- 3. GRANTS SOBRE EL SCHEMA GLOBAL (idempotente)
  -- ============================================================

  GRANT USAGE ON SCHEMA global TO authenticated, anon, service_role;

  -- ============================================================
  -- 4. BUMP FINAL DE config_version
  --    Invalida cualquier caché que estuviera leyendo la versión anterior.
  -- ============================================================

  UPDATE global.config_version
  SET version   = version + 1,
      bumped_at = now()
  WHERE id = true;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE '✅  FASE 2 completada.';
  RAISE NOTICE '    global.config_version bumpeado.';
  RAISE NOTICE '    Próximos pasos:';
  RAISE NOTICE '      F2.1 — Swap lecturas backend → vistas _v';
  RAISE NOTICE '      F2.2 — Realtime sobre global.config_version';
  RAISE NOTICE '════════════════════════════════════════════';

END;
$$;

COMMIT;

-- ============================================================
-- VALIDACIONES OPCIONALES (ejecutar por separado para confirmar)
-- ============================================================
--
-- 1. Ver las vistas creadas:
--    SELECT table_name FROM information_schema.views
--    WHERE table_schema = 'public' AND table_name LIKE '%_v'
--    ORDER BY table_name;
--
-- 2. Verificar config global con org_id inyectado:
--    SELECT * FROM public.ai_configs_v LIMIT 1;
--    SELECT * FROM public.auto_replies_v LIMIT 5;
--
-- 3. Confirmar bump de versión:
--    SELECT * FROM global.config_version;
--
-- 4. Probar restricción RLS (esperado: error de política):
--    INSERT INTO global.ai_configs (id) VALUES (gen_random_uuid());
--
-- 5. Verificar datos privados intactos:
--    SELECT COUNT(*) FROM public.threads;
--

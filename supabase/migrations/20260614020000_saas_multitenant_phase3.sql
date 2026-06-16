-- ============================================================
-- FASE 3: RLS estricto + Realtime de config global
-- Proyecto: Maple CRM / Bridge
-- Fecha: 2026-06-14
-- Pre-requisito: Fase 1 y Fase 2 aplicadas
-- ============================================================

BEGIN;

DO $$
DECLARE
  private_tables text[] := ARRAY[
    'contacts',
    'threads',
    'orders',
    'notes',
    'reminders',
    'scheduled_messages',
    'broadcasts',
    'wa_sessions',
    'ai_actions_log',
    'failed_ai_requests',
    'no_response_pending',
    'events',
    'media',
    'flow_runs',
    'engine_commands',
    'catalog_integrations',
    'catalog_sync_logs',
    'products',
    'auto_reply_steps'
  ];
  v_tbl text;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'FASE 3: aplicando RLS estricto en tablas privadas...';
  RAISE NOTICE '============================================================';

  FOREACH v_tbl IN ARRAY private_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = v_tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tbl || '_tenant_isolation', v_tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I '
        'FOR ALL TO authenticated '
        'USING (org_id = public.current_org_id() OR public.is_super_admin()) '
        'WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin())',
        v_tbl || '_tenant_isolation',
        v_tbl
      );
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_tbl);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', v_tbl);
      RAISE NOTICE '✅  public.% created with tenant_isolation policy', v_tbl;
    ELSE
      RAISE NOTICE '⏭️  public.% does not exist, skipping', v_tbl;
    END IF;
  END LOOP;

  -- Tablas hijas sin org_id propio
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    EXECUTE 'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS messages_tenant_isolation ON public.messages';
    EXECUTE '
      CREATE POLICY messages_tenant_isolation ON public.messages
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.threads t
          WHERE t.id = thread_id
            AND (t.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.threads t
          WHERE t.id = thread_id
            AND (t.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated';
    EXECUTE 'GRANT ALL ON public.messages TO service_role';
    RAISE NOTICE '✅  public.messages child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contact_tags') THEN
    EXECUTE 'ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS contact_tags_tenant_isolation ON public.contact_tags';
    EXECUTE '
      CREATE POLICY contact_tags_tenant_isolation ON public.contact_tags
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated';
    EXECUTE 'GRANT ALL ON public.contact_tags TO service_role';
    RAISE NOTICE '✅  public.contact_tags child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'broadcast_recipients') THEN
    EXECUTE 'ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS broadcast_recipients_tenant_isolation ON public.broadcast_recipients';
    EXECUTE '
      CREATE POLICY broadcast_recipients_tenant_isolation ON public.broadcast_recipients
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.broadcasts b
          WHERE b.id = broadcast_id
            AND (b.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.broadcasts b
          WHERE b.id = broadcast_id
            AND (b.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated';
    EXECUTE 'GRANT ALL ON public.broadcast_recipients TO service_role';
    RAISE NOTICE '✅  public.broadcast_recipients child policy applied';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'auto_reply_triggers') THEN
    EXECUTE 'ALTER TABLE public.auto_reply_triggers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS auto_reply_triggers_tenant_isolation ON public.auto_reply_triggers';
    EXECUTE '
      CREATE POLICY auto_reply_triggers_tenant_isolation ON public.auto_reply_triggers
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id
            AND (c.org_id = public.current_org_id() OR public.is_super_admin())
        )
      )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_triggers TO authenticated';
    EXECUTE 'GRANT ALL ON public.auto_reply_triggers TO service_role';
    RAISE NOTICE '✅  public.auto_reply_triggers child policy applied';
  END IF;

  UPDATE global.config_version
  SET version = version + 1,
      bumped_at = now()
  WHERE id = true;

  RAISE NOTICE '============================================================';
  RAISE NOTICE '✅  FASE 3 completada. global.config_version bump enviado.';
  RAISE NOTICE '============================================================';
END;
$$;

COMMIT;

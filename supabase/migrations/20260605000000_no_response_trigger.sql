-- ============================================================
-- No-Response Trigger System
-- Agrega soporte para activadores "sin respuesta del cliente"
-- en el sistema de auto-respuestas.
-- ============================================================

-- 1. Nuevas columnas en auto_replies
ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS no_response_delay_seconds int NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS no_response_ai_scope text NOT NULL DEFAULT 'always';
  -- no_response_ai_scope: 'always' | 'ai_active' | 'ai_inactive'

-- 2. Nuevas columnas de acción en auto_replies (etiqueta por no respuesta)
ALTER TABLE public.auto_replies
  ADD COLUMN IF NOT EXISTS no_response_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL;

-- 3. Tabla de control: registra qué thread tiene un seguimiento pendiente
CREATE TABLE IF NOT EXISTS public.no_response_pending (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL REFERENCES public.auto_replies(id) ON DELETE CASCADE,
  thread_id     uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  contact_id    uuid,
  session_id    uuid,
  chat_id       text,
  fires_at      timestamptz NOT NULL,
  fired_at      timestamptz,               -- NULL = pendiente, NOT NULL = ya enviado
  cancelled_at  timestamptz,               -- cancelado por respuesta del cliente
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, thread_id, fired_at)   -- evita duplicados de misma regla+thread si ya se disparó
);

ALTER TABLE public.no_response_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read no_response_pending"
  ON public.no_response_pending FOR SELECT TO authenticated
  USING (org_id = (
    SELECT org_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
  ));

-- Índice para que el worker sea rápido
CREATE INDEX IF NOT EXISTS idx_nrp_fires_at
  ON public.no_response_pending (fires_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nrp_thread
  ON public.no_response_pending (thread_id)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- 4. Activar pg_cron (ya viene incluido en Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 5. Cron job: llama al worker cada 5 minutos
-- NOTA: La URL debe apuntar a tu dominio de producción en Lovable.
-- Reemplaza <TU_DOMINIO> con el dominio real del proyecto.
-- Ejemplo: https://plan-maestro-bridge.lovable.app
SELECT cron.schedule(
  'no-response-worker',           -- nombre único del job
  '*/5 * * * *',                  -- cada 5 minutos
  $$
    SELECT net.http_post(
      url := current_setting('app.public_url') || '/api/internal/no-response-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- 6. Configurar las variables de entorno en Supabase (ejecutar manualmente una vez):
-- ALTER DATABASE postgres SET "app.public_url" = 'https://TU-DOMINIO.lovable.app';
-- ALTER DATABASE postgres SET "app.cron_secret" = 'TU_CRON_SECRET_AQUI';

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

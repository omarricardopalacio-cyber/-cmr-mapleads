-- Índices de hot paths y retención. Evitan scans globales durante polling,
-- deduplicación y limpieza de tablas temporales.

CREATE INDEX IF NOT EXISTS idx_engine_commands_terminal_created
  ON public.engine_commands (status, created_at)
  WHERE status IN ('acked', 'failed');

CREATE INDEX IF NOT EXISTS idx_engine_commands_delivered_unacked
  ON public.engine_commands (session_id, delivered_at)
  WHERE status = 'delivered' AND acked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_engine_commands_dedupe_key
  ON public.engine_commands (
    org_id,
    session_id,
    (payload->>'dedupeKey'),
    status
  )
  WHERE payload ? 'dedupeKey';

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON public.events (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_reply_pending_processed
  ON public.ai_reply_pending (created_at)
  WHERE processed_at IS NOT NULL OR cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_no_response_pending_terminal
  ON public.no_response_pending (created_at)
  WHERE fired_at IS NOT NULL OR cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_media_sent_at
  ON public.messages (sent_at)
  WHERE media IS NOT NULL AND media <> '{}'::jsonb;

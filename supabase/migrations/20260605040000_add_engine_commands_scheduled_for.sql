-- Add scheduled_for to engine_commands for delayed dispatch
ALTER TABLE public.engine_commands
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_engine_commands_session_status_scheduled_for_created_at
  ON public.engine_commands(session_id, status, scheduled_for, created_at);

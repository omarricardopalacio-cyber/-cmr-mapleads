-- Estado consolidado de la conversación (hechos: producto, ciudad, cantidad, color, precio…).
-- Se actualiza turno a turno e inyecta con prioridad en el prompt de la IA.
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS ai_conversation_state jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.threads.ai_conversation_state IS
  'Hechos consolidados de la conversación (producto, ciudad, cantidad, precio cotizado, etc.) para no perder contexto en el prompt.';

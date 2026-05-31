-- Fix para asegurar que las columnas de auto_replies existan en instancias donde la migración anterior ya había corrido
ALTER TABLE public.auto_replies
ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'keyword',
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS action_add_tags UUID[],
ADD COLUMN IF NOT EXISTS action_remove_tags UUID[],
ADD COLUMN IF NOT EXISTS action_ai_behavior TEXT DEFAULT 'no_change';

COMMENT ON COLUMN public.auto_replies.action_add_tags IS 'Array of tag IDs to add to the contact';
COMMENT ON COLUMN public.auto_replies.action_remove_tags IS 'Array of tag IDs to remove from the contact';
COMMENT ON COLUMN public.auto_replies.action_ai_behavior IS 'no_change, disable_ai, enable_ai';

-- Refrescar la caché de PostgREST automáticamente después de la migración
NOTIFY pgrst, 'reload schema';

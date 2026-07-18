-- Etapa 3: Enriquecer broadcasts con segmentación por etiquetas, multimedia y monitoreo

ALTER TABLE public.broadcasts
ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES public.tags(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS error_log TEXT;

-- Índices optimizados para alto rendimiento en despacho
CREATE INDEX IF NOT EXISTS idx_broadcasts_status_scheduled ON public.broadcasts(status, scheduled_at) WHERE status IN ('scheduled', 'running');
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON public.broadcast_recipients(status, broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_command ON public.broadcast_recipients(command_id) WHERE command_id IS NOT NULL;

-- Funciones RPC para incrementar contadores de campaña de forma atómica (desde ingest.ts)
CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(p_broadcast_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.broadcasts SET sent_count = sent_count + 1 WHERE id = p_broadcast_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_failed(p_broadcast_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.broadcasts SET failed_count = failed_count + 1 WHERE id = p_broadcast_id;
END;
$$;

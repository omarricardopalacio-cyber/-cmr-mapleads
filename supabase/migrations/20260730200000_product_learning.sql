-- Aprendizaje de prompts por producto + origen de mensajes outbound

-- ── messages.source: agent | ai | flow | unknown ──
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_source_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_source_check
  CHECK (source IS NULL OR source IN ('agent', 'ai', 'flow', 'unknown'));

COMMENT ON COLUMN public.messages.source IS
  'Origen del mensaje saliente: agent (humano CRM), ai, flow, unknown';

CREATE INDEX IF NOT EXISTS idx_messages_thread_source_out
  ON public.messages (thread_id, source)
  WHERE direction = 'out' AND source = 'agent';

-- ── Contadores de aprendizaje en products ──
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS learning_inquiry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learning_sale_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learning_inquiry_prompt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS learning_sale_prompt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.products.learning_inquiry_count IS
  'Chats calificados (consultas) acumulados para aprendizaje (máx 50 por ciclo)';
COMMENT ON COLUMN public.products.learning_sale_count IS
  'Chats con venta calificados para super-prompt (máx 50 por ciclo)';

-- ── Samples ──
CREATE TABLE IF NOT EXISTS public.product_learning_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('inquiry', 'sale')),
  human_reply_count INTEGER NOT NULL DEFAULT 0,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcript_excerpt JSONB NOT NULL DEFAULT '[]'::jsonb,
  flows_activated JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'open'
    CHECK (outcome IN ('open', 'sale', 'no_sale')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, thread_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_pls_org_product_phase
  ON public.product_learning_samples (org_id, product_id, phase, qualified_at DESC);

ALTER TABLE public.product_learning_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage product_learning_samples" ON public.product_learning_samples;
CREATE POLICY "Members manage product_learning_samples" ON public.product_learning_samples
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- ── Jobs de consolidación ──
CREATE TABLE IF NOT EXISTS public.product_learning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('inquiry_50', 'sale_50')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  sample_ids UUID[] NOT NULL DEFAULT '{}',
  generated_prompt TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Un solo job "exitoso o en curso" por producto+fase (permite reintentar failed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_plj_unique_active_done
  ON public.product_learning_jobs (product_id, phase)
  WHERE status IN ('pending', 'running', 'done');

CREATE INDEX IF NOT EXISTS idx_plj_pending
  ON public.product_learning_jobs (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.product_learning_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage product_learning_jobs" ON public.product_learning_jobs;
CREATE POLICY "Members manage product_learning_jobs" ON public.product_learning_jobs
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- ── Versiones / backups de prompts ──
CREATE TABLE IF NOT EXISTS public.product_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  prompt_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'learning_inquiry', 'learning_sale', 'restore')),
  job_id UUID REFERENCES public.product_learning_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppv_product_created
  ON public.product_prompt_versions (product_id, created_at DESC);

ALTER TABLE public.product_prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage product_prompt_versions" ON public.product_prompt_versions;
CREATE POLICY "Members manage product_prompt_versions" ON public.product_prompt_versions
  FOR ALL USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

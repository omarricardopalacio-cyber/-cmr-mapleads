
-- Fix missing columns that the app expects

-- 1) threads.ai_enabled (default true) — used by IA toggle and conversations list
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

-- 2) catalog_integrations.created_at — used for ordering in list view
ALTER TABLE public.catalog_integrations
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Backfill created_at from updated_at where it's the freshly-defaulted now()
UPDATE public.catalog_integrations
SET created_at = updated_at
WHERE updated_at IS NOT NULL AND created_at >= now() - interval '1 minute';

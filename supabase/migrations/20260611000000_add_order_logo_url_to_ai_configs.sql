-- Add an optional shared order logo URL to AI configuration
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS order_logo_url text;

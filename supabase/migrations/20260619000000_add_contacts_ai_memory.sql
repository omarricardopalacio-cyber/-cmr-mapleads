-- Migration: add ai_memory JSONB column to public.contacts table
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS ai_memory JSONB DEFAULT '{}'::jsonb;

-- Comment for documentation
COMMENT ON COLUMN public.contacts.ai_memory IS 'Stores commercial memory for the contact including interests, preferences, objections, purchase intent, and executive summary.';

-- Migration: Add custom AI prompt fields
ALTER TABLE public.auto_replies
ADD COLUMN IF NOT EXISTS action_ai_prompt TEXT;

COMMENT ON COLUMN public.auto_replies.action_ai_prompt IS 'Custom AI instruction to inject when rule activates the AI bot.';

ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS ai_prompt_extension TEXT;

COMMENT ON COLUMN public.threads.ai_prompt_extension IS 'Custom AI instruction extension injected dynamically for this thread.';

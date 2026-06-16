-- Fix: Update ai_configs provider CHECK constraint to include openai and grok
-- This fixes the error when saving AI config with OpenAI or Grok providers

-- Drop old constraint
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

-- Add new constraint with all 4 providers
ALTER TABLE ai_configs 
ADD CONSTRAINT ai_configs_provider_check 
CHECK (provider IN ('lovable','vertex','openai','grok'));

-- Multi-Provider AI Agent: ai_configs enrichment + ai_actions_log audit table
-- Safe migration: uses IF NOT EXISTS for columns and CREATE TABLE IF NOT EXISTS

-- 1. Enrich ai_configs for multiple direct APIs and Vertex JSON
ALTER TABLE ai_configs
ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
ADD COLUMN IF NOT EXISTS grok_api_key TEXT,
ADD COLUMN IF NOT EXISTS vertex_service_account_json TEXT, -- Full Google Cloud service account JSON pasted here
ADD COLUMN IF NOT EXISTS selected_provider TEXT DEFAULT 'lovable'; -- 'lovable', 'openai', 'grok', 'vertex'

-- 2. Audit table for AI actions (visual transparency)
CREATE TABLE IF NOT EXISTS ai_actions_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    action_name TEXT NOT NULL, -- e.g. 'assign_tag', 'disable_ai', 'create_reminder'
    action_details TEXT NOT NULL, -- Human-readable description
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Row Level Security on ai_actions_log
ALTER TABLE ai_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ai logs for their org" ON ai_actions_log
FOR SELECT TO authenticated
USING (public.is_member(auth.uid(), org_id));

-- Optional: allow the service role / backend to insert logs
CREATE POLICY "Service can insert ai logs" ON ai_actions_log
FOR INSERT TO authenticated
WITH CHECK (public.is_member(auth.uid(), org_id));

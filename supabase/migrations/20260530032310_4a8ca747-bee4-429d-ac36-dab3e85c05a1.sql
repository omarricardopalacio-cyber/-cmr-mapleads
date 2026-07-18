
CREATE TABLE public.ai_configs (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'lovable' CHECK (provider IN ('lovable','vertex')),
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  system_prompt text NOT NULL DEFAULT 'Eres un asistente de ventas amable y conciso. Responde en español.',
  knowledge_base text NOT NULL DEFAULT '',
  respond_to text NOT NULL DEFAULT 'all' CHECK (respond_to IN ('all','new')),
  vertex_project text,
  vertex_location text DEFAULT 'us-central1',
  vertex_model text DEFAULT 'gemini-2.5-flash',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_configs TO authenticated;
GRANT ALL ON public.ai_configs TO service_role;

ALTER TABLE public.ai_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_configs members read"
ON public.ai_configs FOR SELECT TO authenticated
USING (public.is_member(auth.uid(), org_id));

CREATE POLICY "ai_configs members insert"
ON public.ai_configs FOR INSERT TO authenticated
WITH CHECK (public.is_member(auth.uid(), org_id));

CREATE POLICY "ai_configs members update"
ON public.ai_configs FOR UPDATE TO authenticated
USING (public.is_member(auth.uid(), org_id));

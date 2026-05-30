-- Etapa 4: Motor de Flujos Automatizados (Flow Builder)

CREATE TABLE IF NOT EXISTS public.flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'tag_added', 'new_contact')),
    trigger_value TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flows for their org" ON public.flows FOR ALL USING (public.is_member(org_id));

CREATE TABLE IF NOT EXISTS public.flow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('send_message', 'send_media', 'wait', 'add_tag', 'remove_tag', 'toggle_ai', 'condition_reply')),
    step_data JSONB NOT NULL DEFAULT '{}',
    parent_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    branch TEXT CHECK (branch IN ('yes', 'no')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flow_steps for their org" ON public.flow_steps FOR ALL USING (
    public.is_member((SELECT org_id FROM public.flows WHERE id = flow_id))
);

CREATE TABLE IF NOT EXISTS public.flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    current_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'wait_node', 'completed', 'cancelled')),
    next_execution_at TIMESTAMPTZ DEFAULT now(),
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (flow_id, contact_id)
);

ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage flow_runs for their org" ON public.flow_runs FOR ALL USING (public.is_member(org_id));

CREATE INDEX IF NOT EXISTS idx_flow_runs_next_exec ON public.flow_runs(status, next_execution_at);
CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_contact ON public.flow_runs(flow_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_flows_trigger ON public.flows(trigger_type, trigger_value, is_active);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_order ON public.flow_steps(flow_id, step_order);

-- Función RPC para eliminar paso de flujo con verificación de propiedad
CREATE OR REPLACE FUNCTION public.delete_flow_step_safe(p_step_id UUID, p_org_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_flow_id UUID;
BEGIN
  SELECT flow_id INTO v_flow_id FROM public.flow_steps WHERE id = p_step_id;
  IF v_flow_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flows WHERE id = v_flow_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.flow_steps WHERE id = p_step_id;
END;
$$;

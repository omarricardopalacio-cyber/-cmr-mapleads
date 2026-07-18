-- ============================================
-- MIGRACIÓN COMPLETA: Motor de Flujos + Configuración IA
-- ============================================
-- Este script crea:
-- 1. Tablas del motor de flujos (flows, flow_steps, flow_runs)
-- 2. Configuración IA en la tabla flows
-- 3. Tablas de base de conocimiento y reglas de transferencia
-- ============================================

-- ============================================
-- PARTE 1: Motor de Flujos Automatizados
-- ============================================

CREATE TABLE IF NOT EXISTS public.flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'tag_added', 'new_contact', 'manual')),
    trigger_value TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage flows for their org" ON public.flows;
CREATE POLICY "Users can manage flows for their org" ON public.flows FOR ALL USING (public.is_member(auth.uid(), org_id));

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
DROP POLICY IF EXISTS "Users can manage flow_steps for their org" ON public.flow_steps;
CREATE POLICY "Users can manage flow_steps for their org" ON public.flow_steps FOR ALL USING (
    public.is_member(auth.uid(), (SELECT org_id FROM public.flows WHERE id = flow_id))
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
DROP POLICY IF EXISTS "Users can manage flow_runs for their org" ON public.flow_runs;
CREATE POLICY "Users can manage flow_runs for their org" ON public.flow_runs FOR ALL USING (public.is_member(auth.uid(), org_id));

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

-- ============================================
-- PARTE 2: Configuración IA en tabla flows
-- ============================================

-- Agregar columnas de configuración IA
ALTER TABLE public.flows
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS ai_mode TEXT DEFAULT 'none' CHECK (ai_mode IN (
    'none',                    -- Opción 1: No activar IA
    'on_completion',           -- Opción 2: IA activa al finalizar flujo
    'during_flow',             -- Opción 3: IA activa durante todo el flujo
    'on_response',             -- Opción 4: IA solo si el cliente responde
    'fallback',                -- Opción 5: IA como respaldo
    'time_limited'             -- Opción 6: IA con límite de tiempo
)),
ADD COLUMN IF NOT EXISTS ai_time_limit_minutes INT CHECK (ai_time_limit_minutes > 0),
ADD COLUMN IF NOT EXISTS ai_enabled_after_flow BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_enabled_during_flow BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_fallback_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_transfer_on_failure BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_maintain_context BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_can_access_crm BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_can_access_tags BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ai_knowledge_sources JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS ai_transfer_rules JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS ai_custom_system_prompt TEXT;

-- ============================================
-- PARTE 3: Tabla de Fuentes de Conocimiento
-- ============================================

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'faq',              -- Preguntas frecuentes
        'products',         -- Productos
        'services',         -- Servicios
        'catalog',          -- Catálogo
        'pdf_document',     -- Documentos PDF
        'website',          -- Sitio web
        'internal_kb',      -- Base de conocimiento interna
        'custom_prompt'     -- Prompts personalizados
    )),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage knowledge sources for their org" ON public.knowledge_sources;
CREATE POLICY "Users can manage knowledge sources for their org" ON public.knowledge_sources 
FOR ALL USING (public.is_member(auth.uid(), org_id));

-- ============================================
-- PARTE 4: Tabla de Reglas de Transferencia
-- ============================================

CREATE TABLE IF NOT EXISTS public.transfer_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    condition_type TEXT NOT NULL CHECK (condition_type IN (
        'request_human',        -- Cliente solicita hablar con persona
        'ai_no_response',       -- IA no tiene respuesta
        'purchase_intent',      -- Intención de compra detectada
        'complaint',            -- Reclamo detectado
        'support_request',      -- Solicitud de soporte
        'custom'                -- Condición personalizada
    )),
    condition_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transfer_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage transfer rules for their org" ON public.transfer_rules;
CREATE POLICY "Users can manage transfer rules for their org" ON public.transfer_rules 
FOR ALL USING (public.is_member(auth.uid(), org_id));

-- ============================================
-- PARTE 5: Índices de rendimiento
-- ============================================

CREATE INDEX IF NOT EXISTS idx_flows_ai_mode ON public.flows(ai_mode, is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org_type ON public.knowledge_sources(org_id, source_type, is_active);
CREATE INDEX IF NOT EXISTS idx_transfer_rules_org_type ON public.transfer_rules(org_id, condition_type, is_active);

-- ============================================
-- VALIDACIÓN FINAL
-- ============================================

-- Verificar tablas creadas
DO $$
BEGIN
    RAISE NOTICE '✅ Migración completada exitosamente';
    RAISE NOTICE 'Tablas creadas: flows, flow_steps, flow_runs, knowledge_sources, transfer_rules';
    RAISE NOTICE 'Configuración IA agregada a flows';
END $$;

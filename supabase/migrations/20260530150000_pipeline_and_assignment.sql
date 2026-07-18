-- Etapa 5: Embudo de Ventas (Pipeline) y Asignación Multiagente

-- 1. Tabla para Etapas del Embudo (Pipeline Stages)
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E0E0E0',
    position INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage pipeline_stages for their org" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline_stages for their org"
ON pipeline_stages FOR ALL
USING (EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.org_id = pipeline_stages.org_id AND ur.user_id = auth.uid()
));

-- 2. Asociar contactos a una etapa del embudo
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;

-- 3. Asignar chats a agentes
ALTER TABLE threads
ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Semilla de etapas por defecto (solo para orgs que no tengan etapas)
INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Prospecto', '#3B82F6', 1 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 1)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Contactado', '#F59E0B', 2 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 2)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Propuesta', '#10B981', 3 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 3)
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (org_id, name, color, position)
SELECT id, 'Cierre', '#8B5CF6', 4 FROM organizations
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = organizations.id AND ps.position = 4)
ON CONFLICT DO NOTHING;

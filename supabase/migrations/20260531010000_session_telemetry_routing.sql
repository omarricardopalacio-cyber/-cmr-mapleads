-- Etapa 8: Centro de Control de Sesiones Multi-Numero, Enrutamiento Inteligente y Consola de Sincronizacion

-- 1. Enriquecer wa_sessions para almacenar telemetria y reglas de negocio
ALTER TABLE wa_sessions
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS device_name TEXT,
ADD COLUMN IF NOT EXISTS battery_level INT,
ADD COLUMN IF NOT EXISTS platform TEXT, -- 'ios', 'android', 'web'
ADD COLUMN IF NOT EXISTS default_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS default_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ DEFAULT now();

-- 2. Asegurar que las consultas por session_id esten indexadas
CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id);

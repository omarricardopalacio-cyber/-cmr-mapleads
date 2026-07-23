-- Permite marcar un flujo como "paquete que la IA puede ofrecer/activar".
-- Cuando es true, la IA puede iniciarlo con la herramienta activate_flow.
ALTER TABLE public.flows
ADD COLUMN IF NOT EXISTS ai_selectable BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.flows.ai_selectable IS
  'Si es true, la IA puede ofrecer y activar este flujo como paquete de venta (herramienta activate_flow).';

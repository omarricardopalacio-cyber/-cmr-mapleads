-- Instrucciones / contexto para la IA cuando ofrece o atiende un flujo/paquete.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS ai_instructions TEXT NULL;

COMMENT ON COLUMN public.flows.ai_instructions IS
  'Instrucciones y contexto para la IA: cómo atender al cliente cuando este paquete se activa o ya se envió (precios, ciudades, objeciones, etc.).';

NOTIFY pgrst, 'reload schema';

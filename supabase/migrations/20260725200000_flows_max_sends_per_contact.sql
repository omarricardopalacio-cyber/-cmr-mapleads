-- Límite de veces que un flujo/paquete se puede enviar al mismo cliente.
-- NULL = sin límite (comportamiento actual).

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS max_sends_per_contact INTEGER NULL;

COMMENT ON COLUMN public.flows.max_sends_per_contact IS
  'Máximo de veces que este flujo se puede enviar al mismo contacto. NULL = ilimitado.';

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.flow_runs.send_count IS
  'Cuántas veces se ha iniciado/reiniciado este flujo para el contacto.';

-- Si ya hubo una ejecución terminada, contar al menos 1 envío.
UPDATE public.flow_runs
SET send_count = 1
WHERE send_count = 0
  AND status IN ('completed', 'cancelled');

NOTIFY pgrst, 'reload schema';

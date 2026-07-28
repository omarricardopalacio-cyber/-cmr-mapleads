-- Observaciones especiales por producto para la IA del chat web
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ai_observation TEXT;

COMMENT ON COLUMN public.products.ai_observation IS
  'Instrucciones especiales para la IA al atender este producto en el chat de la tienda';

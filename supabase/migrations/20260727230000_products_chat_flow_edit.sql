-- Campos editables de ficha/chat por producto (CRM Observaciones)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS chat_ask_text TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS chat_flow JSONB NOT NULL DEFAULT '{"send_specs":true,"send_ask":true}'::jsonb;

COMMENT ON COLUMN public.products.chat_ask_text IS
  'Pregunta automática tras la ficha en el chat de tienda';
COMMENT ON COLUMN public.products.gallery_images IS
  'URLs de imágenes extra del producto (galería)';
COMMENT ON COLUMN public.products.chat_flow IS
  'Flags del flujo automático: send_specs, send_ask';

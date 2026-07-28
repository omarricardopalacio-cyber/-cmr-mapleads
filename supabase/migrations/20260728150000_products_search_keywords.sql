-- Palabras / nombres alternativos para que la IA encuentre el producto rápido

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS search_keywords TEXT;

COMMENT ON COLUMN public.products.search_keywords IS
  'Nombres alternativos o palabras clave (separadas por coma) para búsqueda de la IA';

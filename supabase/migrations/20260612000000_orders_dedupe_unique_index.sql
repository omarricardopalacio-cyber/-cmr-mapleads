-- ══════════════════════════════════════════════════════════════════
-- Migration: Deduplicación de pedidos confirmados y creación de índice único
-- ══════════════════════════════════════════════════════════════════

-- 1. Deduplicar pedidos confirmados existentes por hilo
-- Conservamos el pedido confirmado más reciente y marcamos los duplicados anteriores como 'merged'
WITH ranked_orders AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, thread_id 
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM public.orders
  WHERE status = 'confirmed' AND thread_id IS NOT NULL
)
UPDATE public.orders
SET status = 'merged'
WHERE id IN (
  SELECT id 
  FROM ranked_orders 
  WHERE rn > 1
);

-- 2. Crear el índice único parcial
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_confirmed_per_thread 
ON public.orders (org_id, thread_id) 
WHERE (status = 'confirmed' AND thread_id IS NOT NULL);

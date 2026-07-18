-- ══════════════════════════════════════════════════════════════════
-- Migration: orders, order_fields + purchase_intent en threads
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla para los campos del formulario de pedidos (configurable por org)
CREATE TABLE IF NOT EXISTS public.order_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'text',
  is_required BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_fields TO authenticated;
GRANT ALL ON public.order_fields TO service_role;
ALTER TABLE public.order_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_fields members all"
  ON public.order_fields FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 2. Tabla de pedidos capturados por la IA
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending',
  form_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders members all"
  ON public.orders FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- 3. Columna de intención de compra en threads
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS purchase_intent VARCHAR(32) DEFAULT 'pending';

-- 4. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders(org_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON public.orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_order_fields_org_id ON public.order_fields(org_id);

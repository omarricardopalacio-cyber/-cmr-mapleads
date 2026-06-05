CREATE TABLE IF NOT EXISTS order_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'text',
  is_required BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE order_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage order_fields in their org"
ON order_fields
FOR ALL
USING (org_id IN (
  SELECT org_id FROM user_organizations WHERE user_id = auth.uid()
));

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  thread_id UUID REFERENCES threads(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending',
  form_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage orders in their org"
ON orders
FOR ALL
USING (org_id IN (
  SELECT org_id FROM user_organizations WHERE user_id = auth.uid()
));

ALTER TABLE threads
ADD COLUMN IF NOT EXISTS purchase_intent VARCHAR(32) DEFAULT 'pending';

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON orders(org_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_order_fields_org_id ON order_fields(org_id);

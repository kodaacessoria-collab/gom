-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Products
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  brand TEXT,
  batch TEXT,
  mfg_date DATE,
  expiry_date DATE,
  quantity DECIMAL DEFAULT 0,
  min_stock DECIMAL DEFAULT 10,
  deposit TEXT DEFAULT 'Depósito-Grupo OM',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Slips (Romaneios)
CREATE TABLE IF NOT EXISTS slips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  quantity DECIMAL NOT NULL,
  destination TEXT NOT NULL,
  type TEXT CHECK (type IN ('ENTRADA', 'SAIDA')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase Orders (Pedidos de Compra)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'PENDENTE',
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product compatibilities for purchase planning when the same item has different names
CREATE TABLE IF NOT EXISTS product_compatibilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  compatible_product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_product_id, compatible_product_id)
);

-- Shared operations data (synchronized between browsers and operating systems)
CREATE TABLE IF NOT EXISTS app_shared_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update product quantity on slip insertion, update and deletion
CREATE OR REPLACE FUNCTION update_stock_level()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF (NEW.type = 'ENTRADA') THEN
      UPDATE products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
    ELSIF (NEW.type = 'SAIDA') THEN
      UPDATE products SET quantity = quantity - NEW.quantity WHERE id = NEW.product_id;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.product_id IS DISTINCT FROM NEW.product_id)
      OR (OLD.quantity IS DISTINCT FROM NEW.quantity)
      OR (OLD.type IS DISTINCT FROM NEW.type) THEN
      IF (OLD.type = 'ENTRADA') THEN
        UPDATE products SET quantity = quantity - OLD.quantity WHERE id = OLD.product_id;
      ELSIF (OLD.type = 'SAIDA') THEN
        UPDATE products SET quantity = quantity + OLD.quantity WHERE id = OLD.product_id;
      END IF;

      IF (NEW.type = 'ENTRADA') THEN
        UPDATE products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
      ELSIF (NEW.type = 'SAIDA') THEN
        UPDATE products SET quantity = quantity - NEW.quantity WHERE id = NEW.product_id;
      END IF;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    IF (OLD.type = 'ENTRADA') THEN
      UPDATE products SET quantity = quantity - OLD.quantity WHERE id = OLD.product_id;
    ELSIF (OLD.type = 'SAIDA') THEN
      UPDATE products SET quantity = quantity + OLD.quantity WHERE id = OLD.product_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_stock_level ON slips;
CREATE TRIGGER trg_update_stock_level
AFTER INSERT OR UPDATE OR DELETE ON slips
FOR EACH ROW
EXECUTE FUNCTION update_stock_level();

-- RLS Policies (Simple public access for now)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_compatibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_shared_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to products') THEN
        CREATE POLICY "Allow all access to products" ON products FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to slips') THEN
        CREATE POLICY "Allow all access to slips" ON slips FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to purchase_orders') THEN
        CREATE POLICY "Allow all access to purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to product_compatibilities') THEN
        CREATE POLICY "Allow all access to product_compatibilities" ON product_compatibilities FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow application access to shared state') THEN
        CREATE POLICY "Allow application access to shared state" ON app_shared_state FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;

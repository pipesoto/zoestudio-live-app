CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active
  ON campaigns (is_active)
  WHERE is_active = TRUE;

INSERT INTO campaigns (name, is_active)
SELECT 'General', TRUE
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'General');

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(60) NOT NULL DEFAULT '',
  quantity_label VARCHAR(80) NOT NULL DEFAULT '',
  attributes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  price INTEGER NOT NULL CHECK (price >= 0),
  initial_stock INTEGER NOT NULL CHECK (initial_stock >= 0),
  current_stock INTEGER NOT NULL CHECK (current_stock >= 0),
  image_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_code VARCHAR(20) NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  district VARCHAR(120) NOT NULL,
  reserved_price INTEGER NOT NULL CHECK (reserved_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_campaign_id ON orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_campaign_created_at ON orders(campaign_id, created_at DESC);

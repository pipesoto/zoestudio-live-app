-- Ejecutar UNA VEZ en bases ya existentes (Railway Postgres).
-- psql "$DATABASE_URL" -f migration_campaigns.sql

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active
  ON campaigns (is_active)
  WHERE is_active = TRUE;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES campaigns(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_campaign_id ON orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_campaign_created_at ON orders(campaign_id, created_at DESC);

-- Opcional: campaña por defecto para pedidos antiguos sin campaña
UPDATE campaigns
SET is_active = TRUE
WHERE name = 'General';

INSERT INTO campaigns (name, is_active)
SELECT 'General', TRUE
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'General');

UPDATE orders
SET campaign_id = (SELECT id FROM campaigns WHERE name = 'General' LIMIT 1)
WHERE campaign_id IS NULL;

ALTER TABLE orders
  ALTER COLUMN campaign_id SET NOT NULL;

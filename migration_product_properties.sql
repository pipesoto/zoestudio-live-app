-- Ejecutar UNA VEZ en bases ya existentes.
-- psql "$DATABASE_URL" -f migration_product_properties.sql

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS color VARCHAR(60) NOT NULL DEFAULT '';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS quantity_label VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attributes_json JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE products
SET attributes_json =
  (CASE WHEN color <> '' THEN jsonb_build_array(jsonb_build_object('key', 'Color', 'value', color)) ELSE '[]'::jsonb END) ||
  (CASE WHEN quantity_label <> '' THEN jsonb_build_array(jsonb_build_object('key', 'Cantidad', 'value', quantity_label)) ELSE '[]'::jsonb END)
WHERE attributes_json = '[]'::jsonb;

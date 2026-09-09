-- Run once on Railway Postgres if db:sync is not used (8 Sep 2026)
CREATE TABLE IF NOT EXISTS cart_items (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0 AND qty <= 99),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id, size, color)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_customer ON cart_items(customer_id);

-- ĀKĀRA — run once on Railway Postgres if db:sync fails mid-way
-- customers.id is UUID in production (migrate-uuid). Do NOT use INTEGER FKs.

-- Marketing columns first (independent of cart_items)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abandoned_cart_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS care_email_sent_at TIMESTAMPTZ;

DROP TABLE IF EXISTS cart_items;
CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0 AND qty <= 99),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id, size, color)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_customer ON cart_items(customer_id);

DROP TABLE IF EXISTS analytics_events;
CREATE TABLE analytics_events (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  path            TEXT,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at DESC);

-- ĀKĀRA — run once on Railway Postgres (Query tab or psql)
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS columns)

-- 1) Analytics
CREATE TABLE IF NOT EXISTS analytics_events (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  path            TEXT,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at DESC);

-- 2) Server-side cart for logged-in users
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

-- 3) Marketing / lifecycle email flags
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abandoned_cart_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS care_email_sent_at TIMESTAMPTZ;

-- 4) Push subscriptions (if missing)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_admin ON push_subscriptions(admin_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON push_subscriptions(customer_id);

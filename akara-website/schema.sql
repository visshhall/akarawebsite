-- ĀKĀRA database schema.
-- Run via `npm run migrate` (see db/migrate.js) — never run manually against
-- production without reading what it does first, since it's not yet
-- idempotent-safe for destructive changes (only CREATE ... IF NOT EXISTS,
-- so safe to re-run, but any future ALTER-based migration needs its own
-- versioned file rather than editing this one after it's been run once
-- against production).

-- ============================================================================
-- PRODUCTS — replaces the hardcoded CATALOG/PRODUCTS arrays in AkaraApp.jsx.
-- id is the same slug used in the frontend's product URLs (e.g.
-- "vayu-round-planter") — kept as the primary key so existing URLs,
-- sitemap.xml, and JSON-LD product schema don't need to change.
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  price           INTEGER NOT NULL,          -- INR, GST-exclusive, whole rupees
  dims            TEXT NOT NULL,
  hsn             TEXT NOT NULL,
  stock           TEXT NOT NULL DEFAULT 'in-stock'
                  CHECK (stock IN ('in-stock','low-stock','sold-out')),
  description     TEXT,                       -- website copy (SEO_COPY.description)
  meta_title      TEXT,
  meta_desc       TEXT,
  media           JSONB NOT NULL DEFAULT '[]',-- [{type,src}, ...] — see defaultMedia() in frontend
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================================================
-- CUSTOMERS — real accounts, replacing the single hardcoded demo login.
-- password_hash uses bcrypt (see server/auth.js) — plaintext passwords are
-- never stored, ever.
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ADDRESSES — a customer can have several saved addresses (matches the
-- Addresses tab already built in My Account on the frontend).
-- ============================================================================
CREATE TABLE IF NOT EXISTS addresses (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  line            TEXT NOT NULL,
  city            TEXT NOT NULL,
  state           TEXT,
  pin             TEXT NOT NULL,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);

-- ============================================================================
-- ORDERS — customer_id is nullable to support guest checkout (matches the
-- current frontend, which never required login to buy). items/shipping_address
-- are stored as JSONB SNAPSHOTS at the time of order — deliberately NOT
-- foreign keys into products/addresses, so that a later price change or
-- address edit never rewrites history on a past order (a real invoice must
-- always reflect what was actually charged at the time).
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  order_number        TEXT NOT NULL UNIQUE,     -- e.g. "AK12345", shown to customer
  customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  items               JSONB NOT NULL,           -- [{id,name,price,qty,size,hsn}, ...] snapshot
  shipping_address    JSONB NOT NULL,           -- {name,line,city,state,pin,phone} snapshot
  subtotal            INTEGER NOT NULL,
  shipping_cost       INTEGER NOT NULL DEFAULT 0,
  cgst                INTEGER NOT NULL DEFAULT 0,
  sgst                INTEGER NOT NULL DEFAULT 0,
  total               INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('confirmed','production','qc','dispatched','delivered','cancelled')),
  payment_status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending','paid','failed','refunded')),
  razorpay_order_id    TEXT,
  razorpay_payment_id  TEXT,
  placed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

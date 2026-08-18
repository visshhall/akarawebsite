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
  phone           TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adds the phone UNIQUE constraint to a `customers` table that already
-- existed before this constraint was introduced (the inline `UNIQUE` on
-- the CREATE TABLE above only takes effect on a brand-new table — a
-- table that already exists needs this explicit ALTER instead, which is
-- exactly the situation for any database that ran migrate before this
-- change). Guarded to be safe to re-run: skips if the constraint is
-- already there, whether from this ALTER or from a fresh CREATE TABLE.
-- NULL phones remain unrestricted (Postgres never treats NULL = NULL),
-- so existing customers with no phone on file are unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_phone_key'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_phone_key UNIQUE (phone);
  END IF;
END $$;

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
  phone           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);
-- Makes phone mandatory on an `addresses` table that already existed
-- before this constraint — how would we ship a parcel without a contact
-- number? Real addresses were never actually saved through a backend
-- before this pass (the feature was frontend-only, local state that
-- vanished on logout — exactly the bug this whole migration exists to
-- fix), so this table is virtually certain to be empty; the blank-string
-- backfill is just a safety net in case it isn't.
UPDATE addresses SET phone='' WHERE phone IS NULL;
ALTER TABLE addresses ALTER COLUMN phone SET NOT NULL;

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
  discount             INTEGER NOT NULL DEFAULT 0,   -- from a coupon code, if any (see coupon_code below)
  coupon_code          TEXT,                          -- e.g. 'AKARA10' — null if no coupon was applied
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

-- Adds discount/coupon_code to an `orders` table that already existed
-- before these columns were introduced — same reasoning as the phone
-- UNIQUE constraint above: CREATE TABLE IF NOT EXISTS is a no-op once
-- the table exists, so a database that ran migrate before this change
-- needs this explicit ALTER. Safe to re-run.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- ============================================================================
-- ADMINS — completely separate from `customers`, deliberately. There is no
-- public signup endpoint for this table anywhere in the app — the only way
-- an admin account is ever created is by running server/seed-admin.js
-- directly (see that file). This table existing separately (rather than an
-- `is_admin` flag on `customers`) means a bug in customer signup/auth code
-- can never accidentally grant admin access — the two are structurally
-- unable to overlap.
-- ============================================================================
CREATE TABLE IF NOT EXISTS admins (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CHANGE LOG — an audit trail of admin actions (product edits, order status
-- changes, etc). `details` is a flexible JSONB blob rather than a rigid
-- schema, since different action types naturally have different shapes of
-- "what changed". This exists specifically so that even running solo, there's
-- a record of "wait, did I change that price? when?" without needing full
-- database-level row versioning.
-- ============================================================================
CREATE TABLE IF NOT EXISTS change_log (
  id              SERIAL PRIMARY KEY,
  admin_id        INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,        -- e.g. 'product.update', 'order.status_change'
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at DESC);

-- ============================================================================
-- SETTINGS — a simple key/value store for the handful of values that used
-- to be hardcoded constants in server/routes/orders.js (shipping cost,
-- free-shipping threshold). Reading these fresh from the database on every
-- checkout (not cached) is deliberate — an admin's change should apply to
-- the very next order, not require a deploy or a restart.
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seeds the two settings with the exact same defaults that used to be
-- hardcoded (₹150 shipping, free above ₹2,500) — nothing changes for
-- existing checkouts the moment this migration runs; it just makes these
-- two numbers editable going forward. ON CONFLICT DO NOTHING means this
-- never overwrites a value an admin has already changed on a re-run.
INSERT INTO settings (key, value) VALUES ('shipping_cost', '150') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('free_shipping_threshold', '2500') ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- COUPONS — replaces the hardcoded single AKARA10 = 10% object that used to
-- live in server/routes/orders.js. Supports multiple codes going forward,
-- each independently toggleable (active/inactive) rather than requiring a
-- code change to retire one. discount_percent is bounded 1-100 at the
-- database level — the same enforcement point that matters, since this
-- value directly determines how much money is discounted at real checkout.
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupons (
  code              TEXT PRIMARY KEY,
  discount_percent  INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seeds the existing AKARA10 coupon so nothing changes for customers the
-- moment this migration runs — it just becomes admin-editable going forward.
INSERT INTO coupons (code, discount_percent) VALUES ('AKARA10', 10) ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- RETURN REQUESTS — replaces the old mailto: link approach (which just
-- opened the customer's email client with pre-filled text). That approach
-- could never support a photo attachment — mailto: URLs are a plain-text
-- protocol with no way to attach a file — which is exactly why this
-- exists: a real request needs a real record to attach an uploaded photo
-- (via the existing secure upload pipeline, server/upload.js) to.
-- ============================================================================
CREATE TABLE IF NOT EXISTS return_requests (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_number    TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  reason          TEXT NOT NULL,
  description     TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  contact_phone   TEXT NOT NULL,
  photo_url       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_return_requests_created ON return_requests(created_at DESC);

-- ============================================================================
-- WISHLIST ITEMS — found during a proactive bug sweep: the Wishlist tab
-- lives inside "My Account" alongside Orders and Addresses, strongly
-- implying it's tied to the account — but it was purely localStorage
-- (device-only), the exact same class of bug as the addresses issue fixed
-- earlier. Confirmed directly: a customer logged into the same account on
-- a different device (or with cleared browser storage) saw an empty
-- wishlist despite having saved items. product_id has no foreign key
-- constraint on purpose — a wishlisted product that's later removed from
-- the catalog should not silently break this table or require cleanup.
-- ============================================================================
CREATE TABLE IF NOT EXISTS wishlist_items (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON wishlist_items(customer_id);

-- ============================================================================
-- REFUND TRACKING — the promised follow-up: cancelling an order used to
-- leave a paid order's money genuinely stuck, requiring a fully manual
-- Razorpay-dashboard refund every time. payment_status already had a
-- 'refunded' option in its CHECK constraint from earlier — this just adds
-- the one missing piece: a place to record which real Razorpay refund
-- transaction corresponds to that state, so "refunded" isn't just a label
-- with nothing behind it.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_refund_id TEXT;

-- ============================================================================
-- COURIER TRACKING — a place to store the real AWB/tracking number once a
-- shipment is created via Shiprocket at dispatch time, replacing the
-- placeholder "Track with Courier" link that currently goes nowhere.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_tracking_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT;

-- ============================================================================
-- PICKUP LOCATIONS — a managed list of Shiprocket pickup-address nicknames
-- (must match EXACTLY what's registered on Shiprocket's own dashboard —
-- see server/shiprocket.js). Exists because a single studio doesn't
-- always work: the business has more than one pickup address, and which
-- one to use should be chosen at the moment an order is actually
-- dispatched, not fixed once in an env var.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pickup_locations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ABANDONED CHECKOUT RECOVERY — reuses the existing orders table rather
-- than needing new cart-tracking infrastructure: checkout already creates
-- a real order row with payment_status='pending' the moment someone
-- reaches "Place Order", before payment completes (see
-- POST /api/orders/checkout). An "abandoned checkout" is simply one of
-- these that never became paid — this column just tracks whether a
-- reminder has already gone out, so the same person never gets it twice.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS abandoned_reminder_sent_at TIMESTAMPTZ;

-- ============================================================================
-- REVIEWS — real customer reviews, gated to genuine purchases. order_id is
-- what makes a review "verified purchase" for real rather than by label
-- only: creating a review REQUIRES a matching PAID order containing that
-- product (enforced in server/routes/reviews.js), not just an account.
-- UNIQUE(customer_id, product_id) — one review per product per customer,
-- editable rather than stackable, so someone can't inflate a rating by
-- submitting the same review repeatedly.
-- ============================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id            SERIAL PRIMARY KEY,
  product_id    TEXT NOT NULL,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

-- ============================================================================
-- COUPON LIMITS — expiry date and usage caps, extending the coupon system
-- built earlier. Both nullable/false by default so every existing coupon
-- (AKARA10) keeps working exactly as before the moment this runs — no
-- expiry, no cap, unless an admin explicitly sets one going forward.
-- Redemption counts are deliberately NOT a stored counter column (which
-- risks drifting out of sync) — enforcement checks live against real PAID
-- orders instead, see lookupCoupon() in server/settings.js.
-- ============================================================================
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_redemptions INTEGER;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS one_per_customer BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- CONTACT SUBMISSIONS — found while adding a phone field to the Contact
-- page: the form had never actually sent anywhere at all. Clicking "Send
-- Message" just showed a fake "your message is in" confirmation with no
-- backend behind it — nothing was stored, no email went to
-- support@akaraonline.co.in, nothing. This table plus a real endpoint
-- (see server/routes/contact.js) makes that message honestly true.
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_submissions (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- NEWSLETTER SUBSCRIBERS — found while fixing the Footer's "Join" form: it
-- had no backend at all, just a client-side "Joined ✓" with nothing
-- actually stored. Columns are split by category (not one flat
-- "subscribed" flag) specifically so this same table can later back the
-- fuller Email Preferences page too — which has the identical
-- client-only problem — without a schema change when that gets built for
-- real. The Footer's simple form only ever sets the sensible defaults
-- below; nothing here exposes the granular categories yet.
-- ============================================================================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  new_arrivals    BOOLEAN NOT NULL DEFAULT true,
  promotions      BOOLEAN NOT NULL DEFAULT true,
  journal         BOOLEAN NOT NULL DEFAULT false,
  subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CANCELLATION REASON — captured at the moment a customer cancels an
-- order, so the business actually knows why rather than just that it
-- happened. cancellation_detail holds the free-text explanation when
-- "Other" is selected (or any extra context volunteered). Both nullable
-- since existing/past cancellations never had a reason attached.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_detail TEXT;


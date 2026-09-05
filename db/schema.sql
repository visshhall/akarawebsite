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
-- ORDERS — customer_id is nullable not for guest checkout (checkout has
-- required a logged-in customer since early in this project — see
-- requireAuth on POST /api/orders/checkout) but so a customer's order
-- history survives if their account is ever deleted: ON DELETE SET NULL
-- below keeps the order row itself (a real business/tax record) intact,
-- only detaching it from the now-gone customer, rather than cascading
-- the delete into every order they ever placed. items/shipping_address
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
-- ROLE-BASED ADMIN ACCESS — confirmed spec from the owner:
--   staff:       order lifecycle only (status changes, cancel, refund-trigger)
--                — nothing else (no Products, Media Manager, Customers,
--                Newsletter, Activity Log, Settings).
--   admin:       everything staff has, PLUS Products, Media Manager,
--                Featured Products, variants, Customers, Newsletter,
--                Activity Log, Return Requests, Settings.
--   super_admin: everything admin has, PLUS the site-wide CMS, and is the
--                ONLY role that can create or remove admin/staff accounts.
-- Every EXISTING admin account defaults to super_admin on this migration —
-- critical, since without this, the one real admin account this business
-- already uses would suddenly lose access to things it could do a moment
-- before the migration ran. The CHECK constraint keeps this a genuinely
-- closed set of three values, not free text an insert could typo into
-- something meaningless.
-- ============================================================================
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin';
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('staff','admin','super_admin'));


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

-- ============================================================================
-- PRODUCT STATUS — Phase 1 of the admin product-editor rebuild. Widens
-- the old stock-only field ('in-stock'/'low-stock'/'sold-out') into a
-- real status covering the product's whole visibility/purchasability
-- lifecycle, not just whether it's in stock. draft/hidden are never sent
-- to the public API at all (see products.js) — genuinely invisible, not
-- just visually hidden client-side. pre-order is new groundwork for the
-- still-pending customer-facing pre-order page treatment.
-- Migration is additive and safe to re-run: adds `status`, backfills it
-- from the old `stock` column for every existing row, then only drops
-- `stock` once every row genuinely has a status — never destructive on
-- a system that hasn't finished migrating yet.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='stock') THEN
    UPDATE products SET status = stock WHERE status IS NULL;
  END IF;
END $$;
ALTER TABLE products ALTER COLUMN status SET DEFAULT 'in-stock';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE status IS NULL) THEN
    ALTER TABLE products ALTER COLUMN status SET NOT NULL;
  END IF;
END $$;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('draft','in-stock','low-stock','sold-out','pre-order','hidden'));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='stock')
     AND NOT EXISTS (SELECT 1 FROM products WHERE status IS NULL) THEN
    ALTER TABLE products DROP COLUMN stock;
  END IF;
END $$;

-- ============================================================================
-- LANDMARK — optional field added to every address form site-wide
-- (checkout and the My Account address book). Nullable since existing
-- saved addresses never had one. Checkout's own address doesn't need a
-- migration — it's stored as JSONB (shipping_address), which just needed
-- the field added on the application side, not the database side.
-- ============================================================================
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS landmark TEXT;

-- ============================================================================
-- PASSWORD RESET — found the entire forgot/reset-password flow was
-- completely fake end to end: both pages just simulated success with
-- local component state, no email ever sent, no token ever generated,
-- no password ever actually changed. Storing a HASH of the reset token
-- (never the raw token itself) matching how password_hash already
-- works — if this table were ever exposed, a stored hash can't be used
-- to actually reset anyone's account, only the real emailed token can.
-- Nullable since most customers have no reset in progress at any
-- given time.
-- ============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

-- ============================================================================
-- MAINTENANCE NOTICE — homepage "still under construction" popup, admin-
-- toggleable from Settings so it can go on/off without a code change.
-- Reuses the existing generic settings table (no new table needed), same
-- seeding pattern as shipping_cost above. Defaults to off — this is
-- something an admin deliberately turns on, never accidentally live.
-- ============================================================================
INSERT INTO settings (key, value) VALUES ('maintenance_mode', '0') ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- BULK ORDER ENQUIRIES — found this form was still using a raw mailto:
-- link, same broken pattern the Contact form had before it was fixed:
-- no real delivery guarantee, and on a phone with no email client
-- configured, submitting does nothing visible while still claiming
-- success. Same shape and same fix as contact_submissions above.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bulk_order_enquiries (
  id          SERIAL PRIMARY KEY,
  company     TEXT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL,
  quantity    TEXT NOT NULL,
  interest    TEXT,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- COD (CASH ON DELIVERY) — a real payment method alongside Razorpay,
-- specifically requested so order-flow testing (cancellation, status
-- updates, refunds) doesn't need real live money. Admin-toggleable from
-- Settings, same generic-settings pattern as maintenance_mode, and
-- defaults to off — this is something an admin deliberately turns on.
-- payment_method distinguishes how an order was placed; 'cod' is added
-- to payment_status as a genuinely distinct state from 'pending' — a
-- Razorpay checkout that's abandoned mid-payment is 'pending' and should
-- resolve within minutes, whereas a COD order stays 'cod' indefinitely
-- until cash is actually collected at delivery, which is a real,
-- different situation that deserves its own value rather than
-- overloading 'pending' to mean two different things.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('razorpay','cod'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('pending','paid','failed','refunded','partially_refunded','cod'));
ALTER TABLE orders ALTER COLUMN razorpay_order_id DROP NOT NULL;
INSERT INTO settings (key, value) VALUES ('cod_enabled', '0') ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- COD FEE — a flat handling charge added to the order total specifically
-- when Cash on Delivery is chosen (never for online payment). Its own
-- column, same reasoning as shipping_cost having one: it needs to show
-- as a distinct, traceable line item on the invoice and order summary,
-- not just get silently folded into the total. Admin-configurable
-- (defaults to ₹99) rather than hardcoded, matching every other money
-- amount in this app.
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_fee INTEGER NOT NULL DEFAULT 0;
INSERT INTO settings (key, value) VALUES ('cod_fee', '99') ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- M-11 — a real gap found in an independent security review: duplicate
-- razorpay_order_id values were only ever prevented by application logic
-- (the checkout route only ever inserts one order per created Razorpay
-- order), never by the database itself. A genuine safety net, not just
-- theoretical — a race condition or a future code change could otherwise
-- let two order rows share the same razorpay_order_id, which would
-- silently corrupt which order a webhook or /verify call actually
-- updates. Deliberately NOT a blind CREATE UNIQUE INDEX: that would
-- crash this entire migration outright on any database that happens to
-- already have a duplicate, however unlikely. This checks first, and
-- only adds the constraint if it's actually safe to — printing a clear,
-- actionable NOTICE instead of a hard failure if it isn't, so a
-- deployment never breaks because of this specific step.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT razorpay_order_id FROM orders
    WHERE razorpay_order_id IS NOT NULL
    GROUP BY razorpay_order_id HAVING COUNT(*) > 1
  ) dupes;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id_unique
      ON orders (razorpay_order_id)
      WHERE razorpay_order_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'Skipped adding a unique constraint on orders.razorpay_order_id — % duplicate value(s) found. Run this to find them: SELECT razorpay_order_id, COUNT(*) FROM orders WHERE razorpay_order_id IS NOT NULL GROUP BY razorpay_order_id HAVING COUNT(*) > 1;  Resolve the duplicates, then re-run this migration to add the constraint.', dup_count;
  END IF;
END $$;

-- Plain performance indexes — safe unconditionally, no uniqueness
-- concern, just speeding up the two most common lookups these columns
-- are actually queried by (admin order filtering by status; password
-- reset's token lookup, which runs on every reset attempt).
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_customers_reset_token_hash
  ON customers (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

-- ============================================================================
-- PHONE CHANGE VIA WHATSAPP OTP — same hashed-token, never-store-plain
-- shape as password reset above, but verifying a CHANGE rather than an
-- identity, so the pending NEW phone number has to be held somewhere
-- until the code is confirmed. pending_phone is genuinely NULL for
-- every customer until they start a change — the real phone stays in
-- the existing `phone` column the whole time, only swapped over once
-- the OTP is confirmed correct.
-- ============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pending_phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_otp_hash TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_otp_expires TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_otp_attempts INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- KEY FEATURES — a real, separate tab on the product page (alongside
-- Description, Dimensions, Care Guide, Reviews), for short bullet-point
-- callouts ("Handmade in Mumbai", "Food-safe finish") distinct from the
-- longer descriptive paragraph in `description`. A JSONB array of plain
-- strings, genuinely flexible length (owner wants add/remove, not a
-- fixed count) — same "array of simple values" shape reasoning as
-- `media`, just strings instead of {type,src} objects.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS key_features JSONB NOT NULL DEFAULT '[]';

-- ============================================================================
-- EMAIL CHANGE VIA OTP — same real, hashed-token shape as the phone
-- change (pending_phone/phone_otp_*) above, mirrored for email. A
-- genuinely different delivery consideration from phone: the
-- verification code goes to the NEW email address (proving the
-- customer can actually receive mail there), not the account's
-- existing one — the opposite of how phone-change OTP works, where the
-- code goes to the EXISTING, already-verified email since there was no
-- separate channel to prove the new phone belonged to anyone. Email
-- change has its own real channel (the new address itself) to prove
-- ownership with, so it uses that directly instead.
-- ============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_otp_hash TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_otp_expires TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_otp_attempts INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- PHASE 3 — HOMEPAGE SECTIONS. The "New this season" section was
-- previously PRODUCTS.slice(0,3) — the first 3 rows in whatever order
-- the database happened to return them, not a real curated choice.
-- featured_order is nullable and doubles as the flag: NULL means "not
-- featured", a real integer means "featured, shown in this order" —
-- avoids a separate boolean that could drift out of sync with the
-- ordering value (e.g. is_featured=true but featured_order=NULL, which
-- would be a genuinely ambiguous state to handle in application code).
-- "New Collection" deliberately needs NO new column at all — it's
-- based on the product's real, existing created_at, the honest
-- definition of "new" that requires zero extra admin upkeep to stay
-- accurate as the catalog grows.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_order INTEGER;

-- ============================================================================
-- SIGNUP EMAIL VERIFICATION — a real, separate STAGING table, not columns
-- on `customers`, because there IS no customer row yet at this point.
-- Confirmed spec: a mistyped email must mean the person can never get
-- past this screen and never ends up with a real account — a passive
-- "verify later" link was explicitly rejected, since a wrong email
-- would then just silently never receive anything with no signal
-- anything went wrong. Everything needed to actually create the
-- account (name, phone, password already hashed) is held here,
-- untouched, until the OTP is confirmed correct — only then does a
-- real row get inserted into `customers`. Deliberately keyed by email
-- (not an auto-increment id) since a repeat signup attempt with the
-- same email should replace the pending attempt, not pile up rows.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pending_signups (
  email           TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  otp_hash        TEXT NOT NULL,
  otp_expires     TIMESTAMPTZ NOT NULL,
  otp_attempts    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SITE-WIDE CMS — super_admin only, confirmed spec: every piece of
-- editable text across the site's static content pages (About, FAQ, Care
-- Guide, and every legal/policy page), editable live with no redeploy.
--
-- Each row is ONE content block (a heading or a paragraph) — not one row
-- per whole page — because these pages are genuinely structured as a
-- sequence of headings and paragraphs (see the existing Lh/Lp component
-- pattern already used throughout AkaraApp.jsx), and a block-based model
-- lets an admin add, remove, or reorder sections, not just edit existing
-- text in place. `page_key` groups blocks belonging to one page (e.g.
-- "privacy", "about"); `sort_order` is the block's position within that
-- page — both together, not either alone, since a page can have many
-- blocks and their ORDER is part of the real content.
-- ============================================================================
CREATE TABLE IF NOT EXISTS page_content (
  id            SERIAL PRIMARY KEY,
  page_key      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,
  -- Added when extending the CMS to FAQ and Care Guide, both of which
  -- have genuinely different real structure from the legal pages'
  -- plain heading/paragraph sequence:
  --   'qa'         — one FAQ question+answer pair. content is JSON
  --                  {"q": "...", "a": "..."} — kept as ONE block (not
  --                  two separate ones) since a question with no
  --                  answer, or vice versa, isn't a meaningful partial
  --                  state worth allowing.
  --   'bulletList' — one Care Guide section: a title plus a list of
  --                  bullet points. content is JSON
  --                  {"title": "...", "points": ["...", "..."]} — kept
  --                  as one block (not a heading block + N separate
  --                  bullet blocks) so reordering a whole section stays
  --                  a single move, not N+1 coordinated moves.
  -- The CHECK itself lives in a real ALTER TABLE below, not inline here
  -- — a constraint written inline only ever applies the FIRST time this
  -- table is created; on a database that already has page_content from
  -- an earlier deploy, CREATE TABLE IF NOT EXISTS is a no-op and an
  -- inline constraint change would silently never take effect.
  block_type    TEXT NOT NULL,
  content       TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    INTEGER REFERENCES admins(id) ON DELETE SET NULL
);
-- Extended for the About/Craft pages — genuinely different real layout
-- SHAPES (not just heading/paragraph text) that appear more than once
-- across these two pages, so each becomes its own real, reusable block
-- type rather than forcing either page's actual visual design to
-- collapse into a plain linear list of headings and paragraphs:
--   'hero'      — {eyebrow, heading, subtext} centered intro block,
--                 used at the top of both About and Craft.
--   'quote'     — {quote, attribution} the italic pull-quote treatment
--                 (About's closing "sixty pieces a month" section).
--   'darkPanel' — {eyebrow, heading, body} the full-bleed dark teal
--                 callout section (About's process intro, Craft's
--                 Thane studio section).
--   'stepGrid'  — {steps: [{number, title, description}]} the
--                 numbered process row on a dark background (About's
--                 "From idea to your door").
--   'cardGrid'  — {cards: [{title, description}]} the light card row
--                 (Craft's Design/Material/Machine cards).
-- Genuinely NOT added generally to every page — these five exist
-- specifically because About/Craft's real visual design needs them;
-- the legal pages/FAQ/Care Guide never use them.
-- Extended for the homepage hero and footer — the "second CMS pass",
-- explicitly deferred when About/Craft were converted since both are
-- structurally different from a normal content page (an animated
-- hero with interactive CTAs; a fixed, four-column footer grid mixing
-- real copy with real navigation structure).
--   'heroWithCta' — {eyebrow, heading, subtext, ctaLabel, ctaLabel2}
--                   the homepage hero specifically. Deliberately a
--                   real, SEPARATE type from the existing 'hero' (used
--                   by About/Craft) rather than adding CTA fields to
--                   that one — About/Craft's hero has no inline CTA
--                   buttons of its own (they use a shared, fixed CTA
--                   row after all the page's blocks), so bolting CTA
--                   fields onto the shared type would be real, unused
--                   noise on every page except the homepage. CTA
--                   *destinations* (which route each button navigates
--                   to) are deliberately NOT part of this block —
--                   changing where a button goes is a routing
--                   decision, not a wording one, same real reasoning
--                   already applied to About/Craft's own CTA row.
--   'footerBrand' — {tagline, email, phone, instagram, location,
--                    newsletterBlurb} the footer's real copy — the
--                    brand tagline, contact details, and newsletter
--                    intro line. Deliberately does NOT include the
--                    Collections/Company/legal links columns, which
--                    are real site navigation derived from actual
--                    product categories and routes, not copy — making
--                    those admin-editable text would let a typo
--                    silently break real navigation.
ALTER TABLE page_content DROP CONSTRAINT IF EXISTS page_content_block_type_check;
ALTER TABLE page_content ADD CONSTRAINT page_content_block_type_check CHECK (block_type IN ('heading','paragraph','table','qa','bulletList','hero','quote','darkPanel','stepGrid','cardGrid','heroWithCta','footerBrand'));
CREATE INDEX IF NOT EXISTS idx_page_content_page_key ON page_content(page_key, sort_order);

-- Real version history — the "one-click revert" safety net the owner
-- explicitly asked for. A full snapshot of a page's ENTIRE block list
-- (as JSON) taken right before a save overwrites it — not a per-block
-- diff, since the simplest, most reliably reversible unit here is "what
-- did the whole page look like a moment ago", not trying to reconstruct
-- an add/remove/reorder history block by block.
CREATE TABLE IF NOT EXISTS page_content_history (
  id            SERIAL PRIMARY KEY,
  page_key      TEXT NOT NULL,
  snapshot      JSONB NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_by      INTEGER REFERENCES admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_page_content_history_page_key ON page_content_history(page_key, saved_at DESC);

-- ============================================================================
-- PHASE 4 — SIZE & COLOR VARIANTS. Confirmed spec:
--   - Both size AND color independently affect price and stock, tracked
--     SEPARATELY per size+color combination (not one stock value per
--     product overall).
--   - Colors are custom PER PRODUCT, not a shared catalog-wide palette —
--     e.g. a planter has its own body color, shown as a plain label
--     under the photo, not two separate pickers for "body" and "tray".
--     Each real color choice ("Natural body / Black tray") is one row
--     here, one single option in the list.
--   - A product with no rows in product_variants has no size/color
--     picker at all — the base products.price/status columns keep
--     meaning exactly what they always did for a simple product.
--
-- product_colors: a product's own real color options. variant_key is
-- the short, stable identifier used to build a photo ID (see
-- server/photoId.js) — e.g. "black", "natural-black-tray" — kept
-- separate from the human-readable label so a label can be edited
-- (typo fix, rewording) without silently breaking every photo ID that
-- already references this color.
CREATE TABLE IF NOT EXISTS product_colors (
  id            SERIAL PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_key   TEXT NOT NULL,
  label         TEXT NOT NULL,
  swatch_hex    TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, variant_key)
);
CREATE INDEX IF NOT EXISTS idx_product_colors_product ON product_colors(product_id);

-- product_variants: the real, individually-priced/stocked size+color
-- combinations that actually exist for sale. Genuinely NOT every
-- possible combination is required to exist — a product might sell
-- Black only in Medium/Large but Red only in Small, and this table
-- only needs rows for combinations that are real. size is nullable
-- (a product might have color options but no size options, or vice
-- versa) — color_id is NOT nullable when present, since a variant row
-- with neither a real size nor a real color would carry no actual
-- information.
CREATE TABLE IF NOT EXISTS product_variants (
  id            SERIAL PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_id      INTEGER REFERENCES product_colors(id) ON DELETE CASCADE,
  size          TEXT,
  price         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'in-stock'
                CHECK (status IN ('in-stock','low-stock','sold-out','pre-order')),
  -- Added after discovering real data during the split-color merge
  -- (server/merge-variant-products.js): the three existing Helion Vase
  -- colors and two Vermillion Lamp colors don't just differ in price —
  -- they have genuinely different real dimensions per color (e.g.
  -- Helion Vase Black is 9×9×10cm while Bronze is 6×6×25cm). Nullable,
  -- because most products' variants share the same product-level dims
  -- and don't need an override — only set when a specific size/color
  -- combination genuinely has different real measurements.
  dims          TEXT,
  UNIQUE(product_id, color_id, size)
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);

-- Accessories (bulbs, wire, etc) as mandatory free informational text —
-- built generally per the confirmed spec, but hidden on the customer
-- side until a non-lamp category actually has real content here; a
-- lamp with an empty accessories_note just shows nothing extra.
ALTER TABLE products ADD COLUMN IF NOT EXISTS accessories_note TEXT;

-- ============================================================================
-- ACCOUNT DELETION / DPDP COMPLIANCE. Real design decision, made
-- deliberately: when a customer deletes their account —
--   orders     — KEPT, customer_id set NULL (already correct: this
--                schema already had ON DELETE SET NULL here, matching
--                the 8-year statutory tax retention requirement
--                documented in the Privacy Policy's own Data Retention
--                table — an order is a real transaction record, not
--                just "the customer's data").
--   addresses,
--   wishlist_items — DELETED (already correct: ON DELETE CASCADE,
--                these are genuinely personal and have no retention
--                requirement once the account is gone).
--   reviews    — KEPT, customer_id set NULL, changed HERE from CASCADE
--                to SET NULL. A review is real, useful feedback other
--                shoppers rely on — deleting it just because the
--                reviewer later closed their account would be an
--                unintended side effect, not a deliberate choice
--                anyone actually made when this table was first built.
--                The application layer shows a NULL-customer_id review
--                as "Verified Customer" instead of the real name.
-- ============================================================================
ALTER TABLE reviews ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_customer_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- A real, permanent audit record that a deletion happened — kept
-- SEPARATELY from the customers table itself (which the row is being
-- removed from), since "did this business actually process a real
-- deletion request, and when" is the business's own compliance record
-- to keep, not personal data belonging to the person who left. Stores
-- only what's needed to answer "was this handled" — not a copy of the
-- deleted personal data itself, which would defeat the entire point.
CREATE TABLE IF NOT EXISTS account_deletions (
  id              SERIAL PRIMARY KEY,
  customer_email  TEXT NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- COUPON VISIBILITY — real, deliberate design decision: NOT every active
-- coupon becomes public just because this exists. A coupon table can
-- reasonably hold codes meant for a specific customer segment, a gift,
-- or an influencer partnership — exposing all of them as a public list
-- the moment "coupon visibility" is built would be a genuine business
-- mistake, not a safe default. `featured` is an explicit, separate
-- opt-in an admin sets per coupon — defaults to false, so every
-- existing coupon (including AKARA10) stays exactly as invisible as it
-- is today until an admin deliberately marks it for public display.
-- `label` is the real, short marketing text shown on the public banner
-- (e.g. "10% off your first order") — kept separate from the coupon's
-- own discount_percent/code, since the public-facing wording an admin
-- wants to show isn't always just "CODE for X% off" verbatim.
-- ============================================================================
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS label TEXT;

-- ============================================================================
-- ENQUIRIES — a real "handled" marker for the admin unified Enquiries
-- view. Neither table had ANY status tracking before this (both were
-- write-only from real customer forms, with no admin screen to read
-- them at all until now) — without this, the new screen would just be
-- a flat, ever-growing list with no way to tell what's already been
-- dealt with from what's genuinely new. Defaults to false so every
-- EXISTING submission — real messages sent before this screen existed
-- — correctly shows up as unhandled/new the first time an admin opens
-- this, rather than being silently marked as already-handled.
-- ============================================================================
ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS handled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bulk_order_enquiries ADD COLUMN IF NOT EXISTS handled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- ADMIN 2FA (TOTP) — real, optional-but-encouraged two-factor
-- authentication for admin/staff accounts, confirmed spec: TOTP
-- (Google Authenticator / Authy — no SMS, no new third-party service
-- needed), optional per-account rather than hard-required at the
-- database level (a forced requirement with no working fallback risks
-- a genuine lockout if a device is lost, before this has been proven
-- out in real use).
--
-- totp_secret is stored ENCRYPTED (AES-256-GCM, via server/twoFactor.js),
-- never plaintext — a leaked database dump must not hand over every
-- admin's real 2FA secret directly. totp_enabled is FALSE until setup
-- is actually verified (see the enable endpoint) — generating a secret
-- and immediately trusting it, before the admin has proven they can
-- actually produce a valid code from it, would risk a real self-lockout
-- from a typo'd authenticator-app setup.
-- ============================================================================
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- Real, single-use backup codes — the account-recovery path if a real
-- device is lost. A separate table (not a JSON array column) so each
-- code can be independently marked used, and so the count of remaining
-- codes is a real, simple query rather than parsing JSON.
CREATE TABLE IF NOT EXISTS admin_backup_codes (
  id            SERIAL PRIMARY KEY,
  admin_id      INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  used_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_admin_backup_codes_admin ON admin_backup_codes(admin_id);


-- ============================================================================
-- Google Sign-In — customers may authenticate with Google instead of
-- (or in addition to) email/password. password_hash becomes nullable so
-- a Google-only account is valid; google_id stores Google's stable sub.
-- ============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE customers ALTER COLUMN password_hash DROP NOT NULL;

-- ============================================================================
-- Web Push subscriptions (PWA). endpoint is unique. Either admin_id or
-- customer_id may be set — admins get new-order alerts; customers get
-- status milestones when opted in.
-- ============================================================================
-- Web Push. DROP+CREATE so a failed earlier migrate (integer FK vs UUID
-- customers.id) cannot leave a broken table that IF NOT EXISTS would skip.
DROP TABLE IF EXISTS push_subscriptions;
CREATE TABLE push_subscriptions (
  id              SERIAL PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  admin_id        INTEGER,
  customer_id     TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_admin ON push_subscriptions(admin_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON push_subscriptions(customer_id);

-- ============================================================================
-- CATEGORIES — admin-managed catalogue sections (add/remove without code deploys).
-- Products.category stores the display name; slug is used in /shop/:slug URLs.
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  icon_key        TEXT NOT NULL DEFAULT 'planters',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_active_sort ON categories (is_active, sort_order);

INSERT INTO categories (name, slug, description, sort_order, icon_key) VALUES
  ('Planters', 'planters', 'Grounded forms for living greens', 10, 'planters'),
  ('Vases', 'vases', 'Quiet vessels for cut stems', 20, 'vases'),
  ('Ceiling Lighting', 'ceiling-lighting', 'Light from above, softly', 30, 'ceiling-lighting'),
  ('Table Lamps', 'table-lamps', 'Glow for desks and shelves', 40, 'table-lamps'),
  ('Lanterns', 'lanterns', 'Portable pools of light', 50, 'lanterns'),
  ('Floor Lamps', 'floor-lamps', 'Tall light for open rooms', 60, 'floor-lamps')
ON CONFLICT (name) DO NOTHING;


-- Finish swatches on PDP (name + optional hex colour)
ALTER TABLE products ADD COLUMN IF NOT EXISTS finishes JSONB NOT NULL DEFAULT '[]';
-- Partial refund tracking (paise/rupees already in total; store rupees refunded)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_refunded NUMERIC(12,2) NOT NULL DEFAULT 0;

-- MIGRATE partially_refunded + amount_refunded (idempotent)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_refunded NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('pending','paid','failed','refunded','partially_refunded','cod'));

-- REAL, PER-PRODUCT COST TRACKING — directly requested: a single,
-- current cost breakdown per product (material, labor, electricity,
-- packaging, transport, design, other), entered once and updated
-- whenever real costs change, NOT per batch/print run — a real,
-- deliberate simplification agreed on directly, since a per-batch
-- system would need real, additional complexity (which batch does a
-- given sale belong to?) that isn't what's actually needed here.
-- A real JSONB object (not 7 separate real columns) — follows the
-- exact same, established pattern this schema already uses for
-- `finishes`/`key_features`/`media`: a flexible, real, structured
-- value living in one column, read and written as a whole by the
-- admin editor. Real shape:
-- {"material":0,"labor":0,"electricity":0,"packaging":0,"transport":0,"design":0,"other":0}
-- All real values in whole rupees, matching this table's own existing
-- `price` column convention (INTEGER, GST-exclusive, whole rupees) —
-- deliberately NOT storing a pre-computed "total cost" or "profit"
-- field here: those are always derived, live, from these raw real
-- inputs plus the real, current `price` column, so they can never go
-- stale relative to either one changing independently.
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_breakdown JSONB NOT NULL DEFAULT '{}';

-- REAL, ANDROID APP UPDATE-CHANNEL METADATA — directly requested,
-- following the real, official integration guide's own spec for
-- /app/android-version.json. A real, single JSON value under one
-- settings key (matching the same, established pattern used for
-- cost_breakdown above and every other structured setting in this
-- project), rather than a dedicated real table — this is genuinely
-- just one, current, admin-editable record, not a real history of
-- past versions to query. Real shape:
-- {"versionName":"","versionCode":0,"minVersionCode":null,"apkUrl":"","releaseNotes":"","forceUpdate":false}
-- Deliberately does NOT store the actual real APK file here — that's
-- a real, large binary that belongs in Cloudflare R2 (see server/r2.js,
-- already used for real product photos/videos), with only its real,
-- resulting public URL recorded in this setting's "apkUrl" field.
INSERT INTO settings (key, value) VALUES ('android_app_version', '{}') ON CONFLICT (key) DO NOTHING;

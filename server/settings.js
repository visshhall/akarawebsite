// Reads the shipping settings fresh from the database on every call —
// deliberately not cached in memory. An admin's change to shipping cost or
// the free-shipping threshold should apply to the very next checkout, not
// require a server restart or a stale in-memory value to expire. Falls
// back to the original hardcoded defaults if a row is somehow missing
// (shouldn't happen — the migration seeds both — but checkout must never
// crash just because a setting row got deleted).
import { query } from "./db.js";

const DEFAULTS = { shipping_cost: 150, free_shipping_threshold: 2500 };

export async function getShippingSettings() {
  const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('shipping_cost','free_shipping_threshold')");
  const byKey = Object.fromEntries(rows.map(r => [r.key, Number(r.value)]));
  return {
    shippingCost: Number.isFinite(byKey.shipping_cost) ? byKey.shipping_cost : DEFAULTS.shipping_cost,
    freeShippingThreshold: Number.isFinite(byKey.free_shipping_threshold) ? byKey.free_shipping_threshold : DEFAULTS.free_shipping_threshold,
  };
}

// Looks up a coupon code against the real coupons table — case-insensitive,
// only ever returns a discount for a code that exists, is active, hasn't
// expired, hasn't hit its total redemption cap, and — if marked
// one-per-customer — hasn't already been used by THIS customer. This is
// the single place that decides whether a coupon applies; both the real
// checkout and the public validate-a-code endpoint call this same
// function, so they can never disagree with each other.
//
// Redemption counts are checked live against real PAID orders (never a
// stored counter that could drift out of sync) — an abandoned checkout
// that never completed payment never counts as "used", matching what a
// customer would actually expect.
//
// customerId is optional — the public coupon-preview endpoint can be
// called before login (browsing the Cart page as a guest), where the
// one-per-customer check simply can't apply yet; the real, authoritative
// check happens again at actual checkout, which always requires login.
export async function lookupCoupon(code, customerId = null) {
  if (typeof code !== "string" || !code.trim()) return null;
  const normalizedCode = code.trim().toUpperCase();
  const { rows } = await query(
    "SELECT code, discount_percent, expires_at, max_redemptions, one_per_customer FROM coupons WHERE code = $1 AND active = true",
    [normalizedCode]
  );
  if (rows.length === 0) return null;
  const coupon = rows[0];

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return null;

  if (coupon.max_redemptions !== null) {
    const { rows: countRows } = await query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE coupon_code = $1 AND payment_status = 'paid'",
      [normalizedCode]
    );
    if (countRows[0].n >= coupon.max_redemptions) return null;
  }

  if (coupon.one_per_customer && customerId) {
    const { rows: usedRows } = await query(
      "SELECT 1 FROM orders WHERE coupon_code = $1 AND payment_status = 'paid' AND customer_id = $2 LIMIT 1",
      [normalizedCode, customerId]
    );
    if (usedRows.length > 0) return null;
  }

  return { code: coupon.code, discountPercent: coupon.discount_percent };
}

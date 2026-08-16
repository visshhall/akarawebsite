import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/settings — current shipping cost + free-shipping threshold.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT key, value FROM settings");
  const byKey = Object.fromEntries(rows.map(r => [r.key, Number(r.value)]));
  res.json({
    shippingCost: byKey.shipping_cost ?? 150,
    freeShippingThreshold: byKey.free_shipping_threshold ?? 2500,
  });
}));

// PUT /api/admin/settings — updates shipping cost and/or the free-shipping
// threshold. Both must be non-negative whole rupee amounts — this directly
// controls what every future customer gets charged, so the same strict
// validation used for product prices applies here too.
router.put("/", requireAdmin, asyncHandler(async (req, res) => {
  const { shippingCost, freeShippingThreshold } = req.body || {};
  if (!Number.isInteger(shippingCost) || shippingCost < 0) {
    return res.status(400).json({ error: "Shipping cost must be a non-negative whole number (rupees)." });
  }
  if (!Number.isInteger(freeShippingThreshold) || freeShippingThreshold < 0) {
    return res.status(400).json({ error: "Free-shipping threshold must be a non-negative whole number (rupees)." });
  }

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('shipping_cost', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [String(shippingCost)]
  );
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('free_shipping_threshold', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [String(freeShippingThreshold)]
  );
  await logAdminAction(req.admin.id, "settings.update", { shippingCost, freeShippingThreshold });
  res.json({ shippingCost, freeShippingThreshold });
}));

// GET /api/admin/coupons — every coupon, active or not (the customer-facing
// side only ever sees active ones, via the separate public validate route).
router.get("/coupons", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT code, discount_percent, active, expires_at, max_redemptions, one_per_customer, created_at FROM coupons ORDER BY created_at DESC");
  res.json({ coupons: rows.map(r => ({
    code: r.code, discountPercent: r.discount_percent, active: r.active,
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    maxRedemptions: r.max_redemptions, onePerCustomer: r.one_per_customer,
    createdAt: new Date(r.created_at).getTime(),
  })) });
}));

// POST /api/admin/coupons — creates a new coupon code. expiresAt/
// maxRedemptions are both optional (null = no expiry / unlimited uses) —
// most coupons won't need either, so nothing is forced.
router.post("/coupons", requireAdmin, asyncHandler(async (req, res) => {
  const { code, discountPercent, expiresAt, maxRedemptions, onePerCustomer } = req.body || {};
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,20}$/.test(normalizedCode)) {
    return res.status(400).json({ error: "Coupon code must be 3-20 letters/numbers, no spaces or symbols." });
  }
  if (!Number.isInteger(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    return res.status(400).json({ error: "Discount must be a whole number between 1 and 100 (percent)." });
  }
  if (expiresAt !== undefined && expiresAt !== null && isNaN(new Date(expiresAt).getTime())) {
    return res.status(400).json({ error: "Expiry date isn't valid." });
  }
  if (maxRedemptions !== undefined && maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
    return res.status(400).json({ error: "Max redemptions must be a positive whole number, or left blank for unlimited." });
  }

  const { rows: existing } = await query("SELECT code FROM coupons WHERE code=$1", [normalizedCode]);
  if (existing.length > 0) return res.status(409).json({ error: "A coupon with this code already exists." });

  await query(
    "INSERT INTO coupons (code, discount_percent, expires_at, max_redemptions, one_per_customer) VALUES ($1,$2,$3,$4,$5)",
    [normalizedCode, discountPercent, expiresAt || null, maxRedemptions || null, Boolean(onePerCustomer)]
  );
  await logAdminAction(req.admin.id, "coupon.create", { code: normalizedCode, discountPercent, expiresAt, maxRedemptions, onePerCustomer: Boolean(onePerCustomer) });
  res.status(201).json({ code: normalizedCode, discountPercent, active: true, expiresAt, maxRedemptions, onePerCustomer: Boolean(onePerCustomer) });
}));

// PUT /api/admin/coupons/:code — toggle active/inactive and/or change any
// of the coupon's settings. Deactivating (rather than deleting) is the
// normal way to retire a code — it stays in the activity log and coupon
// list, it just stops applying at checkout the moment this is saved
// (lookupCoupon() in server/settings.js only ever matches active=true).
router.put("/coupons/:code", requireAdmin, asyncHandler(async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { discountPercent, active, expiresAt, maxRedemptions, onePerCustomer } = req.body || {};
  const { rows: existing } = await query("SELECT * FROM coupons WHERE code=$1", [code]);
  if (existing.length === 0) return res.status(404).json({ error: "Coupon not found." });

  const newDiscount = discountPercent !== undefined ? discountPercent : existing[0].discount_percent;
  const newActive = active !== undefined ? Boolean(active) : existing[0].active;
  const newExpiresAt = expiresAt !== undefined ? expiresAt : existing[0].expires_at;
  const newMaxRedemptions = maxRedemptions !== undefined ? maxRedemptions : existing[0].max_redemptions;
  const newOnePerCustomer = onePerCustomer !== undefined ? Boolean(onePerCustomer) : existing[0].one_per_customer;
  if (!Number.isInteger(newDiscount) || newDiscount <= 0 || newDiscount > 100) {
    return res.status(400).json({ error: "Discount must be a whole number between 1 and 100 (percent)." });
  }
  if (newExpiresAt !== null && isNaN(new Date(newExpiresAt).getTime())) {
    return res.status(400).json({ error: "Expiry date isn't valid." });
  }
  if (newMaxRedemptions !== null && (!Number.isInteger(newMaxRedemptions) || newMaxRedemptions <= 0)) {
    return res.status(400).json({ error: "Max redemptions must be a positive whole number, or left blank for unlimited." });
  }

  await query(
    "UPDATE coupons SET discount_percent=$1, active=$2, expires_at=$3, max_redemptions=$4, one_per_customer=$5 WHERE code=$6",
    [newDiscount, newActive, newExpiresAt || null, newMaxRedemptions || null, newOnePerCustomer, code]
  );
  await logAdminAction(req.admin.id, "coupon.update", {
    code,
    from: { discountPercent: existing[0].discount_percent, active: existing[0].active },
    to: { discountPercent: newDiscount, active: newActive },
  });
  res.json({ code, discountPercent: newDiscount, active: newActive, expiresAt: newExpiresAt, maxRedemptions: newMaxRedemptions, onePerCustomer: newOnePerCustomer });
}));

router.delete("/coupons/:code", requireAdmin, asyncHandler(async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { rows } = await query("DELETE FROM coupons WHERE code=$1 RETURNING code", [code]);
  if (rows.length === 0) return res.status(404).json({ error: "Coupon not found." });
  await logAdminAction(req.admin.id, "coupon.delete", { code });
  res.json({ ok: true });
}));

// GET /api/admin/settings/pickup-locations — every saved pickup address
// nickname. Each one MUST exactly match an address nickname already
// registered on Shiprocket's own dashboard (see server/shiprocket.js) —
// this app has no way to verify that match itself, it just stores
// whatever name an admin says to trust.
router.get("/pickup-locations", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name FROM pickup_locations ORDER BY name ASC");
  res.json({ pickupLocations: rows });
}));

router.post("/pickup-locations", requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Pickup location name is required." });
  const { rows: existing } = await query("SELECT id FROM pickup_locations WHERE name=$1", [name.trim()]);
  if (existing.length > 0) return res.status(409).json({ error: "This pickup location is already saved." });

  const { rows } = await query("INSERT INTO pickup_locations (name) VALUES ($1) RETURNING id, name", [name.trim().slice(0, 200)]);
  await logAdminAction(req.admin.id, "pickup_location.create", { name: rows[0].name });
  res.status(201).json({ pickupLocation: rows[0] });
}));

router.delete("/pickup-locations/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("DELETE FROM pickup_locations WHERE id=$1 RETURNING name", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Pickup location not found." });
  await logAdminAction(req.admin.id, "pickup_location.delete", { name: rows[0].name });
  res.json({ ok: true });
}));

export default router;

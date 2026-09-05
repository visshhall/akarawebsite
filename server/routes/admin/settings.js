import { Router } from "express";
import multer from "multer";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole, logAdminAction } from "../../adminAuth.js";
import { getR2PublicUrl, r2Configured, uploadToR2 } from "../../r2.js";

const router = Router();

// GET /api/admin/settings — current shipping cost + free-shipping threshold
// + maintenance mode.
router.get("/", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT key, value FROM settings");
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    shippingCost: Number(byKey.shipping_cost ?? 150),
    freeShippingThreshold: Number(byKey.free_shipping_threshold ?? 2500),
    maintenanceMode: byKey.maintenance_mode === "1",
    maintenanceMessage: byKey.maintenance_message || "We're still putting the finishing touches on things — thanks for your patience while we get everything just right.",
    codEnabled: byKey.cod_enabled === "1",
    codFee: Number(byKey.cod_fee ?? 99),
  });
}));

// PUT /api/admin/settings — updates shipping cost and/or the free-shipping
// threshold. Both must be non-negative whole rupee amounts — this directly
// controls what every future customer gets charged, so the same strict
// validation used for product prices applies here too.
router.put("/", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
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

// PUT /api/admin/settings/maintenance — toggles the "still under
// construction" notice shown to customers on the homepage, and lets the
// message itself be edited without a code change. A blank/missing
// message falls back to the same default getMaintenanceSettings() uses.
router.put("/maintenance", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { enabled, message } = req.body || {};
  const safeMessage = typeof message === "string" ? message.trim().slice(0, 300) : "";

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('maintenance_mode', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [enabled ? "1" : "0"]
  );
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('maintenance_message', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [safeMessage]
  );
  await logAdminAction(req.admin.id, "settings.maintenance_update", { enabled: !!enabled });
  res.json({ maintenanceMode: !!enabled, maintenanceMessage: safeMessage });
}));

// PUT /api/admin/settings/cod — toggles Cash on Delivery as a checkout
// option. Off by default (see the settings seed in schema.sql) — this is
// something an admin deliberately turns on, never accidentally live.
router.put("/cod", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { enabled, fee } = req.body || {};
  // fee is optional on this call — only validated/saved if actually
  // provided, so toggling on/off from the switch (which doesn't send a
  // fee at all) never accidentally resets it.
  if (fee !== undefined && (!Number.isInteger(fee) || fee < 0)) {
    return res.status(400).json({ error: "COD fee must be a non-negative whole number (rupees)." });
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('cod_enabled', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [enabled ? "1" : "0"]
  );
  if (fee !== undefined) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('cod_fee', $1, now())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
      [String(fee)]
    );
  }
  await logAdminAction(req.admin.id, "settings.cod_update", { enabled: !!enabled, fee });
  res.json({ codEnabled: !!enabled });
}));

// GET /api/admin/coupons — every coupon, active or not (the customer-facing
// side only ever sees active ones, via the separate public validate route).
router.get("/coupons", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT code, discount_percent, active, expires_at, max_redemptions, one_per_customer, featured, label, created_at FROM coupons ORDER BY created_at DESC");
  res.json({ coupons: rows.map(r => ({
    code: r.code, discountPercent: r.discount_percent, active: r.active,
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    maxRedemptions: r.max_redemptions, onePerCustomer: r.one_per_customer,
    featured: r.featured, label: r.label,
    createdAt: new Date(r.created_at).getTime(),
  })) });
}));

// POST /api/admin/coupons — creates a new coupon code. expiresAt/
// maxRedemptions are both optional (null = no expiry / unlimited uses) —
// most coupons won't need either, so nothing is forced. featured/label
// are ALSO both optional and default to false/null — a coupon is
// private by default (see db/schema.sql's own comment on `featured` for
// why this isn't a safe thing to default to true).
router.post("/coupons", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { code, discountPercent, expiresAt, maxRedemptions, onePerCustomer, featured, label } = req.body || {};
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
  if (featured && (typeof label !== "string" || !label.trim())) {
    return res.status(400).json({ error: "A featured coupon needs real display text (label) — customers see this, not the raw discount percentage." });
  }

  const { rows: existing } = await query("SELECT code FROM coupons WHERE code=$1", [normalizedCode]);
  if (existing.length > 0) return res.status(409).json({ error: "A coupon with this code already exists." });

  await query(
    "INSERT INTO coupons (code, discount_percent, expires_at, max_redemptions, one_per_customer, featured, label) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [normalizedCode, discountPercent, expiresAt || null, maxRedemptions || null, Boolean(onePerCustomer), Boolean(featured), label || null]
  );
  await logAdminAction(req.admin.id, "coupon.create", { code: normalizedCode, discountPercent, expiresAt, maxRedemptions, onePerCustomer: Boolean(onePerCustomer), featured: Boolean(featured) });
  res.status(201).json({ code: normalizedCode, discountPercent, active: true, expiresAt, maxRedemptions, onePerCustomer: Boolean(onePerCustomer), featured: Boolean(featured), label: label || null });
}));

// PUT /api/admin/coupons/:code — toggle active/inactive and/or change any
// of the coupon's settings. Deactivating (rather than deleting) is the
// normal way to retire a code — it stays in the activity log and coupon
// list, it just stops applying at checkout the moment this is saved
// (lookupCoupon() in server/settings.js only ever matches active=true).
router.put("/coupons/:code", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { discountPercent, active, expiresAt, maxRedemptions, onePerCustomer, featured, label } = req.body || {};
  const { rows: existing } = await query("SELECT * FROM coupons WHERE code=$1", [code]);
  if (existing.length === 0) return res.status(404).json({ error: "Coupon not found." });

  const newDiscount = discountPercent !== undefined ? discountPercent : existing[0].discount_percent;
  const newActive = active !== undefined ? Boolean(active) : existing[0].active;
  const newExpiresAt = expiresAt !== undefined ? expiresAt : existing[0].expires_at;
  const newMaxRedemptions = maxRedemptions !== undefined ? maxRedemptions : existing[0].max_redemptions;
  const newOnePerCustomer = onePerCustomer !== undefined ? Boolean(onePerCustomer) : existing[0].one_per_customer;
  const newFeatured = featured !== undefined ? Boolean(featured) : existing[0].featured;
  const newLabel = label !== undefined ? label : existing[0].label;
  if (!Number.isInteger(newDiscount) || newDiscount <= 0 || newDiscount > 100) {
    return res.status(400).json({ error: "Discount must be a whole number between 1 and 100 (percent)." });
  }
  if (newExpiresAt !== null && isNaN(new Date(newExpiresAt).getTime())) {
    return res.status(400).json({ error: "Expiry date isn't valid." });
  }
  if (newMaxRedemptions !== null && (!Number.isInteger(newMaxRedemptions) || newMaxRedemptions <= 0)) {
    return res.status(400).json({ error: "Max redemptions must be a positive whole number, or left blank for unlimited." });
  }
  if (newFeatured && (typeof newLabel !== "string" || !newLabel.trim())) {
    return res.status(400).json({ error: "A featured coupon needs real display text (label) — customers see this, not the raw discount percentage." });
  }

  await query(
    "UPDATE coupons SET discount_percent=$1, active=$2, expires_at=$3, max_redemptions=$4, one_per_customer=$5, featured=$6, label=$7 WHERE code=$8",
    [newDiscount, newActive, newExpiresAt || null, newMaxRedemptions || null, newOnePerCustomer, newFeatured, newLabel || null, code]
  );
  await logAdminAction(req.admin.id, "coupon.update", {
    code,
    from: { discountPercent: existing[0].discount_percent, active: existing[0].active, featured: existing[0].featured },
    to: { discountPercent: newDiscount, active: newActive, featured: newFeatured },
  });
  res.json({ code, discountPercent: newDiscount, active: newActive, expiresAt: newExpiresAt, maxRedemptions: newMaxRedemptions, onePerCustomer: newOnePerCustomer, featured: newFeatured, label: newLabel });
}));

router.delete("/coupons/:code", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
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
router.get("/pickup-locations", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name FROM pickup_locations ORDER BY name ASC");
  res.json({ pickupLocations: rows });
}));

router.post("/pickup-locations", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Pickup location name is required." });
  const { rows: existing } = await query("SELECT id FROM pickup_locations WHERE name=$1", [name.trim()]);
  if (existing.length > 0) return res.status(409).json({ error: "This pickup location is already saved." });

  const { rows } = await query("INSERT INTO pickup_locations (name) VALUES ($1) RETURNING id, name", [name.trim().slice(0, 200)]);
  await logAdminAction(req.admin.id, "pickup_location.create", { name: rows[0].name });
  res.status(201).json({ pickupLocation: rows[0] });
}));

router.delete("/pickup-locations/:id", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("DELETE FROM pickup_locations WHERE id=$1 RETURNING name", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Pickup location not found." });
  await logAdminAction(req.admin.id, "pickup_location.delete", { name: rows[0].name });
  res.json({ ok: true });
}));

// REAL ANDROID APP UPDATE CHANNEL — see the real, official integration
// guide this whole feature came from, and db/schema.sql's own comment
// on the android_app_version setting for the full, real design
// reasoning (JSON in one settings row, real APK binary in R2, only its
// real, resulting URL stored here).
const apkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.get("/android-app", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='android_app_version'");
  const current = rows[0]?.value ? JSON.parse(rows[0].value) : {};
  res.json({
    versionName: current.versionName || null,
    versionCode: current.versionCode || null,
    minVersionCode: current.minVersionCode ?? null,
    apkUrl: current.apkUrl || null,
    releaseNotes: current.releaseNotes || "",
    forceUpdate: !!current.forceUpdate,
  });
}));

// POST /api/admin/settings/android-app/upload — real, actual APK upload.
// A genuinely large, real binary file, so it goes straight to R2 (same
// real, existing helper already used for product photos/videos), never
// touching Railway's own, non-persistent local disk — the exact same
// real reasoning already documented on the /uploads static route in
// server.js. Returns the real, resulting public URL; does NOT itself
// update the live android_app_version setting — see PUT below, a
// genuinely separate, deliberate step so an admin can upload a real
// APK, then choose exactly when to actually publish it as the live,
// current version (e.g. after also writing real release notes).
router.post("/android-app/upload", requireRole("admin","super_admin"), apkUpload.single("apk"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No APK file received." });
  if (!req.file.originalname.toLowerCase().endsWith(".apk")) {
    return res.status(400).json({ error: "File must be a real .apk file." });
  }
  if (!r2Configured()) {
    return res.status(503).json({ error: "File storage isn't configured yet — contact whoever set up this deployment." });
  }
  const filename = `android/akara-${Date.now()}.apk`;
  await uploadToR2(req.file.buffer, filename, "application/vnd.android.package-archive");
  const apkUrl = `${getR2PublicUrl()}/${filename}`;
  await logAdminAction(req.admin.id, "android_app.apk_uploaded", { apkUrl, sizeBytes: req.file.size });
  res.json({ apkUrl });
}));

// PUT /api/admin/settings/android-app — publishes the real, actual
// live version metadata a real, installed app's UpdateGate checks
// against (see the mobile app's own src/services/ update-check logic).
// versionCode must be a real, whole, increasing integer — the real,
// official guide is explicit that Android's own update mechanism
// relies on comparing these as real numbers, never strings.
router.put("/android-app", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { versionName, versionCode, minVersionCode, apkUrl, releaseNotes, forceUpdate } = req.body || {};
  if (!versionName || typeof versionName !== "string" || !versionName.trim()) {
    return res.status(400).json({ error: "A real version name (e.g. 0.8.0) is required." });
  }
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    return res.status(400).json({ error: "Version code must be a real, positive whole number, increased with every real release." });
  }
  if (minVersionCode != null && (!Number.isInteger(minVersionCode) || minVersionCode < 1)) {
    return res.status(400).json({ error: "Minimum version code, if set, must be a real, positive whole number." });
  }
  if (!apkUrl || typeof apkUrl !== "string" || !/^https:\/\//.test(apkUrl)) {
    return res.status(400).json({ error: "A real, HTTPS APK URL is required — upload the APK first." });
  }
  const value = {
    versionName: versionName.trim().slice(0, 40),
    versionCode,
    minVersionCode: minVersionCode ?? null,
    apkUrl: apkUrl.trim(),
    releaseNotes: String(releaseNotes || "").slice(0, 2000),
    forceUpdate: !!forceUpdate,
  };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('android_app_version', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [JSON.stringify(value)]
  );
  await logAdminAction(req.admin.id, "android_app.version_published", { versionName: value.versionName, versionCode: value.versionCode });
  res.json({ androidApp: value });
}));

export default router;

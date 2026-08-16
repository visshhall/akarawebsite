import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { lookupCoupon, getShippingSettings } from "../settings.js";

const router = Router();

// GET /api/coupons/shipping — the live shipping cost + free-shipping
// threshold, read-only and public. Lets Cart/Checkout show an accurate
// preview total instead of hardcoded numbers that could silently drift
// from what an admin has actually set — the same reasoning as the coupon
// validation route below, just for the other two values that used to be
// hardcoded constants.
router.get("/shipping", asyncHandler(async (req, res) => {
  const settings = await getShippingSettings();
  res.json(settings);
}));

// GET /api/coupons/validate/:code — the ONLY way the frontend ever learns
// a coupon's real discount percentage now that coupons are admin-managed
// (previously the frontend just hardcoded "AKARA10 = 10%", which broke the
// moment that could change). This calls the exact same lookupCoupon()
// function the real checkout pricing uses (server/settings.js) — the
// preview shown on the Cart page and what actually gets charged at
// checkout can never disagree, since they're the same lookup.
//
// Deliberately public (no login required) and read-only — this only
// reveals whether ONE specific, guessed code is currently active and its
// discount percentage, the same information a legitimate promotional code
// is meant to be used with anyway. It does not list other coupons or
// reveal anything about codes not specifically asked about.
router.get("/validate/:code", asyncHandler(async (req, res) => {
  const coupon = await lookupCoupon(req.params.code, req.customer?.id || null);
  if (!coupon) return res.json({ valid: false });
  res.json({ valid: true, code: coupon.code, discountPercent: coupon.discountPercent });
}));

export default router;

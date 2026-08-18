import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { validEmail } from "../validate.js";

const router = Router();

// POST /api/newsletter — public, no login required, matching how a
// footer newsletter signup should work. Idempotent by design: submitting
// an already-subscribed email is a harmless no-op success, not an
// error — someone re-joining shouldn't feel like they did something
// wrong. Only sets new_arrivals/promotions true, journal false — the
// same sensible defaults the (currently still client-only) fuller Email
// Preferences page shows; this table is shared, so those defaults stay
// consistent between the two entry points.
router.post("/", asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ error: "A valid email is required." });

  await query(
    "INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
    [email.trim().toLowerCase()]
  );
  res.status(201).json({ ok: true });
}));

export default router;

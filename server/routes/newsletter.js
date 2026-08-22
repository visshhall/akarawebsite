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

// PUT /api/newsletter/preferences — backs the real Email Preferences
// page, found to be entirely fake (client-only state, nothing ever
// saved). Genuinely different from the POST above: this needs to
// UPDATE an existing subscriber's choices, not silently no-op if they
// already exist. Deliberately never exposes whether an email is
// already subscribed or what its current preferences are — no GET
// endpoint here at all — so this page can't be used to check or leak
// someone else's subscription status. Submitting always just SETS the
// three preferences for that email, which also naturally covers
// "unsubscribe from everything" as a plain all-false submission,
// without needing a separate endpoint for it.
router.put("/preferences", asyncHandler(async (req, res) => {
  const { email, newArrivals, promotions, journal } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ error: "A valid email is required." });

  await query(
    `INSERT INTO newsletter_subscribers (email, new_arrivals, promotions, journal)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET new_arrivals=$2, promotions=$3, journal=$4, updated_at=now()`,
    [email.trim().toLowerCase(), !!newArrivals, !!promotions, !!journal]
  );
  res.json({ ok: true });
}));

export default router;

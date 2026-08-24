import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/newsletter — every real subscriber, most recent first.
// Found genuinely missing: the data has been collected correctly since
// the footer signup form and Email Preferences page were both built,
// but there was never any way to actually see it — an admin would have
// had to query the database directly.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT email, new_arrivals, promotions, journal, subscribed_at, updated_at
     FROM newsletter_subscribers ORDER BY subscribed_at DESC`
  );
  res.json({
    subscribers: rows.map(r => ({
      email: r.email,
      newArrivals: r.new_arrivals,
      promotions: r.promotions,
      journal: r.journal,
      subscribedAt: new Date(r.subscribed_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    })),
  });
}));

// DELETE /api/admin/newsletter/:email — removes a subscriber entirely.
// A genuinely different action from a customer's own self-service
// unsubscribe (PUT /api/newsletter/preferences, all-false) — this is
// for the admin to remove a clearly invalid or bounced address from the
// list, not something a customer would ever trigger themselves.
// :email arrives URL-encoded (it's in the path, and email addresses
// contain @ and other characters) — decoded before use, both for the
// query and for what gets logged.
router.delete("/:email", requireAdmin, asyncHandler(async (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  const { rows } = await query(
    "DELETE FROM newsletter_subscribers WHERE email=$1 RETURNING email",
    [email]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Subscriber not found." });
  await logAdminAction(req.admin.id, "newsletter.subscriber_removed", { email });
  res.json({ ok: true });
}));

export default router;

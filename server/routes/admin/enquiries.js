// ============================================================================
// ENQUIRIES — the actual admin screen for two real, previously-
// unreachable tables (contact_submissions, bulk_order_enquiries). Both
// were being written to correctly by the live Contact and Bulk/
// Corporate Order forms this whole time — this is purely the admin UI
// to surface them, not a new capture mechanism.
// Unified in ONE screen deliberately (not two separate ones) — that
// was the original, explicit ask: a single place to see both kinds of
// enquiry together, sorted by recency, not two more nav items to check
// separately.
// ============================================================================
import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole, logAdminAction } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/enquiries — both tables, real UNION, tagged with a
// "type" so the frontend can render each kind's own real fields
// (bulk enquiries have company/quantity/interest; contact submissions
// don't) while still sorting the combined list by actual recency.
router.get("/", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT id, 'contact' AS type, name, email, phone, NULL AS company, NULL AS quantity, NULL AS interest, message, handled, created_at
    FROM contact_submissions
    UNION ALL
    SELECT id, 'bulk' AS type, name, email, phone, company, quantity, interest, message, handled, created_at
    FROM bulk_order_enquiries
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json({
    enquiries: rows.map(r => ({
      id: r.id, type: r.type, name: r.name, email: r.email, phone: r.phone,
      company: r.company, quantity: r.quantity, interest: r.interest,
      message: r.message, handled: r.handled, createdAt: r.created_at,
    })),
  });
}));

// PUT /api/admin/enquiries/:type/:id — toggles handled/unhandled. :type
// picks the real table (contact vs bulk) — genuinely needed since the
// two are separate tables under the hood, unified only in how they're
// LISTED above, not merged into one real table.
router.put("/:type/:id", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { handled } = req.body || {};
  const table = type === "contact" ? "contact_submissions" : type === "bulk" ? "bulk_order_enquiries" : null;
  if (!table) return res.status(400).json({ error: "Invalid enquiry type." });

  const { rows } = await query(`UPDATE ${table} SET handled=$1 WHERE id=$2 RETURNING id`, [Boolean(handled), id]);
  if (rows.length === 0) return res.status(404).json({ error: "Enquiry not found." });

  await logAdminAction(req.admin.id, "enquiry.mark_handled", { type, id, handled: Boolean(handled) });
  res.json({ ok: true });
}));

// PUT /api/admin/enquiries/bulk — marks several enquiries handled/new
// at once, real admin bulk action. Takes a list of {type, id} pairs
// (not just a list of ids) for the same reason the single-item route
// above needs :type — contact_submissions and bulk_order_enquiries are
// two genuinely separate tables, so a batch can (and often will) span
// both. Each table gets one real UPDATE with an ANY($ids) match rather
// than looping one query per item — a real batch operation, not N
// sequential single-item calls dressed up as one.
router.put("/bulk", requireRole("admin","super_admin"), asyncHandler(async (req, res) => {
  const { items, handled } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No enquiries selected." });
  if (items.length > 200) return res.status(400).json({ error: "Too many selected at once — max 200." });
  for (const item of items) {
    if (!item || !["contact", "bulk"].includes(item.type) || !Number.isInteger(item.id)) {
      return res.status(400).json({ error: "Invalid selection." });
    }
  }

  const contactIds = items.filter(i => i.type === "contact").map(i => i.id);
  const bulkIds = items.filter(i => i.type === "bulk").map(i => i.id);
  let updatedCount = 0;
  if (contactIds.length > 0) {
    const { rowCount } = await query("UPDATE contact_submissions SET handled=$1 WHERE id = ANY($2)", [Boolean(handled), contactIds]);
    updatedCount += rowCount;
  }
  if (bulkIds.length > 0) {
    const { rowCount } = await query("UPDATE bulk_order_enquiries SET handled=$1 WHERE id = ANY($2)", [Boolean(handled), bulkIds]);
    updatedCount += rowCount;
  }

  await logAdminAction(req.admin.id, "enquiry.bulk_mark_handled", { count: updatedCount, handled: Boolean(handled) });
  res.json({ ok: true, updatedCount });
}));

export default router;

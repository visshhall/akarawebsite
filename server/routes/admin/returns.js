import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";

const router = Router();

router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM return_requests ORDER BY created_at DESC LIMIT 200");
  res.json({ returnRequests: rows.map(toFrontend) });
}));

const VALID_STATUS = ["pending", "approved", "rejected", "completed"];
router.patch("/:id/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: `Status must be one of: ${VALID_STATUS.join(", ")}` });

  const { rows } = await query("UPDATE return_requests SET status=$1 WHERE id=$2 RETURNING *", [status, req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Return request not found." });
  await logAdminAction(req.admin.id, "return_request.status_change", { id: req.params.id, orderNumber: rows[0].order_number, to: status });
  res.json({ returnRequest: toFrontend(rows[0]) });
}));

function toFrontend(row) {
  return {
    id: row.id, orderNumber: row.order_number, itemName: row.item_name, reason: row.reason,
    description: row.description, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    photoUrl: row.photo_url, status: row.status, createdAt: new Date(row.created_at).getTime(),
  };
}

export default router;

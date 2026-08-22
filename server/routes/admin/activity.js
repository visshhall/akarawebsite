import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/activity-log — every admin action recorded via
// logAdminAction() (see server/adminAuth.js), which has been quietly
// writing to the change_log table since the admin panel first shipped —
// this is the first endpoint that actually surfaces it anywhere.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT cl.id, cl.action, cl.details, cl.created_at, a.name AS admin_name, a.email AS admin_email
    FROM change_log cl
    LEFT JOIN admins a ON a.id = cl.admin_id
    ORDER BY cl.created_at DESC
    LIMIT 100
  `);
  res.json({
    entries: rows.map(r => ({
      id: r.id,
      action: r.action,
      details: r.details,
      adminName: r.admin_name || "Unknown admin",
      adminEmail: r.admin_email,
      createdAt: new Date(r.created_at).getTime(),
    })),
  });
}));

export default router;

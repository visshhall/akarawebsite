import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole } from "../../adminAuth.js";

const router = Router();

router.get("/", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT w.id, w.product_id, w.email, w.created_at, w.notified_at, p.name AS product_name
     FROM product_waitlist w
     LEFT JOIN products p ON p.id = w.product_id
     ORDER BY w.created_at DESC
     LIMIT 500`
  );
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      email: r.email,
      createdAt: r.created_at,
      notifiedAt: r.notified_at,
    })),
  });
}));

export default router;

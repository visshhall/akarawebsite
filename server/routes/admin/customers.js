import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/customers — every signed-up account, with a real count of
// how many orders each has placed (paid or not) and how much they've
// actually paid, computed with a LEFT JOIN so a customer with zero orders
// still shows up (as 0), not silently omitted.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT
      c.id, c.name, c.email, c.phone, c.created_at,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.payment_status='paid'), 0) AS total_spent
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
  res.json({
    customers: rows.map(r => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone,
      createdAt: new Date(r.created_at).getTime(),
      orderCount: Number(r.order_count),
      totalSpent: Number(r.total_spent),
    })),
  });
}));

export default router;

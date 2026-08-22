import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin } from "../../adminAuth.js";

const router = Router();

// GET /api/admin/dashboard — every number here comes from a real query
// against real data, nothing fabricated or placeholder. Honest gap: there's
// no real "orders funnel" (views -> cart -> checkout -> purchase) since
// that needs page-view/cart-abandonment analytics this app doesn't have —
// what's shown instead is the closest REAL equivalent: orders broken down
// by payment_status, which at least shows checkout-started vs completed.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const [totals, byStatus, revenueTrend, bestSellers, lowStock, recentOrders, newCustomers] = await Promise.all([
    query(`SELECT
             COUNT(*) FILTER (WHERE payment_status='paid') AS paid_order_count,
             COALESCE(SUM(total) FILTER (WHERE payment_status='paid'), 0) AS total_revenue
           FROM orders`),
    query(`SELECT payment_status, COUNT(*) AS count FROM orders GROUP BY payment_status`),
    query(`SELECT date_trunc('day', placed_at) AS day, SUM(total) AS revenue, COUNT(*) AS order_count
           FROM orders
           WHERE payment_status='paid' AND placed_at >= now() - interval '30 days'
           GROUP BY day ORDER BY day`),
    query(`SELECT item->>'id' AS product_id, item->>'name' AS product_name,
             SUM((item->>'qty')::int) AS units_sold,
             SUM((item->>'price')::int * (item->>'qty')::int) AS revenue
           FROM orders, jsonb_array_elements(items) AS item
           WHERE payment_status='paid'
           GROUP BY item->>'id', item->>'name'
           ORDER BY revenue DESC LIMIT 5`),
    query(`SELECT id, name, category, status FROM products WHERE status IN ('low-stock','sold-out') ORDER BY status, name`),
    query(`SELECT order_number, email, total, status, payment_status, placed_at FROM orders ORDER BY placed_at DESC LIMIT 8`),
    query(`SELECT COUNT(*) AS count FROM customers WHERE created_at >= now() - interval '30 days'`),
  ]);

  res.json({
    totalRevenue: Number(totals.rows[0].total_revenue),
    paidOrderCount: Number(totals.rows[0].paid_order_count),
    ordersByPaymentStatus: byStatus.rows.map(r => ({ status: r.payment_status, count: Number(r.count) })),
    revenueTrend: revenueTrend.rows.map(r => ({ day: r.day, revenue: Number(r.revenue), orderCount: Number(r.order_count) })),
    bestSellers: bestSellers.rows.map(r => ({ productId: r.product_id, productName: r.product_name, unitsSold: Number(r.units_sold), revenue: Number(r.revenue) })),
    lowStock: lowStock.rows,
    recentOrders: recentOrders.rows.map(r => ({ orderNumber: r.order_number, email: r.email, total: r.total, status: r.status, paymentStatus: r.payment_status, placedAt: new Date(r.placed_at).getTime() })),
    newCustomersLast30Days: Number(newCustomers.rows[0].count),
  });
}));

export default router;

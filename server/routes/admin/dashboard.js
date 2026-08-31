import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole } from "../../adminAuth.js";

const router = Router();

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, all: null };

function parseRange(raw) {
  const key = String(raw || "30d").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RANGE_DAYS, key)) return key;
  return "30d";
}

function intervalSql(rangeKey) {
  const days = RANGE_DAYS[rangeKey];
  if (days == null) return null;
  return `${days} days`;
}

// Atelier Pulse — real SQL only (no fabricated pageviews).
// GET /api/admin/dashboard?range=7d|30d|90d|all
router.get("/", requireRole("staff", "admin", "super_admin"), asyncHandler(async (req, res) => {
  const rangeKey = parseRange(req.query.range);
  const interval = intervalSql(rangeKey);
  const paidInRange = interval
    ? `payment_status = 'paid' AND placed_at >= now() - interval '${interval}'`
    : `payment_status = 'paid'`;
  const placedInRange = interval
    ? `placed_at >= now() - interval '${interval}'`
    : `TRUE`;
  const prevPaid = interval
    ? `payment_status = 'paid' AND placed_at >= now() - interval '${parseInt(interval, 10) * 2} days' AND placed_at < now() - interval '${interval}'`
    : null;

  const [
    totals,
    prevTotals,
    byPayment,
    byFulfillment,
    revenueTrend,
    bestSellers,
    categoryMix,
    quietForms,
    lowStock,
    recentOrders,
    newCustomers,
    pendingReturns,
    failedPayments,
    inProduction,
  ] = await Promise.all([
    query(`SELECT
             COUNT(*) FILTER (WHERE ${paidInRange}) AS paid_order_count,
             COALESCE(SUM(total) FILTER (WHERE ${paidInRange}), 0) AS total_revenue
           FROM orders`),
    prevPaid
      ? query(`SELECT
                 COUNT(*) FILTER (WHERE ${prevPaid}) AS paid_order_count,
                 COALESCE(SUM(total) FILTER (WHERE ${prevPaid}), 0) AS total_revenue
               FROM orders`)
      : Promise.resolve({ rows: [{ paid_order_count: 0, total_revenue: 0 }] }),
    query(`SELECT payment_status, COUNT(*) AS count FROM orders WHERE ${placedInRange} GROUP BY payment_status`),
    query(`SELECT status, COUNT(*) AS count FROM orders
           WHERE payment_status IN ('paid','cod') AND status IS NOT NULL
           GROUP BY status`),
    query(`SELECT date_trunc('day', placed_at) AS day,
             SUM(total) AS revenue,
             COUNT(*) AS order_count
           FROM orders
           WHERE ${paidInRange}
           GROUP BY day ORDER BY day`),
    query(`SELECT item->>'id' AS product_id, item->>'name' AS product_name,
             SUM((item->>'qty')::int) AS units_sold,
             SUM((item->>'price')::int * (item->>'qty')::int) AS revenue
           FROM orders, jsonb_array_elements(items) AS item
           WHERE ${paidInRange}
           GROUP BY item->>'id', item->>'name'
           ORDER BY revenue DESC LIMIT 8`),
    query(`SELECT COALESCE(p.category, 'Uncategorised') AS category,
             SUM((item->>'qty')::int) AS units_sold,
             SUM((item->>'price')::int * (item->>'qty')::int) AS revenue
           FROM orders o
           CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
           LEFT JOIN products p ON p.id = item->>'id'
           WHERE o.payment_status = 'paid'
             ${interval ? `AND o.placed_at >= now() - interval '${interval}'` : ""}
           GROUP BY COALESCE(p.category, 'Uncategorised')
           ORDER BY revenue DESC`),
    query(`SELECT p.id, p.name, p.category, p.status
           FROM products p
           WHERE p.status IN ('in-stock', 'low-stock', 'pre-order')
             AND NOT EXISTS (
               SELECT 1 FROM orders o, jsonb_array_elements(o.items) AS item
               WHERE o.payment_status = 'paid'
                 AND item->>'id' = p.id
                 AND (${interval ? `o.placed_at >= now() - interval '${interval}'` : "TRUE"})
             )
           ORDER BY p.name
           LIMIT 12`),
    query(`SELECT id, name, category, status FROM products WHERE status IN ('low-stock','sold-out') ORDER BY status, name`),
    query(`SELECT order_number, email, total, status, payment_status, placed_at
           FROM orders ORDER BY placed_at DESC LIMIT 10`),
    query(`SELECT COUNT(*) AS count FROM customers
           WHERE ${interval ? `created_at >= now() - interval '${interval}'` : "TRUE"}`),
    query(`SELECT id, order_number, item_name, status, created_at
           FROM return_requests WHERE status = 'pending'
           ORDER BY created_at DESC LIMIT 10`),
    query(`SELECT order_number, email, total, payment_status, placed_at
           FROM orders
           WHERE payment_status IN ('failed','pending')
             AND placed_at >= now() - interval '14 days'
           ORDER BY placed_at DESC LIMIT 10`),
    query(`SELECT COUNT(*) AS count FROM orders
           WHERE payment_status IN ('paid','cod')
             AND status IN ('confirmed','production','qc')`),
  ]);

  const paidCount = Number(totals.rows[0].paid_order_count);
  const revenue = Number(totals.rows[0].total_revenue);
  const prevPaidCount = Number(prevTotals.rows[0].paid_order_count);
  const prevRevenue = Number(prevTotals.rows[0].total_revenue);

  const pct = (cur, prev) => {
    if (prev == null || prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };

  const FUNNEL_ORDER = ["confirmed", "production", "qc", "dispatched", "delivered"];
  const statusMap = Object.fromEntries(
    byFulfillment.rows.map((r) => [r.status, Number(r.count)])
  );
  const studioFlow = FUNNEL_ORDER.map((s) => ({
    status: s,
    count: statusMap[s] || 0,
  }));

  res.json({
    range: rangeKey,
    totalRevenue: revenue,
    paidOrderCount: paidCount,
    aov: paidCount > 0 ? Math.round(revenue / paidCount) : 0,
    revenueDeltaPct: prevPaid ? pct(revenue, prevRevenue) : null,
    ordersDeltaPct: prevPaid ? pct(paidCount, prevPaidCount) : null,
    inProductionCount: Number(inProduction.rows[0].count),
    newCustomers: Number(newCustomers.rows[0].count),
    ordersByPaymentStatus: byPayment.rows.map((r) => ({
      status: r.payment_status,
      count: Number(r.count),
    })),
    studioFlow,
    revenueTrend: revenueTrend.rows.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue),
      orderCount: Number(r.order_count),
    })),
    bestSellers: bestSellers.rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      unitsSold: Number(r.units_sold),
      revenue: Number(r.revenue),
    })),
    categoryMix: categoryMix.rows.map((r) => ({
      category: r.category,
      unitsSold: Number(r.units_sold),
      revenue: Number(r.revenue),
    })),
    quietForms: quietForms.rows,
    lowStock: lowStock.rows,
    recentOrders: recentOrders.rows.map((o) => ({
      orderNumber: o.order_number,
      email: o.email,
      total: Number(o.total),
      status: o.status,
      paymentStatus: o.payment_status,
      placedAt: o.placed_at,
    })),
    pendingReturns: pendingReturns.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      itemName: r.item_name,
      status: r.status,
      createdAt: r.created_at,
    })),
    failedPayments: failedPayments.rows.map((o) => ({
      orderNumber: o.order_number,
      email: o.email,
      total: Number(o.total),
      paymentStatus: o.payment_status,
      placedAt: o.placed_at,
    })),
    attentionCount:
      pendingReturns.rows.length +
      lowStock.rows.length +
      failedPayments.rows.length,
  });
}));

// Orders in a fulfillment stage — for funnel click-through
router.get("/orders-by-status", requireRole("staff", "admin", "super_admin"), asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").toLowerCase();
  const allowed = ["confirmed", "production", "qc", "dispatched", "delivered", "cancelled"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const { rows } = await query(
    `SELECT order_number, email, total, status, payment_status, placed_at
     FROM orders
     WHERE status = $1 AND payment_status IN ('paid','cod')
     ORDER BY placed_at DESC
     LIMIT 40`,
    [status]
  );
  res.json({
    status,
    orders: rows.map((o) => ({
      orderNumber: o.order_number,
      email: o.email,
      total: Number(o.total),
      status: o.status,
      paymentStatus: o.payment_status,
      placedAt: o.placed_at,
    })),
  });
}));

export default router;

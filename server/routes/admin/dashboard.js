import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole } from "../../adminAuth.js";
import { COST_CATEGORIES } from "../../costCategories.js";

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
  // Confirmed money: online paid OR COD accepted (same as fulfilment funnel)
  const paidInRange = interval
    ? `payment_status IN ('paid','cod') AND placed_at >= now() - interval '${interval}'`
    : `payment_status IN ('paid','cod')`;
  const placedInRange = interval
    ? `placed_at >= now() - interval '${interval}'`
    : `TRUE`;
  const prevPaid = interval
    ? `payment_status IN ('paid','cod') AND placed_at >= now() - interval '${parseInt(interval, 10) * 2} days' AND placed_at < now() - interval '${interval}'`
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
    stuckProduction,
    revenueByMethod,
    missingImages,
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
           WHERE o.payment_status IN ('paid','cod')
             ${interval ? `AND o.placed_at >= now() - interval '${interval}'` : ""}
           GROUP BY COALESCE(p.category, 'Uncategorised')
           ORDER BY revenue DESC`),
    query(`SELECT p.id, p.name, p.category, p.status
           FROM products p
           WHERE p.status IN ('in-stock', 'low-stock', 'pre-order')
             AND NOT EXISTS (
               SELECT 1 FROM orders o, jsonb_array_elements(o.items) AS item
               WHERE o.payment_status IN ('paid','cod')
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
    query(`SELECT COUNT(*)::int AS count FROM orders
           WHERE payment_status IN ('paid','cod')
             AND status IN ('production','qc')
             AND placed_at < now() - interval '14 days'`),
    query(`SELECT
             COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid'), 0) AS online_revenue,
             COALESCE(SUM(total) FILTER (WHERE payment_status = 'cod'), 0) AS cod_revenue,
             COUNT(*) FILTER (WHERE payment_status = 'paid') AS online_count,
             COUNT(*) FILTER (WHERE payment_status = 'cod') AS cod_count
           FROM orders WHERE ${paidInRange}`),
    query(`SELECT COUNT(*)::int AS count FROM products
           WHERE status IN ('in-stock','low-stock','pre-order')
             AND (
               media IS NULL OR jsonb_typeof(media) <> 'array' OR jsonb_array_length(media) = 0
               OR NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(media)='array' THEN media ELSE '[]'::jsonb END) m
                 WHERE COALESCE(m->>'type','image') = 'image' AND COALESCE(m->>'src','') <> ''
               )
             )`),
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


  const stuck = Number(stuckProduction.rows[0].count);
  const missingImg = Number(missingImages.rows[0].count);
  const attention = pendingReturns.rows.length + lowStock.rows.length + failedPayments.rows.length;
  // Studio risk 0–100 — higher = more pressure (capped contributions)
  const studioRisk = Math.min(100, stuck * 12 + attention * 8 + missingImg * 5 + Number(inProduction.rows[0].count) * 2);
  const studioRiskLabel = studioRisk >= 60 ? "High" : studioRisk >= 30 ? "Elevated" : "Calm";

  // Today strip — action counts (IST calendar day approximation via date_trunc)
  const [ordersTodayQ, toPackQ, pendingReturnsCountQ, openContactQ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM orders
           WHERE payment_status IN ('paid','cod') AND status != 'cancelled'
             AND placed_at >= date_trunc('day', now())`),
    query(`SELECT COUNT(*)::int AS count FROM orders
           WHERE payment_status IN ('paid','cod') AND status IN ('qc','production')`),
    query(`SELECT COUNT(*)::int AS count FROM return_requests WHERE status = 'pending'`).catch(() => ({ rows: [{ count: 0 }] })),
    // REAL BUG FIX: this used to try a table called "contact_messages"
    // first, which has never existed anywhere in this schema — every
    // other real route in this codebase (server/routes/contact.js,
    // server/routes/admin/enquiries.js) correctly uses
    // "contact_submissions" instead. The old code had a real .catch()
    // fallback to the correct table, so the dashboard never actually
    // broke — but it meant a real, live PostgreSQL error
    // ("relation contact_messages does not exist") was logged on every
    // single real dashboard load, forever, which is exactly what
    // showed up in the live database's own deploy logs. Also:
    // contact_submissions genuinely has no "status" column at all
    // (confirmed directly against schema.sql), so the real, correct
    // proxy for "open enquiries" is recency — a submission from the
    // last 7 days, matching what the old fallback already used.
    query(`SELECT COUNT(*)::int AS count FROM contact_submissions WHERE created_at >= now() - interval '7 days'`).catch(() => ({ rows: [{ count: 0 }] })),
  ]);

  res.json({
    todayStrip: {
      ordersToday: Number(ordersTodayQ.rows[0]?.count || 0),
      toPack: Number(toPackQ.rows[0]?.count || 0),
      stuckProduction: Number(stuckProduction.rows[0].count),
      lowStock: lowStock.rows.length,
      pendingReturns: Number(pendingReturnsCountQ.rows[0]?.count || 0),
      openContact: Number(openContactQ.rows[0]?.count || 0),
    },
    range: rangeKey,
    totalRevenue: revenue,
    paidOrderCount: paidCount,
    aov: paidCount > 0 ? Math.round(revenue / paidCount) : 0,
    revenueDeltaPct: prevPaid ? pct(revenue, prevRevenue) : null,
    ordersDeltaPct: prevPaid ? pct(paidCount, prevPaidCount) : null,
    inProductionCount: Number(inProduction.rows[0].count),
    stuckProductionCount: Number(stuckProduction.rows[0].count),
    onlineRevenue: Number(revenueByMethod.rows[0].online_revenue),
    codRevenue: Number(revenueByMethod.rows[0].cod_revenue),
    onlineOrderCount: Number(revenueByMethod.rows[0].online_count),
    codOrderCount: Number(revenueByMethod.rows[0].cod_count),
    missingImageCount: Number(missingImages.rows[0].count),
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
    attentionCount: attention,
    studioRisk,
    studioRiskLabel,
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

// Real, per-product cost vs. revenue vs. profit — directly requested:
// "how much did I spend making this, how much have I actually earned
// from it." Deliberately real, ALL-TIME sales (no date-range filter
// like the main dashboard above) — a product's total real profit since
// it started selling is what actually answers "was this priced right,"
// not just a recent window. Uses the exact same real
// payment_status IN ('paid','cod') definition of "real, counted
// revenue" as the rest of this dashboard, for consistency.
router.get("/profit", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { rows: salesRows } = await query(
    `SELECT item->>'id' AS product_id,
       SUM((item->>'qty')::int) AS units_sold,
       SUM((item->>'price')::int * (item->>'qty')::int) AS revenue
     FROM orders, jsonb_array_elements(items) AS item
     WHERE payment_status IN ('paid','cod')
     GROUP BY item->>'id'`
  );
  const salesByProduct = Object.fromEntries(salesRows.map(r => [r.product_id, { unitsSold: Number(r.units_sold), revenue: Number(r.revenue) }]));

  const { rows: products } = await query(
    `SELECT id, name, category, price, status, cost_breakdown FROM products ORDER BY category, name`
  );

  const items = products.map(p => {
    // Real, defensive normalization — a product created before this
    // feature shipped has cost_breakdown='{}' (the real, existing
    // column default), so every real category correctly reads as 0
    // rather than genuinely missing/undefined, matching the same real
    // normalization the admin product-update route already applies on
    // save.
    const cb = p.cost_breakdown && typeof p.cost_breakdown === "object" ? p.cost_breakdown : {};
    const costBreakdown = Object.fromEntries(COST_CATEGORIES.map(k => [k, Number(cb[k]) || 0]));
    const totalCostPerUnit = COST_CATEGORIES.reduce((sum, k) => sum + costBreakdown[k], 0);
    const sales = salesByProduct[p.id] || { unitsSold: 0, revenue: 0 };
    // Real profit = actual revenue collected minus the real, per-unit
    // cost multiplied by the real number of units actually sold — NOT
    // (price - totalCostPerUnit), which would ignore any real coupon
    // discount actually applied at checkout and silently overstate
    // real, genuine margin on a discounted sale.
    const totalCost = totalCostPerUnit * sales.unitsSold;
    const profit = sales.revenue - totalCost;
    // Real, per-unit margin — the number this whole feature exists to
    // let an admin react to BEFORE setting a price, not just after
    // sales happen: (current price - cost per unit) / current price.
    // Null when cost data hasn't been entered yet at all, rather than
    // showing a real, misleading 100% margin against a genuine
    // zero-cost default.
    const hasCostData = totalCostPerUnit > 0;
    const marginPercent = hasCostData ? Math.round(((p.price - totalCostPerUnit) / p.price) * 1000) / 10 : null;
    // Real, ALWAYS-available per-unit figure (price minus cost, at the
    // real, current price) — distinct from `profit` above, which is a
    // real, TOTAL figure that depends on actual sales having happened
    // and is 0 for a genuinely unsold product regardless of how good
    // its real margin actually is. This is the real number the chart
    // compares directly against totalCostPerUnit, since both are
    // genuinely per-unit and comparable regardless of sales history —
    // exactly what's needed to judge a price BEFORE any sales exist.
    const expectedProfitPerUnit = hasCostData ? p.price - totalCostPerUnit : null;
    return {
      id: p.id, name: p.name, category: p.category, price: p.price, status: p.status,
      costBreakdown, totalCostPerUnit, hasCostData,
      unitsSold: sales.unitsSold, revenue: sales.revenue, totalCost, profit, marginPercent, expectedProfitPerUnit,
    };
  });

  res.json({ items });
}));

export default router;

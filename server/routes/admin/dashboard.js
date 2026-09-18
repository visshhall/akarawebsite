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
             ROUND(SUM((item->>'price')::numeric * (item->>'qty')::numeric))::bigint AS revenue
           FROM orders, jsonb_array_elements(items) AS item
           WHERE ${paidInRange}
           GROUP BY item->>'id', item->>'name'
           ORDER BY revenue DESC LIMIT 8`),
    query(`SELECT COALESCE(p.category, 'Uncategorised') AS category,
             SUM((item->>'qty')::int) AS units_sold,
             ROUND(SUM((item->>'price')::numeric * (item->>'qty')::numeric))::bigint AS revenue
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


  // --- Extended insights (safe: each query catches so dashboard never 500s) ---
  const rangeIntervalClause = interval ? `AND placed_at >= now() - interval '${interval}'` : "";
  const analyticsInterval = interval || "90 days";
  const costSumSql = COST_CATEGORIES.map((k) => `COALESCE((p.cost_breakdown->>'${k}')::numeric, 0)`).join(" + ");

  const [
    couponImpactQ,
    sizeMixQ,
    colourMixQ,
    returnsStatsQ,
    deliveredCountQ,
    funnelEventsQ,
    marginDailyQ,
  ] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE coupon_code IS NOT NULL AND BTRIM(coupon_code) <> '')::int AS with_coupon,
         COUNT(*) FILTER (WHERE coupon_code IS NULL OR BTRIM(coupon_code) = '')::int AS without_coupon,
         COALESCE(AVG(discount) FILTER (WHERE coupon_code IS NOT NULL AND BTRIM(coupon_code) <> ''), 0)::float AS avg_discount,
         COALESCE(SUM(discount) FILTER (WHERE coupon_code IS NOT NULL AND BTRIM(coupon_code) <> ''), 0)::float AS total_discount,
         COALESCE(SUM(total) FILTER (WHERE coupon_code IS NOT NULL AND BTRIM(coupon_code) <> ''), 0)::float AS revenue_with_coupon,
         COALESCE(SUM(total) FILTER (WHERE coupon_code IS NULL OR BTRIM(coupon_code) = ''), 0)::float AS revenue_without_coupon
       FROM orders
       WHERE payment_status IN ('paid','cod') ${rangeIntervalClause}`
    ).catch(() => ({ rows: [{}] })),
    query(
      `SELECT COALESCE(NULLIF(BTRIM(item->>'size'), ''), 'Unspecified') AS size,
              SUM((item->>'qty')::int)::int AS units
       FROM orders o, jsonb_array_elements(o.items) AS item
       WHERE o.payment_status IN ('paid','cod') ${interval ? `AND o.placed_at >= now() - interval '${interval}'` : ""}
       GROUP BY 1 ORDER BY units DESC LIMIT 12`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT COALESCE(NULLIF(BTRIM(COALESCE(item->>'colorLabel', item->>'color')), ''), 'Unspecified') AS colour,
              SUM((item->>'qty')::int)::int AS units
       FROM orders o, jsonb_array_elements(o.items) AS item
       WHERE o.payment_status IN ('paid','cod') ${interval ? `AND o.placed_at >= now() - interval '${interval}'` : ""}
       GROUP BY 1 ORDER BY units DESC LIMIT 12`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT
         COUNT(*)::int AS total_returns,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM return_requests
       WHERE TRUE ${interval ? `AND created_at >= now() - interval '${interval}'` : ""}`
    ).catch(() => ({ rows: [{}] })),
    query(
      `SELECT COUNT(*)::int AS count FROM orders
       WHERE payment_status IN ('paid','cod') AND status = 'delivered'
         ${interval ? `AND placed_at >= now() - interval '${interval}'` : ""}`
    ).catch(() => ({ rows: [{ count: 0 }] })),
    query(
      `SELECT event_name, COUNT(*)::int AS count
       FROM analytics_events
       WHERE created_at > now() - interval '${analyticsInterval}'
         AND event_name IN ('page_view','view_item','add_to_cart','begin_checkout','purchase')
       GROUP BY event_name`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT date_trunc('day', o.placed_at) AS day,
              COALESCE(SUM((item->>'price')::numeric * (item->>'qty')::numeric), 0) AS line_revenue,
              COALESCE(SUM((item->>'qty')::numeric * (${costSumSql})), 0) AS line_cost
       FROM orders o
       CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
       LEFT JOIN products p ON p.id = item->>'id'
       WHERE o.payment_status IN ('paid','cod')
         ${interval ? `AND o.placed_at >= now() - interval '${interval}'` : ""}
       GROUP BY 1 ORDER BY 1`
    ).catch(() => ({ rows: [] })),
  ]);

  const couponRow = couponImpactQ.rows[0] || {};
  const returnsRow = returnsStatsQ.rows[0] || {};
  const deliveredN = Number(deliveredCountQ.rows[0]?.count || 0);
  const returnsTotal = Number(returnsRow.total_returns || 0);
  const funnelMap = Object.fromEntries((funnelEventsQ.rows || []).map((r) => [r.event_name, Number(r.count)]));
  const fv = funnelMap.page_view || 0;
  const fi = funnelMap.view_item || 0;
  const fc = funnelMap.add_to_cart || 0;
  const fb = funnelMap.begin_checkout || 0;
  const fp = funnelMap.purchase || 0;

  function fillMarginTrend(rows, rangeKey) {
    const days = RANGE_DAYS[rangeKey];
    const mapped = (rows || []).map((r) => {
      const lineRevenue = Number(r.line_revenue) || 0;
      const lineCost = Number(r.line_cost) || 0;
      const gross = lineRevenue - lineCost;
      const marginPct = lineRevenue > 0 ? Math.round((gross / lineRevenue) * 1000) / 10 : null;
      return {
        day: r.day,
        lineRevenue,
        lineCost,
        grossProfit: Math.round(gross * 100) / 100,
        marginPct,
      };
    });
    if (days == null || mapped.length === 0) {
      return mapped.map((r) => ({
        ...r,
        day: r.day ? new Date(r.day).toISOString().slice(0, 10) : r.day,
      }));
    }
    const byDay = Object.fromEntries(
      mapped.map((r) => {
        const key = new Date(r.day).toISOString().slice(0, 10);
        return [key, r];
      })
    );
    const out = [];
    const end = new Date();
    end.setUTCHours(12, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const hit = byDay[key];
      out.push(
        hit
          ? { ...hit, day: key }
          : { day: key, lineRevenue: 0, lineCost: 0, grossProfit: 0, marginPct: null }
      );
    }
    return out;
  }




  // Fill missing calendar days so AreaChart does not invent slopes across gaps.
  // Only days with orders used to appear — empty days now show 0 revenue/orders.
  function fillDailyTrend(rows, rangeKey) {
    const days = RANGE_DAYS[rangeKey];
    if (days == null || !rows.length) {
      return rows.map((r) => ({
        day: r.day,
        revenue: Number(r.revenue) || 0,
        orderCount: Number(r.order_count != null ? r.order_count : r.orderCount) || 0,
      }));
    }
    const byDay = Object.fromEntries(
      rows.map((r) => {
        const key = new Date(r.day).toISOString().slice(0, 10);
        return [key, { revenue: Number(r.revenue) || 0, orderCount: Number(r.order_count) || 0 }];
      })
    );
    const out = [];
    const end = new Date();
    end.setUTCHours(12, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const hit = byDay[key] || { revenue: 0, orderCount: 0 };
      out.push({ day: key, revenue: hit.revenue, orderCount: hit.orderCount });
    }
    return out;
  }

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
    revenueTrend: fillDailyTrend(revenueTrend.rows, rangeKey),
    couponImpact: {
      withCoupon: Number(couponRow.with_coupon || 0),
      withoutCoupon: Number(couponRow.without_coupon || 0),
      avgDiscount: Math.round(Number(couponRow.avg_discount || 0)),
      totalDiscount: Math.round(Number(couponRow.total_discount || 0)),
      revenueWithCoupon: Math.round(Number(couponRow.revenue_with_coupon || 0)),
      revenueWithoutCoupon: Math.round(Number(couponRow.revenue_without_coupon || 0)),
    },
    sizeMix: (sizeMixQ.rows || []).map((r) => ({ name: r.size, units: Number(r.units) || 0 })),
    colourMix: (colourMixQ.rows || []).map((r) => ({ name: r.colour, units: Number(r.units) || 0 })),
    returnsStats: {
      total: returnsTotal,
      pending: Number(returnsRow.pending || 0),
      approved: Number(returnsRow.approved || 0),
      rejected: Number(returnsRow.rejected || 0),
      completed: Number(returnsRow.completed || 0),
      deliveredOrders: deliveredN,
      returnRatePct: deliveredN > 0 ? Math.round((returnsTotal / deliveredN) * 1000) / 10 : null,
    },
    conversionFunnel: {
      pageViews: fv,
      viewItem: fi,
      addToCart: fc,
      beginCheckout: fb,
      purchase: fp,
      steps: [
        { name: "Page views", value: fv },
        { name: "Product views", value: fi },
        { name: "Add to cart", value: fc },
        { name: "Checkout", value: fb },
        { name: "Purchase", value: fp },
      ],
    },
    marginTrend: fillMarginTrend(marginDailyQ.rows || [], rangeKey),
    payMethodMix: [
      { name: "Online", value: Number(revenueByMethod.rows[0]?.online_revenue || 0), orders: Number(revenueByMethod.rows[0]?.online_count || 0) },
      { name: "COD", value: Number(revenueByMethod.rows[0]?.cod_revenue || 0), orders: Number(revenueByMethod.rows[0]?.cod_count || 0) },
    ],
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
    // Honest caveats for charts (admin UI can surface as tips)
    dataNotes: {
      revenueTrend: "Order totals (incl. shipping/COD fee/GST as charged). Empty days = ₹0.",
      bestSellers: "Line subtotals from item prices (before order-level coupon allocation). Not identical to full order totals.",
      categoryMix: "Same basis as best sellers — share of line value by category.",
      profit: "Margin uses variant-aware selling price; realised profit uses paid/COD order lines vs unit cost.",
    },
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
  // WHAT: Per-product cost vs revenue vs margin for the dashboard chart/table.
  // WHY: Margin used products.price (Basics) only — size/colour variant prices were ignored,
  //      so a Medium @ ₹500 with a low Basics price showed fake negative margin.
  // HOW: Reference selling price = average of variant prices when any exist (size rows preferred);
  //      else Basics price. Realised profit still uses order line revenue (actual charged amounts).
  // CONNECTED TO: product_variants.price, products.price, cost_breakdown; Admin dashboard Cost & profit.
  const { rows: salesRows } = await query(
    `SELECT item->>'id' AS product_id,
       SUM((item->>'qty')::int) AS units_sold,
       SUM((item->>'price')::numeric * (item->>'qty')::int) AS revenue
     FROM orders, jsonb_array_elements(items) AS item
     WHERE payment_status IN ('paid','cod')
     GROUP BY item->>'id'`
  );
  const salesByProduct = Object.fromEntries(salesRows.map(r => [r.product_id, { unitsSold: Number(r.units_sold), revenue: Number(r.revenue) }]));

  const { rows: products } = await query(
    `SELECT id, name, category, price, status, cost_breakdown FROM products ORDER BY category, name`
  );

  const { rows: variantRows } = await query(
    `SELECT product_id, size, price FROM product_variants WHERE price IS NOT NULL AND price > 0`
  );
  const variantsByProduct = {};
  for (const v of variantRows) {
    (variantsByProduct[v.product_id] ||= []).push({
      size: v.size,
      price: Number(v.price),
    });
  }

  function referenceSellingPrice(productId, basePrice) {
    const list = variantsByProduct[productId] || [];
    if (list.length === 0) {
      return { price: Number(basePrice) || 0, source: "base", min: null, max: null, count: 0 };
    }
    // Prefer size-specific rows (Small/Medium/Large) when present — colour-only rows
    // often inherit Basics; size rows are the deliberate price overrides.
    const sized = list.filter((v) => v.size != null && String(v.size).trim() !== "");
    const pool = sized.length > 0 ? sized : list;
    const prices = pool.map((v) => v.price).filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length === 0) {
      return { price: Number(basePrice) || 0, source: "base", min: null, max: null, count: 0 };
    }
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = Math.round((sum / prices.length) * 100) / 100;
    return {
      price: avg,
      source: "variants",
      min: Math.min(...prices),
      max: Math.max(...prices),
      count: prices.length,
    };
  }

  const items = products.map((p) => {
    const cb = p.cost_breakdown && typeof p.cost_breakdown === "object" ? p.cost_breakdown : {};
    const costBreakdown = Object.fromEntries(COST_CATEGORIES.map((k) => [k, Number(cb[k]) || 0]));
    const totalCostPerUnit = COST_CATEGORIES.reduce((sum, k) => sum + costBreakdown[k], 0);
    const sales = salesByProduct[p.id] || { unitsSold: 0, revenue: 0 };
    const totalCost = totalCostPerUnit * sales.unitsSold;
    const profit = sales.revenue - totalCost;

    const ref = referenceSellingPrice(p.id, p.price);
    const sellPrice = ref.price > 0 ? ref.price : Number(p.price) || 0;
    const hasCostData = totalCostPerUnit > 0;
    const marginPercent =
      hasCostData && sellPrice > 0
        ? Math.round(((sellPrice - totalCostPerUnit) / sellPrice) * 1000) / 10
        : null;
    const expectedProfitPerUnit = hasCostData ? Math.round((sellPrice - totalCostPerUnit) * 100) / 100 : null;

    return {
      id: p.id,
      name: p.name,
      category: p.category,
      // Display / margin price = variant-aware reference (not raw Basics alone)
      price: sellPrice,
      basePrice: Number(p.price) || 0,
      priceSource: ref.source,
      variantPriceMin: ref.min,
      variantPriceMax: ref.max,
      variantPriceCount: ref.count,
      status: p.status,
      costBreakdown,
      totalCostPerUnit,
      hasCostData,
      unitsSold: sales.unitsSold,
      revenue: sales.revenue,
      totalCost,
      profit,
      marginPercent,
      expectedProfitPerUnit,
    };
  });

  res.json({ items });
}));



// GET /api/admin/dashboard/behaviour?range=7d|30d|90d
// First-party event analytics for the admin Behaviour / Analytics panel
router.get("/behaviour", requireRole("staff", "admin", "super_admin"), asyncHandler(async (req, res) => {
  const rangeKey = parseRange(req.query.range);
  const days = RANGE_DAYS[rangeKey] ?? 30;
  const interval = `${days} days`;

  const { rows: totals } = await query(
    `SELECT event_name, COUNT(*)::int AS count
     FROM analytics_events
     WHERE created_at > now() - interval '${interval}'
     GROUP BY event_name
     ORDER BY count DESC`
  );

  const { rows: dailyRaw } = await query(
    `SELECT date_trunc('day', created_at)::date AS day,
            COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
            COUNT(*) FILTER (WHERE event_name = 'view_item')::int AS view_item,
            COUNT(*) FILTER (WHERE event_name = 'add_to_cart')::int AS add_to_cart,
            COUNT(*) FILTER (WHERE event_name = 'begin_checkout')::int AS begin_checkout,
            COUNT(*) FILTER (WHERE event_name = 'purchase')::int AS purchase
     FROM analytics_events
     WHERE created_at > now() - interval '${interval}'
     GROUP BY 1
     ORDER BY 1 ASC`
  );
  // Fill every calendar day in range so charts never look "empty" when only a few days have hits
  const { rows: daySeries } = await query(
    `SELECT generate_series(
       (current_date - ($1::int - 1))::timestamp,
       current_date::timestamp,
       '1 day'::interval
     )::date AS day`,
    [days]
  );
  const byDay = Object.fromEntries(dailyRaw.map((r) => [String(r.day).slice(0, 10), r]));
  const daily = daySeries.map((row) => {
    const key = String(row.day).slice(0, 10);
    const hit = byDay[key];
    return {
      day: row.day,
      page_views: hit?.page_views || 0,
      view_item: hit?.view_item || 0,
      add_to_cart: hit?.add_to_cart || 0,
      begin_checkout: hit?.begin_checkout || 0,
      purchase: hit?.purchase || 0,
    };
  });

  const { rows: topPages } = await query(
    `SELECT path, COUNT(*)::int AS views
     FROM analytics_events
     WHERE event_name = 'page_view'
       AND created_at > now() - interval '${interval}'
       AND path IS NOT NULL AND path <> ''
     GROUP BY path
     ORDER BY views DESC
     LIMIT 15`
  );

  const { rows: topProducts } = await query(
    `SELECT meta->>'productId' AS product_id,
            COALESCE(meta->>'name', meta->>'productId') AS name,
            COUNT(*)::int AS views
     FROM analytics_events
     WHERE event_name = 'view_item'
       AND created_at > now() - interval '${interval}'
       AND meta->>'productId' IS NOT NULL
     GROUP BY 1, 2
     ORDER BY views DESC
     LIMIT 12`
  );

  const { rows: topSearches } = await query(
    `SELECT meta->>'q' AS query, COUNT(*)::int AS count
     FROM analytics_events
     WHERE event_name = 'search'
       AND created_at > now() - interval '${interval}'
       AND meta->>'q' IS NOT NULL AND meta->>'q' <> ''
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 12`
  );

  const { rows: sessions } = await query(
    `SELECT COUNT(DISTINCT session_id)::int AS sessions
     FROM analytics_events
     WHERE created_at > now() - interval '${interval}'
       AND session_id IS NOT NULL`
  );

  const byName = Object.fromEntries(totals.map((r) => [r.event_name, r.count]));
  const pageViews = byName.page_view || 0;
  const viewItem = byName.view_item || 0;
  const addToCart = byName.add_to_cart || 0;
  const beginCheckout = byName.begin_checkout || 0;
  const purchase = byName.purchase || 0;

  res.json({
    range: rangeKey,
    sessions: sessions[0]?.sessions || 0,
    totals: byName,
    funnel: {
      pageViews,
      viewItem,
      addToCart,
      beginCheckout,
      purchase,
      viewToCart: viewItem ? Math.round((addToCart / viewItem) * 1000) / 10 : null,
      cartToCheckout: addToCart ? Math.round((beginCheckout / addToCart) * 1000) / 10 : null,
      checkoutToPurchase: beginCheckout ? Math.round((purchase / beginCheckout) * 1000) / 10 : null,
    },
    daily,
    topPages,
    topProducts,
    topSearches,
  });
}));

export default router;

import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";
import { sendOrderStatusEmail, sendOrderCancelledEmail } from "../../email.js";
import { sendOrderDispatchedWhatsApp, sendOrderDeliveredWhatsApp } from "../../whatsapp.js";
import { refundOrderIfPaid } from "../../refunds.js";
import { createShipment, fetchTrackingStatus } from "../../shiprocket.js";

const router = Router();
const VALID_STATUS = ["confirmed", "production", "qc", "dispatched", "delivered", "cancelled"];

// GET /api/admin/orders — every order in the system, most recent first.
// Unlike the customer-facing GET /api/orders (which only ever returns the
// logged-in customer's own orders), this has no ownership filter — that's
// exactly why it's admin-only.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders ORDER BY placed_at DESC LIMIT 200");
  res.json({ orders: rows.map(toAdminOrder) });
}));

router.get("/:orderNumber", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders WHERE order_number=$1", [req.params.orderNumber]);
  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });
  res.json({ order: toAdminOrder(rows[0]) });
}));

// PATCH /api/admin/orders/:orderNumber/status — this is what turns the
// "5-stage tracking" the frontend already displays from a simulated,
// elapsed-time guess into something a real person actually set.
router.patch("/:orderNumber/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status, pickupLocation } = req.body || {};
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUS.join(", ")}` });
  }

  const { rows: existingRows } = await query("SELECT * FROM orders WHERE order_number=$1", [req.params.orderNumber]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Order not found." });

  const { rows } = await query(
    "UPDATE orders SET status=$1, updated_at=now() WHERE order_number=$2 RETURNING *",
    [status, req.params.orderNumber]
  );
  await logAdminAction(req.admin.id, "order.status_change", {
    orderNumber: req.params.orderNumber, from: existingRows[0].status, to: status,
  });
  // Automatic refund on admin-initiated cancellation too — same real
  // Razorpay refund as the customer self-cancel path, see server/refunds.js.
  let orderRow = rows[0];
  let refundResult = { attempted: false };
  if (status === "cancelled") {
    refundResult = await refundOrderIfPaid(orderRow, { adminId: req.admin.id });
    if (refundResult.success) orderRow = { ...orderRow, payment_status: "refunded", razorpay_refund_id: refundResult.refundId };
  }
  const order = toAdminOrder(orderRow);
  // Fire-and-forget — matches the same reasoning as the customer-facing
  // endpoints: an email failure must never fail the admin action that
  // triggered it. sendOrderStatusEmail() only actually sends for the
  // customer-facing milestones (production/qc/dispatched/delivered) —
  // it quietly no-ops for internal-only statuses like 'confirmed'.
  if (status === "cancelled") sendOrderCancelledEmail(order, refundResult);
  else sendOrderStatusEmail(order, status);
  if (status === "dispatched") {
    sendOrderDispatchedWhatsApp(order);
    // createShipment() expects flat name/address/city/state/pin fields —
    // toAdminOrder() keeps these nested under shippingAddress instead, so
    // this builds the shape createShipment() actually needs directly from
    // the raw DB row rather than reusing `order` here and risking every
    // field silently being undefined.
    const addr = orderRow.shipping_address || {};
    createShipment({ ...order, name: addr.name, address: addr.line, city: addr.city, state: addr.state, pin: addr.pin }, pickupLocation)
      .then(result => {
        if (result.ok) {
          query("UPDATE orders SET courier_tracking_id=$1, courier_tracking_url=$2 WHERE order_number=$3",
            [result.trackingId, result.trackingUrl, req.params.orderNumber]).catch(() => {});
        }
      });
  } else if (status === "delivered") {
    sendOrderDeliveredWhatsApp(order);
  }
  res.json({ order });
}));

// PATCH /api/admin/orders/:orderNumber/mark-paid — records that cash was
// actually collected for a COD order at delivery. Only ever valid from
// 'cod' — a COD order's payment_status starts there and stays there
// until this is called, since there's no Razorpay payment to verify the
// way an online order has. Guarded so this can't be used to flip an
// already-refunded or already-failed order to 'paid' by mistake.
router.patch("/:orderNumber/mark-paid", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "UPDATE orders SET payment_status='paid', updated_at=now() WHERE order_number=$1 AND payment_status='cod' RETURNING *",
    [req.params.orderNumber]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found, or it isn't a pending COD payment." });
  await logAdminAction(req.admin.id, "order.cod_marked_paid", { orderNumber: req.params.orderNumber });
  res.json({ order: toAdminOrder(rows[0]) });
}));

// POST /api/admin/orders/refresh-tracking — checks every currently
// "dispatched" order against Shiprocket's real tracking data and
// auto-advances any that have genuinely been delivered. Replaces relying
// purely on an admin remembering to check and click "Delivered" by hand
// — Shiprocket already knows; this just asks it, for every dispatched
// order in one pass rather than one at a time.
router.post("/refresh-tracking", requireAdmin, asyncHandler(async (req, res) => {
  const { rows: dispatchedOrders } = await query(
    "SELECT * FROM orders WHERE status='dispatched' AND courier_tracking_id IS NOT NULL"
  );
  let updatedCount = 0;
  const results = [];
  for (const orderRow of dispatchedOrders) {
    const tracking = await fetchTrackingStatus(orderRow.courier_tracking_id);
    if (tracking.skipped) continue; // no Shiprocket credentials configured — nothing to check against
    if (!tracking.ok) { results.push({ orderNumber: orderRow.order_number, checked: true, updated: false }); continue; }
    if (tracking.isDelivered) {
      const { rows: updated } = await query(
        "UPDATE orders SET status='delivered', updated_at=now() WHERE order_number=$1 RETURNING *",
        [orderRow.order_number]
      );
      await logAdminAction(req.admin.id, "order.status_change", { orderNumber: orderRow.order_number, from: "dispatched", to: "delivered", source: "shiprocket_tracking_sync" });
      sendOrderStatusEmail(toAdminOrder(updated[0]), "delivered");
      sendOrderDeliveredWhatsApp(toAdminOrder(updated[0]));
      updatedCount++;
      results.push({ orderNumber: orderRow.order_number, checked: true, updated: true });
    } else {
      results.push({ orderNumber: orderRow.order_number, checked: true, updated: false, rawStatus: tracking.rawStatus });
    }
  }
  res.json({ checkedCount: dispatchedOrders.length, updatedCount, results });
}));

function toAdminOrder(row) {
  return {
    orderNumber: row.order_number,
    customerId: row.customer_id,
    email: row.email,
    phone: row.phone,
    items: row.items,
    shippingAddress: row.shipping_address,
    subtotal: row.subtotal,
    discount: row.discount,
    couponCode: row.coupon_code,
    shippingCost: row.shipping_cost,
    codFee: row.cod_fee,
    cgst: row.cgst,
    sgst: row.sgst,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    courierTrackingUrl: row.courier_tracking_url,
    placedAt: new Date(row.placed_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export default router;

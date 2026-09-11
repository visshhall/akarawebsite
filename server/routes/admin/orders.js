import { notifyCustomer } from "../../push.js";
import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";
import { sendOrderStatusEmail, sendOrderCancelledEmail } from "../../email.js";
import { sendOrderDispatchedWhatsApp, sendOrderDeliveredWhatsApp } from "../../whatsapp.js";
import { refundOrderIfPaid, refundOrderPartial } from "../../refunds.js";
import { createShipment, fetchTrackingStatus, cancelShipment, syncShipmentByOrderNumber } from "../../shiprocket.js";

const router = Router();
const VALID_STATUS = ["confirmed", "production", "qc", "dispatched", "delivered", "cancelled"];

// Found in an independent security review: any status could follow any
// other with zero checks — an order could jump straight from "confirmed"
// to "delivered", or bounce backward from "delivered" to "production".
// This maps out the real, sensible order lifecycle for a made-to-order
// business: forward progress, one deliberate backward step (qc can send
// a piece back to production on a genuine quality failure), and
// cancellation allowed at any point before delivery — matching real
// courier realities like a refused or lost-in-transit ("RTO") parcel,
// not just a pre-dispatch change of mind. delivered and cancelled are
// both terminal here; a post-delivery issue goes through the separate
// Return Request flow instead, not this endpoint.
const ALLOWED_TRANSITIONS = {
  confirmed: ["production", "cancelled"],
  production: ["qc", "cancelled"],
  qc: ["production", "dispatched", "cancelled"],
  dispatched: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

// GET /api/admin/orders — every order in the system, most recent first.
// Unlike the customer-facing GET /api/orders (which only ever returns the
// logged-in customer's own orders), this has no ownership filter — that's
// exactly why it's admin-only.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders ORDER BY placed_at DESC LIMIT 200");
  res.json({ orders: rows.map(toAdminOrder) });
}));

// Lightweight poll endpoint for admin sidebar badge — count of orders
// placed after `since` (unix ms). Used like an unread-message counter.
router.get("/new-count", requireAdmin, asyncHandler(async (req, res) => {
  const sinceRaw = req.query.since;
  const sinceMs = sinceRaw != null && sinceRaw !== "" ? Number(sinceRaw) : NaN;
  if (!Number.isFinite(sinceMs) || sinceMs < 0) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count, COALESCE(MAX(EXTRACT(EPOCH FROM placed_at)*1000), 0)::bigint AS latest
       FROM orders`
    );
    return res.json({ count: rows[0].count, latest: Number(rows[0].latest) });
  }
  const sinceDate = new Date(sinceMs);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(MAX(EXTRACT(EPOCH FROM placed_at)*1000), $1)::bigint AS latest
     FROM orders
     WHERE placed_at > $2`,
    [sinceMs, sinceDate]
  );
  res.json({ count: rows[0].count, latest: Number(rows[0].latest) });
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
  const currentStatus = existingRows[0].status;

  // Setting a status to what it already is is allowed as a harmless
  // no-op (e.g. a double-click or a retried request after a network
  // blip) — only a genuine change needs to pass the transition check.
  if (status !== currentStatus) {
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        error: allowedNext.length > 0
          ? `Can't move from "${currentStatus}" to "${status}". Valid next steps: ${allowedNext.join(", ")}.`
          : `"${currentStatus}" is a final status and can't be changed.`,
      });
    }
  }

  // Dispatching without a pickup location is rejected before any DB write.
  if (status === "dispatched" && !pickupLocation) {
    return res.status(400).json({ error: "A pickup location is required to mark an order as dispatched." });
  }

  // ── DISPATCH: Shiprocket must succeed BEFORE status becomes "dispatched"
  // so customers are never told an order shipped when no courier booking exists.
  if (status === "dispatched") {
    const existing = existingRows[0];
    // pg may return JSON columns as objects or strings depending on driver/settings
    let addr = existing.shipping_address || {};
    if (typeof addr === "string") {
      try { addr = JSON.parse(addr); } catch { addr = {}; }
    }
    if (!addr || typeof addr !== "object") addr = {};
    let itemsRaw = existing.items || [];
    if (typeof itemsRaw === "string") {
      try { itemsRaw = JSON.parse(itemsRaw); } catch { itemsRaw = []; }
    }
    if (!Array.isArray(itemsRaw)) itemsRaw = [];
    const shipPayload = {
      orderNumber: existing.order_number,
      name: addr.name || existing.name || existing.email,
      address: addr.line || addr.address || addr.address_line || "",
      landmark: addr.landmark || "",
      city: addr.city || "",
      state: addr.state || "",
      pin: addr.pin || addr.pincode || addr.postal_code || "",
      phone: addr.phone || existing.phone || "",
      email: existing.email || "",
      items: itemsRaw,
      total: existing.total,
      paymentMethod: existing.payment_method,
      paymentStatus: existing.payment_status,
    };

    let shipment;
    try {
      shipment = await createShipment(shipPayload, pickupLocation);
    } catch (err) {
      console.error("[dispatch] createShipment threw:", err?.message || err);
      shipment = { ok: false, error: err?.message || "Shiprocket call failed unexpectedly." };
    }
    if (!shipment?.ok) {
      const errMsg = shipment?.error || "Shiprocket could not create the shipment. Order was NOT marked dispatched.";
      console.error(`[dispatch] #${req.params.orderNumber} blocked: ${errMsg}`);
      await logAdminAction(req.admin.id, "order.shiprocket_failed", {
        orderNumber: req.params.orderNumber,
        from: currentStatus,
        error: errMsg,
        skipped: !!shipment?.skipped,
      });
      return res.status(502).json({
        error: errMsg,
        shipment: {
          ok: false,
          skipped: !!shipment?.skipped,
          error: errMsg,
        },
      });
    }

    const { rows } = await query(
      `UPDATE orders SET status='dispatched', courier_tracking_id=$1, courier_tracking_url=$2, updated_at=now()
       WHERE order_number=$3 RETURNING *`,
      [shipment.trackingId, shipment.trackingUrl, req.params.orderNumber]
    );
    let orderRow = rows[0];
    await logAdminAction(req.admin.id, "order.status_change", {
      orderNumber: req.params.orderNumber,
      from: currentStatus,
      to: "dispatched",
      shiprocketAwb: shipment.awb || null,
      shiprocketTrackingId: shipment.trackingId || null,
    });

    const order = toAdminOrder(orderRow);
    if (orderRow.customer_id) {
      notifyCustomer(orderRow.customer_id, {
        title: "ĀKĀRA · Order update",
        body: `#${req.params.orderNumber} · Dispatched`,
        url: "/order-status",
      }).catch(() => {});
    }
    sendOrderStatusEmail(order, "dispatched");
    sendOrderDispatchedWhatsApp(order);

    return res.json({
      order,
      shipment: {
        ok: true,
        skipped: false,
        error: null,
        trackingId: shipment.trackingId || null,
        trackingUrl: shipment.trackingUrl || null,
        awb: shipment.awb || null,
        shipmentId: shipment.shipmentId || null,
      },
    });
  }

  // ── All other status changes (not dispatch)
  const { rows } = await query(
    "UPDATE orders SET status=$1, updated_at=now() WHERE order_number=$2 RETURNING *",
    [status, req.params.orderNumber]
  );
  await logAdminAction(req.admin.id, "order.status_change", {
    orderNumber: req.params.orderNumber, from: existingRows[0].status, to: status,
  });
  const statusLabels = { confirmed:"Confirmed", production:"In production", qc:"QC & packaging", dispatched:"Dispatched", delivered:"Delivered", cancelled:"Cancelled" };
  if (rows[0]?.customer_id && ["production","qc","dispatched","delivered","cancelled"].includes(status)) {
    notifyCustomer(rows[0].customer_id, {
      title: "ĀKĀRA · Order update",
      body: `#${req.params.orderNumber} · ${statusLabels[status]||status}`,
      url: "/order-status",
    }).catch(()=>{});
  }
  let orderRow = rows[0];
  let refundResult = { attempted: false };
  let shiprocketCancel = null;
  if (status === "cancelled") {
    // If this order was already booked with Shiprocket (dispatched / has tracking),
    // request cancel on their side so the courier is not left active after an emergency cancel.
    const hadCourier =
      existingRows[0].status === "dispatched" ||
      !!existingRows[0].courier_tracking_id ||
      !!existingRows[0].courier_tracking_url;
    if (hadCourier) {
      shiprocketCancel = await cancelShipment({
        trackingId: existingRows[0].courier_tracking_id,
        awb: existingRows[0].courier_tracking_id,
        orderNumber: req.params.orderNumber,
      });
      await logAdminAction(req.admin.id, shiprocketCancel?.ok ? "order.shiprocket_cancel_ok" : "order.shiprocket_cancel_failed", {
        orderNumber: req.params.orderNumber,
        from: existingRows[0].status,
        error: shiprocketCancel?.error || null,
        message: shiprocketCancel?.message || null,
        method: shiprocketCancel?.method || null,
      });
      // Record on order events for admin/customer visibility
      try {
        let events = [];
        try {
          events = Array.isArray(existingRows[0].courier_events)
            ? existingRows[0].courier_events
            : JSON.parse(existingRows[0].courier_events || "[]");
        } catch { events = []; }
        if (!Array.isArray(events)) events = [];
        events.push({
          status: shiprocketCancel?.ok
            ? "Cancellation requested on Shiprocket"
            : `Shiprocket cancel failed: ${shiprocketCancel?.error || "unknown"}`,
          at: new Date().toISOString(),
          awb: existingRows[0].courier_tracking_id || null,
        });
        await query(
          `UPDATE orders SET courier_status=$1, courier_status_detail=$1, courier_events=$2::jsonb, updated_at=now() WHERE order_number=$3`,
          [
            shiprocketCancel?.ok ? "Cancellation requested" : "Cancel failed — check Shiprocket",
            JSON.stringify(events.slice(-40)),
            req.params.orderNumber,
          ]
        );
        const refreshed = await query("SELECT * FROM orders WHERE order_number=$1", [req.params.orderNumber]);
        if (refreshed.rows[0]) orderRow = refreshed.rows[0];
      } catch (e) {
        console.error("[courier] failed to record cancel event:", e.message);
      }
    }

    refundResult = await refundOrderIfPaid(orderRow, { adminId: req.admin.id });
    if (refundResult.success) orderRow = { ...orderRow, payment_status: "refunded", razorpay_refund_id: refundResult.refundId };
  }
  const order = toAdminOrder(orderRow);
  if (status === "cancelled") sendOrderCancelledEmail(order, refundResult);
  else sendOrderStatusEmail(order, status);
  if (status === "delivered") {
    sendOrderDeliveredWhatsApp(order);
  }
  res.json({
    order,
    shipment: null,
    shiprocketCancel: shiprocketCancel
      ? {
          ok: !!shiprocketCancel.ok,
          skipped: !!shiprocketCancel.skipped,
          error: shiprocketCancel.error || null,
          message: shiprocketCancel.message || null,
        }
      : null,
    refund: refundResult?.attempted
      ? { attempted: true, success: !!refundResult.success, error: refundResult.error || null }
      : null,
  });
}));

// PATCH /api/admin/orders/:orderNumber/mark-paid — records that cash was
// actually collected for a COD order at delivery. Only ever valid from
// 'cod' — a COD order's payment_status starts there and stays there
// until this is called, since there's no Razorpay payment to verify the
// way an online order has. Guarded so this can't be used to flip an
// already-refunded or already-failed order to 'paid' by mistake.
router.patch("/:orderNumber/mark-paid", requireAdmin, asyncHandler(async (req, res) => {
  // Found via real end-to-end testing: this originally only checked
  // payment_status='cod', with no check on the order's own status —
  // meaning a cancelled COD order (which never should have cash
  // collected for it) could still be marked "paid" by mistake. status
  // must genuinely still be 'confirmed' or further along, never
  // 'cancelled', for marking payment to make any sense at all.
  const { rows } = await query(
    "UPDATE orders SET payment_status='paid', updated_at=now() WHERE order_number=$1 AND payment_status='cod' AND status!='cancelled' RETURNING *",
    [req.params.orderNumber]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found, isn't a pending COD payment, or has already been cancelled." });
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


// POST /api/admin/orders/:orderNumber/sync-courier — pull AWB/URL from Shiprocket
// when booking exists there but our DB has no (or only SR-) tracking id.
router.post("/:orderNumber/sync-courier", requireAdmin, asyncHandler(async (req, res) => {
  const orderNumber = req.params.orderNumber;
  const { rows: existingRows } = await query("SELECT * FROM orders WHERE order_number=$1", [orderNumber]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Order not found." });

  const result = await syncShipmentByOrderNumber(orderNumber);
  if (!result?.ok) {
    return res.status(502).json({
      error: result?.error || "Could not find this order on Shiprocket.",
      shipment: result || null,
    });
  }

  const { rows } = await query(
    `UPDATE orders SET
       courier_tracking_id = $1,
       courier_tracking_url = $2,
       courier_status = COALESCE(courier_status, 'SHIPMENT CREATED'),
       updated_at = now()
     WHERE order_number = $3
     RETURNING *`,
    [result.trackingId, result.trackingUrl, orderNumber]
  );

  await logAdminAction(req.admin.id, "order.courier_sync", {
    orderNumber,
    awb: result.awb || null,
    trackingId: result.trackingId || null,
  });

  res.json({
    order: toAdminOrder(rows[0]),
    shipment: {
      ok: true,
      awb: result.awb || null,
      trackingId: result.trackingId || null,
      trackingUrl: result.trackingUrl || null,
      shipmentId: result.shipmentId || null,
    },
  });
}));


function toAdminOrder(row) {
  return {
    orderNumber: row.order_number,
    customerId: row.customer_id,
    email: row.email,
    phone: row.phone,
    // Same real, defensive hardening as toFrontendOrder() in
    // server/routes/orders.js — this is a genuinely separate real
    // serialization function, so the fix there does not cover this
    // one; found and fixed while doing a full sweep for the same bug
    // class that broke product media uploads.
    items: Array.isArray(row.items) ? row.items : [],
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
    courierTrackingId: row.courier_tracking_id || null,
    courierStatus: row.courier_status || null,
    courierStatusDetail: row.courier_status_detail || null,
    courierEvents: Array.isArray(row.courier_events) ? row.courier_events : [],
    placedAt: new Date(row.placed_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    amountRefunded: Number(row.amount_refunded || 0),
    razorpayPaymentId: row.razorpay_payment_id || null,
  };
}


// POST /api/admin/orders/:orderNumber/refund — partial or full residual refund
router.post("/:orderNumber/refund", requireAdmin, asyncHandler(async (req, res) => {
  const orderNumber = req.params.orderNumber;
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim().slice(0, 200);
  const { rows } = await query("SELECT * FROM orders WHERE order_number=$1", [orderNumber]);
  if (!rows.length) return res.status(404).json({ error: "Order not found." });
  const result = await refundOrderPartial(rows[0], amount, { adminId: req.admin.id, reason });
  if (!result.success) {
    return res.status(400).json({ error: result.error || "Refund failed." });
  }
  const { rows: updated } = await query("SELECT * FROM orders WHERE order_number=$1", [orderNumber]);
  res.json({ ok: true, ...result, order: toAdminOrder(updated[0]) });
}));

export default router;


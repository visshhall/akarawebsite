import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { verifyWebhookSignature } from "../razorpay.js";
import { sendOrderConfirmationEmail } from "../email.js";
import { sendOrderConfirmationWhatsApp } from "../whatsapp.js";
import { toFrontendOrder } from "./orders.js";

const router = Router();

// POST /webhooks/razorpay — deliberately mounted OUTSIDE /api and BEFORE
// the CSRF middleware in server.js. This request comes from Razorpay's own
// servers, not a browser with cookies — it can never carry a CSRF token,
// and shouldn't need to; its authenticity is proven by the webhook
// signature check below instead.
//
// Why this exists alongside /api/orders/verify: the frontend-driven verify
// call can fail to ever happen — the customer's browser could crash, lose
// connection, or they could close the tab right after paying, before the
// verify request completes. This webhook is Razorpay proactively telling
// us "this payment succeeded" regardless of what the customer's browser
// did afterward — the actual authoritative source of truth, not a backup.
router.post("/razorpay", asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: "Missing signature." });
  }

  const valid = verifyWebhookSignature(req.rawBody, signature);
  if (!valid) {
    console.error("Razorpay webhook: invalid signature — possible forged request, rejected.");
    return res.status(400).json({ error: "Invalid signature." });
  }

  const event = req.body;
  const razorpayOrderId = event?.payload?.payment?.entity?.order_id;
  const razorpayPaymentId = event?.payload?.payment?.entity?.id;

  if (event?.event === "payment.captured" && razorpayOrderId) {
    // RETURNING * (not just a plain UPDATE) is what makes this genuinely
    // safe to call unconditionally, not just "probably fine": if the
    // customer's own /verify request already got there first, the WHERE
    // clause matches zero rows, rows.length is 0, and nothing further
    // happens — no duplicate email, no duplicate WhatsApp. If this
    // webhook is the ONLY thing that ever ran (e.g. the customer's
    // browser crashed or lost connection right after paying, before
    // /verify completed), exactly one row is returned and the customer
    // gets the confirmation they're actually owed for a real, captured
    // payment — which, before this, they simply never received.
    const { rows } = await query(
      `UPDATE orders SET payment_status='paid', razorpay_payment_id=$1, updated_at=now()
       WHERE razorpay_order_id=$2 AND payment_status <> 'paid' RETURNING *`,
      [razorpayPaymentId, razorpayOrderId]
    );
    if (rows.length > 0) {
      const order = toFrontendOrder(rows[0]);
      // Fire-and-forget, matching the exact same pattern as /verify —
      // an email/WhatsApp failure must never fail this webhook response,
      // which Razorpay itself retries on non-2xx.
      sendOrderConfirmationEmail(order);
      sendOrderConfirmationWhatsApp(order);
    }
  } else if (event?.event === "payment.failed" && razorpayOrderId) {
    await query(
      `UPDATE orders SET payment_status='failed', updated_at=now()
       WHERE razorpay_order_id=$1 AND payment_status = 'pending'`,
      [razorpayOrderId]
    );
  }
  // Any other event type is acknowledged but ignored — Razorpay sends many
  // event types; we only act on the two that matter for order state here.

  res.status(200).json({ received: true });
}));



// POST /webhooks/shiprocket — status updates from Shiprocket (delivered, RTO, etc.).
// Mounted under /webhooks (no CSRF). Auth: x-api-key header must match
// SHIPROCKET_WEBHOOK_TOKEN. This does NOT create shipments — only syncs
// status after a booking already exists from admin dispatch.
router.post("/shiprocket", asyncHandler(async (req, res) => {
  const expected = (process.env.SHIPROCKET_WEBHOOK_TOKEN || "").trim();
  if (!expected) {
    console.error("[shiprocket webhook] SHIPROCKET_WEBHOOK_TOKEN not set — rejecting");
    return res.status(503).json({ error: "Webhook not configured." });
  }
  const got =
    req.headers["x-api-key"] ||
    req.headers["x-api-token"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
    "";
  if (String(got).trim() !== expected) {
    console.error("[shiprocket webhook] invalid token");
    return res.status(401).json({ error: "Invalid token." });
  }

  const body = req.body || {};
  const channelOrderId =
    body.channel_order_id ||
    body.order_id ||
    body.sr_order_id ||
    body?.data?.channel_order_id ||
    body?.data?.order_id ||
    null;
  const awb =
    body.awb ||
    body.awb_code ||
    body?.data?.awb ||
    body?.data?.awb_code ||
    null;
  const rawStatus = String(
    body.current_status ||
      body.shipment_status ||
      body.status ||
      body?.data?.current_status ||
      ""
  ).trim();

  if (!channelOrderId && !awb) {
    return res.status(200).json({ received: true, acted: false, reason: "no order id" });
  }

  let rows;
  if (channelOrderId) {
    ({ rows } = await query(`SELECT * FROM orders WHERE order_number = $1 LIMIT 1`, [String(channelOrderId)]));
  }
  if ((!rows || rows.length === 0) && awb) {
    ({ rows } = await query(`SELECT * FROM orders WHERE courier_tracking_id = $1 LIMIT 1`, [String(awb)]));
  }
  if (!rows || rows.length === 0) {
    console.warn(`[shiprocket webhook] no local order for channel_order_id=${channelOrderId} awb=${awb}`);
    return res.status(200).json({ received: true, acted: false, reason: "order not found" });
  }

  const order = rows[0];
  const statusLower = rawStatus.toLowerCase();
  const isDelivered = /delivered/.test(statusLower) && !/rto|undelivered|failed/.test(statusLower);
  const isRto = /\brto\b|returned to origin|return to origin/.test(statusLower);
  const isOutForDelivery = /out for delivery|ofd/.test(statusLower);
  const isInTransit = /in transit|shipped|picked up|pickup|in_transit|connected/.test(statusLower);

  // Append event history (keep last 40)
  let events = [];
  try {
    events = Array.isArray(order.courier_events) ? order.courier_events : JSON.parse(order.courier_events || "[]");
  } catch { events = []; }
  if (!Array.isArray(events)) events = [];
  if (rawStatus) {
    events.push({ status: rawStatus, at: new Date().toISOString(), awb: awb || order.courier_tracking_id || null });
    events = events.slice(-40);
  }

  const trackingUrl = awb
    ? `https://shiprocket.co/tracking/${awb}`
    : order.courier_tracking_url || null;

  await query(
    `UPDATE orders SET
       courier_tracking_id = COALESCE($1, courier_tracking_id),
       courier_tracking_url = COALESCE($2, courier_tracking_url),
       courier_status = COALESCE(NULLIF($3, ''), courier_status),
       courier_status_detail = $3,
       courier_events = $4::jsonb,
       updated_at = now()
     WHERE order_number = $5`,
    [awb ? String(awb) : null, trackingUrl, rawStatus || null, JSON.stringify(events), order.order_number]
  );

  if (isDelivered && order.status === "dispatched") {
    await query(
      `UPDATE orders SET status='delivered', updated_at=now() WHERE order_number=$1 AND status='dispatched'`,
      [order.order_number]
    );
    console.log(`[shiprocket webhook] #${order.order_number} → delivered (${rawStatus})`);
  } else if (isOutForDelivery || isInTransit || isRto) {
    console.log(`[shiprocket webhook] #${order.order_number} courier: ${rawStatus}`);
  }

  res.status(200).json({ received: true, acted: true, orderNumber: order.order_number, courierStatus: rawStatus });
}));

export default router;


import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { verifyWebhookSignature } from "../razorpay.js";

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
    await query(
      `UPDATE orders SET payment_status='paid', razorpay_payment_id=$1, updated_at=now()
       WHERE razorpay_order_id=$2 AND payment_status <> 'paid'`,
      [razorpayPaymentId, razorpayOrderId]
    );
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

export default router;

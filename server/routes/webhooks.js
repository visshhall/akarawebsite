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

export default router;

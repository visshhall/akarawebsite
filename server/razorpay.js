// ============================================================================
// RAZORPAY INTEGRATION — order creation and the two signature checks that
// actually make this secure: verifying a completed payment (called by the
// frontend right after checkout) and verifying a webhook (called by
// Razorpay's own servers, the authoritative source of truth).
//
// SECURITY PRINCIPLE running through this whole file: never trust the
// browser's word that a payment succeeded. A payment is only ever marked
// "paid" in our database after a cryptographic signature — computed with
// a secret only we and Razorpay know — has been verified server-side.
// Anyone could call our API and *claim* they paid; only a valid signature
// proves Razorpay actually processed it.
// ============================================================================
import crypto from "crypto";

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error(
    "RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET are not set. Add both in " +
    "Railway's Variables tab. The Key ID is safe to share; the Key Secret " +
    "must NEVER be pasted anywhere except directly into Railway."
  );
  process.exit(1);
}

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
// Configurable purely so this can be pointed at a local mock during
// testing without touching any real behavior — always the real Razorpay
// API in production, since this env var is never set there.
const RAZORPAY_API_BASE = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com/v1";

// Creates an order on Razorpay's side (required before the frontend can
// open the payment widget). amountInPaise must be a whole number — Razorpay
// works in the smallest currency unit (paise, not rupees) specifically to
// avoid floating-point rounding errors with money.
export async function createRazorpayOrder(amountInPaise, receipt) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency: "INR",
      receipt,
      payment_capture: 1, // auto-capture — funds settle immediately on successful payment rather than needing a separate manual capture step
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Razorpay order creation failed (${res.status}): ${body}`);
  }
  return res.json(); // { id, amount, currency, ... }
}

// Called right after the customer completes payment in the Razorpay widget.
// The frontend receives razorpay_order_id + razorpay_payment_id +
// razorpay_signature from Razorpay directly and forwards all three here.
// This recomputes the expected signature ourselves and compares — this is
// the check that actually proves the payment is real, not just a claim.
export function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  return timingSafeEqualStrings(expected, razorpay_signature);
}

// Verifies a Razorpay webhook — a SEPARATE secret from the payment
// signature above (RAZORPAY_WEBHOOK_SECRET, configured in the Razorpay
// dashboard when the webhook URL is set up). Needs the raw, unparsed
// request body — signing over the parsed-and-re-stringified JSON would
// produce a different (wrong) signature, since key order/whitespace can
// differ from what Razorpay originally sent.
export function verifyWebhookSignature(rawBody, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqualStrings(expected, signature);
}

// Constant-time string comparison — a regular === comparison leaks timing
// information (it returns faster the earlier a mismatch occurs), which in
// theory lets an attacker guess a valid signature one character at a time.
// crypto.timingSafeEqual requires equal-length buffers, so length is
// checked first (safe to leak — signature length isn't secret).
function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b || "", "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Issues a real refund via Razorpay's Refund API against a specific
// payment. amountInPaise must be an exact whole-number amount in paise —
// same reasoning as order creation, avoids floating-point rounding on
// money. Passing a smaller amount than the original payment issues a
// PARTIAL refund; the full paid amount issues a full one. Razorpay itself
// is idempotent per payment for the full amount (won't double-refund the
// same payment_id past what was actually paid), but this function does
// not retry on failure — the caller (see server/routes/admin/orders.js)
// is responsible for recording the outcome and surfacing any failure to
// the admin rather than silently losing it.
export async function createRazorpayRefund(paymentId, amountInPaise, notes = {}) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ amount: amountInPaise, notes }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Razorpay refund failed (${res.status}): ${body}`);
  }
  return res.json(); // { id, amount, status, ... }
}

export { RAZORPAY_KEY_ID };

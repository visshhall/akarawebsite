import { Router } from "express";
import crypto from "crypto";
import { query, pool } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";
import { createRazorpayOrder, verifyPaymentSignature, RAZORPAY_KEY_ID } from "../razorpay.js";
import { sanitize, validEmail } from "../validate.js";
import { getShippingSettings, lookupCoupon } from "../settings.js";
import { sendOrderConfirmationEmail, sendOrderCancelledEmail } from "../email.js";
import { sendOrderConfirmationWhatsApp } from "../whatsapp.js";
import { refundOrderIfPaid } from "../refunds.js";

const router = Router();

// Recomputes the entire order total from REAL, current database prices —
// never from anything the client sent. This is the single most important
// security property of checkout: a tampered request claiming a ₹50,000
// item costs ₹5 cannot succeed, because the price never comes from the
// request body, only from `products.price` in the database at the moment
// of checkout. Returns null if any cart item references a real product
// that's sold out or no longer exists — checkout should not proceed either way.
//
// couponCode works the same way: the client sends only the CODE (a
// string like "AKARA10"), never a discount amount — the discount
// percentage and the resulting rupee amount are both looked up here, from
// the real coupons table (see server/settings.js), never trusted from the
// request. An unrecognized OR deactivated code is silently treated as no
// coupon (matches the Cart page's own behavior: an invalid code just
// doesn't apply, rather than blocking checkout).
//
// Shipping cost and the free-shipping threshold are read fresh from the
// settings table on every call too — an admin changing these in the
// Settings screen applies to the very next checkout, not after a restart.
async function priceCartServerSide(cartItems, couponCode, customerId, codFee = 0) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return null;
  const ids = cartItems.map(i => i?.id).filter(id => typeof id === "string");
  if (ids.length !== cartItems.length) return null;

  // REAL BUG FIX: this used to always charge products.price and never
  // looked at color/variant at all — found directly from a customer
  // screenshot showing 4 separate "Vermillion Pendant Lamp (Black)"
  // cart lines, one with no size shown (added from a product CARD,
  // which never set size/color) sitting alongside 3 correctly-labeled
  // size-specific lines. Tracing that display bug surfaced a genuinely
  // more serious one: for ANY variant product, checkout was silently
  // charging the base product price regardless of which real
  // size+color combination — and its real, different price — the
  // customer actually picked and saw on the product page. Now fetches
  // every real color+variant row alongside the base product, and
  // resolves each cart line's ACTUAL price/status server-side from
  // that — the server, not whatever price a manipulated cart request
  // might claim, decides what gets charged.
  const [{ rows: products }, { rows: colors }, { rows: variants }, { shippingCost: SHIPPING_COST, freeShippingThreshold: FREE_SHIPPING_THRESHOLD }, coupon] = await Promise.all([
    query("SELECT id, name, price, hsn, status FROM products WHERE id = ANY($1)", [ids]),
    query("SELECT id, product_id, variant_key, label FROM product_colors WHERE product_id = ANY($1)", [ids]),
    query("SELECT product_id, color_id, size, price, status FROM product_variants WHERE product_id = ANY($1)", [ids]),
    getShippingSettings(),
    lookupCoupon(couponCode, customerId),
  ]);
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  // colorId is looked up per product+variant_key, since variant_key is
  // only unique WITHIN one product (two different products can each
  // have their own "black" color, with different real database ids).
  const colorIdByProductAndKey = {};
  // Real, human-readable label (e.g. "Red"), looked up the same way —
  // added specifically because order confirmation emails/pages were
  // showing the internal variant_key ("red") or nothing at all, never
  // the actual display name a customer picked. The key itself is still
  // what's used for all matching/pricing logic below; the label is
  // purely for what gets shown to the customer afterward.
  const colorLabelByProductAndKey = {};
  for (const c of colors) {
    colorIdByProductAndKey[`${c.product_id}::${c.variant_key}`] = c.id;
    colorLabelByProductAndKey[`${c.product_id}::${c.variant_key}`] = c.label;
  }
  const variantsByProduct = {};
  for (const v of variants) (variantsByProduct[v.product_id] ||= []).push(v);

  const items = [];
  for (const cartItem of cartItems) {
    const product = byId[cartItem.id];
    if (!product) return null; // references a product that doesn't exist
    const size = typeof cartItem.size === "string" ? sanitize(cartItem.size).slice(0, 20) : null;
    const color = typeof cartItem.color === "string" ? sanitize(cartItem.color).slice(0, 40) : null;
    const colorLabel = color ? (colorLabelByProductAndKey[`${product.id}::${color}`] || null) : null;

    let realPrice = product.price;
    let realStatus = product.status;
    const productVariants = variantsByProduct[product.id];
    if (productVariants && productVariants.length > 0) {
      // REAL BUG FIX, found while directly testing this: a color string
      // that doesn't match any of THIS product's real colors must be
      // rejected outright, not silently treated the same as "no color
      // specified at all". Those are genuinely different cases — colorId
      // stays a real lookup miss (undefined) distinguished from a
      // genuine null, and a lookup miss now correctly fails the whole
      // line instead of matching whichever variant happened to come
      // first in the array (which, for Vermillion, was quietly letting
      // a bogus "nonexistent-color" checkout through at Black's real
      // price — a real, exploitable pricing bug, not just a cosmetic one).
      const colorId = color ? colorIdByProductAndKey[`${product.id}::${color}`] : null;
      if (color && colorId === undefined) return null; // a color was specified but isn't real for this product
      const matched = productVariants.find(v => (colorId == null ? v.color_id == null : v.color_id === colorId) && (v.size || "Medium") === (size || "Medium"));
      // A variant product with no exact-matching combination (e.g. a
      // cart line predating this fix, or a genuinely tampered request)
      // is rejected outright, rather than silently falling back to the
      // base price — for a product WITH real variants, the base price
      // was never meant to be charged directly.
      if (!matched) return null;
      realPrice = matched.price;
      realStatus = matched.status;
    }
    if (realStatus === "sold-out") return null; // can't buy what's sold out — checked per real variant, not just the product overall

    const qty = Number.isInteger(cartItem.qty) && cartItem.qty > 0 && cartItem.qty <= 99 ? cartItem.qty : null;
    if (qty === null) return null;
    items.push({ id: product.id, name: product.name, price: realPrice, hsn: product.hsn, qty, size, color, colorLabel });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = coupon ? Math.round(subtotal * (coupon.discountPercent / 100)) : 0;
  const appliedCouponCode = coupon ? coupon.code : null;
  const afterDiscount = subtotal - discount;
  // Matches the Cart page's exact rule: the free-shipping threshold is
  // checked against the DISCOUNTED subtotal, not the original — a coupon
  // can push an order below the threshold and bring shipping back into play.
  const shippingCost = afterDiscount === 0 || afterDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
  // codFee is 0 for every online-payment order — only ever non-zero when
  // the caller explicitly passes it for a COD checkout. Folded into the
  // taxable value the same way shippingCost already is, for the same
  // reason: it's a real charge on this order, not a separate untaxed
  // afterthought.
  const taxableValue = afterDiscount + shippingCost + codFee;
  const totalTax = Math.round(taxableValue * 0.18);
  const cgst = Math.round(totalTax / 2);
  const sgst = totalTax - cgst; // whatever's left, so cgst+sgst always exactly equals totalTax — no rounding drift between the two halves
  const total = afterDiscount + shippingCost + codFee + totalTax;

  return { items, subtotal, discount, couponCode: appliedCouponCode, shippingCost, codFee, cgst, sgst, total };
}

function generateOrderNumber() {
  // Found in an independent security review: Math.random() is not
  // cryptographically secure, and a 5-digit range (10000-99999, ~90k
  // possibilities) is realistically brute-forceable. Ownership is
  // already correctly re-checked wherever an order number is looked up
  // (customer_id must also match — verified directly in the order-fetch
  // route below), so this was never a direct access-control bypass, but
  // a predictable, guessable identifier is still a real gap worth
  // closing — it also leaks order-volume information to anyone who
  // happens to see two consecutive order numbers. crypto.randomBytes(5)
  // gives a genuinely unpredictable ~1.1 trillion possible values.
  return "AK" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

// POST /api/orders/checkout — step 1 of 2. Prices the cart server-side,
// creates a Razorpay order, and creates our own order record with
// payment_status='pending'. Nothing is considered "paid" yet — that only
// happens in /verify below, after a real signature check.
// Every order MUST belong to a real logged-in customer — guest checkout
// was deliberately removed. It's not that guest checkout is inherently
// insecure (it's extremely common in e-commerce), but it was built here
// without being explicitly discussed as a decision, and the business
// requirement is now explicit: no order without an account. requireAuth
// below is the actual enforcement — it's not a frontend-only restriction.
// Real, atomic re-check for coupon limits, run INSIDE a transaction with
// a row lock on the coupon itself — this is the actual fix for a real,
// serious race condition found during a live concurrency test: firing 5
// genuinely simultaneous checkout requests with the same one-per-customer
// coupon resulted in 4 of them getting the discount, not 1. The earlier
// fix (payment_status IN ('paid','cod') instead of just 'paid') closes
// the gap for sequential requests, but a "check, then later insert" can
// never be made safe against real concurrency without something
// serializing the concurrent requests — a plain re-check without the
// lock would still race, since two connections could both read "not yet
// used" before either one's insert commits.
// SELECT ... FOR UPDATE on the coupon row is what actually closes this:
// the SECOND concurrent transaction trying to lock the same coupon row
// genuinely blocks (queues) until the first transaction commits or rolls
// back — turning "check, then insert" into a real, atomic unit for that
// specific coupon. Returns { ok: true } if the order may proceed, or
// { ok: false } if the real, now-committed state of a concurrent
// transaction means this one should no longer get the discount — in
// that case, the caller re-runs pricing without the coupon rather than
// failing the whole checkout, matching how an ordinary invalid/expired
// coupon already degrades gracefully elsewhere in this file.
async function reserveCouponUnderLock(client, couponCode, customerId) {
  if (!couponCode) return { ok: true };
  const { rows: couponRows } = await client.query(
    "SELECT code, one_per_customer, max_redemptions FROM coupons WHERE code=$1 AND active=true FOR UPDATE",
    [couponCode]
  );
  if (couponRows.length === 0) return { ok: false };
  const coupon = couponRows[0];

  if (coupon.max_redemptions !== null) {
    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE coupon_code=$1 AND payment_status IN ('paid','cod') AND status != 'cancelled'",
      [couponCode]
    );
    if (rows[0].n >= coupon.max_redemptions) return { ok: false };
  }
  if (coupon.one_per_customer && customerId) {
    const { rows } = await client.query(
      "SELECT 1 FROM orders WHERE coupon_code=$1 AND payment_status IN ('paid','cod') AND status != 'cancelled' AND customer_id=$2 LIMIT 1",
      [couponCode, customerId]
    );
    if (rows.length > 0) return { ok: false };
  }
  return { ok: true };
}

router.post("/checkout", requireAuth, asyncHandler(async (req, res) => {
  const { items, address, email, phone, couponCode, paymentMethod } = req.body || {};

  if (!validEmail(email)) return res.status(400).json({ error: "A valid email is required." });
  if (!address || !sanitize(address.name).trim() || !sanitize(address.line).trim() || !sanitize(address.city).trim() || !/^\d{6}$/.test(address.pin || "")) {
    return res.status(400).json({ error: "A complete shipping address is required." });
  }

  // Determined BEFORE pricing runs, not after — the fee has to be baked
  // into subtotal/tax/total from the start, not bolted on afterward.
  // Never trusts the client's word alone that COD is actually available:
  // even a request that claims paymentMethod:'cod' while the setting is
  // genuinely off gets codFee=0 and falls through to the Razorpay path
  // below, exactly the same "never trust client input for anything
  // money-related" principle every other payment code path here follows.
  const shippingSettings = await getShippingSettings();
  const isCodRequest = paymentMethod === "cod" && shippingSettings.codEnabled;
  if (paymentMethod === "cod" && !shippingSettings.codEnabled) {
    return res.status(400).json({ error: "Cash on Delivery isn't available right now. Please choose online payment." });
  }

  const priced = await priceCartServerSide(items, couponCode, req.customer.id, isCodRequest ? shippingSettings.codFee : 0);
  if (!priced) return res.status(400).json({ error: "Your cart couldn't be processed — an item may be sold out or no longer available. Please refresh your cart." });

  const shippingAddress = {
    name: sanitize(address.name).slice(0, 200),
    line: sanitize(address.line).slice(0, 300),
    landmark: sanitize(address.landmark || "").slice(0, 150),
    city: sanitize(address.city).slice(0, 100),
    state: sanitize(address.state || "").slice(0, 100),
    pin: sanitize(address.pin).slice(0, 6),
    phone: sanitize(address.phone || phone || "").slice(0, 20),
  };

  const orderNumber = generateOrderNumber();

  if (isCodRequest) {
    // Real, dedicated client (not the shared pool's query()) — required
    // to run a genuine transaction with a row lock; see
    // reserveCouponUnderLock's own comment for the full real race
    // condition this closes.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let finalPriced = priced;
      if (priced.couponCode) {
        const reservation = await reserveCouponUnderLock(client, priced.couponCode, req.customer.id);
        if (!reservation.ok) {
          // A concurrent request genuinely won the real race for this
          // coupon between when pricing first ran and now — re-price
          // the SAME cart without the coupon rather than fail the
          // whole checkout, the same real, graceful degradation an
          // ordinary invalid/expired code already gets elsewhere.
          finalPriced = await priceCartServerSide(items, null, req.customer.id, shippingSettings.codFee);
          if (!finalPriced) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Your cart couldn't be processed — an item may be sold out or no longer available. Please refresh your cart." }); }
        }
      }
      const { rows } = await client.query(
        `INSERT INTO orders (order_number, customer_id, email, phone, items, shipping_address, subtotal, discount, coupon_code, shipping_cost, cod_fee, cgst, sgst, total, payment_method, payment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'cod','cod') RETURNING *`,
        [
          orderNumber, req.customer.id, sanitize(email), sanitize(phone || shippingAddress.phone),
          JSON.stringify(finalPriced.items), JSON.stringify(shippingAddress),
          finalPriced.subtotal, finalPriced.discount, finalPriced.couponCode, finalPriced.shippingCost, finalPriced.codFee, finalPriced.cgst, finalPriced.sgst, finalPriced.total,
        ]
      );
      await client.query("COMMIT");

      const order = toFrontendOrder(rows[0]);
      // Sent immediately, unlike the Razorpay path — a COD order is fully
      // confirmed the moment it's placed (there's no separate payment step
      // to wait for), so there's no reason to delay this the way Razorpay
      // orders wait for /verify.
      sendOrderConfirmationEmail(order);
      sendOrderConfirmationWhatsApp(order);

      return res.status(201).json({ orderNumber, isCOD: true, order });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(priced.total * 100, orderNumber); // paise, not rupees
  } catch (err) {
    console.error("Razorpay order creation failed:", err);
    return res.status(502).json({ error: "Couldn't reach the payment provider. Please try again in a moment." });
  }

  const { rows } = await query(
    `INSERT INTO orders (order_number, customer_id, email, phone, items, shipping_address, subtotal, discount, coupon_code, shipping_cost, cgst, sgst, total, razorpay_order_id, payment_method)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'razorpay') RETURNING *`,
    [
      orderNumber, req.customer.id, sanitize(email), sanitize(phone || shippingAddress.phone),
      JSON.stringify(priced.items), JSON.stringify(shippingAddress),
      priced.subtotal, priced.discount, priced.couponCode, priced.shippingCost, priced.cgst, priced.sgst, priced.total,
      razorpayOrder.id,
    ]
  );

  res.status(201).json({
    orderNumber,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: RAZORPAY_KEY_ID,
    order: toFrontendOrder(rows[0]),
  });
}));

// POST /api/orders/verify — step 2 of 2. Called by the frontend right
// after the Razorpay payment widget reports success. THIS is where a
// payment actually becomes real in our system — everything before this
// point is provisional. If the signature doesn't check out, the order
// stays payment_status='pending' no matter what the request claims.
router.post("/verify", requireAuth, asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing payment verification details." });
  }

  const valid = verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });
  if (!valid) {
    // Deliberately vague to the client — a real attacker probing this
    // endpoint learns nothing about why their forged signature failed.
    return res.status(400).json({ error: "Payment could not be verified." });
  }

  // Ownership check: only the customer who actually created this order can
  // verify it. A valid Razorpay signature alone proves a real payment
  // happened, but not that it's THIS logged-in customer's payment to
  // confirm — this stops one account from marking another account's order
  // as paid, even in the practically-unlikely case they obtained a valid
  // razorpay_order_id/payment_id/signature set that wasn't theirs.
  //
  // Real transaction + coupon row lock here too — the same real race
  // condition class as the COD path (see reserveCouponUnderLock's own
  // comment), just a lower-probability real-world case: it would need
  // two genuinely separate, real successful Razorpay payments (each
  // costing real money) landing on /verify within the same instant,
  // both for orders using the same one-per-customer coupon. Lower
  // probability than the free-to-repeat COD race, but the same real
  // class of bug, so closed the same real way rather than left as a
  // known, smaller gap.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: orderRows } = await client.query(
      "SELECT * FROM orders WHERE razorpay_order_id=$1 AND customer_id=$2 FOR UPDATE",
      [razorpay_order_id, req.customer.id]
    );
    if (orderRows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Order not found." }); }
    const existingOrder = orderRows[0];

    let finalCouponCode = existingOrder.coupon_code;
    let finalDiscount = existingOrder.discount;
    let finalTotal = existingOrder.total;
    if (existingOrder.coupon_code) {
      const reservation = await reserveCouponUnderLock(client, existingOrder.coupon_code, req.customer.id);
      if (!reservation.ok) {
        // A concurrent request genuinely won the real race for this
        // coupon since this order was first created — the payment
        // itself is still genuinely real and already happened, so the
        // order is NOT rejected; only the coupon's discount is
        // removed at this final step, same real "degrade gracefully,
        // don't fail the whole thing" principle as the COD path.
        finalCouponCode = null;
        finalDiscount = 0;
        finalTotal = existingOrder.subtotal + existingOrder.shipping_cost + existingOrder.cgst + existingOrder.sgst;
      }
    }

    const { rows } = await client.query(
      `UPDATE orders SET payment_status='paid', razorpay_payment_id=$1, coupon_code=$2, discount=$3, total=$4, updated_at=now()
       WHERE id=$5 RETURNING *`,
      [razorpay_payment_id, finalCouponCode, finalDiscount, finalTotal, existingOrder.id]
    );
    await client.query("COMMIT");

    const order = toFrontendOrder(rows[0]);
    // Fire-and-forget — an email failure must never fail the payment
    // response the customer is waiting on; sendOrderConfirmationEmail()
    // already catches its own errors internally (see server/email.js).
    sendOrderConfirmationEmail(order);
    sendOrderConfirmationWhatsApp(order);
    res.json({ order });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// GET /api/orders — the logged-in customer's real order history. This is
// what makes My Account → Orders show more than just "the last order from
// this browser session" for the first time.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM orders WHERE customer_id=$1 ORDER BY placed_at DESC",
    [req.customer.id]
  );
  res.json({ orders: rows.map(toFrontendOrder) });
}));

// GET /api/orders/:orderNumber — single order detail. Requires login AND
// ownership — deliberately does NOT support guest lookup by order number
// alone (order numbers are only 5 digits, ~90000 possibilities — guessable
// — so allowing lookup without proof of ownership would let anyone browse
// other customers' addresses and order contents).
router.get("/:orderNumber", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM orders WHERE order_number=$1 AND customer_id=$2",
    [req.params.orderNumber, req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });
  res.json({ order: toFrontendOrder(rows[0]) });
}));

const CUSTOMER_CANCEL_WINDOW_MINUTES = 30;

// PATCH /api/orders/:orderNumber/cancel — a customer can cancel their own
// order, but ONLY within 30 minutes of placing it. The 30-minute check
// happens here, server-side, against the real placed_at timestamp stored
// in the database — never trusting anything the client claims about how
// much time has passed (a browser clock or a client-side timer is trivial
// to manipulate; this is the actual enforcement point). Ownership is
// checked the same way every other customer order endpoint does — a
// customer can only ever cancel their own order, never anyone else's.
//
// HONEST LIMITATION: this marks the order cancelled in our own system —
// it does NOT automatically refund the payment via Razorpay. A real
// refund requires calling Razorpay's Refund API with the account's live
// credentials, which isn't wired up yet. For now, a cancelled-and-paid
// order needs its refund processed manually via the Razorpay dashboard.
// Real cancellation reasons — captured directly from the customer at the
// moment of cancelling, not guessed at afterward. Keys are stable
// identifiers (not the display label) so wording can be tweaked later on
// the frontend without needing to touch stored historical data or this
// validation list.
const CANCELLATION_REASONS = new Set([
  "mistake", "better_price", "too_long", "changed_mind",
  "wrong_selection", "different_product", "financial", "duplicate", "other",
]);

router.patch("/:orderNumber/cancel", requireAuth, asyncHandler(async (req, res) => {
  const { reason, detail } = req.body || {};
  if (!CANCELLATION_REASONS.has(reason)) return res.status(400).json({ error: "Please select a cancellation reason." });
  if (reason === "other" && !sanitize(detail || "").trim()) return res.status(400).json({ error: "Please tell us a bit more." });

  const { rows } = await query(
    "SELECT * FROM orders WHERE order_number=$1 AND customer_id=$2",
    [req.params.orderNumber, req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });

  const { status, placed_at } = rows[0];
  if (status === "cancelled") return res.status(400).json({ error: "This order is already cancelled." });
  if (status === "delivered") return res.status(400).json({ error: "A delivered order can't be cancelled — please use Return Request instead." });

  const minutesSincePlaced = (Date.now() - new Date(placed_at).getTime()) / 60000;
  if (minutesSincePlaced > CUSTOMER_CANCEL_WINDOW_MINUTES) {
    return res.status(400).json({ error: `Orders can only be cancelled within ${CUSTOMER_CANCEL_WINDOW_MINUTES} minutes of placing them. Please contact us if you need help.` });
  }

  const { rows: updated } = await query(
    "UPDATE orders SET status='cancelled', cancellation_reason=$1, cancellation_detail=$2, updated_at=now() WHERE order_number=$3 RETURNING *",
    [reason, detail ? sanitize(detail).trim().slice(0, 500) : null, req.params.orderNumber]
  );
  // Automatic refund — the real follow-up to the earlier known gap: if
  // this order was actually paid, this issues a genuine Razorpay refund
  // right now rather than leaving it as a manual dashboard task. A
  // refund failure does not fail this request (the cancellation itself
  // still succeeds either way) — it's recorded and surfaced to admins
  // via the activity log instead (see server/refunds.js).
  const refundResult = await refundOrderIfPaid(updated[0]);
  const finalRow = refundResult.success ? { ...updated[0], payment_status: "refunded", razorpay_refund_id: refundResult.refundId } : updated[0];
  const order = toFrontendOrder(finalRow);
  sendOrderCancelledEmail(order, refundResult);
  res.json({ order });
}));

export function toFrontendOrder(row) {
  return {
    orderNumber: row.order_number,
    email: row.email,
    phone: row.phone,
    items: row.items,
    address: row.shipping_address.line,
    landmark: row.shipping_address.landmark||"",
    city: row.shipping_address.city,
    state: row.shipping_address.state,
    pin: row.shipping_address.pin,
    name: row.shipping_address.name,
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
  };
}

export default router;

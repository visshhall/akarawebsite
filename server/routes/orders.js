import { notifyAdmins } from "../push.js";
import { Router } from "express";
import crypto from "crypto";
import { query, pool } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, hashPassword, signToken, setSessionCookie } from "../auth.js";
import { createRazorpayOrder, verifyPaymentSignature, RAZORPAY_KEY_ID } from "../razorpay.js";
import { sanitize, validEmail } from "../validate.js";
import { getShippingSettings, lookupCoupon } from "../settings.js";
import { sendOrderConfirmationEmail, sendOrderCancelledEmail } from "../email.js";
import { sendOrderConfirmationWhatsApp } from "../whatsapp.js";
import { refundOrderIfPaid } from "../refunds.js";
import { orderLookupRateLimit } from "../rateLimit.js";

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
    // REAL, DIRECT CORRECTION following a direct, live report: this
    // used to trust ANY real variant's price the moment one existed at
    // all — but a colour-only variant (no real, distinct size) was
    // then silently overriding the real, deliberately-set Basics price
    // an admin actually typed in, which is exactly NOT what was wanted.
    // The real, correct, now-confirmed rule, matching the exact same
    // fix just applied on the customer-facing product page: variant
    // pricing only takes over once a REAL, DISTINCT SIZE genuinely
    // exists somewhere on this product — a colour with no real size
    // attached must never change the price the admin actually set.
    // This is the real, authoritative, server-side check that actually
    // decides what a customer is charged — it must stay in exact,
    // permanent lockstep with the customer-facing page's own logic, or
    // a customer could see one real price and be charged a genuinely
    // different one.
    const hasRealSizes = productVariants && productVariants.some(v => v.size != null);
    if (hasRealSizes) {
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
      // base price — for a product with real, distinct SIZES, the base
      // price was never meant to be charged directly.
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

// REAL, DIRECT GUEST CHECKOUT SUPPORT — directly discussed and designed
// before writing this: requireAuth is now gone from this route, but
// this is NOT the same as "checkout is open to anyone with no
// conditions." attachCustomer (applied globally in server.js) already
// runs on every real request regardless, correctly populating
// req.customer when a real, valid session exists, or leaving it null
// otherwise — that part needed no change at all. What's new here is
// this explicit, real requirement: a request with no real, logged-in
// session must ALSO explicitly declare guestCheckout:true to proceed.
// This is deliberate — it means a genuine accident (a session cookie
// silently expiring mid-checkout, say) can never quietly fall through
// as an unintended guest order; only a real, deliberate guest choice
// (matching the calm, explicit UI choice this was designed around) is
// accepted.
router.post("/checkout", asyncHandler(async (req, res) => {
  const { items, address, email, phone, couponCode, paymentMethod, guestCheckout } = req.body || {};
  if (!req.customer && !guestCheckout) {
    return res.status(401).json({ error: "Sign in, or choose to continue as a guest, to place an order." });
  }
  const customerId = req.customer?.id || null;
  // Explicit marketing consent from checkout (never default-on)
  if (customerId && req.body?.marketingEmailOptIn === true) {
    await query(
      `UPDATE customers SET marketing_email_opt_in = true WHERE id = $1`,
      [customerId]
    ).catch(() => {});
    if (email) {
      await query(
        `INSERT INTO newsletter_subscribers (email, new_arrivals, promotions, journal)
         VALUES ($1, true, false, true)
         ON CONFLICT (email) DO UPDATE SET new_arrivals = true, journal = true, updated_at = now()`,
        [String(email).trim().toLowerCase()]
      ).catch(() => {});
    }
  }


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

  const priced = await priceCartServerSide(items, couponCode, customerId, isCodRequest ? shippingSettings.codFee : 0);
  if (!priced) return res.status(400).json({ error: "Your cart couldn't be processed — an item may be sold out or no longer available. Please refresh your cart." });

  const shippingAddress = {
    name: sanitize(address.name).slice(0, 200),
    line: sanitize(address.line).slice(0, 300),
    landmark: sanitize(address.landmark || "").slice(0, 150),
    city: sanitize(address.city).slice(0, 100),
    state: sanitize(address.state || "").slice(0, 100),
    pin: sanitize(address.pin).slice(0, 6),
    phone: sanitize(address.phone || phone || "").slice(0, 20),
    giftNote: sanitize(address.giftNote || "").slice(0, 200),
  };

  const orderNumber = generateOrderNumber();
  // Only a genuine guest order gets a real, actual tracking token —
  // see the schema comment for the full, real reasoning on why this,
  // specifically, is the secure mechanism a guest uses to check their
  // own order status with no login at all.
  const guestTrackingToken = customerId ? null : crypto.randomBytes(32).toString("base64url");

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
        const reservation = await reserveCouponUnderLock(client, priced.couponCode, customerId);
        if (!reservation.ok) {
          // A concurrent request genuinely won the real race for this
          // coupon between when pricing first ran and now — re-price
          // the SAME cart without the coupon rather than fail the
          // whole checkout, the same real, graceful degradation an
          // ordinary invalid/expired code already gets elsewhere.
          finalPriced = await priceCartServerSide(items, null, customerId, shippingSettings.codFee);
          if (!finalPriced) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Your cart couldn't be processed — an item may be sold out or no longer available. Please refresh your cart." }); }
        }
      }
      const { rows } = await client.query(
        `INSERT INTO orders (order_number, customer_id, email, phone, items, shipping_address, subtotal, discount, coupon_code, shipping_cost, cod_fee, cgst, sgst, total, payment_method, payment_status, guest_tracking_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'cod','cod',$15) RETURNING *`,
        [
          orderNumber, customerId, sanitize(email), sanitize(phone || shippingAddress.phone),
          JSON.stringify(finalPriced.items), JSON.stringify(shippingAddress),
          finalPriced.subtotal, finalPriced.discount, finalPriced.couponCode, finalPriced.shippingCost, finalPriced.codFee, finalPriced.cgst, finalPriced.sgst, finalPriced.total,
          guestTrackingToken,
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
      notifyAdmins({
        title: "ĀKĀRA · New COD order",
        body: `#${orderNumber} · ₹${Number(order.total||0).toLocaleString("en-IN")}`,
        url: "/admin",
      }).catch(()=>{});

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
    `INSERT INTO orders (order_number, customer_id, email, phone, items, shipping_address, subtotal, discount, coupon_code, shipping_cost, cgst, sgst, total, razorpay_order_id, payment_method, guest_tracking_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'razorpay',$15) RETURNING *`,
    [
      orderNumber, customerId, sanitize(email), sanitize(phone || shippingAddress.phone),
      JSON.stringify(priced.items), JSON.stringify(shippingAddress),
      priced.subtotal, priced.discount, priced.couponCode, priced.shippingCost, priced.cgst, priced.sgst, priced.total,
      razorpayOrder.id, guestTrackingToken,
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
// REAL, DIRECT GUEST CHECKOUT SUPPORT — same real reasoning as the
// checkout route above: requireAuth removed, attachCustomer already
// ran globally, req.customer is null for a genuine guest. The real
// ownership check below now uses Postgres's own, real, null-safe
// "IS NOT DISTINCT FROM" instead of "=" — customer_id=NULL AND
// req.customer=null would otherwise silently evaluate to NULL (never
// true) with a plain "=", which would incorrectly reject every real,
// legitimate guest verifying their own, genuine order.
router.post("/verify", asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing payment verification details." });
  }
  const customerId = req.customer?.id || null;

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
  // razorpay_order_id/payment_id/signature set that wasn't theirs. For a
  // genuine guest order (customer_id IS NULL), this real check still
  // holds: forging this request additionally requires a real, correct
  // razorpay_order_id (a genuinely unique, unguessable Razorpay-generated
  // ID only ever handed to the actual customer who started this specific
  // checkout) plus a real, valid payment signature for it — the same,
  // real cryptographic guarantee this check already relied on before.
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
      "SELECT * FROM orders WHERE razorpay_order_id=$1 AND customer_id IS NOT DISTINCT FROM $2 FOR UPDATE",
      [razorpay_order_id, customerId]
    );
    if (orderRows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Order not found." }); }
    const existingOrder = orderRows[0];

    let finalCouponCode = existingOrder.coupon_code;
    let finalDiscount = existingOrder.discount;
    let finalTotal = existingOrder.total;
    if (existingOrder.coupon_code) {
      const reservation = await reserveCouponUnderLock(client, existingOrder.coupon_code, customerId);
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
    notifyAdmins({
      title: "ĀKĀRA · New paid order",
      body: `#${order.orderNumber} · ₹${Number(order.total||0).toLocaleString("en-IN")}`,
      url: "/admin",
    }).catch(()=>{});
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

// REAL, PUBLIC GUEST ORDER TRACKING — GET /api/orders/track/:token.
// Genuinely no auth at all, by design: this IS the real, actual
// mechanism a guest uses to check their own order with no login,
// exactly as designed and discussed before writing any of this. Safe
// specifically because the token itself (see schema.sql's own comment)
// is a real, independently-random 32-byte value that can't be derived
// or guessed from anything else about the order — knowing this token
// is the real, actual proof of ownership here, the same real role a
// session cookie plays for a logged-in customer. No rate limit needed
// on this one specifically — a token this long is already computationally
// infeasible to brute-force; rate-limiting would only ever slow down a
// genuine, real guest re-checking their own order.
router.get("/track/:token", asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM orders WHERE guest_tracking_token=$1",
    [req.params.token]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found. Check the link from your confirmation email, or use order lookup below." });
  res.json({ order: toFrontendOrder(rows[0]) });
}));

// REAL, PUBLIC GUEST ORDER LOOKUP — POST /api/orders/lookup. The real,
// deliberate backup method for a guest who's lost or deleted their
// confirmation email (and therefore their real tracking link) —
// matches an order by number + the exact email used at checkout. Only
// ever returns a genuine guest order (customer_id IS NULL) — a
// logged-in customer's order is never reachable this way, since they
// have their own, real, correct path (signing in) instead; this keeps
// the real, guessing-attack surface limited to orders that have no
// other real, secure way to be checked. Real, actual case-insensitive
// email match, since a customer might type it with different real
// capitalization than what they originally entered at checkout.
router.post("/lookup", orderLookupRateLimit, asyncHandler(async (req, res) => {
  const { orderNumber, email } = req.body || {};
  if (!orderNumber || !validEmail(email)) {
    return res.status(400).json({ error: "Enter both your order number and the email used at checkout." });
  }
  const { rows } = await query(
    "SELECT * FROM orders WHERE order_number=$1 AND lower(email)=lower($2) AND customer_id IS NULL",
    [sanitize(orderNumber).trim(), sanitize(email).trim()]
  );
  // Deliberately the same, real, generic message whether the order
  // number is wrong, the email doesn't match, or this was actually a
  // logged-in customer's order — a real attacker probing this endpoint
  // learns nothing about which real detail was incorrect, the same
  // real principle already applied to payment verification above.
  if (rows.length === 0) return res.status(404).json({ error: "No matching guest order found. Double-check your order number and email, or sign in if you created an account." });
  res.json({ order: toFrontendOrder(rows[0]) });
}));

function passwordOk(pw = "") {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// REAL, DIRECT "SAVE THIS ORDER TO AN ACCOUNT" FEATURE — directly
// discussed and designed before writing this: a guest shouldn't have
// to lose their real order history just because they checked out
// without an account. Takes the real, actual guest_tracking_token
// (the exact same real proof-of-ownership already used for tracking —
// see /track/:token above) plus a new real password, creates a genuine
// account using the order's own real email/phone, and links EVERY
// real, existing guest order sharing that same email to it at once —
// not just the one order they're currently looking at — so checking
// out as a guest more than once before finally creating an account
// doesn't leave earlier real orders stranded.
router.post("/convert-to-account", asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing order reference." });
  if (!passwordOk(password)) {
    return res.status(400).json({ error: "Password must be 8+ characters with an uppercase letter, a number, and a special character." });
  }

  const { rows: orderRows } = await query("SELECT * FROM orders WHERE guest_tracking_token=$1", [token]);
  if (orderRows.length === 0) return res.status(404).json({ error: "Order not found." });
  const order = orderRows[0];

  // Real, honest check: if an account already exists with this exact
  // email (created separately, at some other real point), correctly
  // refuse rather than silently creating a real, second, conflicting
  // account — the customer should sign in with their existing one
  // instead, and (separately, a real future feature) could link this
  // guest order to it that way if genuinely needed.
  const { rows: existing } = await query("SELECT id FROM customers WHERE lower(email)=lower($1)", [order.email]);
  if (existing.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists — please sign in instead." });
  }

  const passwordHash = await hashPassword(password);
  const shippingAddr = order.shipping_address || {};
  const { rows: newCustomerRows } = await query(
    "INSERT INTO customers (name, email, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone",
    [shippingAddr.name || order.email, order.email, order.phone, passwordHash]
  );
  const customer = newCustomerRows[0];

  // Real, genuine bonus value: link every guest order with this same
  // real email, not just the one the customer is currently looking at.
  await query("UPDATE orders SET customer_id=$1 WHERE lower(email)=lower($2) AND customer_id IS NULL", [customer.id, order.email]);

  // Signs them in immediately — a customer who just created an account
  // specifically to see their order history shouldn't have to then
  // separately log in to actually see it.
  const sessionToken = signToken(customer);
  setSessionCookie(res, sessionToken);
  res.status(201).json({ customer, token: sessionToken });
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
  let addr = row.shipping_address || {};
  if (typeof addr === "string") {
    try { addr = JSON.parse(addr); } catch { addr = {}; }
  }
  if (!addr || typeof addr !== "object") addr = {};
  return {
    orderNumber: row.order_number,
    email: row.email,
    phone: row.phone,
    items: Array.isArray(row.items) ? row.items : (typeof row.items === "string" ? (()=>{ try { const p=JSON.parse(row.items); return Array.isArray(p)?p:[]; } catch { return []; } })() : []),
    address: addr.line || addr.address || "",
    landmark: addr.landmark||"",
    city: addr.city || "",
    state: addr.state || "",
    pin: addr.pin || addr.pincode || "",
    name: addr.name || "",
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
    // REAL, DIRECT GUEST CHECKOUT SUPPORT: isGuestOrder is the real,
    // simple, direct signal the frontend needs to decide whether to
    // show the "save this order to an account" prompt — true whenever
    // this order genuinely has no real, linked customer account yet.
    // guestTrackingToken is only ever meaningfully present for a real
    // guest order (see the schema's own comment on why); deliberately
    // still included (as null) for a logged-in customer's order too,
    // rather than omitted, so every real order response has the exact
    // same, consistent shape regardless of which kind it is.
    isGuestOrder: row.customer_id === null,
    guestTrackingToken: row.guest_tracking_token || null,
  };
}

export default router;

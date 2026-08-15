import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";
import { createRazorpayOrder, verifyPaymentSignature, RAZORPAY_KEY_ID } from "../razorpay.js";
import { sanitize, validEmail } from "../validate.js";

const router = Router();

const FREE_SHIPPING_THRESHOLD = 2500;
const SHIPPING_COST = 150;
// The one real coupon code, matching what's shown on the Cart page.
// Deliberately a plain constant here rather than a database table for
// now — a real "coupon management" feature (multiple codes, expiry
// dates, usage limits) is admin-panel territory for later, not something
// worth a full table for a single hardcoded code today.
const VALID_COUPONS = { AKARA10: 0.10 };

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
// percentage and the resulting rupee amount are both computed here, from
// VALID_COUPONS, never trusted from the request. An unrecognized code is
// silently treated as no coupon (matches the Cart page's own behavior:
// an invalid code just doesn't apply, rather than blocking checkout).
async function priceCartServerSide(cartItems, couponCode) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return null;
  const ids = cartItems.map(i => i?.id).filter(id => typeof id === "string");
  if (ids.length !== cartItems.length) return null;

  const { rows: products } = await query("SELECT id, name, price, hsn, stock FROM products WHERE id = ANY($1)", [ids]);
  const byId = Object.fromEntries(products.map(p => [p.id, p]));

  const items = [];
  for (const cartItem of cartItems) {
    const product = byId[cartItem.id];
    if (!product) return null; // references a product that doesn't exist
    if (product.stock === "sold-out") return null; // can't buy what's sold out
    const qty = Number.isInteger(cartItem.qty) && cartItem.qty > 0 && cartItem.qty <= 99 ? cartItem.qty : null;
    if (qty === null) return null;
    items.push({ id: product.id, name: product.name, price: product.price, hsn: product.hsn, qty, size: typeof cartItem.size === "string" ? sanitize(cartItem.size).slice(0, 20) : null });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const normalizedCode = typeof couponCode === "string" ? couponCode.trim().toUpperCase() : "";
  const couponRate = VALID_COUPONS[normalizedCode] || 0;
  const discount = couponRate > 0 ? Math.round(subtotal * couponRate) : 0;
  const appliedCouponCode = discount > 0 ? normalizedCode : null;
  const afterDiscount = subtotal - discount;
  // Matches the Cart page's exact rule: the free-shipping threshold is
  // checked against the DISCOUNTED subtotal, not the original — a coupon
  // can push an order below ₹2,500 and bring shipping back into play.
  const shippingCost = afterDiscount === 0 || afterDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
  const taxableValue = afterDiscount + shippingCost;
  const totalTax = Math.round(taxableValue * 0.18);
  const cgst = Math.round(totalTax / 2);
  const sgst = totalTax - cgst; // whatever's left, so cgst+sgst always exactly equals totalTax — no rounding drift between the two halves
  const total = afterDiscount + shippingCost + totalTax;

  return { items, subtotal, discount, couponCode: appliedCouponCode, shippingCost, cgst, sgst, total };
}

function generateOrderNumber() {
  return "AK" + Math.floor(10000 + Math.random() * 89999);
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
router.post("/checkout", requireAuth, asyncHandler(async (req, res) => {
  const { items, address, email, phone, couponCode } = req.body || {};

  if (!validEmail(email)) return res.status(400).json({ error: "A valid email is required." });
  if (!address || !sanitize(address.name).trim() || !sanitize(address.line).trim() || !sanitize(address.city).trim() || !/^\d{6}$/.test(address.pin || "")) {
    return res.status(400).json({ error: "A complete shipping address is required." });
  }

  const priced = await priceCartServerSide(items, couponCode);
  if (!priced) return res.status(400).json({ error: "Your cart couldn't be processed — an item may be sold out or no longer available. Please refresh your cart." });

  const shippingAddress = {
    name: sanitize(address.name).slice(0, 200),
    line: sanitize(address.line).slice(0, 300),
    city: sanitize(address.city).slice(0, 100),
    state: sanitize(address.state || "").slice(0, 100),
    pin: sanitize(address.pin).slice(0, 6),
    phone: sanitize(address.phone || phone || "").slice(0, 20),
  };

  const orderNumber = generateOrderNumber();
  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(priced.total * 100, orderNumber); // paise, not rupees
  } catch (err) {
    console.error("Razorpay order creation failed:", err);
    return res.status(502).json({ error: "Couldn't reach the payment provider. Please try again in a moment." });
  }

  const { rows } = await query(
    `INSERT INTO orders (order_number, customer_id, email, phone, items, shipping_address, subtotal, discount, coupon_code, shipping_cost, cgst, sgst, total, razorpay_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
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
  const { rows } = await query(
    `UPDATE orders SET payment_status='paid', razorpay_payment_id=$1, updated_at=now()
     WHERE razorpay_order_id=$2 AND customer_id=$3 RETURNING *`,
    [razorpay_payment_id, razorpay_order_id, req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });

  res.json({ order: toFrontendOrder(rows[0]) });
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

function toFrontendOrder(row) {
  return {
    orderNumber: row.order_number,
    email: row.email,
    phone: row.phone,
    items: row.items,
    address: row.shipping_address.line,
    city: row.shipping_address.city,
    state: row.shipping_address.state,
    pin: row.shipping_address.pin,
    name: row.shipping_address.name,
    subtotal: row.subtotal,
    discount: row.discount,
    couponCode: row.coupon_code,
    shippingCost: row.shipping_cost,
    cgst: row.cgst,
    sgst: row.sgst,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    placedAt: new Date(row.placed_at).getTime(),
  };
}

export default router;

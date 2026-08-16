import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";
import { sanitize } from "../validate.js";

const router = Router();

// GET /api/reviews/:productId — public. Every review for one product,
// plus the real aggregate (average + count) — no login needed to read
// reviews, only to write one.
router.get("/:productId", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.rating, r.comment, r.created_at, c.name AS customer_name
     FROM reviews r JOIN customers c ON c.id = r.customer_id
     WHERE r.product_id = $1
     ORDER BY r.created_at DESC`,
    [req.params.productId]
  );
  const count = rows.length;
  const average = count > 0 ? rows.reduce((s, r) => s + r.rating, 0) / count : null;
  res.json({
    average, count,
    reviews: rows.map(r => ({
      id: r.id, rating: r.rating, comment: r.comment,
      // First name + last initial only — a reviewer's full name doesn't
      // need to be public on a product page for this to feel like a real
      // verified review; "Verified Buyer" tag comes from this record
      // existing at all, since creating one requires a real paid order.
      reviewerName: r.customer_name ? r.customer_name.split(" ")[0] + (r.customer_name.split(" ")[1] ? " " + r.customer_name.split(" ")[1][0] + "." : "") : "Verified Buyer",
      createdAt: new Date(r.created_at).getTime(),
    })),
  });
}));

// GET /api/reviews — aggregate rating for EVERY product in one call, so
// the shop grid / homepage can show real star ratings without firing one
// request per product card.
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT product_id, AVG(rating)::float AS average, COUNT(*)::int AS count
     FROM reviews GROUP BY product_id`
  );
  const summary = {};
  for (const r of rows) summary[r.product_id] = { average: r.average, count: r.count };
  res.json({ summary });
}));

// POST /api/reviews — the real gate: this requires a specific order
// number that (a) belongs to the logged-in customer, (b) is actually
// PAID, and (c) actually contains this product. A "verified purchase"
// review means something specific here, not just a label — someone
// can't review a product they never bought, or one they only ever
// abandoned at checkout without paying.
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { orderNumber, productId, rating, comment } = req.body || {};

  if (!orderNumber || !sanitize(orderNumber).trim()) return res.status(400).json({ error: "Order number is required." });
  if (!productId) return res.status(400).json({ error: "Product is required." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be a whole number from 1 to 5." });

  const { rows: orderRows } = await query(
    "SELECT id, items, payment_status FROM orders WHERE order_number=$1 AND customer_id=$2",
    [sanitize(orderNumber).trim(), req.customer.id]
  );
  if (orderRows.length === 0) return res.status(404).json({ error: "We couldn't find that order on your account." });

  const order = orderRows[0];
  if (order.payment_status !== "paid") return res.status(403).json({ error: "This order hasn't been paid, so it can't be reviewed." });

  const containsProduct = (order.items || []).some(i => i.id === productId);
  if (!containsProduct) return res.status(403).json({ error: "That order doesn't include this product." });

  try {
    const { rows } = await query(
      "INSERT INTO reviews (product_id, customer_id, order_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [productId, req.customer.id, order.id, rating, comment ? sanitize(comment).slice(0, 1000) : null]
    );
    res.status(201).json({ review: rows[0] });
  } catch (err) {
    // The UNIQUE(customer_id, product_id) constraint is what actually
    // stops a second review of the same product — caught here specifically
    // to turn a raw Postgres constraint-violation error into a real,
    // readable message instead of a generic 500.
    if (err.code === "23505") return res.status(409).json({ error: "You've already reviewed this product." });
    throw err;
  }
}));

export default router;

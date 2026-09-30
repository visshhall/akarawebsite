import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { sanitize, validEmail } from "../validate.js";
import { publicFormRateLimit } from "../rateLimit.js";

const router = Router();

// POST /api/waitlist { productId, email }
router.post("/", publicFormRateLimit, asyncHandler(async (req, res) => {
  const productId = sanitize(req.body?.productId || "").slice(0, 80);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
  if (!productId) return res.status(400).json({ error: "Product required." });
  if (!validEmail(email)) return res.status(400).json({ error: "Valid email required." });

  const { rows: pr } = await query(
    "SELECT id, name, status FROM products WHERE id=$1 AND status NOT IN ('draft','hidden')",
    [productId]
  );
  if (!pr.length) return res.status(404).json({ error: "Product not found." });

  await query(
    `INSERT INTO product_waitlist (product_id, email)
     VALUES ($1,$2)
     ON CONFLICT (product_id, email) DO NOTHING`,
    [productId, email]
  );
  res.json({ ok: true, message: "We'll email you when this piece is available again." });
}));

export default router;

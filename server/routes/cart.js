import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";

const router = Router();

function normalizeLine(raw) {
  if (!raw || typeof raw !== "object") return null;
  const product_id = String(raw.id || raw.product_id || raw.productId || "").trim();
  if (!product_id) return null;
  const size = String(raw.size || "").trim();
  const color = String(raw.color || "").trim();
  let qty = Number(raw.qty || raw.quantity || 1);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  if (qty > 99) qty = 99;
  return { product_id, size, color, qty };
}

async function loadCartWithPrices(customerId) {
  const { rows } = await query(
    `SELECT c.product_id, c.size, c.color, c.qty, c.updated_at,
            p.name, p.price, p.media, p.status, p.category
     FROM cart_items c
     LEFT JOIN products p ON p.id = c.product_id
     WHERE c.customer_id = $1
     ORDER BY c.updated_at DESC`,
    [customerId]
  );
  return rows
    .filter((r) => r.name && r.status !== "draft" && r.status !== "hidden")
    .map((r) => {
      let media = r.media;
      if (typeof media === "string") {
        try { media = JSON.parse(media); } catch { media = []; }
      }
      const img =
        (Array.isArray(media) && media[0] && (media[0].url || media[0].src || media[0])) ||
        null;
      return {
        id: r.product_id,
        name: r.name,
        price: Number(r.price) || 0,
        qty: r.qty,
        size: r.size || "",
        color: r.color || "",
        img: typeof img === "string" ? img : img?.url || null,
        cat: r.category || "",
      };
    });
}

// GET /api/cart
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const items = await loadCartWithPrices(req.customer.id);
  res.json({ items });
}));

// PUT /api/cart — full replace (client is source of truth after local edits)
router.put("/", requireAuth, asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const lines = [];
  const seen = new Set();
  for (const raw of incoming.slice(0, 100)) {
    const n = normalizeLine(raw);
    if (!n) continue;
    const key = `${n.product_id}|${n.size}|${n.color}`;
    if (seen.has(key)) {
      const existing = lines.find((l) => `${l.product_id}|${l.size}|${l.color}` === key);
      if (existing) existing.qty = Math.min(99, existing.qty + n.qty);
      continue;
    }
    seen.add(key);
    lines.push(n);
  }

  await query("DELETE FROM cart_items WHERE customer_id=$1", [req.customer.id]);
  await query("UPDATE customers SET abandoned_cart_reminder_sent_at = NULL WHERE id=$1", [req.customer.id]);
  for (const line of lines) {
    await query(
      `INSERT INTO cart_items (customer_id, product_id, size, color, qty)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.customer.id, line.product_id, line.size, line.color, line.qty]
    );
  }
  const items = await loadCartWithPrices(req.customer.id);
  res.json({ items });
}));

// POST /api/cart/merge — fold guest localStorage cart into account cart
router.post("/merge", requireAuth, asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  for (const raw of incoming.slice(0, 100)) {
    const n = normalizeLine(raw);
    if (!n) continue;
    await query(
      `INSERT INTO cart_items (customer_id, product_id, size, color, qty)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (customer_id, product_id, size, color)
       DO UPDATE SET qty = LEAST(99, cart_items.qty + EXCLUDED.qty), updated_at = now()`,
      [req.customer.id, n.product_id, n.size, n.color, n.qty]
    );
  }
  await query("UPDATE customers SET abandoned_cart_reminder_sent_at = NULL WHERE id=$1", [req.customer.id]);
  const items = await loadCartWithPrices(req.customer.id);
  res.json({ items });
}));

export default router;

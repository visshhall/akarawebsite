import { Router } from "express";
import { query, pool } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";

const router = Router();

/** Must match client MAX_UNITS_PER_PRODUCT */
const MAX_UNITS_PER_PRODUCT = 5;

function normalizeLine(raw) {
  if (!raw || typeof raw !== "object") return null;
  const product_id = String(raw.id || raw.product_id || raw.productId || "").trim();
  if (!product_id) return null;
  // Empty string only — never null (UNIQUE treats NULLs as distinct → duplicate rows)
  const size = String(raw.size ?? "").trim();
  const color = String(raw.color ?? "").trim();
  let qty = Number(raw.qty || raw.quantity || 1);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  if (qty > MAX_UNITS_PER_PRODUCT) qty = MAX_UNITS_PER_PRODUCT;
  return { product_id, size, color, qty };
}

function dedupeLines(incoming) {
  const lines = [];
  const seen = new Set();
  for (const raw of (Array.isArray(incoming) ? incoming : []).slice(0, 100)) {
    const n = normalizeLine(raw);
    if (!n) continue;
    const key = `${n.product_id}|${n.size}|${n.color}`;
    if (seen.has(key)) {
      const existing = lines.find((l) => `${l.product_id}|${l.size}|${l.color}` === key);
      if (existing) existing.qty = Math.min(MAX_UNITS_PER_PRODUCT, Math.max(existing.qty, n.qty));
      continue;
    }
    seen.add(key);
    lines.push(n);
  }
  return lines;
}

async function loadCartWithPrices(customerId) {
  const { rows } = await query(
    `SELECT c.product_id, c.size, c.color, c.qty, c.updated_at,
            p.name, p.price, p.media, p.status, p.category, p.stock_qty
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
        try {
          media = JSON.parse(media);
        } catch {
          media = [];
        }
      }
      const img =
        (Array.isArray(media) && media[0] && (media[0].url || media[0].src || media[0])) || null;
      let maxQty = MAX_UNITS_PER_PRODUCT;
      if (r.stock_qty != null && Number.isFinite(Number(r.stock_qty))) {
        maxQty = Math.max(0, Math.min(MAX_UNITS_PER_PRODUCT, Math.floor(Number(r.stock_qty))));
      }
      const qty = Math.min(r.qty, maxQty || 1);
      return {
        id: r.product_id,
        name: r.name,
        price: Number(r.price) || 0,
        qty: qty > 0 ? qty : 1,
        size: r.size || "",
        color: r.color || "",
        img: typeof img === "string" ? img : img?.url || null,
        cat: r.category || "",
      };
    });
}

// GET /api/cart
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await loadCartWithPrices(req.customer.id);
    res.json({ items });
  })
);

/**
 * PUT /api/cart — full replace.
 * WHY race fixed: concurrent PUTs (multi-tab) used DELETE then INSERT without
 * ON CONFLICT → second tab's INSERT hit unique cart_items_customer_id_product_id_size_color_key.
 * HOW: transaction + advisory lock per customer + UPSERT after clear.
 */
router.put(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const lines = dedupeLines(req.body?.items);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize cart writes for this customer (blocks concurrent merge/PUT)
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [
        String(req.customer.id),
      ]);
      await client.query("DELETE FROM cart_items WHERE customer_id=$1", [req.customer.id]);
      for (const line of lines) {
        await client.query(
          `INSERT INTO cart_items (customer_id, product_id, size, color, qty)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (customer_id, product_id, size, color)
           DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()`,
          [req.customer.id, line.product_id, line.size, line.color, line.qty]
        );
      }
      await client.query(
        "UPDATE customers SET abandoned_cart_reminder_sent_at = NULL WHERE id=$1",
        [req.customer.id]
      );
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
    const items = await loadCartWithPrices(req.customer.id);
    res.json({ items });
  })
);

// POST /api/cart/merge — fold guest localStorage cart into account cart
router.post(
  "/merge",
  requireAuth,
  asyncHandler(async (req, res) => {
    const lines = dedupeLines(req.body?.items);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [
        String(req.customer.id),
      ]);
      for (const n of lines) {
        await client.query(
          `INSERT INTO cart_items (customer_id, product_id, size, color, qty)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (customer_id, product_id, size, color)
           DO UPDATE SET qty = GREATEST(cart_items.qty, EXCLUDED.qty), updated_at = now()`,
          [req.customer.id, n.product_id, n.size, n.color, n.qty]
        );
      }
      await client.query(
        "UPDATE customers SET abandoned_cart_reminder_sent_at = NULL WHERE id=$1",
        [req.customer.id]
      );
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
    const items = await loadCartWithPrices(req.customer.id);
    res.json({ items });
  })
);

export default router;

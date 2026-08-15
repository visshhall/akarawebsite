import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";
import { sanitize } from "../../validate.js";

const router = Router();
const VALID_STOCK = ["in-stock", "low-stock", "sold-out"];

// GET /api/admin/products — full catalog, including fields the public
// /api/products endpoint doesn't expose (this is the same table, just an
// admin-only view of it — no separate data source to keep in sync).
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products ORDER BY category, name");
  res.json({ products: rows });
}));

router.get("/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products WHERE id=$1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Product not found." });
  res.json({ product: rows[0] });
}));

// PUT /api/admin/products/:id — updates an existing product. Every field
// is optional in the request (only what's sent gets changed) — this is a
// partial update, not a full-replace, so the admin panel can e.g. flip
// just the stock status without resending the whole product.
router.put("/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { rows: existingRows } = await query("SELECT * FROM products WHERE id=$1", [req.params.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Product not found." });
  const existing = existingRows[0];

  const { name, category, price, dims, hsn, stock, description, metaTitle, metaDesc, media } = req.body || {};

  if (stock !== undefined && !VALID_STOCK.includes(stock)) {
    return res.status(400).json({ error: "Invalid stock value." });
  }
  if (price !== undefined && (!Number.isInteger(price) || price <= 0)) {
    return res.status(400).json({ error: "Price must be a positive whole number (rupees)." });
  }

  const updated = {
    name: name !== undefined ? sanitize(name) : existing.name,
    category: category !== undefined ? sanitize(category) : existing.category,
    price: price !== undefined ? price : existing.price,
    dims: dims !== undefined ? sanitize(dims) : existing.dims,
    hsn: hsn !== undefined ? sanitize(hsn) : existing.hsn,
    stock: stock !== undefined ? stock : existing.stock,
    description: description !== undefined ? sanitize(description).slice(0, 2000) : existing.description,
    meta_title: metaTitle !== undefined ? sanitize(metaTitle) : existing.meta_title,
    meta_desc: metaDesc !== undefined ? sanitize(metaDesc) : existing.meta_desc,
    media: media !== undefined ? JSON.stringify(media) : JSON.stringify(existing.media),
  };

  const { rows } = await query(
    `UPDATE products SET name=$1, category=$2, price=$3, dims=$4, hsn=$5, stock=$6, description=$7, meta_title=$8, meta_desc=$9, media=$10, updated_at=now()
     WHERE id=$11 RETURNING *`,
    [updated.name, updated.category, updated.price, updated.dims, updated.hsn, updated.stock, updated.description, updated.meta_title, updated.meta_desc, updated.media, req.params.id]
  );

  // Logs exactly what changed (old -> new), not just "product was updated"
  // — this is what makes the change log actually useful to look back at.
  const diff = {};
  for (const key of Object.keys(updated)) {
    if (key === "media") continue; // usually large/noisy, skip from the diff log
    if (String(existing[key]) !== String(updated[key])) diff[key] = { from: existing[key], to: updated[key] };
  }
  await logAdminAction(req.admin.id, "product.update", { productId: req.params.id, diff });

  res.json({ product: rows[0] });
}));

// POST /api/admin/products — creates a new product. `id` doubles as the
// URL slug (must be unique, matches the pattern every existing product
// already uses) — deliberately not auto-generated, so the admin controls
// the exact URL a new product gets.
router.post("/", requireAdmin, asyncHandler(async (req, res) => {
  const { id, name, category, price, dims, hsn, description, metaTitle, metaDesc } = req.body || {};
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "Product ID must be lowercase letters, numbers, and hyphens only (used as the URL slug)." });
  }
  if (!name || !category || !dims || !hsn) {
    return res.status(400).json({ error: "Name, category, dimensions, and HSN are all required." });
  }
  // Split out from the general "required fields" check specifically so
  // a negative, zero, or decimal price gets its own clear message rather
  // than being lumped in with "something's missing" — the actual problem
  // (price format) wasn't a missing field, and this used to say
  // "required" for a price that was very much present, just invalid.
  if (!Number.isInteger(price) || price <= 0) {
    return res.status(400).json({ error: "Price must be a positive whole number (rupees, no decimals)." });
  }

  const { rows: existing } = await query("SELECT id FROM products WHERE id=$1", [id]);
  if (existing.length > 0) return res.status(409).json({ error: "A product with this ID already exists." });

  const { rows } = await query(
    `INSERT INTO products (id, name, category, price, dims, hsn, description, meta_title, meta_desc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, sanitize(name), sanitize(category), price, sanitize(dims), sanitize(hsn), sanitize(description || "").slice(0, 2000), sanitize(metaTitle || ""), sanitize(metaDesc || "")]
  );
  await logAdminAction(req.admin.id, "product.create", { productId: id });
  res.status(201).json({ product: rows[0] });
}));

router.delete("/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("DELETE FROM products WHERE id=$1 RETURNING id", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Product not found." });
  await logAdminAction(req.admin.id, "product.delete", { productId: req.params.id });
  res.json({ ok: true });
}));

export default router;

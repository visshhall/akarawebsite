import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";
import { sanitize } from "../../validate.js";
import { sendLowStockAlertEmail } from "../../email.js";
import { getR2PublicUrl } from "../../r2.js";

const router = Router();
const VALID_STATUS = ["draft", "in-stock", "low-stock", "sold-out", "pre-order", "hidden"];
const MAX_MEDIA_ITEMS = 20;

// Found in an independent security review: media was saved with zero
// validation of its actual shape — req.body.media went straight to
// JSON.stringify() and into the database. That meant a malformed or
// unexpected structure could silently corrupt what the product page
// tries to render, and there was nothing stopping a src pointing
// anywhere at all — not necessarily this site's own storage. Checks
// against BOTH real storage locations this app actually uses: R2's
// public URL when configured, and the local /uploads/ path (the
// fallback used when R2 isn't set, e.g. local development — see
// server/routes/upload.js). Returns null when valid, or a specific
// error string explaining exactly what's wrong.
function validateMedia(media) {
  if (!Array.isArray(media)) return "Media must be a list of items.";
  if (media.length > MAX_MEDIA_ITEMS) return `Too many media items — max ${MAX_MEDIA_ITEMS}.`;

  const r2PublicUrl = getR2PublicUrl();
  const validPrefixes = ["/uploads/", ...(r2PublicUrl ? [r2PublicUrl] : [])];

  for (const item of media) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "Each media item must be an object with type and src.";
    }
    if (item.type !== "image" && item.type !== "video") {
      return "Each media item's type must be 'image' or 'video'.";
    }
    if (typeof item.src !== "string" || item.src.length === 0 || item.src.length > 500) {
      return "Each media item needs a src (a real, non-empty URL under 500 characters).";
    }
    if (!validPrefixes.some(prefix => item.src.startsWith(prefix))) {
      return "Each media item's src must point to this site's own upload storage, not an arbitrary external URL.";
    }
  }
  return null;
}

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

  const { name, category, price, dims, hsn, status, description, metaTitle, metaDesc, media } = req.body || {};

  if (status !== undefined && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }
  if (price !== undefined && (!Number.isInteger(price) || price <= 0)) {
    return res.status(400).json({ error: "Price must be a positive whole number (rupees)." });
  }
  if (media !== undefined) {
    const mediaError = validateMedia(media);
    if (mediaError) return res.status(400).json({ error: mediaError });
  }

  const updated = {
    name: name !== undefined ? sanitize(name) : existing.name,
    category: category !== undefined ? sanitize(category) : existing.category,
    price: price !== undefined ? price : existing.price,
    dims: dims !== undefined ? sanitize(dims) : existing.dims,
    hsn: hsn !== undefined ? sanitize(hsn) : existing.hsn,
    status: status !== undefined ? status : existing.status,
    description: description !== undefined ? sanitize(description).slice(0, 2000) : existing.description,
    meta_title: metaTitle !== undefined ? sanitize(metaTitle) : existing.meta_title,
    meta_desc: metaDesc !== undefined ? sanitize(metaDesc) : existing.meta_desc,
    media: media !== undefined ? JSON.stringify(media) : JSON.stringify(existing.media),
  };

  const { rows } = await query(
    `UPDATE products SET name=$1, category=$2, price=$3, dims=$4, hsn=$5, status=$6, description=$7, meta_title=$8, meta_desc=$9, media=$10, updated_at=now()
     WHERE id=$11 RETURNING *`,
    [updated.name, updated.category, updated.price, updated.dims, updated.hsn, updated.status, updated.description, updated.meta_title, updated.meta_desc, updated.media, req.params.id]
  );

  // Logs exactly what changed (old -> new), not just "product was updated"
  // — this is what makes the change log actually useful to look back at.
  const diff = {};
  for (const key of Object.keys(updated)) {
    if (key === "media") continue; // usually large/noisy, skip from the diff log
    if (String(existing[key]) !== String(updated[key])) diff[key] = { from: existing[key], to: updated[key] };
  }
  await logAdminAction(req.admin.id, "product.update", { productId: req.params.id, diff });

  // Alert on a genuine TRANSITION into low-stock/sold-out — checked
  // against what it actually was before this save, so re-saving a
  // product that's already low-stock (editing its description, say)
  // never re-sends the same alert.
  const statusWorsened = (updated.status === "low-stock" || updated.status === "sold-out") && existing.status !== updated.status;
  if (statusWorsened) sendLowStockAlertEmail(rows[0]);

  res.json({ product: rows[0] });
}));

// POST /api/admin/products — creates a new product. `id` doubles as the
// URL slug (must be unique, matches the pattern every existing product
// already uses) — deliberately not auto-generated, so the admin controls
// the exact URL a new product gets.
router.post("/", requireAdmin, asyncHandler(async (req, res) => {
  const { id, name, category, price, dims, hsn, status, description, metaTitle, metaDesc } = req.body || {};
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
  if (status !== undefined && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  const { rows: existing } = await query("SELECT id FROM products WHERE id=$1", [id]);
  if (existing.length > 0) return res.status(409).json({ error: "A product with this ID already exists." });

  // Defaults to 'draft' when not specified — a newly created product
  // should need a deliberate action to go live, not accidentally appear
  // to customers mid-setup because a required field just hasn't been
  // filled in yet.
  const { rows } = await query(
    `INSERT INTO products (id, name, category, price, dims, hsn, status, description, meta_title, meta_desc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, sanitize(name), sanitize(category), price, sanitize(dims), sanitize(hsn), status || "draft", sanitize(description || "").slice(0, 2000), sanitize(metaTitle || ""), sanitize(metaDesc || "")]
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

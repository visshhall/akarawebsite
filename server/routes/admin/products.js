import { Router } from "express";
import multer from "multer";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";
import { sanitize } from "../../validate.js";
import { sendLowStockAlertEmail } from "../../email.js";
import { getR2PublicUrl, r2Configured, uploadToR2, deleteFromR2 } from "../../r2.js";
import { processUpload, ensureUploadDir, UploadValidationError, MAX_VIDEO_BYTES } from "../../upload.js";
import { buildPhotoId, collectExistingPhotoIds } from "../../photoId.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Three levels up from server/routes/admin — same reasoning as the
// customer-facing upload route: get this wrong and files silently land
// somewhere server.js never actually serves from.
const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads");
let warnedNoR2Admin = false;
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } });

const router = Router();
const VALID_STATUS = ["draft", "in-stock", "low-stock", "sold-out", "pre-order", "hidden"];
const MAX_MEDIA_ITEMS = 20;

// POST /api/admin/products/media/upload — admin-only media upload,
// genuinely separate from the customer-facing POST /api/upload (which
// is requireAuth, shared with the return-request photo flow). Reuses
// the exact same validated processUpload()/R2 pipeline underneath —
// duplicating the pipeline itself would risk the two paths silently
// drifting apart on what's actually allowed through; only the auth
// layer and the route differ.
router.post("/media/upload", requireAdmin, mediaUpload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was uploaded." });
  const kind = req.body?.kind === "video" ? "video" : "image";

  let result;
  try {
    result = await processUpload(req.file.buffer, kind);
  } catch (err) {
    if (err instanceof UploadValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  let url;
  if (r2Configured()) {
    url = await uploadToR2(result.buffer, result.filename, result.mime);
  } else {
    if (!warnedNoR2Admin) {
      console.warn("[admin upload] R2 is not configured — falling back to local disk, which Railway does NOT persist across redeploys.");
      warnedNoR2Admin = true;
    }
    await ensureUploadDir(UPLOAD_DIR);
    await writeFile(path.join(UPLOAD_DIR, result.filename), result.buffer);
    url = `/uploads/${result.filename}`;
  }

  // category/productId arrive as plain form fields alongside the file —
  // both optional (a brand-new, not-yet-saved product genuinely has no
  // real category chosen yet at the moment of upload in some flows), in
  // which case buildPhotoId()'s own fallback codes ("GEN"/"PROD") apply
  // rather than failing the upload entirely. Checked against every
  // photoId across the WHOLE catalog (collectExistingPhotoIds pulls
  // every product's media, not just this one product's), since the
  // 5-digit number must be globally unique, not just unique within one
  // product's own gallery.
  const { rows: allProducts } = await query("SELECT media FROM products");
  const existingIds = collectExistingPhotoIds(allProducts);
  const photoId = buildPhotoId({
    category: sanitize(req.body?.category || ""),
    productId: sanitize(req.body?.productId || ""),
    existingIds,
  });

  res.status(201).json({ url, kind: result.kind, mime: result.mime, photoId });
}));

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

// Same "check the real shape before it ever reaches JSON.stringify"
// reasoning as validateMedia above, sized for a short bullet list —
// genuinely flexible length (no fixed count), but capped so a single
// admin mistake (pasting a huge block of text) can't produce something
// absurd on the customer-facing tab.
const MAX_KEY_FEATURES = 12;
function validateKeyFeatures(features) {
  if (!Array.isArray(features)) return "Key features must be a list.";
  if (features.length > MAX_KEY_FEATURES) return `Too many key features — max ${MAX_KEY_FEATURES}.`;
  for (const f of features) {
    if (typeof f !== "string" || f.trim().length === 0) return "Each key feature must be real, non-empty text.";
    if (f.length > 150) return "Each key feature must be under 150 characters.";
  }
  return null;
}

// GET /api/admin/products — full catalog, including fields the public
// /api/products endpoint doesn't expose (this is the same table, just an
// admin-only view of it — no separate data source to keep in sync).
// PUT /api/admin/products/featured — sets the WHOLE featured list at
// once, given as an ordered array of product IDs. A dedicated endpoint
// rather than folding this into the general PUT /:id above, on purpose:
// reordering a list of N products means N products' featured_order
// values all need to change together — trying to express that as
// individual per-product PATCHes risks a half-applied order if one
// request succeeds and a later one fails, whereas this does the whole
// list in a single transaction-like sequence, clears every OTHER
// product's featured_order first (so a product removed from the list
// genuinely becomes unfeatured, not just skipped), then sets the new
// ones in the exact order given.
router.put("/featured", requireAdmin, asyncHandler(async (req, res) => {
  const { productIds } = req.body || {};
  if (!Array.isArray(productIds)) return res.status(400).json({ error: "productIds must be a list." });
  if (productIds.length > 12) return res.status(400).json({ error: "Too many featured products — max 12, to keep the homepage section genuinely curated rather than becoming a second full catalog listing." });
  for (const id of productIds) {
    if (typeof id !== "string" || id.length === 0) return res.status(400).json({ error: "Every product ID must be real, non-empty text." });
  }

  await query("UPDATE products SET featured_order=NULL WHERE featured_order IS NOT NULL");
  for (let i = 0; i < productIds.length; i++) {
    const { rowCount } = await query("UPDATE products SET featured_order=$1 WHERE id=$2", [i, productIds[i]]);
    if (rowCount === 0) return res.status(400).json({ error: `No product found with ID "${productIds[i]}".` });
  }
  await logAdminAction(req.admin.id, "products.featured_updated", { count: productIds.length });
  res.json({ ok: true });
}));

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

  const { name, category, price, dims, hsn, status, description, metaTitle, metaDesc, media, keyFeatures } = req.body || {};

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
  if (keyFeatures !== undefined) {
    const kfError = validateKeyFeatures(keyFeatures);
    if (kfError) return res.status(400).json({ error: kfError });
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
    key_features: keyFeatures !== undefined ? JSON.stringify(keyFeatures.map(f => sanitize(f).trim())) : JSON.stringify(existing.key_features),
  };

  const { rows } = await query(
    `UPDATE products SET name=$1, category=$2, price=$3, dims=$4, hsn=$5, status=$6, description=$7, meta_title=$8, meta_desc=$9, media=$10, key_features=$11, updated_at=now()
     WHERE id=$12 RETURNING *`,
    [updated.name, updated.category, updated.price, updated.dims, updated.hsn, updated.status, updated.description, updated.meta_title, updated.meta_desc, updated.media, updated.key_features, req.params.id]
  );

  // Logs exactly what changed (old -> new), not just "product was updated"
  // — this is what makes the change log actually useful to look back at.
  const diff = {};
  for (const key of Object.keys(updated)) {
    if (key === "media" || key === "key_features") continue; // usually large/noisy, skip from the diff log
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
  const { id, name, category, price, dims, hsn, status, description, metaTitle, metaDesc, media, keyFeatures } = req.body || {};
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
  // Same validators the update route uses — a product created WITH
  // photos/features already attached (the whole point of the fuller
  // creation form) needs exactly the same real checks a later edit
  // would apply, not a looser pass just because it's the first save.
  if (media !== undefined) {
    const mediaError = validateMedia(media);
    if (mediaError) return res.status(400).json({ error: mediaError });
  }
  if (keyFeatures !== undefined) {
    const kfError = validateKeyFeatures(keyFeatures);
    if (kfError) return res.status(400).json({ error: kfError });
  }

  const { rows: existing } = await query("SELECT id FROM products WHERE id=$1", [id]);
  if (existing.length > 0) return res.status(409).json({ error: "A product with this ID already exists." });

  // Defaults to 'draft' when not specified — a newly created product
  // should need a deliberate action to go live, not accidentally appear
  // to customers mid-setup because a required field just hasn't been
  // filled in yet.
  const { rows } = await query(
    `INSERT INTO products (id, name, category, price, dims, hsn, status, description, meta_title, meta_desc, media, key_features)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id, sanitize(name), sanitize(category), price, sanitize(dims), sanitize(hsn), status || "draft", sanitize(description || "").slice(0, 2000), sanitize(metaTitle || ""), sanitize(metaDesc || ""), JSON.stringify(media || []), JSON.stringify((keyFeatures || []).map(f => sanitize(f).trim()))]
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

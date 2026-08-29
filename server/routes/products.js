import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

// Converts a DB row (snake_case columns) into the shape the frontend
// already expects (camelCase, matching the old hardcoded PRODUCTS array)
// — this is deliberate: it means AkaraApp.jsx's components barely need to
// change when they switch from reading the static array to fetching this
// endpoint, since the object shape stays the same.
function toFrontendShape(row) {
  return {
    id: row.id,
    name: row.name,
    cat: row.category,
    price: row.price,
    dims: row.dims,
    hsn: row.hsn,
    status: row.status,
    description: row.description,
    metaTitle: row.meta_title,
    metaDesc: row.meta_desc,
    media: row.media,
    keyFeatures: row.key_features,
    featuredOrder: row.featured_order,
    accessoriesNote: row.accessories_note,
    createdAt: row.created_at,
  };
}

// Draft and hidden products are never sent here at all — not filtered
// client-side (which would just hide them visually while still leaking
// the data to anyone inspecting the network tab), genuinely excluded at
// the query level.
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products WHERE status NOT IN ('draft','hidden') ORDER BY category, name");

  // Colors/variants for EVERY product, fetched here rather than the
  // single-product route below — the frontend genuinely only ever
  // calls this list endpoint once on mount and finds a given product
  // by id from the in-memory result (confirmed directly: GET
  // /api/products/:id below has no real caller anywhere in the
  // frontend), so this is the actual, only place a customer's variant
  // picker gets its real data from. Two batched queries (not one per
  // product — a real N+1 query problem otherwise, at 31+ products and
  // growing) then grouped in JS by product_id.
  const { rows: allColors } = await query("SELECT id, product_id, variant_key, label, swatch_hex, sort_order FROM product_colors ORDER BY sort_order");
  const { rows: allVariants } = await query("SELECT id, product_id, color_id, size, price, status, dims FROM product_variants");
  const colorsByProduct = {};
  for (const c of allColors) (colorsByProduct[c.product_id] ||= []).push({ id: c.id, variantKey: c.variant_key, label: c.label, swatchHex: c.swatch_hex });
  const variantsByProduct = {};
  for (const v of allVariants) (variantsByProduct[v.product_id] ||= []).push({ id: v.id, colorId: v.color_id, size: v.size, price: v.price, status: v.status, dims: v.dims });

  res.json({
    products: rows.map(row => ({
      ...toFrontendShape(row),
      colors: colorsByProduct[row.id] || [],
      variants: variantsByProduct[row.id] || [],
    })),
  });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products WHERE id = $1 AND status NOT IN ('draft','hidden')", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Product not found." });
  res.json({ product: toFrontendShape(rows[0]) });
}));

export default router;

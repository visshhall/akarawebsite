import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

async function isSalesPaused() {
  try {
    const { rows } = await query("SELECT value FROM settings WHERE key='sales_paused'");
    return rows[0]?.value === "1";
  } catch {
    return false;
  }
}

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
    media: Array.isArray(row.media) ? row.media : [],
    keyFeatures: Array.isArray(row.key_features) ? row.key_features : [],
    featuredOrder: row.featured_order,
    accessoriesNote: row.accessories_note,
    finishes: Array.isArray(row.finishes) ? row.finishes : [],
    createdAt: row.created_at,
  };
}

function applySalesPause(shape, variants, paused) {
  if (!paused) return { shape, variants };
  return {
    shape: { ...shape, status: "sold-out" },
    variants: (variants || []).map((v) => ({ ...v, status: "sold-out" })),
  };
}

router.get("/", asyncHandler(async (req, res) => {
  const paused = await isSalesPaused();
  const { rows } = await query("SELECT * FROM products WHERE status NOT IN ('draft','hidden') ORDER BY category, name");

  const { rows: allColors } = await query("SELECT id, product_id, variant_key, label, swatch_hex, sort_order FROM product_colors ORDER BY sort_order");
  const { rows: allVariants } = await query("SELECT id, product_id, color_id, size, price, status, dims FROM product_variants");
  const colorsByProduct = {};
  for (const c of allColors) (colorsByProduct[c.product_id] ||= []).push({ id: c.id, variantKey: c.variant_key, label: c.label, swatchHex: c.swatch_hex });
  const variantsByProduct = {};
  for (const v of allVariants) (variantsByProduct[v.product_id] ||= []).push({ id: v.id, colorId: v.color_id, size: v.size, price: v.price, status: v.status, dims: v.dims });

  res.json({
    salesPaused: paused,
    products: rows.map((row) => {
      const base = toFrontendShape(row);
      const variants = variantsByProduct[row.id] || [];
      const { shape, variants: vOut } = applySalesPause(base, variants, paused);
      return {
        ...shape,
        colors: colorsByProduct[row.id] || [],
        variants: vOut,
      };
    }),
  });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const paused = await isSalesPaused();
  const { rows } = await query("SELECT * FROM products WHERE id = $1 AND status NOT IN ('draft','hidden')", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Product not found." });
  const base = toFrontendShape(rows[0]);
  const { rows: variants } = await query("SELECT id, product_id, color_id, size, price, status, dims FROM product_variants WHERE product_id=$1", [req.params.id]);
  const mapped = variants.map((v) => ({ id: v.id, colorId: v.color_id, size: v.size, price: v.price, status: v.status, dims: v.dims }));
  const { shape, variants: vOut } = applySalesPause(base, mapped, paused);
  res.json({ product: { ...shape, variants: vOut }, salesPaused: paused });
}));

export default router;

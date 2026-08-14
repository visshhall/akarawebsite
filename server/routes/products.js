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
    stock: row.stock,
    description: row.description,
    metaTitle: row.meta_title,
    metaDesc: row.meta_desc,
    media: row.media,
  };
}

router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products ORDER BY category, name");
  res.json({ products: rows.map(toFrontendShape) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Product not found." });
  res.json({ product: toFrontendShape(rows[0]) });
}));

export default router;
import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

/** Public active categories for storefront nav / shop / homepage */
router.get("/", asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT name, slug, description, sort_order, icon_key
     FROM categories WHERE is_active = true
     ORDER BY sort_order ASC, name ASC`
  );
  res.json({
    categories: rows.map((r) => ({
      name: r.name,
      slug: r.slug,
      description: r.description || "",
      sortOrder: r.sort_order,
      iconKey: r.icon_key,
    })),
  });
}));

export default router;

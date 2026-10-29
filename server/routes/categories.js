import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

function mapRow(r) {
  return {
    name: r.name,
    slug: r.slug,
    description: r.description || "",
    sortOrder: r.sort_order,
    iconKey: r.icon_key,
    atmosphereImageUrl: r.atmosphere_image_url || "",
  };
}

/** Public active categories for storefront nav / shop / homepage.
 *  WHY resilient: if atmosphere_image_url column is not migrated yet, do not 500 the whole shop. */
router.get("/", asyncHandler(async (_req, res) => {
  let rows;
  try {
    ({ rows } = await query(
      `SELECT name, slug, description, sort_order, icon_key, atmosphere_image_url
       FROM categories WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`
    ));
  } catch (err) {
    const msg = String(err?.message || err);
    if (/atmosphere_image_url/i.test(msg) || err?.code === "42703") {
      ({ rows } = await query(
        `SELECT name, slug, description, sort_order, icon_key
         FROM categories WHERE is_active = true
         ORDER BY sort_order ASC, name ASC`
      ));
      rows = rows.map((r) => ({ ...r, atmosphere_image_url: null }));
    } else {
      throw err;
    }
  }
  res.json({ categories: rows.map(mapRow) });
}));

export default router;

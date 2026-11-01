import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole } from "../../adminAuth.js";
import { sanitize } from "../../validate.js";

const router = Router();

async function insertCategory(name, slug, description, sortOrder, isActive, iconKey, atmosphereImageUrl) {
  try {
    return await query(
      `INSERT INTO categories (name, slug, description, sort_order, is_active, icon_key, atmosphere_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, slug, description, sort_order, is_active, icon_key, atmosphere_image_url`,
      [name, slug, description || null, sortOrder, isActive, iconKey, atmosphereImageUrl]
    );
  } catch (err) {
    if (err?.code === "42703" || /atmosphere_image_url/i.test(String(err?.message || ""))) {
      return await query(
        `INSERT INTO categories (name, slug, description, sort_order, is_active, icon_key)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, slug, description, sort_order, is_active, icon_key`,
        [name, slug, description || null, sortOrder, isActive, iconKey]
      );
    }
    throw err;
  }
}

async function updateCategory(id, name, slug, description, sortOrder, isActive, iconKey, atmosphereImageUrl) {
  try {
    return await query(
      `UPDATE categories SET name=$1, slug=$2, description=$3, sort_order=$4, is_active=$5, icon_key=$6, atmosphere_image_url=$7, updated_at=now()
       WHERE id=$8
       RETURNING id, name, slug, description, sort_order, is_active, icon_key, atmosphere_image_url`,
      [name, slug, description || null, sortOrder, isActive, iconKey, atmosphereImageUrl, id]
    );
  } catch (err) {
    if (err?.code === "42703" || /atmosphere_image_url/i.test(String(err?.message || ""))) {
      return await query(
        `UPDATE categories SET name=$1, slug=$2, description=$3, sort_order=$4, is_active=$5, icon_key=$6, updated_at=now()
         WHERE id=$7
         RETURNING id, name, slug, description, sort_order, is_active, icon_key`,
        [name, slug, description || null, sortOrder, isActive, iconKey, id]
      );
    }
    throw err;
  }
}


function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

router.get("/", requireRole("admin", "super_admin"), asyncHandler(async (_req, res) => {
  let rows;
  try {
    ({ rows } = await query(
      `SELECT id, name, slug, description, sort_order, is_active, icon_key, atmosphere_image_url, created_at, updated_at
       FROM categories ORDER BY sort_order ASC, name ASC`
    ));
  } catch (err) {
    const msg = String(err?.message || err);
    if (/atmosphere_image_url/i.test(msg) || err?.code === "42703") {
      ({ rows } = await query(
        `SELECT id, name, slug, description, sort_order, is_active, icon_key, created_at, updated_at
         FROM categories ORDER BY sort_order ASC, name ASC`
      ));
      rows = rows.map((r) => ({ ...r, atmosphere_image_url: null }));
    } else {
      throw err;
    }
  }
  res.json({
    categories: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description || "",
      sortOrder: r.sort_order,
      isActive: r.is_active,
      iconKey: r.icon_key,
      atmosphereImageUrl: r.atmosphere_image_url || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}));

router.post("/", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const name = sanitize(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  let slug = sanitize(req.body?.slug || "").trim() || slugify(name);
  if (!slug) return res.status(400).json({ error: "Could not build a URL slug from that name." });
  const description = sanitize(req.body?.description || "").trim().slice(0, 500);
  const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 100;
  const iconKey = sanitize(req.body?.iconKey || "planters").trim() || "planters";
  const isActive = req.body?.isActive !== false;
  let atmosphereImageUrl = sanitize(req.body?.atmosphereImageUrl || "").trim().slice(0, 500);
  if (atmosphereImageUrl && !/^https:\/\//i.test(atmosphereImageUrl)) {
    return res.status(400).json({ error: "Atmosphere image must be an https:// URL (or leave blank for default SVG)." });
  }
  if (!atmosphereImageUrl) atmosphereImageUrl = null;

  try {
    const { rows } = await insertCategory(name, slug, description, sortOrder, isActive, iconKey, atmosphereImageUrl);
    const r = rows[0];
    res.status(201).json({
      category: {
        id: r.id, name: r.name, slug: r.slug, description: r.description || "",
        sortOrder: r.sort_order, isActive: r.is_active, iconKey: r.icon_key,
        atmosphereImageUrl: r.atmosphere_image_url || "",
      },
    });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A category with that name or slug already exists." });
    throw err;
  }
}));

router.put("/:id", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  const name = sanitize(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  let slug = sanitize(req.body?.slug || "").trim() || slugify(name);
  const description = sanitize(req.body?.description || "").trim().slice(0, 500);
  const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 100;
  const iconKey = sanitize(req.body?.iconKey || "planters").trim() || "planters";
  const isActive = req.body?.isActive !== false;
  let atmosphereImageUrl = sanitize(req.body?.atmosphereImageUrl || "").trim().slice(0, 500);
  if (atmosphereImageUrl && !/^https:\/\//i.test(atmosphereImageUrl)) {
    return res.status(400).json({ error: "Atmosphere image must be an https:// URL (or leave blank for default SVG)." });
  }
  if (!atmosphereImageUrl) atmosphereImageUrl = null;

  // If renaming, optionally update products that used the old name
  const prev = await query(`SELECT name FROM categories WHERE id=$1`, [id]);
  if (!prev.rows.length) return res.status(404).json({ error: "Category not found." });
  const oldName = prev.rows[0].name;

  try {
    const { rows } = await updateCategory(id, name, slug, description, sortOrder, isActive, iconKey, atmosphereImageUrl);
    if (oldName !== name) {
      await query(`UPDATE products SET category=$1, updated_at=now() WHERE category=$2`, [name, oldName]);
    }
    const r = rows[0];
    res.json({
      category: {
        id: r.id, name: r.name, slug: r.slug, description: r.description || "",
        sortOrder: r.sort_order, isActive: r.is_active, iconKey: r.icon_key,
        atmosphereImageUrl: r.atmosphere_image_url || "",
      },
    });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A category with that name or slug already exists." });
    throw err;
  }
}));

router.delete("/:id", requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  const prev = await query(`SELECT name FROM categories WHERE id=$1`, [id]);
  if (!prev.rows.length) return res.status(404).json({ error: "Category not found." });
  const name = prev.rows[0].name;
  const { rows: used } = await query(`SELECT COUNT(*)::int AS n FROM products WHERE category=$1`, [name]);
  if (Number(used[0].n) > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${used[0].n} product(s) still use “${name}”. Move or re-categorise them first, or deactivate the category instead.`,
    });
  }
  await query(`DELETE FROM categories WHERE id=$1`, [id]);
  res.json({ ok: true });
}));

export default router;

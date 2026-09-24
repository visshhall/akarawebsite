import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

// GET /api/room-stories — public homepage boards (only active, with product details)
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='room_stories'");
  let boards = [];
  if (rows[0]?.value) {
    try { boards = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value; } catch { boards = []; }
  }
  if (!Array.isArray(boards)) boards = [];
  boards = boards.filter((b) => b && b.active !== false && b.title);

  const allIds = [...new Set(boards.flatMap((b) => (Array.isArray(b.productIds) ? b.productIds : [])))];
  let productsById = {};
  if (allIds.length) {
    const { rows: prows } = await query(
      `SELECT id, name, category, price, status, media
       FROM products WHERE id = ANY($1::text[])`,
      [allIds]
    );
    // Keep response light; frontend already has full catalog often, but
    // this endpoint is self-contained for SSR/home.
    for (const r of prows) {
      productsById[r.id] = {
        id: r.id,
        name: r.name,
        cat: r.category,
        price: Number(r.price),
        status: r.status,
        media: r.media,
      };
    }
  }

  res.json({
    boards: boards.map((b) => ({
      id: b.id,
      title: b.title,
      blurb: b.blurb || "",
      products: (b.productIds || []).map((id) => productsById[id]).filter(Boolean),
    })),
  });
}));

export default router;

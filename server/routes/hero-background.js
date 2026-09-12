import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();
const DEFAULT_URL = "/images/hero-home.jpg";

// GET /api/hero-background — public still image for homepage hero
router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='hero_background_url'");
  const raw = rows[0]?.value && String(rows[0].value).trim();
  const imageUrl = raw || DEFAULT_URL;
  res.set("Cache-Control", "public, max-age=60, s-maxage=120");
  res.json({ imageUrl, isDefault: !raw });
}));

export default router;

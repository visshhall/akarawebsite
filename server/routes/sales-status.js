import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='sales_paused'");
  const salesPaused = rows[0]?.value === "1";
  res.set("Cache-Control", "public, max-age=15");
  res.json({ salesPaused });
}));

export default router;

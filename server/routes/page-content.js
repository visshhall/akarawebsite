// ============================================================================
// PUBLIC PAGE CONTENT — the read side of the CMS. Genuinely public, no
// auth required (matches every other content page like /products —
// anyone visiting the site needs to read the Privacy Policy without
// being logged in). The WRITE side (create/update/reorder/revert) lives
// entirely in server/routes/admin/page-content.js, gated to
// super_admin only — this file can only ever read.
// ============================================================================
import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

router.get("/:pageKey", asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT id, block_type, content, sort_order FROM page_content WHERE page_key=$1 ORDER BY sort_order ASC",
    [req.params.pageKey]
  );
  // A page with zero rows is a real, meaningful state (e.g. the page_key
  // is genuinely wrong, or content was fully deleted and never
  // reseeded) — returned as a normal empty array rather than a 404, so
  // the frontend's existing "couldn't load" vs "genuinely empty" error
  // handling stays simple; CmsPageView already renders gracefully
  // either way.
  res.json({
    blocks: rows.map(r => ({ id: r.id, blockType: r.block_type, content: r.content, sortOrder: r.sort_order })),
  });
}));

export default router;

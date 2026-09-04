// ============================================================================
// CMS ADMIN — super_admin only, confirmed spec. Every route here uses
// requireRole("super_admin") specifically — not even a regular admin can
// touch site-wide content, per the owner's explicit instruction.
//
// PAGES is the real, fixed list of CMS-driven pages this admin screen
// can manage — deliberately NOT open-ended (an admin can't invent a
// new arbitrary page_key here), since every page_key needs a matching
// real route/component on the customer-facing site to ever be seen; a
// page_key with no such page would just be orphaned, unreachable data.
// ============================================================================
import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole, logAdminAction } from "../../adminAuth.js";

const router = Router();
const PAGES = {
  privacy: "Privacy Policy",
  refund: "Refund & Return Policy",
  shipping: "Shipping Policy",
  terms: "Terms of Service",
  cookies: "Cookie Policy",
  accessibility: "Accessibility Statement",
  faq: "FAQ",
  "care-guide": "Care Guide",
  about: "About",
  craft: "The Craft",
  home: "Homepage Hero",
  footer: "Footer",
  "return-request": "Return Request Page",
};
const MAX_BLOCKS = 60;

function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) return "blocks must be a list.";
  if (blocks.length === 0) return "A page needs at least one block.";
  if (blocks.length > MAX_BLOCKS) return `Too many blocks — max ${MAX_BLOCKS}.`;
  for (const b of blocks) {
    if (!b || typeof b !== "object") return "Each block must be a real object.";
    if (!["heading", "paragraph", "table", "qa", "bulletList", "hero", "quote", "darkPanel", "stepGrid", "cardGrid", "heroWithCta", "footerBrand"].includes(b.blockType)) return "Each block's type isn't recognized.";
    if (typeof b.content !== "string" || b.content.trim().length === 0) return "Each block needs real, non-empty content.";
    if (b.content.length > 5000) return "A single block's content is too long (max 5000 characters).";
    if (b.blockType === "table") {
      try {
        const rows = JSON.parse(b.content);
        if (!Array.isArray(rows) || !rows.every(r => Array.isArray(r))) return "A table block's content must be a JSON array of arrays.";
      } catch {
        return "A table block's content must be valid JSON.";
      }
    }
    if (b.blockType === "qa") {
      try {
        const { q, a } = JSON.parse(b.content);
        if (typeof q !== "string" || !q.trim() || typeof a !== "string" || !a.trim()) return "A qa block needs both a real question and a real answer.";
      } catch {
        return "A qa block's content must be valid JSON with q and a fields.";
      }
    }
    if (b.blockType === "bulletList") {
      try {
        const { title, points } = JSON.parse(b.content);
        if (typeof title !== "string" || !title.trim()) return "A bulletList block needs a real title.";
        if (!Array.isArray(points) || points.length === 0 || !points.every(p => typeof p === "string" && p.trim())) return "A bulletList block needs at least one real, non-empty point.";
      } catch {
        return "A bulletList block's content must be valid JSON with title and points fields.";
      }
    }
    if (b.blockType === "hero") {
      try {
        const { eyebrow, heading, subtext } = JSON.parse(b.content);
        if (![eyebrow, heading, subtext].every(v => typeof v === "string" && v.trim())) return "A hero block needs a real eyebrow, heading, and subtext.";
      } catch {
        return "A hero block's content must be valid JSON with eyebrow, heading, and subtext fields.";
      }
    }
    if (b.blockType === "quote") {
      try {
        const { quote, attribution } = JSON.parse(b.content);
        if (![quote, attribution].every(v => typeof v === "string" && v.trim())) return "A quote block needs both a real quote and attribution.";
      } catch {
        return "A quote block's content must be valid JSON with quote and attribution fields.";
      }
    }
    if (b.blockType === "darkPanel") {
      try {
        const { eyebrow, heading, body } = JSON.parse(b.content);
        if (![eyebrow, heading, body].every(v => typeof v === "string" && v.trim())) return "A darkPanel block needs a real eyebrow, heading, and body.";
      } catch {
        return "A darkPanel block's content must be valid JSON with eyebrow, heading, and body fields.";
      }
    }
    if (b.blockType === "stepGrid") {
      try {
        const { eyebrow, heading, steps } = JSON.parse(b.content);
        if (typeof eyebrow !== "string" || !eyebrow.trim() || typeof heading !== "string" || !heading.trim()) return "A stepGrid block needs a real eyebrow and heading.";
        if (!Array.isArray(steps) || steps.length === 0 || !steps.every(s => s && typeof s.number === "string" && typeof s.title === "string" && s.title.trim() && typeof s.description === "string" && s.description.trim())) {
          return "A stepGrid block needs at least one real step, each with a number, title, and description.";
        }
      } catch {
        return "A stepGrid block's content must be valid JSON with eyebrow, heading, and steps fields.";
      }
    }
    if (b.blockType === "cardGrid") {
      try {
        const { cards } = JSON.parse(b.content);
        if (!Array.isArray(cards) || cards.length === 0 || !cards.every(c => c && typeof c.title === "string" && c.title.trim() && typeof c.description === "string" && c.description.trim())) {
          return "A cardGrid block needs at least one real card, each with a title and description.";
        }
      } catch {
        return "A cardGrid block's content must be valid JSON with a cards field.";
      }
    }
    if (b.blockType === "heroWithCta") {
      try {
        const { eyebrow, heading, subtext, ctaLabel, ctaLabel2 } = JSON.parse(b.content);
        if (![eyebrow, heading, subtext, ctaLabel, ctaLabel2].every(v => typeof v === "string" && v.trim())) {
          return "A heroWithCta block needs a real eyebrow, heading, subtext, and both button labels.";
        }
      } catch {
        return "A heroWithCta block's content must be valid JSON with eyebrow, heading, subtext, ctaLabel, and ctaLabel2 fields.";
      }
    }
    if (b.blockType === "footerBrand") {
      try {
        const { tagline, email, phone, instagram, location, newsletterBlurb } = JSON.parse(b.content);
        if (![tagline, email, phone, instagram, location, newsletterBlurb].every(v => typeof v === "string" && v.trim())) {
          return "A footerBrand block needs real values for tagline, email, phone, instagram, location, and newsletterBlurb — none can be left blank.";
        }
      } catch {
        return "A footerBrand block's content must be valid JSON with tagline, email, phone, instagram, location, and newsletterBlurb fields.";
      }
    }
  }
  return null;
}

// GET /api/admin/page-content — the real list of manageable pages, with
// each one's current block count, for the CMS screen's page picker.
router.get("/", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT page_key, COUNT(*) as block_count, MAX(updated_at) as last_updated FROM page_content GROUP BY page_key");
  const counts = Object.fromEntries(rows.map(r => [r.page_key, { blockCount: Number(r.block_count), lastUpdated: r.last_updated }]));
  const pages = Object.entries(PAGES).map(([key, title]) => ({
    pageKey: key, title,
    blockCount: counts[key]?.blockCount || 0,
    lastUpdated: counts[key]?.lastUpdated || null,
  }));
  res.json({ pages });
}));

// GET /api/admin/page-content/:pageKey — one page's real, current blocks
// for editing.
router.get("/:pageKey", requireRole("super_admin"), asyncHandler(async (req, res) => {
  if (!PAGES[req.params.pageKey]) return res.status(404).json({ error: "Unknown page." });
  const { rows } = await query(
    "SELECT id, block_type, content, sort_order FROM page_content WHERE page_key=$1 ORDER BY sort_order ASC",
    [req.params.pageKey]
  );
  res.json({ blocks: rows.map(r => ({ id: r.id, blockType: r.block_type, content: r.content, sortOrder: r.sort_order })) });
}));

// PUT /api/admin/page-content/:pageKey — saves the WHOLE page's block
// list at once (add/edit/remove/reorder in one action) — same reasoning
// as the Featured Products bulk-save: trying to express "these 8 blocks
// are now in this order, this one's gone, this one's new" as individual
// per-block PATCHes risks a half-applied page if one request in a
// sequence fails partway through.
//
// A REAL VERSION SNAPSHOT is taken first, before anything is touched —
// this is the actual "one-click revert" safety net: whatever the page
// looked like a moment before this save is preserved in
// page_content_history, in full, as its own row, not a diff.
router.put("/:pageKey", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const pageKey = req.params.pageKey;
  if (!PAGES[pageKey]) return res.status(404).json({ error: "Unknown page." });
  const { blocks } = req.body || {};
  const error = validateBlocks(blocks);
  if (error) return res.status(400).json({ error });

  const { rows: current } = await query(
    "SELECT block_type, content, sort_order FROM page_content WHERE page_key=$1 ORDER BY sort_order ASC",
    [pageKey]
  );
  // Snapshot only makes sense if there's genuinely a prior state to
  // preserve — a brand-new page (current.length === 0) has nothing
  // real to revert TO, so skipping this avoids a meaningless empty
  // history entry.
  if (current.length > 0) {
    await query(
      "INSERT INTO page_content_history (page_key, snapshot, saved_by) VALUES ($1,$2,$3)",
      [pageKey, JSON.stringify(current), req.admin.id]
    );
  }

  await query("DELETE FROM page_content WHERE page_key=$1", [pageKey]);
  for (let i = 0; i < blocks.length; i++) {
    await query(
      "INSERT INTO page_content (page_key, sort_order, block_type, content, updated_by) VALUES ($1,$2,$3,$4,$5)",
      [pageKey, i, blocks[i].blockType, blocks[i].content, req.admin.id]
    );
  }
  await logAdminAction(req.admin.id, "page_content.save", { pageKey, blockCount: blocks.length });
  res.json({ ok: true });
}));

// GET /api/admin/page-content/:pageKey/history — real, past versions of
// a page, most recent first, for the revert screen.
router.get("/:pageKey/history", requireRole("super_admin"), asyncHandler(async (req, res) => {
  if (!PAGES[req.params.pageKey]) return res.status(404).json({ error: "Unknown page." });
  const { rows } = await query(
    `SELECT h.id, h.snapshot, h.saved_at, a.name as saved_by_name
     FROM page_content_history h LEFT JOIN admins a ON a.id = h.saved_by
     WHERE h.page_key=$1 ORDER BY h.saved_at DESC LIMIT 20`,
    [req.params.pageKey]
  );
  res.json({
    versions: rows.map(r => ({
      id: r.id,
      savedAt: r.saved_at,
      savedByName: r.saved_by_name || "Unknown admin",
      blockCount: r.snapshot.length,
    })),
  });
}));

// POST /api/admin/page-content/:pageKey/revert/:versionId — the actual
// "one-click revert". Restores a past snapshot as the page's real,
// current content — and (deliberately) ALSO snapshots what was live
// just before the revert, so reverting is itself just another real,
// undoable save, not a one-way trip that could lose whatever was live
// right before someone reverted.
router.post("/:pageKey/revert/:versionId", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const pageKey = req.params.pageKey;
  if (!PAGES[pageKey]) return res.status(404).json({ error: "Unknown page." });

  const { rows: versionRows } = await query(
    "SELECT snapshot FROM page_content_history WHERE id=$1 AND page_key=$2",
    [req.params.versionId, pageKey]
  );
  if (versionRows.length === 0) return res.status(404).json({ error: "That version doesn't exist." });

  const { rows: current } = await query(
    "SELECT block_type, content, sort_order FROM page_content WHERE page_key=$1 ORDER BY sort_order ASC",
    [pageKey]
  );
  if (current.length > 0) {
    await query("INSERT INTO page_content_history (page_key, snapshot, saved_by) VALUES ($1,$2,$3)", [pageKey, JSON.stringify(current), req.admin.id]);
  }

  const restoreBlocks = versionRows[0].snapshot;
  await query("DELETE FROM page_content WHERE page_key=$1", [pageKey]);
  for (let i = 0; i < restoreBlocks.length; i++) {
    await query(
      "INSERT INTO page_content (page_key, sort_order, block_type, content, updated_by) VALUES ($1,$2,$3,$4,$5)",
      [pageKey, i, restoreBlocks[i].block_type, restoreBlocks[i].content, req.admin.id]
    );
  }
  await logAdminAction(req.admin.id, "page_content.revert", { pageKey, restoredVersionId: req.params.versionId });
  res.json({ ok: true });
}));

export default router;

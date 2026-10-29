// ============================================================================
// ARCHITECT / DESIGNER LOOKBOOK
// Password-gated catalogue summary for interior designers & studios.
// Admin sets lookbook_password + optional lookbook_pdf_url in settings.
// After unlock, a short-lived httpOnly cookie grants access to specs.
// ============================================================================
import { Router } from "express";
import crypto from "crypto";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { lookbookUnlockRateLimit } from "../rateLimit.js";

const router = Router();

const COOKIE = "akara_lookbook";
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function getLookbookSettings() {
  const { rows } = await query(
    "SELECT key, value FROM settings WHERE key IN ('lookbook_password','lookbook_pdf_url','lookbook_enabled')"
  );
  const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: by.lookbook_enabled !== "0",
    password: by.lookbook_password || "",
    pdfUrl: by.lookbook_pdf_url || "",
  };
}

function hasLookbookCookie(req) {
  return req.cookies?.[COOKIE] === "1";
}

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const s = await getLookbookSettings();
    res.json({
      enabled: s.enabled && !!s.password,
      unlocked: hasLookbookCookie(req),
      hasPdf: !!s.pdfUrl,
    });
  })
);

router.post(
  "/unlock",
  lookbookUnlockRateLimit,
  asyncHandler(async (req, res) => {
    const s = await getLookbookSettings();
    if (!s.enabled || !s.password) {
      return res.status(503).json({ error: "Lookbook is not available right now." });
    }
    const attempt = String(req.body?.password || "").trim();
    if (!attempt || !timingSafeEqualStr(attempt, s.password)) {
      return res.status(401).json({ error: "That access code is not valid." });
    }
    res.cookie(COOKIE, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
    });
    res.json({ ok: true, hasPdf: !!s.pdfUrl });
  })
);

router.post(
  "/lock",
  asyncHandler(async (req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  })
);

router.get(
  "/content",
  asyncHandler(async (req, res) => {
    if (!hasLookbookCookie(req)) {
      return res.status(401).json({ error: "Unlock the lookbook first." });
    }
    const s = await getLookbookSettings();
    const { rows } = await query(
      `SELECT id, name, category, price, status, dims, description, key_features
       FROM products
       WHERE COALESCE(status, 'in-stock') NOT IN ('draft','hidden')
       ORDER BY category NULLS LAST, name ASC
       LIMIT 200`
    );
    const pieces = rows.map((p) => {
      let features = p.key_features;
      if (typeof features === "string") {
        try { features = JSON.parse(features); } catch { features = []; }
      }
      const materials = Array.isArray(features) ? features.filter(Boolean).slice(0, 4).join(" · ") : "";
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        dimensions: p.dims || "",
        materials,
        summary: String(p.description || "").slice(0, 280),
        available: p.status !== "sold_out" && p.status !== "sold-out",
      };
    });
    res.json({
      pdfUrl: s.pdfUrl || null,
      pieces,
      note: "Made to order in Mumbai. Studio work typically two to three days; most pieces reach the client in about two weeks including courier. Prices are GST-inclusive list prices for single units — project pricing on request.",
    });
  })
);

export default router;

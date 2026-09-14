import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { publicFormRateLimit } from "../rateLimit.js";
import { attachCustomer } from "../auth.js";

const router = Router();

const ALLOWED = new Set([
  "page_view",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "purchase",
  "search",
  "wishlist_add",
  "wishlist_remove",
]);

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out = {};
  const keys = Object.keys(meta).slice(0, 12);
  for (const k of keys) {
    const key = String(k).slice(0, 40);
    let v = meta[k];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = v.slice(0, 200);
    else if (Array.isArray(v)) out[key] = v.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 80) : x)).filter((x) => typeof x === "string" || typeof x === "number");
  }
  return out;
}

// POST /api/analytics/event — first-party beacon (works even when GA is blocked)
router.post(
  "/event",
  publicFormRateLimit,
  attachCustomer,
  asyncHandler(async (req, res) => {
    const { event, path, sessionId, meta } = req.body || {};
    const eventName = String(event || "").slice(0, 40);
    if (!ALLOWED.has(eventName)) {
      return res.status(400).json({ error: "Unknown event." });
    }
    const sid = String(sessionId || "").slice(0, 64) || null;
    const p = String(path || "").slice(0, 300) || null;
    const m = sanitizeMeta(meta);
    const customerId = req.customer?.id || null;

    await query(
      `INSERT INTO analytics_events (session_id, customer_id, event_name, path, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [sid, customerId, eventName, p, JSON.stringify(m)]
    );
    res.status(204).end();
  })
);

export default router;

import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { analyticsEventRateLimit } from "../rateLimit.js";
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
    else if (Array.isArray(v))
      out[key] = v
        .slice(0, 20)
        .map((x) => (typeof x === "string" ? x.slice(0, 80) : x))
        .filter((x) => typeof x === "string" || typeof x === "number");
  }
  return out;
}

// POST /api/analytics/event — first-party beacon (works when GA is blocked).
// Mounted BEFORE CSRF in server.js. High rate limit so normal browsing is recorded.
router.post(
  "/event",
  analyticsEventRateLimit,
  attachCustomer,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const { event, path, sessionId, meta } = body;
    const eventName = String(event || "").slice(0, 40);
    if (!ALLOWED.has(eventName)) {
      return res.status(400).json({ error: "Unknown event." });
    }
    const sid = String(sessionId || "").slice(0, 64) || null;
    const p = String(path || "").slice(0, 300) || null;
    const m = sanitizeMeta(meta);
    const customerId = req.customer?.id || null;

    try {
      await query(
        `INSERT INTO analytics_events (session_id, customer_id, event_name, path, meta)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [sid, customerId, eventName, p, JSON.stringify(m)]
      );
    } catch (e) {
      // Table missing after incomplete migrate — create once and retry
      if (e?.code === "42P01") {
        console.error("[analytics] analytics_events missing — creating");
        await query(`
          CREATE TABLE IF NOT EXISTS analytics_events (
            id              BIGSERIAL PRIMARY KEY,
            session_id      TEXT,
            customer_id     UUID,
            event_name      TEXT NOT NULL,
            path            TEXT,
            meta            JSONB NOT NULL DEFAULT '{}',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
          )`);
        await query(`CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at DESC)`);
        await query(
          `INSERT INTO analytics_events (session_id, customer_id, event_name, path, meta)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [sid, customerId, eventName, p, JSON.stringify(m)]
        );
      } else {
        console.error("[analytics] insert failed:", e?.message || e);
        return res.status(500).json({ error: "Could not record event." });
      }
    }
    res.status(204).end();
  })
);

export default router;

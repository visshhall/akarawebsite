/**
 * Meta ads public config + optional CAPI event relay.
 *
 * GET  /api/meta/config     — public Pixel ID only (never the access token)
 * POST /api/meta/capi-event — rate-limited; server hashes PII and forwards to CAPI
 *
 * SECURITY: access token stays in env; client may send email/phone only over HTTPS
 * to this endpoint — we hash before Graph API. Allowed event names are allowlisted.
 */
import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import rateLimit from "express-rate-limit";
import { analyticsEventRateLimit } from "../rateLimit.js";
import {
  metaCapiConfigured,
  sendMetaCapiEvents,
  buildStandardEvent,
} from "../metaCapi.js";

function publicPixelId() {
  return (process.env.META_PIXEL_ID || process.env.FACEBOOK_PIXEL_ID || "").trim();
}

const router = Router();

const ALLOWED = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
  "Search",
  "AddToWishlist",
  "CompleteRegistration",
  "Lead",
  "Contact",
]);

const capiLimit = analyticsEventRateLimit || rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tracking requests." },
});

router.get("/config", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    pixelId: publicPixelId() || null,
    capiEnabled: metaCapiConfigured(),
  });
});

router.post(
  "/capi-event",
  capiLimit,
  asyncHandler(async (req, res) => {
    if (!metaCapiConfigured()) {
      return res.status(204).end();
    }

    const body = req.body || {};
    const eventName = String(body.event_name || body.eventName || "").trim();
    if (!ALLOWED.has(eventName)) {
      return res.status(400).json({ error: "Event not allowed." });
    }

    // Purchase is primarily server-fired from orders.js; allow client only with order_id
    if (eventName === "Purchase" && !body.order_id && !body.event_id) {
      return res.status(400).json({ error: "Purchase requires order id." });
    }

    const fbp = body.fbp || req.headers["x-fb-fbp"];
    const fbc = body.fbc || req.headers["x-fb-fbc"];
    // Attach cookies from body into a fake req for user_data helpers
    const reqLike = {
      ...req,
      headers: {
        ...req.headers,
        "x-fb-fbp": fbp,
        "x-fb-fbc": fbc,
        "user-agent": body.user_agent || req.headers["user-agent"],
      },
    };

    const contentIds = Array.isArray(body.content_ids)
      ? body.content_ids
      : body.content_id
        ? [body.content_id]
        : body.productId
          ? [body.productId]
          : undefined;

    const event = buildStandardEvent({
      eventName,
      eventId: body.event_id || body.eventId,
      sourceUrl: typeof body.source_url === "string" ? body.source_url.slice(0, 500) : undefined,
      email: body.email,
      phone: body.phone,
      value: body.value,
      contentIds,
      contentName: body.content_name || body.name,
      contentType: body.content_type || "product",
      req: reqLike,
    });

    if (eventName === "Purchase" && (body.order_id || body.event_id)) {
      event.event_id = String(body.order_id || body.event_id);
      event.custom_data = event.custom_data || {};
      event.custom_data.order_id = String(body.order_id || body.event_id);
    }

    if (body.search_string) {
      event.custom_data = event.custom_data || {};
      event.custom_data.search_string = String(body.search_string).slice(0, 200);
    }

    // Don't await hard — but return status for debugging in Meta Test Events
    const result = await sendMetaCapiEvents([event]);
    if (result.skipped) return res.status(204).end();
    if (result.ok) return res.status(204).end();
    return res.status(502).json({ error: "Upstream tracking failed." });
  })
);

export default router;

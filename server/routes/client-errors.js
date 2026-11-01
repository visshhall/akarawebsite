import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { publicFormRateLimit } from "../rateLimit.js";
import { sanitize } from "../validate.js";

const router = Router();

/**
 * Lightweight first-party error monitoring.
 * Frontend posts crashes / unhandled rejections here so Railway logs
 * (and optional webhook) capture what customers hit — without requiring
 * a paid Sentry plan. Set ERROR_WEBHOOK_URL to forward to Slack/Discord.
 */
router.post("/", publicFormRateLimit, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const message = sanitize(String(body.message || "unknown")).slice(0, 500);
  const stack = sanitize(String(body.stack || "")).slice(0, 2000);
  const source = sanitize(String(body.source || "client")).slice(0, 80);
  const url = sanitize(String(body.url || "")).slice(0, 400);
  const view = sanitize(String(body.view || "")).slice(0, 80);
  const userAgent = sanitize(String(req.headers["user-agent"] || "")).slice(0, 300);

  const payload = {
    at: new Date().toISOString(),
    message,
    stack: stack || undefined,
    source,
    url,
    view,
    userAgent,
    ip: req.ip,
  };

  console.error("[client-error]", JSON.stringify(payload));

  const hook = process.env.ERROR_WEBHOOK_URL;
  if (hook && /^https:\/\//i.test(hook)) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `ĀKĀRA client error: ${message}\n${url}\n${view}`,
          ...payload,
        }),
      });
    } catch (e) {
      console.error("[client-error] webhook failed", e?.message || e);
    }
  }

  res.json({ ok: true });
}));

export default router;

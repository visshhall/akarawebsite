import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { getVapidPublicKey, isPushConfigured, notifyAdmins } from "../push.js";
import rateLimit from "express-rate-limit";

const router = Router();

/** Limit subscribe/unsubscribe spam and endpoint probing */
const pushMutateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many push requests. Please try again later." },
});

/**
 * Only accept HTTPS Web Push endpoints from known provider host patterns.
 * Blocks javascript:, data:, and random attacker-controlled URLs.
 */
function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > 2048) {
    return false;
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const allowedSuffixes = [
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "push.apple.com",
    "notify.windows.com",
    "wns.windows.com",
  ];
  return allowedSuffixes.some((s) => host === s || host.endsWith("." + s));
}

function isValidPushKeys(keys) {
  if (!keys || typeof keys !== "object") return false;
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return false;
  if (p256dh.length < 20 || p256dh.length > 512) return false;
  if (auth.length < 8 || auth.length > 256) return false;
  // base64url-ish
  return /^[A-Za-z0-9\-_+/]+=*$/.test(p256dh) && /^[A-Za-z0-9\-_+/]+=*$/.test(auth);
}

router.get("/vapid-public-key", (req, res) => {
  if (!isPushConfigured()) {
    return res.json({ enabled: false, publicKey: null });
  }
  res.json({ enabled: true, publicKey: getVapidPublicKey() });
});

router.post("/subscribe", pushMutateRateLimit, asyncHandler(async (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Push is not configured on this server." });
  }
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !isValidPushKeys(sub.keys)) {
    return res.status(400).json({ error: "Invalid subscription." });
  }
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    return res.status(400).json({ error: "Push endpoint is not allowed." });
  }

  const role = String(req.body?.role || "customer");
  const adminId = role === "admin" && req.admin?.id != null ? req.admin.id : null;
  const customerId = role !== "admin" && req.customer?.id != null ? String(req.customer.id) : null;

  if (role === "admin" && !adminId) {
    return res.status(401).json({ error: "Admin session required." });
  }
  if (role !== "admin" && !customerId) {
    return res.status(401).json({ error: "Sign in to enable order alerts." });
  }

  // Ownership is always the current session — never COALESCE onto another user.
  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, admin_id, customer_id, user_agent, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       admin_id = EXCLUDED.admin_id,
       customer_id = EXCLUDED.customer_id,
       user_agent = EXCLUDED.user_agent,
       updated_at = now()`,
    [
      sub.endpoint,
      sub.keys.p256dh,
      sub.keys.auth,
      adminId,
      customerId,
      String(req.headers["user-agent"] || "").slice(0, 300),
    ]
  );
  res.json({ ok: true });
}));

router.post("/unsubscribe", pushMutateRateLimit, asyncHandler(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "endpoint required" });
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return res.status(400).json({ error: "Invalid endpoint." });
  }

  const adminId = req.admin?.id != null ? req.admin.id : null;
  const customerId = req.customer?.id != null ? String(req.customer.id) : null;
  if (!adminId && !customerId) {
    return res.status(401).json({ error: "Sign in required." });
  }

  // Only delete subscriptions owned by this session
  if (adminId) {
    await query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND admin_id = $2`,
      [endpoint, adminId]
    );
  } else {
    await query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND customer_id = $2`,
      [endpoint, customerId]
    );
  }
  res.json({ ok: true });
}));

// Admin test ping
router.post("/test", asyncHandler(async (req, res) => {
  if (!req.admin?.id) return res.status(401).json({ error: "Admin only." });
  if (!isPushConfigured()) return res.status(503).json({ error: "Push not configured." });
  try {
    await notifyAdmins({
      title: "ĀKĀRA studio",
      body: "Test notification — push is working.",
      url: "/admin",
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Push test failed." });
  }
}));

export default router;

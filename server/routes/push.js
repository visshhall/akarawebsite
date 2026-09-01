import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { getVapidPublicKey, isPushConfigured, initPush, notifyAdmins } from "../push.js";

const router = Router();

router.get("/vapid-public-key", (req, res) => {
  if (!isPushConfigured()) {
    return res.json({ enabled: false, publicKey: null });
  }
  res.json({ enabled: true, publicKey: getVapidPublicKey() });
});

router.post("/subscribe", asyncHandler(async (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Push is not configured on this server." });
  }
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription." });
  }
  const role = String(req.body?.role || "customer");
  const adminId = role === "admin" && req.admin?.id ? req.admin.id : null;
  const customerId = role !== "admin" && req.customer?.id ? req.customer.id : null;
  if (role === "admin" && !adminId) {
    return res.status(401).json({ error: "Admin session required." });
  }
  // Guest customer push not supported — need an account
  if (role !== "admin" && !customerId) {
    return res.status(401).json({ error: "Sign in to enable order alerts." });
  }

  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, admin_id, customer_id, user_agent, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       admin_id = COALESCE(EXCLUDED.admin_id, push_subscriptions.admin_id),
       customer_id = COALESCE(EXCLUDED.customer_id, push_subscriptions.customer_id),
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

router.post("/unsubscribe", asyncHandler(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  res.json({ ok: true });
}));

// Admin test ping
router.post("/test", asyncHandler(async (req, res) => {
  if (!req.admin?.id) return res.status(401).json({ error: "Admin only." });
  if (!isPushConfigured()) return res.status(503).json({ error: "Push not configured." });
  initPush();
  const result = await notifyAdmins({
    title: "ĀKĀRA · Test",
    body: "Push alerts are working.",
    url: "/admin",
  });
  res.json(result);
}));

export default router;

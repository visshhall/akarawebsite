import webpush from "web-push";
import { query } from "./db.js";

let configured = false;

export function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@akaraonline.co.in";
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured() {
  return configured || !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Send to all admin subscribers */
export async function notifyAdmins(payload) {
  if (!isPushConfigured()) return { sent: 0 };
  if (!configured) initPush();
  const { rows } = await query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id IS NOT NULL`
  );
  return sendToRows(rows, payload);
}

/** Send to a customer's subscriptions */
export async function notifyCustomer(customerId, payload) {
  if (!customerId || !isPushConfigured()) return { sent: 0 };
  if (!configured) initPush();
  const { rows } = await query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE customer_id = $1`,
    [customerId]
  );
  return sendToRows(rows, payload);
}

async function sendToRows(rows, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  let sent = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body
      );
      sent += 1;
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]).catch(() => {});
      }
    }
  }
  return { sent };
}

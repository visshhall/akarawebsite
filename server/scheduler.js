// ============================================================================
// SCHEDULER — in-process jobs for a single Railway instance.
// 1) Abandoned *checkout* (pending payment order rows)
// 2) Abandoned *cart* (logged-in cart_items left sitting)
// 3) Post-delivery care note
// ============================================================================
import { query } from "./db.js";
import {
  sendAbandonedCheckoutEmail,
  sendAbandonedCartEmail,
  sendPostDeliveryCareEmail,
} from "./email.js";

const MIN_AGE_HOURS = 1;
const MAX_AGE_HOURS = 48;
const CART_MIN_HOURS = 4;
const CART_MAX_HOURS = 72;
const CARE_MIN_DAYS = 5;
const CARE_MAX_DAYS = 14;

export async function checkAbandonedCheckouts() {
  const { rows } = await query(
    `SELECT * FROM orders
     WHERE payment_status = 'pending'
       AND abandoned_reminder_sent_at IS NULL
       AND placed_at < now() - interval '${MIN_AGE_HOURS} hours'
       AND placed_at > now() - interval '${MAX_AGE_HOURS} hours'`
  );
  let sentCount = 0;
  for (const row of rows) {
    const order = {
      orderNumber: row.order_number,
      email: row.email,
      items: Array.isArray(row.items) ? row.items : (typeof row.items === "string" ? safeJson(row.items) : []),
      total: row.total,
    };
    const result = await sendAbandonedCheckoutEmail(order);
    await query("UPDATE orders SET abandoned_reminder_sent_at = now() WHERE order_number = $1", [
      row.order_number,
    ]);
    if (result?.ok !== false) sentCount++;
  }
  return sentCount;
}

/** Logged-in server cart still has lines and was not touched recently. */
export async function checkAbandonedCarts() {
  // Customers with cart lines whose newest line is older than CART_MIN_HOURS
  // and newer than CART_MAX_HOURS, and we have not already emailed them for this "wave".
  // Reset abandoned_cart_reminder_sent_at when cart is updated (see cart.js PUT/merge).
  const { rows } = await query(
    `SELECT c.id, c.email, c.name, c.abandoned_cart_reminder_sent_at,
            MAX(ci.updated_at) AS last_cart_at
     FROM customers c
     INNER JOIN cart_items ci ON ci.customer_id = c.id
     WHERE c.email IS NOT NULL
     GROUP BY c.id, c.email, c.name, c.abandoned_cart_reminder_sent_at
     HAVING MAX(ci.updated_at) < now() - interval '${CART_MIN_HOURS} hours'
        AND MAX(ci.updated_at) > now() - interval '${CART_MAX_HOURS} hours'
        AND (c.abandoned_cart_reminder_sent_at IS NULL
             OR c.abandoned_cart_reminder_sent_at < MAX(ci.updated_at))`
  );
  let sentCount = 0;
  for (const row of rows) {
    const { rows: items } = await query(
      `SELECT ci.product_id, ci.qty, ci.size, ci.color, p.name
       FROM cart_items ci
       LEFT JOIN products p ON p.id = ci.product_id
       WHERE ci.customer_id = $1
       ORDER BY ci.updated_at DESC
       LIMIT 8`,
      [row.id]
    );
    const result = await sendAbandonedCartEmail({
      email: row.email,
      name: row.name,
      items: items.map((i) => ({ name: i.name || i.product_id, qty: i.qty })),
    });
    await query("UPDATE customers SET abandoned_cart_reminder_sent_at = now() WHERE id = $1", [
      row.id,
    ]);
    if (result?.ok !== false) sentCount++;
  }
  return sentCount;
}

/** Delivered orders 5–14 days ago without a care email yet. */
export async function checkPostDeliveryCare() {
  const { rows } = await query(
    `SELECT * FROM orders
     WHERE status = 'delivered'
       AND care_email_sent_at IS NULL
       AND updated_at < now() - interval '${CARE_MIN_DAYS} days'
       AND updated_at > now() - interval '${CARE_MAX_DAYS} days'
       AND email IS NOT NULL`
  );
  let sentCount = 0;
  for (const row of rows) {
    let addr = row.shipping_address;
    if (typeof addr === "string") {
      try { addr = JSON.parse(addr); } catch { addr = {}; }
    }
    const order = {
      orderNumber: row.order_number,
      email: row.email,
      name: (addr && addr.name) || "",
    };
    await sendPostDeliveryCareEmail(order);
    await query("UPDATE orders SET care_email_sent_at = now() WHERE order_number = $1", [
      row.order_number,
    ]);
    sentCount++;
  }
  return sentCount;
}

function safeJson(s) {
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function startScheduler() {
  const HOUR = 60 * 60 * 1000;
  const run = async () => {
    try {
      const a = await checkAbandonedCheckouts();
      const b = await checkAbandonedCarts();
      const c = await checkPostDeliveryCare();
      if (a || b || c) {
        console.log(`[scheduler] abandonedCheckout=${a} abandonedCart=${b} care=${c}`);
      }
    } catch (err) {
      console.error("[scheduler] run failed:", err.message);
    }
  };
  // First run after 2 minutes, then hourly
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, HOUR);
  console.log("[scheduler] started (abandoned checkout/cart + post-delivery care)");
}

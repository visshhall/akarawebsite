// ============================================================================
// SCHEDULER — currently does exactly one job: find checkouts that were
// started (a real order row exists, payment_status='pending') but never
// completed, and send one gentle reminder email each. Runs as a simple
// in-process interval rather than a separate cron service — appropriate
// for this app's actual scale (a single Railway instance), not something
// that needs external infrastructure.
//
// checkAbandonedCheckouts() is exported separately from the interval
// setup specifically so it can be called directly and awaited in tests —
// there's no reasonable way to test a real setInterval-based job by
// actually waiting for it to fire.
// ============================================================================
import { query } from "./db.js";
import { sendAbandonedCheckoutEmail } from "./email.js";

// Window: don't nag someone within the first hour (they might just be
// mid-checkout, still filling in their address) and don't bother reaching
// out to someone who abandoned something 3 days ago — that reminder reads
// as spam, not a helpful nudge. Tune these two numbers, not the query
// logic, if the timing ever needs to change.
const MIN_AGE_HOURS = 1;
const MAX_AGE_HOURS = 48;

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
      orderNumber: row.order_number, email: row.email, items: row.items, total: row.total,
    };
    const result = await sendAbandonedCheckoutEmail(order);
    // Marks it sent regardless of whether the email itself succeeded —
    // deliberate: a transient email-provider failure shouldn't cause the
    // SAME reminder to be attempted again on every future run forever.
    // One honest attempt, not a retry loop.
    await query("UPDATE orders SET abandoned_reminder_sent_at = now() WHERE order_number = $1", [row.order_number]);
    if (result?.ok) sentCount++;
  }
  return { checkedCount: rows.length, sentCount };
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

export function startScheduler() {
  setInterval(() => {
    checkAbandonedCheckouts().catch(err => console.error("[scheduler] Abandoned checkout check failed:", err.message));
  }, CHECK_INTERVAL_MS);
}

// Attempts a real, full refund via Razorpay for a paid order being
// cancelled. This is deliberately NOT fire-and-forget like the email
// sends elsewhere in this app — a failed refund is real money stuck
// somewhere, not a missed notification, so the outcome is always
// recorded, and a failure is surfaced (via the admin activity log)
// rather than silently swallowed.
//
// Only ever acts on an order that is actually paid — an order that was
// never paid (payment_status='pending'/'failed') has nothing to refund,
// and this correctly does nothing in that case rather than erroring.
import { query } from "./db.js";
import { createRazorpayRefund } from "./razorpay.js";
import { logAdminAction } from "./adminAuth.js";

export async function refundOrderIfPaid(orderRow, { adminId = null } = {}) {
  if (orderRow.payment_status !== "paid") {
    return { attempted: false };
  }
  if (!orderRow.razorpay_payment_id) {
    // Shouldn't happen for a genuinely paid order, but a paid order with
    // no recorded payment ID has nothing to refund against — logged so
    // it doesn't disappear silently.
    await logAdminAction(adminId, "order.refund_skipped_no_payment_id", { orderNumber: orderRow.order_number });
    return { attempted: false };
  }

  try {
    const refund = await createRazorpayRefund(
      orderRow.razorpay_payment_id,
      Math.round(orderRow.total * 100), // rupees -> paise, same conversion used everywhere else money touches Razorpay
      { order_number: orderRow.order_number, reason: "order_cancelled" }
    );
    await query(
      "UPDATE orders SET payment_status='refunded', razorpay_refund_id=$1, updated_at=now() WHERE order_number=$2",
      [refund.id, orderRow.order_number]
    );
    await logAdminAction(adminId, "order.refund_succeeded", { orderNumber: orderRow.order_number, refundId: refund.id, amount: orderRow.total });
    return { attempted: true, success: true, refundId: refund.id };
  } catch (err) {
    // Deliberately does NOT change payment_status on failure — it stays
    // 'paid', which is the honest state (the money was never actually
    // returned), rather than a new ambiguous status. The activity log
    // entry is what makes this visible to an admin instead of vanishing.
    console.error(`[refund] Failed for order ${orderRow.order_number}:`, err.message);
    await logAdminAction(adminId, "order.refund_failed", { orderNumber: orderRow.order_number, error: err.message });
    return { attempted: true, success: false, error: err.message };
  }
}

/**
 * Partial refund in rupees (converted to paise for Razorpay).
 * Marks payment_status refunded only when cumulative >= total.
 */
export async function refundOrderPartial(orderRow, amountRupees, { adminId = null, reason = "" } = {}) {
  const amount = Math.round(Number(amountRupees) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { attempted: false, success: false, error: "Invalid refund amount." };
  }
  const already = Number(orderRow.amount_refunded || 0);
  const total = Number(orderRow.total || 0);
  const remaining = Math.round((total - already) * 100) / 100;
  if (amount > remaining + 0.001) {
    return { attempted: false, success: false, error: `Amount exceeds remaining ₹${remaining.toLocaleString("en-IN")}.` };
  }
  if (orderRow.payment_status !== "paid" && orderRow.payment_status !== "partially_refunded") {
    return { attempted: false, success: false, error: "Order is not in a refundable paid state." };
  }
  if (!orderRow.razorpay_payment_id) {
    if (adminId) await logAdminAction(adminId, "order.refund_skipped_no_payment_id", { orderNumber: orderRow.order_number });
    return { attempted: true, success: false, error: "No Razorpay payment ID on this order." };
  }
  try {
    const refund = await createRazorpayRefund(
      orderRow.razorpay_payment_id,
      Math.round(amount * 100),
      { order_number: orderRow.order_number, reason: String(reason || "partial_refund").slice(0, 100) }
    );
    const newRefunded = Math.round((already + amount) * 100) / 100;
    const fully = newRefunded >= total - 0.001;
    await query(
      `UPDATE orders SET
         amount_refunded = $1,
         payment_status = $2,
         razorpay_refund_id = COALESCE($3, razorpay_refund_id),
         updated_at = now()
       WHERE order_number = $4`,
      [newRefunded, fully ? "refunded" : "partially_refunded", refund.id, orderRow.order_number]
    );
    if (adminId) {
      await logAdminAction(adminId, "order.partial_refund", {
        orderNumber: orderRow.order_number,
        amount,
        refundId: refund.id,
        fully,
      });
    }
    return { attempted: true, success: true, refundId: refund.id, amount, fully, amountRefunded: newRefunded };
  } catch (err) {
    console.error(`[refund partial] ${orderRow.order_number}:`, err.message);
    if (adminId) await logAdminAction(adminId, "order.refund_failed", { orderNumber: orderRow.order_number, error: err.message, partial: true });
    return { attempted: true, success: false, error: err.message };
  }
}

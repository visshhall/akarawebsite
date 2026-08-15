import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin, logAdminAction } from "../../adminAuth.js";

const router = Router();
const VALID_STATUS = ["confirmed", "production", "qc", "dispatched", "delivered", "cancelled"];

// GET /api/admin/orders — every order in the system, most recent first.
// Unlike the customer-facing GET /api/orders (which only ever returns the
// logged-in customer's own orders), this has no ownership filter — that's
// exactly why it's admin-only.
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders ORDER BY placed_at DESC LIMIT 200");
  res.json({ orders: rows.map(toAdminOrder) });
}));

router.get("/:orderNumber", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders WHERE order_number=$1", [req.params.orderNumber]);
  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });
  res.json({ order: toAdminOrder(rows[0]) });
}));

// PATCH /api/admin/orders/:orderNumber/status — this is what turns the
// "5-stage tracking" the frontend already displays from a simulated,
// elapsed-time guess into something a real person actually set.
router.patch("/:orderNumber/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUS.join(", ")}` });
  }

  const { rows: existingRows } = await query("SELECT status FROM orders WHERE order_number=$1", [req.params.orderNumber]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Order not found." });

  const { rows } = await query(
    "UPDATE orders SET status=$1, updated_at=now() WHERE order_number=$2 RETURNING *",
    [status, req.params.orderNumber]
  );
  await logAdminAction(req.admin.id, "order.status_change", {
    orderNumber: req.params.orderNumber, from: existingRows[0].status, to: status,
  });
  res.json({ order: toAdminOrder(rows[0]) });
}));

function toAdminOrder(row) {
  return {
    orderNumber: row.order_number,
    customerId: row.customer_id,
    email: row.email,
    phone: row.phone,
    items: row.items,
    shippingAddress: row.shipping_address,
    subtotal: row.subtotal,
    discount: row.discount,
    couponCode: row.coupon_code,
    shippingCost: row.shipping_cost,
    cgst: row.cgst,
    sgst: row.sgst,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    placedAt: new Date(row.placed_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export default router;

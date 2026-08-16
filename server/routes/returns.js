import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";
import { sanitize, validEmail, normalizePhone, validIndianPhone } from "../validate.js";

const router = Router();

// POST /api/returns — replaces the old mailto: link, which could never
// support a photo attachment (a fundamental limitation of the mailto:
// protocol, not something fixable client-side). Requires login and
// verifies the order actually belongs to the requesting customer — a
// return request can't be filed against someone else's order number.
// photoUrl, if present, must already be a URL from this app's own
// /uploads/ path (i.e. a file that went through the real upload security
// pipeline — magic-byte checking, size limits, metadata stripping — see
// server/upload.js) — never an arbitrary external URL.
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { orderNumber, itemName, reason, description, contactEmail, contactPhone, photoUrl } = req.body || {};

  const errors = {};
  if (!orderNumber || !sanitize(orderNumber).trim()) errors.orderNumber = "Required";
  if (!itemName || !sanitize(itemName).trim()) errors.itemName = "Required";
  if (!reason || !sanitize(reason).trim()) errors.reason = "Required";
  if (!description || !sanitize(description).trim()) errors.description = "Required";
  if (!validEmail(contactEmail)) errors.contactEmail = "Valid email required";
  if (!validIndianPhone(normalizePhone(contactPhone || ""))) errors.contactPhone = "Valid 10-digit mobile number required";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fill in all required fields correctly.", fields: errors });

  // Ownership check — the order must actually belong to whoever is
  // submitting this request, same principle as every other order-scoped
  // endpoint in this app.
  const { rows: orderRows } = await query(
    "SELECT id FROM orders WHERE order_number=$1 AND customer_id=$2",
    [sanitize(orderNumber).trim(), req.customer.id]
  );
  if (orderRows.length === 0) {
    return res.status(404).json({ error: "We couldn't find that order number on your account. Please double-check it." });
  }

  let safePhotoUrl = null;
  if (typeof photoUrl === "string" && photoUrl.startsWith("/uploads/")) {
    safePhotoUrl = photoUrl;
  }

  const { rows } = await query(
    `INSERT INTO return_requests (customer_id, order_number, item_name, reason, description, contact_email, contact_phone, photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      req.customer.id, sanitize(orderNumber).trim(), sanitize(itemName).slice(0,200), sanitize(reason).slice(0,100),
      sanitize(description).slice(0,2000), sanitize(contactEmail), normalizePhone(contactPhone), safePhotoUrl,
    ]
  );
  res.status(201).json({ returnRequest: toFrontend(rows[0]) });
}));

function toFrontend(row) {
  return {
    id: row.id, orderNumber: row.order_number, itemName: row.item_name, reason: row.reason,
    description: row.description, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    photoUrl: row.photo_url, status: row.status, createdAt: new Date(row.created_at).getTime(),
  };
}

export default router;

import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";
import { sanitize, normalizePhone, validIndianPhone } from "../validate.js";

const router = Router();

// GET /api/addresses — every saved address belonging to the logged-in
// customer. Scoped strictly by customer_id — never returns another
// customer's addresses regardless of what's requested.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM addresses WHERE customer_id=$1 ORDER BY created_at DESC", [req.customer.id]);
  res.json({ addresses: rows.map(toFrontendAddress) });
}));

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { name, line, city, state, pin, phone } = req.body || {};
  const error = validateAddressFields({ name, line, city, pin, phone });
  if (error) return res.status(400).json({ error });

  const { rows } = await query(
    `INSERT INTO addresses (customer_id, name, line, city, state, pin, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.customer.id, sanitize(name).slice(0,200), sanitize(line).slice(0,300), sanitize(city).slice(0,100), sanitize(state||"").slice(0,100), sanitize(pin).slice(0,6), normalizePhone(phone)]
  );
  res.status(201).json({ address: toFrontendAddress(rows[0]) });
}));

router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  const { name, line, city, state, pin, phone } = req.body || {};
  const error = validateAddressFields({ name, line, city, pin, phone });
  if (error) return res.status(400).json({ error });

  const { rows } = await query(
    `UPDATE addresses SET name=$1, line=$2, city=$3, state=$4, pin=$5, phone=$6
     WHERE id=$7 AND customer_id=$8 RETURNING *`,
    [sanitize(name).slice(0,200), sanitize(line).slice(0,300), sanitize(city).slice(0,100), sanitize(state||"").slice(0,100), sanitize(pin).slice(0,6), normalizePhone(phone), req.params.id, req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Address not found." });
  res.json({ address: toFrontendAddress(rows[0]) });
}));

// DELETE requires ownership too (WHERE customer_id=$2) — without this, a
// logged-in customer could delete ANY address by guessing IDs, not just
// their own.
router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("DELETE FROM addresses WHERE id=$1 AND customer_id=$2 RETURNING id", [req.params.id, req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Address not found." });
  res.json({ ok: true });
}));

function validateAddressFields({ name, line, city, pin, phone }) {
  if (!name || !sanitize(name).trim()) return "Name is required.";
  if (!line || !sanitize(line).trim()) return "Address line is required.";
  if (!city || !sanitize(city).trim()) return "City is required.";
  if (!pin || !/^\d{6}$/.test(pin)) return "A valid 6-digit PIN code is required.";
  if (!validIndianPhone(normalizePhone(phone || ""))) return "A valid 10-digit Indian mobile number is required — needed to actually deliver the parcel.";
  return null;
}

function toFrontendAddress(row) {
  return { id: row.id, name: row.name, line: row.line, city: row.city, state: row.state, pin: row.pin, phone: row.phone };
}

export default router;

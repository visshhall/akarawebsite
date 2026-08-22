import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { sanitize, validEmail, normalizePhone, validIndianPhone } from "../validate.js";
import { sendContactNotificationEmail } from "../email.js";

const router = Router();

// POST /api/contact — public, no login required, matching how a "contact
// us" form should work. Stores every submission for a real record, and
// notifies the business by email so a message doesn't just sit
// unnoticed in a database table.
router.post("/", asyncHandler(async (req, res) => {
  const { name, email, phone, message } = req.body || {};
  const errors = {};
  if (!sanitize(name || "").trim()) errors.name = "Required";
  if (!validEmail(email)) errors.email = "Valid email required";
  if (!validIndianPhone(normalizePhone(phone || ""))) errors.phone = "Valid 10-digit mobile number required";
  if (sanitize(message || "").trim().length < 240) errors.message = "Please tell us a bit more — at least 240 characters.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const cleanName = sanitize(name).trim().slice(0, 200);
  const cleanMessage = sanitize(message).trim().slice(0, 2000);
  const cleanPhone = normalizePhone(phone);

  await query(
    "INSERT INTO contact_submissions (name, email, phone, message) VALUES ($1,$2,$3,$4)",
    [cleanName, email, cleanPhone, cleanMessage]
  );

  // Fire-and-forget, matching every other notification email in this
  // app — a failed notification must never fail the customer's
  // confirmation, since the message is already safely stored either way.
  sendContactNotificationEmail({ name: cleanName, email, phone: cleanPhone, message: cleanMessage });

  res.status(201).json({ ok: true });
}));

export default router;

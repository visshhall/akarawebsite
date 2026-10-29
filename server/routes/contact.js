import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { sanitize, validEmail, normalizePhone, validIndianPhone, validPersonName, cleanPersonName, validMessage, cleanMessage } from "../validate.js";
import { sendContactNotificationEmail } from "../email.js";
import { publicFormRateLimit } from "../rateLimit.js";
import { requireTurnstile } from "../turnstile.js";

const router = Router();

// POST /api/contact — public, no login required, matching how a "contact
// us" form should work. Stores every submission for a real record, and
// notifies the business by email so a message doesn't just sit
// unnoticed in a database table.
router.post("/", publicFormRateLimit, requireTurnstile, asyncHandler(async (req, res) => {
  const { name, email, phone, message } = req.body || {};
  const errors = {};
  if (!validPersonName(name)) errors.name = "Enter a valid name (letters only).";
  if (!validEmail(email)) errors.email = "Valid email required";
  if (!validIndianPhone(normalizePhone(phone || ""))) errors.phone = "Valid 10-digit mobile number required";
  if (!validMessage(message, { min: 240, max: 2000 })) errors.message = "Please tell us a bit more — at least 240 characters, no scripts.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const personName = cleanPersonName(name);
  const msgBody = cleanMessage(message, 2000);
  const cleanPhone = normalizePhone(phone);
  const cleanEmail = String(email).trim().toLowerCase().slice(0, 200);

  await query(
    "INSERT INTO contact_submissions (name, email, phone, message) VALUES ($1,$2,$3,$4)",
    [personName, cleanEmail, cleanPhone, msgBody]
  );

  sendContactNotificationEmail({ name: personName, email: cleanEmail, phone: cleanPhone, message: msgBody });

  res.status(201).json({ ok: true });
}));

export default router;

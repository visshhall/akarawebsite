import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { sanitize, validEmail, normalizePhone, validIndianPhone, validPersonName, cleanPersonName, validMessage, cleanMessage } from "../validate.js";
import { sendBulkOrderNotificationEmail } from "../email.js";
import { publicFormRateLimit } from "../rateLimit.js";
import { requireTurnstile } from "../turnstile.js";

const router = Router();

// POST /api/bulk-orders — public, no login required. Was previously a
// raw mailto: link with no real delivery guarantee — on a phone with no
// email client configured, submitting did nothing visible at all while
// the page still claimed success. Same shape as /api/contact: stores
// every submission for a real record, then notifies the business by
// email so nothing just sits unnoticed.
router.post("/", publicFormRateLimit, requireTurnstile, asyncHandler(async (req, res) => {
  const { company, name, email, phone, quantity, interest, message } = req.body || {};
  const errors = {};
  if (!validPersonName(name)) errors.name = "Enter a valid name (letters only).";
  if (!validEmail(email)) errors.email = "Valid email required";
  if (!validIndianPhone(normalizePhone(phone || ""))) errors.phone = "Valid 10-digit mobile number required";
  if (!sanitize(quantity || "").trim()) errors.quantity = "Required";
  if (!validMessage(message, { min: 240, max: 2000 })) errors.message = "Please tell us a bit more — at least 240 characters.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const cleanCompany = sanitize(company || "").trim().slice(0, 200);
  const cleanName = cleanPersonName(name);
  const cleanPhone = normalizePhone(phone);
  const cleanQuantity = sanitize(quantity).trim().slice(0, 100);
  const cleanInterest = sanitize(interest || "").trim().slice(0, 200);
  const cleanMessageBody = cleanMessage(message, 2000);

  await query(
    "INSERT INTO bulk_order_enquiries (company, name, email, phone, quantity, interest, message) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [cleanCompany || null, cleanName, email, cleanPhone, cleanQuantity, cleanInterest || null, cleanMessageBody]
  );

  // Fire-and-forget, matching every other notification email in this
  // app — a failed notification must never fail the customer's
  // confirmation, since the enquiry is already safely stored either way.
  sendBulkOrderNotificationEmail({ company: cleanCompany, name: cleanName, email, phone: cleanPhone, quantity: cleanQuantity, interest: cleanInterest, message: cleanMessageBody });

  res.status(201).json({ ok: true });
}));

export default router;

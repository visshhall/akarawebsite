import { Router } from "express";
import crypto from "crypto";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { validEmail, validIndianPhone, normalizePhone, sanitize } from "../validate.js";
import {
  hashPassword, verifyPassword, signToken,
  setSessionCookie, clearSessionCookie, loginRateLimit, requireAuth,
} from "../auth.js";
import { sendPasswordResetEmail, sendPhoneChangeOTPEmail, sendEmailChangeOTPEmail } from "../email.js";
import { publicFormRateLimit, otpVerifyRateLimit } from "../rateLimit.js";

const SITE_URL = process.env.SITE_URL || "https://www.akaraonline.co.in";

const router = Router();

function passwordOk(pw = "") {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

router.post("/signup", asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 1) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  // Mirrors the frontend's phone requirement — the frontend marks this
  // field required, but until now the backend silently accepted signups
  // with no phone at all or with a garbage value, since it's the backend
  // that actually enforces anything (the frontend check is bypassable by
  // sending the request directly).
  const normalizedPhone = normalizePhone(phone);
  if (!validIndianPhone(normalizedPhone)) {
    return res.status(400).json({ error: "A valid 10-digit Indian mobile number is required." });
  }
  if (!passwordOk(password)) {
    return res.status(400).json({
      error: "Password must be 8+ characters with an uppercase letter, a number, and a special character.",
    });
  }

  const existingEmail = await query("SELECT id FROM customers WHERE email = $1", [email.toLowerCase()]);
  if (existingEmail.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  const existingPhone = await query("SELECT id FROM customers WHERE phone = $1", [normalizedPhone]);
  if (existingPhone.rows.length > 0) {
    return res.status(409).json({ error: "An account with this mobile number already exists." });
  }

  const passwordHash = await hashPassword(password);
  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO customers (name, email, phone, password_hash)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
      [name.trim(), email.toLowerCase(), normalizedPhone, passwordHash]
    ));
  } catch (err) {
    // Belt-and-suspenders: the SELECT checks above cover the normal case,
    // but a second signup for the same email/phone submitted in the same
    // instant (a genuine race condition, not something a single request
    // can trigger on its own) could slip past both SELECTs before either
    // INSERT completes. The database's own UNIQUE constraints are the
    // real, unbypassable backstop — this just turns that low-level
    // Postgres error into the same friendly message instead of a 500.
    if (err.code === "23505") { // unique_violation
      const field = err.constraint === "customers_phone_key" ? "mobile number" : "email";
      return res.status(409).json({ error: `An account with this ${field} already exists.` });
    }
    throw err;
  }
  const customer = rows[0];
  const token = signToken(customer);
  setSessionCookie(res, token);
  res.status(201).json({ customer });
}));

router.post("/login", loginRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { rows } = await query(
    "SELECT id, name, email, password_hash FROM customers WHERE email = $1",
    [email.toLowerCase()]
  );
  // Deliberately identical error for "no such account" and "wrong password"
  // — a different message for each would let someone enumerate which
  // emails have accounts, just by trying logins.
  const invalid = () => res.status(401).json({ error: "Incorrect email or password." });
  if (rows.length === 0) return invalid();

  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return invalid();

  const customer = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
  const token = signToken(customer);
  setSessionCookie(res, token);
  res.json({ customer });
}));

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT id, name, email, phone FROM customers WHERE id = $1",
    [req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  res.json({ customer: rows[0] });
}));

// PUT /api/auth/profile — found during a proactive bug sweep: the
// Profile tab's Name and Email fields rendered exactly like every other
// editable field on the site, but had a no-op onChange handler — typing
// into them silently did nothing, with no indication they were read-only.
// This makes name genuinely editable. Email is deliberately left
// read-only here (not wired to this endpoint) — changing a login email
// safely usually needs its own re-verification step, which is a bigger
// piece of work than this fix; the frontend now marks it disabled rather
// than pretending it's editable.
router.put("/profile", requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const { rows } = await query(
    "UPDATE customers SET name=$1 WHERE id=$2 RETURNING id, name, email, phone",
    [name.trim().slice(0, 200), req.customer.id]
  );
  res.json({ customer: rows[0] });
}));

// PUT /api/auth/password — a real "change password while logged in" flow,
// mirroring the same one already built for admin accounts
// (server/routes/admin/auth.js). Previously the only option here was a
// button that navigated to the "email me a reset link" flow — which
// doesn't even send a real email yet — even though the customer is
// already authenticated and could just prove their current password
// instead. Requires the CURRENT password for the same reason the admin
// version does: without it, a briefly-unattended logged-in session could
// be used to lock the real account owner out.
router.put("/password", requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are both required." });
  }
  if (!passwordOk(newPassword)) {
    return res.status(400).json({ error: "New password must be 8+ characters with an uppercase letter, a number, and a special character." });
  }

  const { rows } = await query("SELECT password_hash FROM customers WHERE id=$1", [req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });

  const ok = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect." });

  const newHash = await hashPassword(newPassword);
  await query("UPDATE customers SET password_hash=$1 WHERE id=$2", [newHash, req.customer.id]);
  res.json({ ok: true });
}));

// POST /api/auth/forgot-password — the piece that was completely missing.
// Deliberately responds with the exact same message whether or not the
// email actually has an account (prevents using this endpoint to check
// which emails are registered). Rate-limited with the same limiter as
// login, for the same reason — this could otherwise be used to spam a
// real customer's inbox with reset emails.
router.post("/forgot-password", loginRateLimit, asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ error: "A valid email is required." });

  const { rows } = await query("SELECT id FROM customers WHERE email=$1", [email.trim().toLowerCase()]);
  if (rows.length > 0) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await query(
      "UPDATE customers SET reset_token_hash=$1, reset_token_expires=now() + interval '1 hour' WHERE id=$2",
      [tokenHash, rows[0].id]
    );
    sendPasswordResetEmail(email.trim().toLowerCase(), `${SITE_URL}/reset-password?token=${token}`);
  }
  // Always the same response, found or not.
  res.json({ ok: true });
}));

// POST /api/auth/reset-password — validates the token the same way
// (hash it, compare), enforces expiry, and clears the token on success
// so the same link can never be used a second time.
router.post("/reset-password", asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Invalid or missing reset token." });
  if (!passwordOk(newPassword)) {
    return res.status(400).json({ error: "Password must be 8+ characters with an uppercase letter, a number, and a special character." });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { rows } = await query(
    "SELECT id FROM customers WHERE reset_token_hash=$1 AND reset_token_expires > now()",
    [tokenHash]
  );
  if (rows.length === 0) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  }

  const newHash = await hashPassword(newPassword);
  await query(
    "UPDATE customers SET password_hash=$1, reset_token_hash=NULL, reset_token_expires=NULL WHERE id=$2",
    [newHash, rows[0].id]
  );
  res.json({ ok: true });
}));

// POST /api/auth/phone-change/request — starts a phone number change.
// Requires being logged in (this changes YOUR OWN account, not a
// lookup-by-email flow like password reset) — the phone belongs to
// whoever's already authenticated, not something proven by knowing an
// email address. publicFormRateLimit here, not the stricter
// otpVerifyRateLimit below — this is the "send me a code" side, not
// the "guess the code" side; those need different limits.
router.post("/phone-change/request", requireAuth, publicFormRateLimit, asyncHandler(async (req, res) => {
  const { phone } = req.body || {};
  const cleanPhone = normalizePhone(phone || "");
  if (!validIndianPhone(cleanPhone)) return res.status(400).json({ error: "A valid 10-digit mobile number is required." });

  // A 6-digit code, not a long cryptographic token like password
  // reset's — this one gets manually typed by a real person reading
  // their email, so it has to stay short and readable. Still hashed
  // before storage, same as every other token in this app; the OTP
  // itself is never held anywhere in plain form once this line runs.
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

  await query(
    `UPDATE customers SET pending_phone=$1, phone_otp_hash=$2,
     phone_otp_expires=now() + interval '10 minutes', phone_otp_attempts=0
     WHERE id=$3`,
    [cleanPhone, otpHash, req.customer.id]
  );

  // Sent to the account's EXISTING, already-verified email (from the
  // JWT payload — req.customer.email — not a fresh DB lookup, since
  // signToken() already embeds it), not the new phone number. Delivers
  // to a channel already tied to this logged-in customer, rather than
  // trying to prove anything about the phone itself via email.
  const result = await sendPhoneChangeOTPEmail(req.customer.email, otp);
  // Genuinely different from password reset's fixed, enumeration-safe
  // response — there's no email-enumeration risk to guard against here
  // (the customer is already authenticated and this is THEIR own
  // account's email), so telling them plainly if the send failed is
  // more useful than a vague blanket "ok: true" would be.
  if (result?.skipped || result?.ok === false) {
    return res.status(502).json({ error: "Couldn't send the verification code right now. Please try again in a moment." });
  }
  res.json({ ok: true });
}));

// POST /api/auth/phone-change/verify — confirms the code and actually
// swaps the phone number over. otpVerifyRateLimit (stricter, per-IP) is
// the first layer; phone_otp_attempts (per-account, in the database) is
// the second, independent one — five wrong tries on the SAME pending
// change invalidates it entirely, forcing a fresh code rather than
// leaving a long-lived guessing window open.
router.post("/phone-change/verify", requireAuth, otpVerifyRateLimit, asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!/^\d{6}$/.test(code || "")) return res.status(400).json({ error: "Enter the 6-digit code." });

  const { rows } = await query(
    "SELECT pending_phone, phone_otp_hash, phone_otp_expires, phone_otp_attempts FROM customers WHERE id=$1",
    [req.customer.id]
  );
  const row = rows[0];
  if (!row?.pending_phone || !row.phone_otp_hash) {
    return res.status(400).json({ error: "No phone change is in progress. Please request a new code." });
  }
  if (new Date(row.phone_otp_expires) < new Date()) {
    await query("UPDATE customers SET pending_phone=NULL, phone_otp_hash=NULL, phone_otp_expires=NULL, phone_otp_attempts=0 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "This code has expired. Please request a new one." });
  }
  if (row.phone_otp_attempts >= 5) {
    await query("UPDATE customers SET pending_phone=NULL, phone_otp_hash=NULL, phone_otp_expires=NULL, phone_otp_attempts=0 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  if (codeHash !== row.phone_otp_hash) {
    await query("UPDATE customers SET phone_otp_attempts=phone_otp_attempts+1 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "That code isn't correct. Please try again." });
  }

  const { rows: updated } = await query(
    `UPDATE customers SET phone=pending_phone, pending_phone=NULL, phone_otp_hash=NULL,
     phone_otp_expires=NULL, phone_otp_attempts=0 WHERE id=$1 RETURNING phone`,
    [req.customer.id]
  );
  res.json({ ok: true, phone: updated[0].phone });
}));

// POST /api/auth/email-change/request — starts an email address change.
// Requires being logged in — same reasoning as phone-change: this
// changes YOUR OWN account, not a lookup-by-anything-else flow.
// Genuinely different validation from phone: must also check the new
// email isn't already someone else's login — two customers can't share
// one email, so this has to be caught here, not just at final save
// time (finding out only after typing in a 6-digit code would be a
// real, avoidable dead end).
router.post("/email-change/request", requireAuth, publicFormRateLimit, asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = sanitize(email || "").trim().toLowerCase();
  if (!validEmail(cleanEmail)) return res.status(400).json({ error: "A valid email address is required." });

  const { rows: existing } = await query("SELECT id FROM customers WHERE email=$1 AND id != $2", [cleanEmail, req.customer.id]);
  if (existing.length > 0) return res.status(409).json({ error: "That email is already in use on another account." });

  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

  await query(
    `UPDATE customers SET pending_email=$1, email_otp_hash=$2,
     email_otp_expires=now() + interval '10 minutes', email_otp_attempts=0
     WHERE id=$3`,
    [cleanEmail, otpHash, req.customer.id]
  );

  // Sent to the NEW email — the whole point is proving the customer can
  // actually receive mail there, the opposite of phone-change's
  // existing-email delivery (see the comment on sendEmailChangeOTPEmail
  // in server/email.js for why the two flows differ this way).
  const result = await sendEmailChangeOTPEmail(cleanEmail, otp);
  if (result?.skipped || result?.ok === false) {
    return res.status(502).json({ error: "Couldn't send the verification code right now. Please try again in a moment." });
  }
  res.json({ ok: true });
}));

// POST /api/auth/email-change/verify — confirms the code and swaps the
// login email over. Same two-layer rate-limit shape as phone-change
// (otpVerifyRateLimit per-IP, email_otp_attempts per-account) and same
// 5-attempt lockout forcing a fresh code rather than an open-ended
// guessing window.
router.post("/email-change/verify", requireAuth, otpVerifyRateLimit, asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!/^\d{6}$/.test(code || "")) return res.status(400).json({ error: "Enter the 6-digit code." });

  const { rows } = await query(
    "SELECT pending_email, email_otp_hash, email_otp_expires, email_otp_attempts FROM customers WHERE id=$1",
    [req.customer.id]
  );
  const row = rows[0];
  if (!row?.pending_email || !row.email_otp_hash) {
    return res.status(400).json({ error: "No email change is in progress. Please request a new code." });
  }
  if (new Date(row.email_otp_expires) < new Date()) {
    await query("UPDATE customers SET pending_email=NULL, email_otp_hash=NULL, email_otp_expires=NULL, email_otp_attempts=0 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "This code has expired. Please request a new one." });
  }
  if (row.email_otp_attempts >= 5) {
    await query("UPDATE customers SET pending_email=NULL, email_otp_hash=NULL, email_otp_expires=NULL, email_otp_attempts=0 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  if (codeHash !== row.email_otp_hash) {
    await query("UPDATE customers SET email_otp_attempts=email_otp_attempts+1 WHERE id=$1", [req.customer.id]);
    return res.status(400).json({ error: "That code isn't correct. Please try again." });
  }

  // Re-checked here too, not just at request time — the new email could
  // theoretically have been claimed by someone else's signup in the
  // window between requesting this code and actually verifying it.
  const { rows: stillFree } = await query("SELECT id FROM customers WHERE email=$1 AND id != $2", [row.pending_email, req.customer.id]);
  if (stillFree.length > 0) {
    await query("UPDATE customers SET pending_email=NULL, email_otp_hash=NULL, email_otp_expires=NULL, email_otp_attempts=0 WHERE id=$1", [req.customer.id]);
    return res.status(409).json({ error: "That email was just claimed by another account. Please start again with a different address." });
  }

  const { rows: updated } = await query(
    `UPDATE customers SET email=pending_email, pending_email=NULL, email_otp_hash=NULL,
     email_otp_expires=NULL, email_otp_attempts=0 WHERE id=$1 RETURNING id, email`,
    [req.customer.id]
  );
  // Critical, easy to miss: the current session's own JWT still has the
  // OLD email embedded in it (signToken() bakes email into the token at
  // login) — every other place in this app that reads req.customer.email
  // directly (e.g. phone-change OTP delivery, which emails whatever
  // req.customer.email currently says) would keep using the stale old
  // address for the rest of this session if the cookie isn't reissued
  // right here, immediately after the actual database change succeeds.
  const newToken = signToken(updated[0]);
  setSessionCookie(res, newToken);
  res.json({ ok: true, email: updated[0].email });
}));

export default router;

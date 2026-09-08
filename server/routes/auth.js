import { Router } from "express";
import crypto from "crypto";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { validEmail, validIndianPhone, normalizePhone, sanitize } from "../validate.js";
import {
  hashPassword, verifyPassword, signToken,
  setSessionCookie, clearSessionCookie, loginRateLimit, requireAuth,
} from "../auth.js";
import { sendPasswordResetEmail, sendPhoneChangeOTPEmail, sendEmailChangeOTPEmail, sendSignupOTPEmail, sendWelcomeEmail } from "../email.js";
import { publicFormRateLimit, otpVerifyRateLimit } from "../rateLimit.js";
import { googleConfigured, verifyGoogleIdToken } from "../googleAuth.js";

const SITE_URL = process.env.SITE_URL || "https://www.akaraonline.co.in";

const router = Router();

function passwordOk(pw = "") {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// POST /api/auth/signup/request — step 1 of 2. Validates everything a
// normal signup already validated (name, email, phone, password,
// duplicate checks), but does NOT create a real customer row yet — it
// stages everything in pending_signups and sends an OTP to the typed
// email. Confirmed spec: a mistyped email must mean the person can
// never get past verification and never ends up with a real,
// half-created account — not a passive "verify whenever" link.
router.post("/signup/request", publicFormRateLimit, asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 1) {
    return res.status(400).json({ error: "Name is required." });
  }
  const cleanEmail = sanitize(email || "").trim().toLowerCase();
  if (!validEmail(cleanEmail)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  const normalizedPhone = normalizePhone(phone);
  if (!validIndianPhone(normalizedPhone)) {
    return res.status(400).json({ error: "A valid 10-digit Indian mobile number is required." });
  }
  if (!passwordOk(password)) {
    return res.status(400).json({
      error: "Password must be 8+ characters with an uppercase letter, a number, and a special character.",
    });
  }

  // Same duplicate checks as before, just run before staging rather than
  // before the final insert — no point sending someone an OTP for an
  // email/phone that can never actually become a new account.
  const existingEmail = await query("SELECT id FROM customers WHERE email = $1", [cleanEmail]);
  if (existingEmail.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  const existingPhone = await query("SELECT id FROM customers WHERE phone = $1", [normalizedPhone]);
  if (existingPhone.rows.length > 0) {
    return res.status(409).json({ error: "An account with this mobile number already exists." });
  }

  const passwordHash = await hashPassword(password);
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

  // ON CONFLICT — a repeat signup attempt with the same email
  // (e.g. they didn't finish verifying and tried again) REPLACES the
  // pending attempt rather than piling up rows or failing outright;
  // also resets otp_attempts, so an abandoned first try never leaves a
  // stale lockout behind on a genuine retry.
  await query(
    `INSERT INTO pending_signups (email, name, phone, password_hash, otp_hash, otp_expires, otp_attempts)
     VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes', 0)
     ON CONFLICT (email) DO UPDATE SET
       name=$2, phone=$3, password_hash=$4, otp_hash=$5,
       otp_expires=now() + interval '10 minutes', otp_attempts=0`,
    [cleanEmail, name.trim(), normalizedPhone, passwordHash, otpHash]
  );

  const result = await sendSignupOTPEmail(cleanEmail, otp);
  if (result?.skipped || result?.ok === false) {
    return res.status(502).json({ error: "Couldn't send the verification code right now. Please try again in a moment." });
  }
  res.json({ ok: true });
}));

// POST /api/auth/signup/verify — step 2 of 2. Confirms the code and
// ONLY THEN actually creates the real customer row — this is the
// moment an account genuinely starts to exist, not the request step
// above. Same two-layer rate-limit/lockout shape as phone/email-change
// verification (otpVerifyRateLimit per-IP, otp_attempts per-record).
router.post("/signup/verify", otpVerifyRateLimit, asyncHandler(async (req, res) => {
  const { email, code } = req.body || {};
  const cleanEmail = sanitize(email || "").trim().toLowerCase();
  if (!/^\d{6}$/.test(code || "")) return res.status(400).json({ error: "Enter the 6-digit code." });

  const { rows } = await query("SELECT * FROM pending_signups WHERE email=$1", [cleanEmail]);
  const pending = rows[0];
  if (!pending) {
    return res.status(400).json({ error: "No signup is in progress for this email. Please start again." });
  }
  if (new Date(pending.otp_expires) < new Date()) {
    await query("DELETE FROM pending_signups WHERE email=$1", [cleanEmail]);
    return res.status(400).json({ error: "This code has expired. Please start signing up again." });
  }
  if (pending.otp_attempts >= 5) {
    await query("DELETE FROM pending_signups WHERE email=$1", [cleanEmail]);
    return res.status(400).json({ error: "Too many incorrect attempts. Please start signing up again." });
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  if (codeHash !== pending.otp_hash) {
    await query("UPDATE pending_signups SET otp_attempts=otp_attempts+1 WHERE email=$1", [cleanEmail]);
    return res.status(400).json({ error: "That code isn't correct. Please try again." });
  }

  // Re-checked here too, not just at request time — someone else could
  // have genuinely claimed this exact email or phone in the window
  // between requesting the code and actually verifying it (e.g. two
  // people racing to sign up with the same email, unlikely but real).
  const dupeEmail = await query("SELECT id FROM customers WHERE email=$1", [cleanEmail]);
  if (dupeEmail.rows.length > 0) {
    await query("DELETE FROM pending_signups WHERE email=$1", [cleanEmail]);
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  const dupePhone = await query("SELECT id FROM customers WHERE phone=$1", [pending.phone]);
  if (dupePhone.rows.length > 0) {
    await query("DELETE FROM pending_signups WHERE email=$1", [cleanEmail]);
    return res.status(409).json({ error: "An account with this mobile number already exists." });
  }

  let rows2;
  try {
    ({ rows: rows2 } = await query(
      `INSERT INTO customers (name, email, phone, password_hash)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
      [pending.name, cleanEmail, pending.phone, pending.password_hash]
    ));
  } catch (err) {
    if (err.code === "23505") {
      const field = err.constraint === "customers_phone_key" ? "mobile number" : "email";
      return res.status(409).json({ error: `An account with this ${field} already exists.` });
    }
    throw err;
  }
  await query("DELETE FROM pending_signups WHERE email=$1", [cleanEmail]);

  const customer = rows2[0];
  const token = signToken(customer);
  setSessionCookie(res, token);
  // Fire-and-forget, same pattern as every other notification in this
  // app — a failed welcome email must never block the account that was
  // just genuinely, successfully created.
  sendWelcomeEmail(customer.email, customer.name);
  // Real, additive field for the mobile app — see the identical, real
  // comment on the login/Google routes above for the full reasoning.
  res.status(201).json({ customer, token });
}));


// GET /api/auth/google-config — public; tells the storefront whether
// Google sign-in is available and which client ID to use for GIS.
router.get("/google-config", (req, res) => {
  if (!googleConfigured()) return res.json({ enabled: false, clientId: null });
  res.json({ enabled: true, clientId: (process.env.GOOGLE_CLIENT_ID || "").trim() });
});

// POST /api/auth/google — verify Google ID token, upsert customer, set session.
router.post("/google", loginRateLimit, asyncHandler(async (req, res) => {
  const { credential, idToken } = req.body || {};
  const token = credential || idToken;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Google credential is required." });
  }
  let profile;
  try {
    profile = await verifyGoogleIdToken(token);
  } catch (err) {
    if (err.code === "NOT_CONFIGURED") {
      return res.status(503).json({ error: "Google sign-in is not available right now." });
    }
    if (err.code === "UNVERIFIED") {
      return res.status(401).json({ error: "Please use a verified Google account." });
    }
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }

  // 1) Existing Google link
  let { rows } = await query(
    "SELECT id, name, email, phone FROM customers WHERE google_id = $1",
    [profile.googleId]
  );

  // 2) Same email without google_id → link
  if (rows.length === 0) {
    const byEmail = await query(
      "SELECT id, name, email, phone, google_id FROM customers WHERE email = $1",
      [profile.email]
    );
    if (byEmail.rows.length > 0) {
      const existing = byEmail.rows[0];
      if (existing.google_id && existing.google_id !== profile.googleId) {
        return res.status(409).json({ error: "This email is already linked to a different Google account." });
      }
      await query(
        "UPDATE customers SET google_id = $1, name = COALESCE(NULLIF(name,''), $2) WHERE id = $3",
        [profile.googleId, profile.name, existing.id]
      );
      rows = (await query(
        "SELECT id, name, email, phone FROM customers WHERE id = $1",
        [existing.id]
      )).rows;
    }
  }

  // 3) New customer
  if (rows.length === 0) {
    const inserted = await query(
      `INSERT INTO customers (name, email, password_hash, google_id)
       VALUES ($1, $2, NULL, $3)
       RETURNING id, name, email, phone`,
      [profile.name, profile.email, profile.googleId]
    );
    rows = inserted.rows;
    // Welcome email is best-effort; don't block sign-in
    try {
      if (typeof sendWelcomeEmail === "function") {
        await sendWelcomeEmail(profile.email, profile.name);
      }
    } catch { /* ignore */ }
  }

  const customer = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
  const sessionToken = signToken(customer);
  setSessionCookie(res, sessionToken);
  // Real, additive field for the mobile app (see attachCustomer in
  // server/auth.js) — the exact same real, signed token already used
  // for the cookie above, just also returned in the real JSON body so
  // a real, native client with no cookie jar can store and send it
  // back as a real Authorization: Bearer header. A real browser client
  // reading this response never looks at this field at all (confirmed
  // directly in the real, existing frontend code) — genuinely additive.
  res.json({ customer: { ...customer, phone: rows[0].phone }, token: sessionToken });
}));

// GET /api/auth/google-status — real, current linked state for the
// authenticated customer's own account. Also reports whether they have
// a real password set, since that determines whether unlinking is
// actually safe to offer (a Google-only account with no password would
// be permanently locked out if it unlinked without setting one first).
router.get("/google-status", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT google_id, password_hash FROM customers WHERE id=$1", [req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  res.json({ linked: !!rows[0].google_id, hasPassword: !!rows[0].password_hash });
}));

// POST /api/auth/google-link — links Google to the ALREADY logged-in
// customer's own account. Deliberately a separate, real endpoint from
// POST /google (sign-in) — that route creates or signs into an account
// from a Google credential alone with no real session yet; this one
// requires a real, existing session first and only ever touches that
// exact customer's own row (req.customer.id), never a different real
// account, even if the Google token happened to belong to someone
// else's email — that mismatch is checked explicitly below instead.
router.post("/google-link", requireAuth, asyncHandler(async (req, res) => {
  const { credential, idToken } = req.body || {};
  const token = credential || idToken;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Google credential is required." });
  }
  let profile;
  try {
    profile = await verifyGoogleIdToken(token);
  } catch (err) {
    if (err.code === "NOT_CONFIGURED") return res.status(503).json({ error: "Google sign-in is not available right now." });
    if (err.code === "UNVERIFIED") return res.status(401).json({ error: "Please use a verified Google account." });
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }

  // Real, important real-world safeguard: this exact Google account
  // may already be linked to a DIFFERENT real customer row (their own,
  // separate account, or someone else's entirely) — linking it here
  // too would let two different customer accounts both claim the same
  // real Google identity, which is exactly the kind of ambiguity that
  // caused genuine, real duplicate-account bugs before the original
  // sign-in flow was built carefully to avoid. Blocked outright.
  const { rows: existingLink } = await query("SELECT id FROM customers WHERE google_id=$1", [profile.googleId]);
  if (existingLink.length > 0 && existingLink[0].id !== req.customer.id) {
    return res.status(409).json({ error: "This Google account is already linked to a different ĀKĀRA account." });
  }
  // Real, second safeguard: the Google account's own email must
  // genuinely match this customer's real, current account email — a
  // customer manually linking Google from their account settings
  // (rather than signing in fresh) should only ever be able to attach
  // their OWN Google identity, not a completely different one that
  // happens to share no real relationship to the account they're
  // logged into right now.
  const { rows: selfRow } = await query("SELECT email FROM customers WHERE id=$1", [req.customer.id]);
  if (selfRow.length === 0) return res.status(404).json({ error: "Account not found." });
  if (selfRow[0].email.toLowerCase() !== profile.email) {
    return res.status(409).json({ error: `That Google account (${profile.email}) doesn't match your account email. Sign in with the Google account that uses ${selfRow[0].email}.` });
  }

  await query("UPDATE customers SET google_id=$1 WHERE id=$2", [profile.googleId, req.customer.id]);
  res.json({ ok: true });
}));

// POST /api/auth/google-unlink — real, deliberate safeguard: refuses
// outright if the account has no real password set, since unlinking a
// Google-only account with nothing else to sign in with would
// permanently lock the real customer out of their own account. The
// frontend surfaces this by directing them to set a password first
// (see /auth/set-password below) — this check is enforced here too,
// server-side, so it can't be bypassed by skipping that real UI step.
router.post("/google-unlink", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT google_id, password_hash FROM customers WHERE id=$1", [req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  if (!rows[0].google_id) return res.status(400).json({ error: "Google isn't linked to this account." });
  if (!rows[0].password_hash) {
    return res.status(409).json({ error: "Set a password first — unlinking Google would leave you unable to sign in." });
  }
  await query("UPDATE customers SET google_id=NULL WHERE id=$1", [req.customer.id]);
  res.json({ ok: true });
}));

// POST /api/auth/set-password — real, genuinely distinct from PUT
// /password above: that route requires a currentPassword to change an
// EXISTING one; a Google-only account has no real password at all yet,
// so there's nothing to verify against. This is real, first-time
// password creation for exactly that case — the real, current
// password_hash must still be genuinely NULL, so this can't be used to
// silently overwrite a real, already-set password without the current
// one (that's what PUT /password is correctly for instead).
router.post("/set-password", requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!passwordOk(password)) {
    return res.status(400).json({ error: "Password must be 8+ characters with an uppercase letter, a number, and a special character." });
  }
  const { rows } = await query("SELECT password_hash FROM customers WHERE id=$1", [req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  if (rows[0].password_hash) {
    return res.status(409).json({ error: "This account already has a password — use Change Password instead." });
  }
  const hash = await hashPassword(password);
  await query("UPDATE customers SET password_hash=$1 WHERE id=$2", [hash, req.customer.id]);
  res.json({ ok: true });
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

  if (!rows[0].password_hash) {
    return res.status(401).json({ error: "This account uses Google sign-in. Please continue with Google." });
  }
  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return invalid();

  const customer = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
  const token = signToken(customer);
  setSessionCookie(res, token);
  // Real, additive field for the mobile app — see the identical, real
  // comment on the Google sign-in route above for the full reasoning.
  res.json({ customer, token });
}));

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    "SELECT id, name, email, phone, marketing_email_opt_in, marketing_whatsapp_opt_in FROM customers WHERE id = $1",
    [req.customer.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  const r = rows[0];
  res.json({
    customer: {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      marketingEmailOptIn: !!r.marketing_email_opt_in,
      marketingWhatsappOptIn: !!r.marketing_whatsapp_opt_in,
    },
  });
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
    await sendPasswordResetEmail(email.trim().toLowerCase(), `${SITE_URL}/reset-password?token=${token}`);
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

// DELETE /api/auth/account — DPDP-compliant self-service account
// deletion. Requires the current password re-entered — an irreversible
// action shouldn't be a single click, same reasoning as the password-
// change endpoint above requiring the current password, just with
// higher real stakes here.
//
// Real, deliberate per-table behavior (see db/schema.sql's own comment
// on this for the full reasoning):
//   orders            — KEPT, customer_id set NULL (ON DELETE SET NULL,
//                        matches the 8-year statutory tax retention
//                        already documented in the Privacy Policy).
//   addresses,
//   wishlist_items     — DELETED (ON DELETE CASCADE) — genuinely
//                        personal, no retention requirement.
//   reviews            — KEPT, customer_id set NULL — real product
//                        feedback other shoppers rely on; shows as
//                        "Verified Buyer" afterward (see
//                        server/routes/reviews.js's LEFT JOIN, changed
//                        specifically so a NULL customer_id review
//                        doesn't silently disappear from the product
//                        page instead of degrading gracefully).
// All of this is the database's OWN foreign-key behavior — a single
// DELETE FROM customers here is sufficient; nothing else needs an
// explicit cleanup query.
router.delete("/account", requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Enter your password to confirm account deletion." });

  const { rows } = await query("SELECT email, password_hash FROM customers WHERE id=$1", [req.customer.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });

  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  // A real, permanent compliance record that a deletion happened — see
  // db/schema.sql's own comment on account_deletions for why this is
  // genuinely separate from (and outlives) the customer row itself.
  await query("INSERT INTO account_deletions (customer_email) VALUES ($1)", [rows[0].email]);
  await query("DELETE FROM customers WHERE id=$1", [req.customer.id]);

  clearSessionCookie(res);
  res.json({ ok: true });
}));


// GET is already on /me — enrich customer payload if handler selects *
// PATCH /api/auth/marketing-preferences — account toggles (DPDP-friendly explicit consent)
router.patch("/marketing-preferences", requireAuth, asyncHandler(async (req, res) => {
  const emailOpt = !!req.body?.marketingEmailOptIn;
  const waOpt = !!req.body?.marketingWhatsappOptIn;
  const { rows } = await query(
    `UPDATE customers SET
       marketing_email_opt_in = $1,
       marketing_whatsapp_opt_in = $2
     WHERE id = $3
     RETURNING id, name, email, phone, marketing_email_opt_in, marketing_whatsapp_opt_in`,
    [emailOpt, waOpt, req.customer.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Account not found." });
  // Keep newsletter table in sync when email marketing is on
  if (emailOpt && rows[0].email) {
    await query(
      `INSERT INTO newsletter_subscribers (email, new_arrivals, promotions, journal)
       VALUES ($1, true, false, true)
       ON CONFLICT (email) DO UPDATE SET new_arrivals = true, journal = true, updated_at = now()`,
      [rows[0].email.toLowerCase()]
    );
  }
  res.json({
    customer: {
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      phone: rows[0].phone,
      marketingEmailOptIn: rows[0].marketing_email_opt_in,
      marketingWhatsappOptIn: rows[0].marketing_whatsapp_opt_in,
    },
  });
}));

export default router;


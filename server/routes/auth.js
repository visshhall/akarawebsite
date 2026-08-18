import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { validEmail, validIndianPhone, normalizePhone } from "../validate.js";
import {
  hashPassword, verifyPassword, signToken,
  setSessionCookie, clearSessionCookie, loginRateLimit, requireAuth,
} from "../auth.js";

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

export default router;

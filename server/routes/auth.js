import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  hashPassword, verifyPassword, signToken,
  setSessionCookie, clearSessionCookie, loginRateLimit, requireAuth,
} from "../auth.js";

const router = Router();

// Mirrors the frontend's existing validEmail()/pwStrength() checks —
// duplicated here deliberately, NOT trusted from the client, because
// client-side validation is a UX nicety, not security (a request could
// always be sent directly, bypassing the browser entirely).
const validEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
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
  if (!passwordOk(password)) {
    return res.status(400).json({
      error: "Password must be 8+ characters with an uppercase letter, a number, and a special character.",
    });
  }

  const existing = await query("SELECT id FROM customers WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO customers (name, email, phone, password_hash)
     VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
    [name.trim(), email.toLowerCase(), phone || null, passwordHash]
  );
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

export default router;
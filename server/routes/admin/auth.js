import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { validEmail } from "../../validate.js";
import {
  verifyPassword, signAdminToken, setAdminSessionCookie, clearAdminSessionCookie,
  adminLoginRateLimit, requireAdmin,
} from "../../adminAuth.js";

const router = Router();

// POST /api/admin/login — the ONLY admin auth endpoint besides logout/me.
// Deliberately no /signup here or anywhere else in the app — the one admin
// account is created exclusively via server/seed-admin.js, run directly.
router.post("/login", adminLoginRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { rows } = await query("SELECT id, name, email, password_hash FROM admins WHERE email=$1", [email.toLowerCase()]);
  const invalid = () => res.status(401).json({ error: "Incorrect email or password." });
  if (rows.length === 0) return invalid();

  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return invalid();

  const admin = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
  const token = signAdminToken(admin);
  setAdminSessionCookie(res, token);
  res.json({ admin });
}));

router.post("/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name, email FROM admins WHERE id=$1", [req.admin.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Admin account not found." });
  res.json({ admin: rows[0] });
}));

export default router;

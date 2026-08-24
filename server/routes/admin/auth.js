import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { validEmail } from "../../validate.js";
import {
  hashPassword, verifyPassword, signAdminToken, setAdminSessionCookie, clearAdminSessionCookie,
  adminLoginRateLimit, requireAdmin, logAdminAction,
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

// PUT /api/admin/auth/password — changes the admin password. Requires the
// CURRENT password to be re-entered and verified first — this is
// deliberate: without it, anyone who got hold of a live admin session
// (e.g. an unattended logged-in browser) could permanently lock the real
// admin out just by setting a new password, no proof of actually knowing
// the old one required. Same password strength bar as account creation
// (10+ chars) — see server/seed-admin.js for the original rule.
router.put("/password", requireAdmin, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are both required." });
  }
  if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "New password must be 10+ characters with an uppercase letter, a number, and a special character." });
  }

  const { rows } = await query("SELECT password_hash FROM admins WHERE id=$1", [req.admin.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Admin account not found." });

  const ok = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect." });

  const newHash = await hashPassword(newPassword);
  await query("UPDATE admins SET password_hash=$1 WHERE id=$2", [newHash, req.admin.id]);
  await logAdminAction(req.admin.id, "admin.password_change", {});
  res.json({ ok: true });
}));

export default router;

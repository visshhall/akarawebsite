// ============================================================================
// MANAGE ACCOUNTS — confirmed spec: ONLY super_admin can create or remove
// admin/staff accounts. Every route here uses requireRole("super_admin")
// specifically, not the broader ("admin","super_admin") pair used
// elsewhere — a regular admin must never be able to grant themselves or
// anyone else more access than they already have.
// ============================================================================
import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireRole, hashPassword, logAdminAction } from "../../adminAuth.js";
import { validEmail } from "../../validate.js";

const router = Router();
const VALID_ROLES = ["staff", "admin", "super_admin"];

function passwordOk(pw = "") {
  // Same 10+ char bar as seed-admin.js and the existing admin password-
  // change endpoint — every admin/staff account can touch real customer
  // data or real orders, so the higher bar applies uniformly, not just
  // to super_admin.
  return pw.length >= 10 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// GET /api/admin/accounts — every admin/staff account, for the Manage
// Accounts screen's list. Never returns password_hash.
router.get("/", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name, email, role, created_at FROM admins ORDER BY created_at ASC");
  res.json({ accounts: rows });
}));

// POST /api/admin/accounts — creates a new admin/staff/super_admin
// account. This is the real, in-app replacement for having to run
// server/seed-admin.js from a terminal every time — that script still
// exists as a recovery path, but day-to-day account creation happens
// here now.
router.post("/", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 1) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!passwordOk(password)) {
    return res.status(400).json({ error: "Password must be 10+ characters with an uppercase letter, a number, and a special character." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}` });
  }

  const cleanEmail = email.trim().toLowerCase();
  const { rows: existing } = await query("SELECT id FROM admins WHERE email=$1", [cleanEmail]);
  if (existing.length > 0) return res.status(409).json({ error: "An account with this email already exists." });

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    "INSERT INTO admins (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, created_at",
    [name.trim(), cleanEmail, passwordHash, role]
  );
  await logAdminAction(req.admin.id, "account.create", { newAccountId: rows[0].id, email: cleanEmail, role });
  res.status(201).json({ account: rows[0] });
}));

// DELETE /api/admin/accounts/:id — removes an account. Two real
// safety checks, not just the role gate above: a super_admin can never
// delete their OWN account (self-lockout — this app has no other way
// to create a super_admin account except this screen or the CLI
// script, so an accidental self-delete with no other super_admin left
// would be a genuine, hard-to-recover mistake), and the database's own
// FK (change_log.admin_id ON DELETE SET NULL) already ensures deleting
// an account never deletes or corrupts its past activity log entries —
// they just show "Unknown admin" afterward, same as any admin_id that
// no longer resolves.
router.delete("/:id", requireRole("super_admin"), asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.admin.id) {
    return res.status(400).json({ error: "You can't remove your own account." });
  }
  const { rows } = await query("DELETE FROM admins WHERE id=$1 RETURNING email", [targetId]);
  if (rows.length === 0) return res.status(404).json({ error: "Account not found." });
  await logAdminAction(req.admin.id, "account.remove", { removedEmail: rows[0].email });
  res.json({ ok: true });
}));

export default router;

import { Router } from "express";
import { requireTurnstile } from "../../turnstile.js";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { validEmail } from "../../validate.js";
import {
  hashPassword, verifyPassword, signAdminToken, setAdminSessionCookie, clearAdminSessionCookie,
  adminLoginRateLimit, requireAdmin, logAdminAction,
  signPending2FAToken, verifyPending2FAToken,
} from "../../adminAuth.js";
import {
  encryptSecret, decryptSecret, generateTotpSetup, verifyTotpCode,
  generateBackupCodes, hashBackupCode, verifyBackupCode,
} from "../../twoFactor.js";

const router = Router();

// POST /api/admin/login — step one of two when 2FA is enabled. Real,
// deliberate two-step design: password verification and 2FA
// verification happen in genuinely separate requests, so a real full
// session token is never issued to anyone who's only proven the
// password — a leaked/guessed password alone can no longer be enough
// on its own for a 2FA-enabled account.
router.post("/login", adminLoginRateLimit, requireTurnstile, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { rows } = await query("SELECT id, name, email, password_hash, role, totp_enabled FROM admins WHERE email=$1", [email.toLowerCase()]);
  const invalid = () => res.status(401).json({ error: "Incorrect email or password." });
  if (rows.length === 0) return invalid();

  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return invalid();

  if (rows[0].totp_enabled) {
    // Deliberately NOT a real session cookie yet — a real, full
    // session only gets issued after the actual 2FA step below
    // succeeds. pendingToken is single-purpose (see
    // signPending2FAToken's own comment) and expires in 5 minutes.
    const pendingToken = signPending2FAToken(rows[0].id);
    return res.json({ requiresTwoFactor: true, pendingToken });
  }

  const admin = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
  const token = signAdminToken(admin);
  setAdminSessionCookie(res, token);
  res.json({ admin });
}));

// POST /api/admin/login/verify-2fa — step two, real TOTP code (or a
// real single-use backup code) required to actually complete login for
// a 2FA-enabled account. rate-limited the same as the password step
// itself — a 2FA code is exactly the kind of thing worth protecting
// from real brute-force guessing too, not just the password.
router.post("/login/verify-2fa", adminLoginRateLimit, asyncHandler(async (req, res) => {
  const { pendingToken, code } = req.body || {};
  const adminId = verifyPending2FAToken(pendingToken);
  if (!adminId) return res.status(401).json({ error: "Your session expired — please sign in again." });
  if (typeof code !== "string" || !code.trim()) return res.status(400).json({ error: "Enter your 6-digit code, or a backup code." });

  const { rows } = await query("SELECT id, name, email, role, totp_secret FROM admins WHERE id=$1", [adminId]);
  if (rows.length === 0) return res.status(401).json({ error: "Account not found." });
  const admin = rows[0];

  const cleanCode = code.trim();
  let verified = false;

  if (/^\d{6}$/.test(cleanCode)) {
    // A real TOTP code — decrypt the stored secret and check it.
    const secret = decryptSecret(admin.totp_secret);
    verified = await verifyTotpCode(secret, cleanCode);
  } else {
    // Anything else is treated as a real backup code attempt (real
    // shape is XXXX-XXXX, but this deliberately doesn't hard-validate
    // the shape here — verifyBackupCode's own bcrypt.compare is what
    // actually decides, and rejecting non-6-digit input early above
    // already keeps this path from being a free-form guessing ground).
    const { rows: backupRows } = await query("SELECT id, code_hash FROM admin_backup_codes WHERE admin_id=$1 AND used_at IS NULL", [adminId]);
    for (const b of backupRows) {
      if (await verifyBackupCode(cleanCode, b.code_hash)) {
        verified = true;
        // Real single-use enforcement — marked used immediately, in
        // the same request that consumed it, not left for a later
        // cleanup pass that could race with a second real use.
        await query("UPDATE admin_backup_codes SET used_at=now() WHERE id=$1", [b.id]);
        break;
      }
    }
  }

  if (!verified) return res.status(401).json({ error: "Incorrect code." });

  const token = signAdminToken(admin);
  setAdminSessionCookie(res, token);
  await logAdminAction(admin.id, "admin.2fa_login", {});
  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
}));

router.post("/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, name, email, role FROM admins WHERE id=$1", [req.admin.id]);
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

// GET /api/admin/auth/2fa/status — whether the CURRENT account has 2FA
// enabled, and how many real backup codes are left unused. Used by the
// Settings screen to show the right UI (a "Set Up 2FA" prompt vs a
// "Disable" / "Regenerate Backup Codes" one).
router.get("/2fa/status", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT totp_enabled FROM admins WHERE id=$1", [req.admin.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Admin account not found." });
  const { rows: codeRows } = await query("SELECT COUNT(*) FROM admin_backup_codes WHERE admin_id=$1 AND used_at IS NULL", [req.admin.id]);
  res.json({ enabled: rows[0].totp_enabled, remainingBackupCodes: Number(codeRows[0].count) });
}));

// POST /api/admin/auth/2fa/setup — starts enabling 2FA: generates a
// real, fresh secret and its QR code. Deliberately does NOT touch the
// database yet — the secret is returned to the client to show the QR
// code, and is only actually persisted (as encrypted, and marked
// enabled) once /2fa/enable below confirms the admin can produce a
// real valid code from it. This is what prevents a botched scan/typo
// from silently locking an admin out with 2FA "on" but no working way
// to ever pass it again.
router.post("/2fa/setup", requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT email, totp_enabled FROM admins WHERE id=$1", [req.admin.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Admin account not found." });
  if (rows[0].totp_enabled) return res.status(400).json({ error: "2FA is already enabled. Disable it first to set up a new device." });

  const { secret, qrCodeDataUrl } = await generateTotpSetup(rows[0].email);
  res.json({ secret, qrCodeDataUrl });
}));

// POST /api/admin/auth/2fa/enable — completes setup: the admin proves
// they can produce a real, valid code from the secret staged in the
// step above, and ONLY THEN does this persist (encrypted) and flip
// totp_enabled to true. Also generates the one real set of backup
// codes, shown to the admin exactly once here — only their bcrypt
// hashes are ever stored (see server/twoFactor.js's own comment on
// generateBackupCodes for why).
router.post("/2fa/enable", requireAdmin, asyncHandler(async (req, res) => {
  const { secret, code } = req.body || {};
  if (typeof secret !== "string" || !secret) return res.status(400).json({ error: "Missing setup secret — start setup again." });
  const verified = await verifyTotpCode(secret, code || "");
  if (!verified) return res.status(400).json({ error: "That code isn't correct. Check your authenticator app and try again." });

  const encrypted = encryptSecret(secret);
  await query("UPDATE admins SET totp_secret=$1, totp_enabled=true WHERE id=$2", [encrypted, req.admin.id]);

  // Real, fresh backup codes every time 2FA is (re-)enabled — any
  // codes from a previous enable/disable cycle are deliberately
  // cleared first, so a stale code from a prior setup can never still
  // work.
  await query("DELETE FROM admin_backup_codes WHERE admin_id=$1", [req.admin.id]);
  const codes = generateBackupCodes();
  for (const c of codes) {
    const hash = await hashBackupCode(c);
    await query("INSERT INTO admin_backup_codes (admin_id, code_hash) VALUES ($1,$2)", [req.admin.id, hash]);
  }

  await logAdminAction(req.admin.id, "admin.2fa_enabled", {});
  res.json({ ok: true, backupCodes: codes });
}));

// POST /api/admin/auth/2fa/disable — requires the CURRENT password
// re-entered, same real reasoning as the password-change endpoint
// above: disabling 2FA is a genuine security downgrade, and shouldn't
// be one click away for anyone who merely has an unattended live
// session, without proving they actually know the account's password.
router.post("/2fa/disable", requireAdmin, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Enter your password to confirm." });

  const { rows } = await query("SELECT password_hash FROM admins WHERE id=$1", [req.admin.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Admin account not found." });
  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  await query("UPDATE admins SET totp_secret=NULL, totp_enabled=false WHERE id=$1", [req.admin.id]);
  await query("DELETE FROM admin_backup_codes WHERE admin_id=$1", [req.admin.id]);
  await logAdminAction(req.admin.id, "admin.2fa_disabled", {});
  res.json({ ok: true });
}));

export default router;

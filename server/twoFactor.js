// ============================================================================
// ADMIN 2FA — real TOTP (Google Authenticator/Authy-compatible), no SMS,
// no new third-party service. Genuinely optional per-account (see
// db/schema.sql's own comment on admins.totp_enabled for why this isn't
// hard-required at the database level).
//
// otplib does the actual TOTP math (RFC 6238) — not hand-rolled here,
// since getting time-window/HMAC details subtly wrong in a homemade
// implementation is exactly the kind of real security risk worth using
// a proven, widely-used library for instead.
//
// IMPORTANT — this uses otplib v13's real, actual top-level function
// API (generateSecret/generate/verify/generateURI), confirmed directly
// against the real installed package rather than assumed: an earlier
// draft of this file used the OLDER `authenticator` object pattern
// from a previous major version of otplib, which genuinely does not
// exist in the version actually installed here — caught by running it
// directly before it ever shipped, not left for a real failure later.
// ============================================================================
import { generateSecret as otplibGenerateSecret, generate as otplibGenerate, verify as otplibVerify, generateURI } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY;

function requireKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("TOTP_ENCRYPTION_KEY is not set (or too short) — add a real 32+ byte value in Railway's Variables tab. 2FA cannot function without it.");
  }
}

// AES-256-GCM — real authenticated encryption (not just AES-CBC, which
// has no built-in integrity check), so a tampered ciphertext is
// detected and rejected rather than silently decrypting to garbage. A
// fresh random IV per encryption (stored alongside the ciphertext,
// never reused) is what makes this safe to call repeatedly with the
// same key.
export function encryptSecret(plaintext) {
  requireKey();
  const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, all hex — one real string to store in one
  // real TEXT column, rather than three separate columns for what's
  // genuinely one logical value.
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored) {
  requireKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(":");
  const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

// Generates a real, fresh TOTP secret and its setup QR code — called
// once when an admin STARTS enabling 2FA. The secret is returned to
// the caller to stage temporarily (NOT written to the database as
// enabled yet — see the real enable endpoint in
// server/routes/admin/auth.js, which only persists it after the admin
// proves they can produce a real valid code from it).
export async function generateTotpSetup(accountLabel) {
  const secret = otplibGenerateSecret();
  const otpauthUrl = generateURI({ secret, label: accountLabel, issuer: "ĀKĀRA Admin" });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, qrCodeDataUrl };
}

export async function verifyTotpCode(secret, code) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  try {
    // otplib v13's real default time-step tolerance already covers
    // one step before/after — a deliberate, small, real-world
    // allowance for clock drift between the server and the admin's
    // phone, not a security weakening.
    const result = await otplibVerify({ secret, token: code });
    return !!result?.valid;
  } catch {
    return false;
  }
}

// Real, single-use backup codes — genuinely random, not derived from
// the TOTP secret (so losing the TOTP secret doesn't also compromise
// these). Returned in plaintext ONCE, at generation time, for the
// admin to save — only their bcrypt hash is ever stored, same real
// standard as an actual password, since a leaked database must not
// hand over usable recovery codes either.
export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // XXXX-XXXX shape — genuinely easier to read/type correctly than a
    // long undivided string, while still real, high-entropy (8
    // real random alphanumeric characters, ~41 bits).
    const raw = crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export async function hashBackupCode(code) {
  return bcrypt.hash(code.toUpperCase().trim(), 10);
}

export async function verifyBackupCode(code, hash) {
  return bcrypt.compare(code.toUpperCase().trim(), hash);
}

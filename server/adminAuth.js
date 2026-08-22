// ============================================================================
// ADMIN AUTHENTICATION — deliberately a SEPARATE code path from customer
// auth (server/auth.js), not a shared one with a role flag. This is the
// actual security boundary behind "only I can see the admin panel, under
// any scenario": a completely different secret (ADMIN_JWT_SECRET, never
// the same value as JWT_SECRET), a completely different session cookie
// name, and a completely different verification function. A bug in
// customer auth code has no path to granting admin access, structurally,
// not just by convention.
//
// IMPORTANT — what this actually guarantees and what it doesn't: the real
// enforcement is here, server-side, on every /api/admin/* request (see
// requireAdmin below). The frontend also hides admin UI/routes from
// regular visitors, but that's a UX nicety, not the security boundary —
// frontend JavaScript is always inspectable by anyone with browser
// devtools. Nobody should rely on "the button isn't shown" as security;
// what actually stops an unauthorized request is this server-side check.
// ============================================================================
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { query } from "./db.js";
import { IS_PRODUCTION } from "./env.js";

if (!process.env.ADMIN_JWT_SECRET) {
  console.error(
    "ADMIN_JWT_SECRET is not set. Add it in Railway's Variables tab — a " +
    "long random string, DIFFERENT from JWT_SECRET and CSRF_SECRET " +
    "(openssl rand -hex 32). Locally: put it in .env."
  );
  process.exit(1);
}

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const ADMIN_COOKIE_NAME = "akara_admin_session";
const ADMIN_TOKEN_EXPIRY = "12h"; // deliberately much shorter than the customer session (30d) — this account can edit the whole catalog and every order, so a stolen/left-open session should go stale fast

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signAdminToken(admin) {
  return jwt.sign({ id: admin.id, email: admin.email, role: "admin" }, ADMIN_JWT_SECRET, { expiresIn: ADMIN_TOKEN_EXPIRY });
}

export function setAdminSessionCookie(res, token) {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict", // stricter than the customer cookie's "lax" — no legitimate reason for this cookie to ever be sent on a cross-site navigation
    maxAge: 12 * 60 * 60 * 1000,
  });
}
export function clearAdminSessionCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME);
}

// Reads the admin session cookie (if any) and attaches req.admin — does
// NOT reject the request by itself. Routes that require admin access use
// requireAdmin below, which does reject.
export function attachAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, ADMIN_JWT_SECRET);
      if (payload.role === "admin") req.admin = payload;
    } catch {
      req.admin = null;
    }
  }
  next();
}

// The actual gate. Every /api/admin/* route (except login) uses this.
export function requireAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: "Admin sign-in required." });
  next();
}

// Same shape as the customer rate limiter, but this endpoint is a higher-
// value target (one account controls the whole business) — worth its own
// separate limiter rather than sharing state with customer login attempts.
export const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in a few minutes." },
});

// Writes one row to change_log — call this from any admin route that
// mutates something. Never throws (a logging failure should never block
// the actual action it's trying to log) — errors are swallowed with a
// console warning instead.
export async function logAdminAction(adminId, action, details = {}) {
  try {
    await query("INSERT INTO change_log (admin_id, action, details) VALUES ($1,$2,$3)", [adminId, action, JSON.stringify(details)]);
  } catch (err) {
    console.error("Failed to write change_log entry (action not blocked):", err);
  }
}

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
  // Real role, not hardcoded "admin" — this is what makes requireRole()
  // below actually mean something. Every session's role is fixed at the
  // moment of login; if an account's role is changed while they're
  // already logged in, that takes effect on their NEXT login, not
  // instantly — the same trade-off every JWT-based system makes (the
  // token itself, not a fresh DB read, is the source of truth for the
  // life of that session).
  // typ:"admin" is checked in attachAdmin so a pending-2FA token (or any
  // other JWT shape signed with the same secret) can never be treated as
  // a full admin session.
  return jwt.sign(
    { typ: "admin", id: admin.id, email: admin.email, role: admin.role },
    ADMIN_JWT_SECRET,
    { algorithm: "HS256", expiresIn: ADMIN_TOKEN_EXPIRY }
  );
}

// A genuinely SEPARATE, much shorter-lived token for the real gap
// between "password verified" and "2FA code verified" — deliberately a
// different shape ({pendingAdminId} only, no role/email) and a 5-minute
// expiry, not reused from signAdminToken, so this can never be mistaken
// for — or misused as — a real, full admin session token even if it
// leaked. Same signing secret is fine (still genuinely admin-context),
// but nothing about its payload or expiry looks like a real session.
export function signPending2FAToken(adminId) {
  return jwt.sign({ pendingAdminId: adminId }, ADMIN_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "5m" 
  });
}
export function verifyPending2FAToken(token) {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET, { algorithms: ["HS256"] });
    return payload.pendingAdminId ? payload.pendingAdminId : null;
  } catch {
    return null;
  }
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
  // Same fix as clearSessionCookie in auth.js, matched to this cookie's
  // own attributes (sameSite:"strict" here, not "lax" — must mirror
  // exactly what setAdminSessionCookie used, not just copy the customer
  // version).
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/",
  });
}

const VALID_ADMIN_ROLES = ["staff", "admin", "super_admin"];

// Reads the admin session cookie (if any) and attaches req.admin — does
// NOT reject the request by itself. Routes that require admin access use
// requireAdmin or requireRole below, which do reject.
export function attachAdmin(req, res, next) {
  // Never trusts a customer cookie. Only akara_admin_session + ADMIN_JWT_SECRET.
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  req.admin = null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET, { algorithms: ["HS256"] });
    // Reject pending-2FA tokens and any non-session shape.
    if (payload.pendingAdminId) return next();
    if (payload.typ && payload.typ !== "admin") return next();
    if (!payload.id || !VALID_ADMIN_ROLES.includes(payload.role)) return next();
    req.admin = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    req.admin = null;
  }
  next();
}

// The actual gate for "any admin/staff account, any role" — matches the
// old behavior exactly, for routes every role can reach.
async function assertAdminStillValid(req, res) {
  if (!req.admin?.id) {
    res.status(401).json({ error: "Admin sign-in required." });
    return false;
  }
  try {
    const { rows } = await query(
      "SELECT id, email, role FROM admins WHERE id=$1 LIMIT 1",
      [req.admin.id]
    );
    if (!rows.length) {
      clearAdminSessionCookie(res);
      res.status(401).json({ error: "Admin sign-in required." });
      return false;
    }
    // Role in DB is source of truth if it diverged from JWT (account demoted).
    const live = rows[0];
    if (!VALID_ADMIN_ROLES.includes(live.role)) {
      clearAdminSessionCookie(res);
      res.status(403).json({ error: "Your account doesn't have permission to do this." });
      return false;
    }
    req.admin = { id: live.id, email: live.email, role: live.role };
    return true;
  } catch (err) {
    console.error("[adminAuth] live session check failed:", err?.message || err);
    res.status(503).json({ error: "Admin auth temporarily unavailable." });
    return false;
  }
}

export async function requireAdmin(req, res, next) {
  if (!(await assertAdminStillValid(req, res))) return;
  // Harden API responses: never cache admin JSON in browsers/CDNs.
  res.setHeader("Cache-Control", "no-store, private");
  next();
}

// The REAL permission boundary. requireRole("admin","super_admin") means
// exactly that — staff hitting this route gets a clear 403, not a silent
// UI hiding that a direct API call could bypass. Confirmed spec:
//   staff:       order lifecycle only
//   admin:       staff's access + Products/Media/Featured/variants/
//                Customers/Newsletter/Activity Log/Returns/Settings
//   super_admin: admin's access + the CMS + creating/removing accounts
// Every /api/admin/* route that ISN'T staff-safe should use this instead
// of the plain requireAdmin above.
export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!(await assertAdminStillValid(req, res))) return;
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: "Your account doesn't have permission to do this." });
    }
    res.setHeader("Cache-Control", "no-store, private");
    next();
  };
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

// ---------------------------------------------------------------------------
// Global /api/admin gate — belt-and-suspenders on top of per-route requireAdmin.
// Public exceptions: login + 2FA verify only. Everything else needs a live session.
// ---------------------------------------------------------------------------
const ADMIN_AUTH_PUBLIC = new Set([
  "POST /login",
  "POST /login/verify-2fa",
]);

export function requireAdminApiSession(req, res, next) {
  // Works whether mounted at /api/admin or checked with full originalUrl.
  const method = (req.method || "GET").toUpperCase();
  const full = String(req.originalUrl || req.url || "").split("?")[0];
  // Allow only credential acquisition endpoints without a session.
  if (method === "POST" && (
    full === "/api/admin/auth/login" ||
    full.endsWith("/api/admin/auth/login") ||
    full === "/api/admin/auth/login/verify-2fa" ||
    full.endsWith("/api/admin/auth/login/verify-2fa")
  )) {
    return next();
  }
  if (!req.admin) {
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(401).json({ error: "Admin sign-in required." });
  }
  next();
}

/** Soft rate limit across all admin API traffic per IP (after login too). */
export const adminApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // ~40 req/min sustained — normal studio use; blocks scrapers
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests. Slow down and try again." },
});


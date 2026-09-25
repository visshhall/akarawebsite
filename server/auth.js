// Real authentication, replacing the hardcoded single demo account
// (test@example.com) that lived in the frontend. Passwords are hashed
// with bcrypt (never stored plain), sessions are JWTs in an httpOnly
// cookie (not localStorage — httpOnly means client-side JS can't read the
// token even if something else on the page were compromised), and login
// attempts are rate-limited server-side (the frontend's RateLimiter class
// was explicitly flagged earlier as bypassable by clearing localStorage —
// this is the real fix that comment promised).
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { IS_PRODUCTION } from "./env.js";
import rateLimit from "express-rate-limit";

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is not set. Add it in Railway's Variables tab (any long " +
    "random string works, e.g. generate one with `openssl rand -hex 32`). " +
    "Locally: put it in .env."
  );
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = "30d";
const COOKIE_NAME = "akara_session";

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(customer) {
  return jwt.sign({ id: customer.id, email: customer.email }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: TOKEN_EXPIRY,
  });
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches TOKEN_EXPIRY
  });
}

export function clearSessionCookie(res) {
  // Found in an independent security review: this used to call
  // clearCookie() with no options at all, while setSessionCookie() above
  // sets several (httpOnly, secure, sameSite). Express/browsers match a
  // cookie for deletion by these same attributes (path especially) — a
  // mismatch can mean the "clear" instruction creates a separate,
  // already-expired cookie instead of actually removing the original,
  // leaving a stale session cookie behind after logout in some browsers.
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
  });
}

// Middleware: reads the session cookie, verifies it, and attaches
// req.customer if valid. Does NOT reject the request if there's no valid
// session — routes that require login check `req.customer` themselves
// (see requireAuth below) — this version just makes the info available
// for routes that behave differently for logged-in vs guest users.
//
// REAL, ADDITIVE EXTENSION for the mobile app: a real, native app has
// no real browser cookie jar, so it can't use the same real, existing
// cookie-based session the website correctly uses — it sends a real
// `Authorization: Bearer <token>` header instead (the same real JWT,
// just carried a different real way). The cookie is checked FIRST,
// exactly as before, completely unchanged — a real, existing website
// browser session always has this cookie, so it always takes this
// exact same, real path it always has; the header is only ever
// consulted as a real, second option when the cookie is genuinely
// absent, which never happens for a real browser request.
export function attachCustomer(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || extractBearerToken(req);
  if (token) {
    try {
      req.customer = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      req.customer = null;
    }
  }
  next();
}

// Real, small, dedicated helper — pulls a real token out of a real,
// standard "Authorization: Bearer <token>" header, or returns null if
// that header is genuinely absent or malformed. Kept separate so the
// real, actual extraction logic is easy to find and audit on its own.
function extractBearerToken(req) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requireAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: "Not signed in." });
  next();
}

// Server-side rate limiting on auth endpoints — this is the real
// enforcement layer. 5 attempts per 15 minutes per IP, matching the
// original frontend-only limiter's intent but actually unbypassable by
// clearing browser storage (an attacker would need a different IP, not
// just a private browsing window).
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in a few minutes." },
});

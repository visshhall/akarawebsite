// ============================================================================
// CSRF PROTECTION — stops a malicious site from tricking a logged-in
// customer's browser into taking an action on ĀKĀRA without them knowing
// (e.g. submitting a hidden form to another site while they're signed in
// here). The session cookie is already SameSite=Lax (see auth.js), which
// blocks the most common version of this attack — this adds the standard
// second layer: a token the frontend must read and echo back on every
// state-changing request, which a third-party site has no way to obtain.
// ============================================================================
import { doubleCsrf } from "csrf-csrf";
import crypto from "crypto";

if (!process.env.CSRF_SECRET) {
  console.error(
    "CSRF_SECRET is not set. Add it in Railway's Variables tab (any long " +
    "random string works, e.g. generate one with `openssl rand -hex 32` — " +
    "use a DIFFERENT value than JWT_SECRET, don't reuse it). Locally: put " +
    "it in .env."
  );
  process.exit(1);
}

const ANON_ID_COOKIE = "akara_csrf_sid";

// csrf-csrf needs a stable per-visitor identifier to bind each CSRF token
// to (getSessionIdentifier below) — normally this would be a server-side
// session ID, but this app uses stateless JWTs instead, and a CSRF token
// must exist even for a visitor who isn't logged in yet (e.g. on the
// signup page itself). This middleware assigns a random, long-lived,
// anonymous id cookie the first time anyone visits, then reuses it for
// every request after — logged in or not. It identifies "this browser",
// not "this person", which is exactly what CSRF binding needs.
export function ensureAnonId(req, res, next) {
  if (!req.cookies?.[ANON_ID_COOKIE]) {
    const id = crypto.randomUUID();
    res.cookie(ANON_ID_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    req.cookies[ANON_ID_COOKIE] = id; // so it's usable within this same request too
  }
  next();
}

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  getSessionIdentifier: (req) => req.cookies?.[ANON_ID_COOKIE] || "no-session",
  cookieName: "akara_csrf",
  cookieOptions: {
    httpOnly: false, // must be readable by frontend JS to echo back in the header — this is the standard double-submit pattern, not a mistake
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

// GET /api/csrf-token — the frontend calls this once on load to receive a
// token (as a cookie AND in the response body), then sends that token back
// in the X-CSRF-Token header on every POST/PUT/DELETE request.
export function csrfTokenRoute(req, res) {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
}

export { doubleCsrfProtection };

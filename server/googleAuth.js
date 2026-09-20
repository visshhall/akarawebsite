// Google ID-token verification for "Continue with Google".
// Only GOOGLE_CLIENT_ID is required on the server for this flow.
// GOOGLE_CLIENT_SECRET is not used for ID-token verify (GIS button).
import { OAuth2Client } from "google-auth-library";

let client = null;

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID || "").trim();
}

function getClient() {
  if (!client) {
    const id = (process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!id) return null;
    client = new OAuth2Client(id);
  }
  return client;
}

/**
 * @param {string} idToken
 * @returns {Promise<{ googleId: string, email: string, name: string, emailVerified: boolean }>}
 */
export async function verifyGoogleIdToken(idToken) {
  const oauth = getClient();
  if (!oauth) {
    const err = new Error("Google sign-in is not configured.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  if (!idToken || typeof idToken !== "string") {
    const err = new Error("Missing Google credential.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  // Hard cap size — real GIS tokens are far smaller; reject obvious junk
  if (idToken.length < 20 || idToken.length > 4096) {
    const err = new Error("Invalid Google credential size.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  const audience = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const ticket = await oauth.verifyIdToken({
    idToken,
    audience,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    const err = new Error("Google token missing email.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  // Audience must match our client (library checks; re-assert for clarity)
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk) {
    const err = new Error("Google token audience mismatch.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  // Reject clearly non-Google issuers
  const iss = String(payload.iss || "");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    const err = new Error("Google token issuer invalid.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  if (payload.email_verified === false) {
    const err = new Error("Google email is not verified.");
    err.code = "UNVERIFIED";
    throw err;
  }
  const email = String(payload.email).toLowerCase().trim();
  if (!email || !email.includes("@") || email.length > 320) {
    const err = new Error("Google email invalid.");
    err.code = "BAD_TOKEN";
    throw err;
  }
  return {
    googleId: String(payload.sub).slice(0, 255),
    email,
    name: String(payload.name || email.split("@")[0] || "Customer").slice(0, 200),
    emailVerified: true,
  };
}

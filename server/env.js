// Whether this is running in a real deployed environment (Railway) vs.
// local development. Checking NODE_ENV alone is unreliable here — Railway
// doesn't guarantee setting it for an arbitrary Node app — but Railway
// DOES always inject its own RAILWAY_* environment variables into every
// deployment, regardless of what the app itself sets. Checking for those
// too makes this detection correct even if NODE_ENV was never touched.
// Used specifically to decide the `secure` flag on every cookie this app
// sets (session, admin session, CSRF) — a cookie without `secure:true` on
// a real HTTPS deployment is a real, avoidable weakening of the cookie's
// protection, not just a formality.
export const IS_PRODUCTION = Boolean(
  process.env.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT_NAME ||
  process.env.RAILWAY_PROJECT_ID
);

// ============================================================================
// PUBLIC FORM RATE LIMITING — found in an independent security review:
// Contact, Bulk Orders, and Newsletter had no rate limiting at all, unlike
// login and password reset which already do (see loginRateLimit in
// auth.js). Anyone could submit either form as fast as their connection
// allowed — no real damage on its own, but a cheap way to spam an inbox
// or hammer the database with junk rows. Same shape as loginRateLimit,
// just less strict — these forms are meant to be usable by a genuine
// visitor filling them out normally, not brute-forced.
// ============================================================================
import rateLimit from "express-rate-limit";

export const publicFormRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again in a few minutes." },
});

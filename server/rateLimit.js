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

// A 6-digit OTP has only 1,000,000 possible values — publicFormRateLimit's
// 10-per-15-minutes is fine for genuine form spam, but nowhere near
// strict enough to stop someone actually guessing a code. This caps
// VERIFY attempts specifically, tighter than the request-a-new-code
// side of the same flow (that one can reasonably reuse
// publicFormRateLimit — sending yourself extra codes isn't a guessing
// attack). Combined with the real per-customer attempt counter stored
// in the database (phone_otp_attempts) as a second, independent layer —
// this limiter is per-IP, that counter is per-account, so one doesn't
// substitute for the other.
export const otpVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please request a new code and try again in a few minutes." },
});

// Push subscribe/unsubscribe — also defined inline on push routes; exported
// here for reuse/tests. 20 / 15 minutes per IP is enough for real devices
// and stops subscription-table flooding.
export const pushMutateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many push requests. Please try again later." },
});

export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again in a few minutes." },
});

export const couponValidateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many coupon checks. Please try again later." },
});

// Shared server-side validation — mirrors the frontend's equivalents, but
// these copies are what actually matters for security: the frontend's
// versions are a UX nicety, easily bypassed by anyone sending a request
// directly. Every route that touches user input should import from here
// rather than re-implementing its own copy (auth.js and orders.js both do).
export const sanitize = (str = "") => String(str).replace(/<[^>]*>/g, "").slice(0, 500);
export const validEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Strips spaces/+/- so "+91 91234 56780" and "9123456780" normalize to
// the same stored value, AND strips a leading "91" country code if it's
// clearly present (12 digits total, starting "91", with the remaining 10
// matching a real Indian mobile number) — without this, a number entered
// exactly the way the UI's own placeholder text suggests ("+91 XXXXX
// XXXXX") would fail validation, since "+91 91234 56780" strips down to
// a 12-digit string, not the 10 digits the format check expects. Careful
// not to strip "91" from a legitimate 10-digit number that happens to
// start with 9 and 1 (e.g. "9123456780" is valid on its own and must
// NOT be shortened to 8 digits) — only strips when the full 12-digit
// form is present.
export const normalizePhone = (phone = "") => {
  const digits = String(phone).replace(/[\s+\-]/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9][0-9]{9}$/.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return digits;
};
// Matches the frontend's existing Indian mobile number rule (10 digits,
// starting 6-9) — kept as one shared regex so frontend/backend can't
// silently drift apart on what counts as valid.
export const validIndianPhone = (phone = "") => /^[6-9][0-9]{9}$/.test(phone);

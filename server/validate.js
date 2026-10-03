// Shared server-side validation — mirrors the frontend's equivalents, but
// these copies are what actually matters for security: the frontend's
// versions are a UX nicety, easily bypassed by anyone sending a request
// directly (e.g. Burp Suite). Every route that touches user input must
// import from here rather than trusting raw req.body.

/** Strip HTML tags and hard-cap length. */
export const sanitize = (str = "", max = 500) =>
  String(str)
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, max);

export const validEmail = (e = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim()) && String(e).length <= 200;

/**
 * Person names (profile, address recipient, signup).
 * Letters (any script via Unicode), spaces, apostrophe, hyphen, period only.
 * Blocks emoji, @, $, <, digits-only, and pure special-char payloads.
 */
export const validPersonName = (name = "") => {
  const s = String(name).trim();
  if (s.length < 2 || s.length > 80) return false;
  // Must contain at least one letter
  if (!/\p{L}/u.test(s)) return false;
  // Allowed: letters, marks (accents), spaces, ' - .
  if (!/^[\p{L}\p{M}\s'.-]+$/u.test(s)) return false;
  return true;
};

export const cleanPersonName = (name = "") => {
  const s = sanitize(String(name).trim(), 80);
  // Collapse whitespace
  return s.replace(/\s+/g, " ").slice(0, 80);
};

/** Street / address line — printable, no angle brackets or control chars. */
export const validAddressLine = (line = "") => {
  const s = String(line).trim();
  if (s.length < 5 || s.length > 200) return false;
  if (/[<>]/.test(s)) return false;
  if (!/[\p{L}\p{N}]/u.test(s)) return false; // must have letter or digit
  return true;
};

export const cleanAddressLine = (line = "") =>
  sanitize(String(line).trim(), 200).replace(/\s+/g, " ");

/** City / state — similar to name but allows digits (e.g. Sector 18). */
export const validCityOrState = (v = "") => {
  const s = String(v).trim();
  if (s.length < 2 || s.length > 60) return false;
  if (/[<>@$%]/.test(s)) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (!/^[\p{L}\p{M}\p{N}\s'.-]+$/u.test(s)) return false;
  return true;
};

export const cleanCityOrState = (v = "") =>
  sanitize(String(v).trim(), 60).replace(/\s+/g, " ");

/** Free-text notes / messages (contact form, gift note) — no HTML. */
export const validMessage = (msg = "", { min = 0, max = 2000 } = {}) => {
  const s = String(msg).trim();
  if (s.length < min || s.length > max) return false;
  if (/<script|javascript:|on\w+=/i.test(s)) return false;
  return true;
};

export const cleanMessage = (msg = "", max = 2000) => sanitize(String(msg).trim(), max);

export const normalizePhone = (phone = "") => {
  const digits = String(phone).replace(/[\s+\-()]/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9][0-9]{9}$/.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return digits;
};

export const validIndianPhone = (phone = "") => /^[6-9][0-9]{9}$/.test(phone);

export const validPin = (pin = "") => /^\d{6}$/.test(String(pin).trim());

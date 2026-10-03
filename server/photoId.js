// ============================================================================
// PHOTO IDs — a real, stable identifier per photo/video, in the format
// requested directly by the owner: CATEGORY-PRODUCT-##### (with COLOUR
// and SIZE segments inserted automatically once a product actually has
// that data — see below). The whole point: a human-readable reference
// either side of this conversation can use directly ("problem with
// photo LAMP-AETHER-83920") without hunting through a product list or
// a raw filename UUID neither of us can read at a glance.
//
// Deliberately does NOT include a literal placeholder for color/size
// today (e.g. "NA-NA") — every current product has neither, since size/
// color variants are Phase 4 work, not yet built. Baking a placeholder
// into the ID now would mean every existing ID changes the moment
// Phase 4 ships, which defeats the whole point of a STABLE identifier.
// Instead, buildPhotoId() already accepts color/size as optional
// arguments; they're simply omitted from the ID whenever a product
// doesn't have real values for them yet, and start appearing
// automatically, with zero format change, once Phase 4 gives a product
// genuine color/size data.
// ============================================================================

// Known category short codes for the current, real catalog. Falls back to
// a derived code (first 4 letters, uppercased, non-letters stripped) for
// any category not in this list — category is free-text in the database,
// not a fixed enum, so a future category must still produce a sensible
// code rather than breaking.
const CATEGORY_CODES = {
  "Ceiling Lighting": "CEIL",
  "Floor Lamps": "FLR",
  "Lanterns": "LANT",
  "Planters": "PLNT",
  "Table Lamps": "TBL",
  "Vases": "VASE",
};

function categoryCode(category) {
  if (CATEGORY_CODES[category]) return CATEGORY_CODES[category];
  const letters = String(category || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 4) || "GEN";
}

// The product's own id (e.g. "aether-pendant-lamp") is already a clean,
// deterministic slug — reusing its first segment ("aether") rather than
// abbreviating the human-readable `name` field keeps this consistent
// with data that already exists and never needs a separate mapping.
function productCode(productId) {
  const first = String(productId || "").split("-")[0];
  return (first || "PROD").toUpperCase().slice(0, 12);
}

function shortCode(value, maxLen = 6) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, maxLen);
}

// existingIds: a Set of every photoId already in use across the whole
// catalog (not just this one product) — the 5-digit number must be
// globally unique, not just unique within one product's own gallery, so
// two different products' photos can never collide on the same ID.
export function buildPhotoId({ category, productId, color, size, existingIds }) {
  const parts = [categoryCode(category), productCode(productId)];
  if (color) parts.push(shortCode(color, 4));
  if (size) parts.push(shortCode(size, 3));

  // Genuinely random each attempt (matches what was asked for — not a
  // predictable counter), re-rolled on the rare collision rather than
  // assumed unique on the first try.
  let digits;
  do {
    digits = String(Math.floor(10000 + Math.random() * 90000));
  } while (existingIds.has(`${parts.join("-")}-${digits}`));

  return `${parts.join("-")}-${digits}`;
}

// Pulls every photoId already present across an entire product list's
// media arrays, so a new one can be checked against the real, current
// set rather than assumed collision-free.
//
// REAL BUG FIX: found directly from a real admin's upload failing with
// "Something went wrong" on every attempt. Traced to two real product
// rows (leftover from the variant-merge migration) whose media column
// held {} instead of [] — genuinely different from a missing/null
// value, which the old `p.media || []` fallback handled fine, but {}
// is truthy and passes that check while still not being iterable,
// throwing "object is not iterable" the moment `for...of` ran over it.
// Since this function scans the ENTIRE catalog on every single upload
// (to check for a global photoId collision, not just one product's own
// gallery), a single malformed row anywhere in the table broke EVERY
// upload, not just uploads for that one product — matching exactly
// what was reported. Array.isArray() is the real, correct check here:
// unlike a truthy/falsy check, it genuinely confirms the value is safe
// to iterate before ever trying to.
export function collectExistingPhotoIds(products) {
  const ids = new Set();
  for (const p of products) {
    const media = Array.isArray(p.media) ? p.media : [];
    for (const m of media) {
      if (m && typeof m.photoId === "string") ids.add(m.photoId);
    }
  }
  return ids;
}

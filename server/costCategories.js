// Real, fixed set of per-product cost categories — material, labor,
// electricity, packaging, transport, design, and a real catch-all
// "other." Deliberately a closed, real set (not free-form, admin-typed
// keys) so every real product's cost_breakdown JSONB value has the
// exact same real shape, and every real place that reads it (the
// product editor's save validation, the profit dashboard's per-unit
// cost calculation) can rely on that shape without defensive checks.
// Kept in its own, small, shared module rather than defined separately
// in server/routes/admin/products.js AND server/routes/admin/
// dashboard.js — two, real, independent copies of the same real list
// would only need to silently drift out of sync once for a genuine,
// real bug (a cost category counted in the editor but silently
// ignored in the dashboard's profit math, or vice versa).
export const COST_CATEGORIES = ["material", "labor", "electricity", "packaging", "transport", "design", "other"];

import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth.js";

const router = Router();

// GET /api/wishlist — every product ID the logged-in customer has saved,
// scoped strictly to their own account.
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT product_id FROM wishlist_items WHERE customer_id=$1 ORDER BY created_at DESC", [req.customer.id]);
  res.json({ productIds: rows.map(r => r.product_id) });
}));

// POST /api/wishlist/merge — MUST be registered before the /:productId
// routes below, otherwise Express matches "merge" as a literal product ID
// against POST /:productId instead of this handler (caught exactly this
// way during testing — a real product_id='merge' row got inserted before
// this was reordered). Called once right after login. A guest may have
// wishlisted items locally (localStorage) before ever signing in; this
// folds those into their real account wishlist instead of silently
// discarding them the moment they log in, which would otherwise look
// like "the thing I just saved vanished."
router.post("/merge", requireAuth, asyncHandler(async (req, res) => {
  const { productIds } = req.body || {};
  if (Array.isArray(productIds)) {
    for (const id of productIds.slice(0, 200)) {
      if (typeof id === "string" && id) {
        await query("INSERT INTO wishlist_items (customer_id, product_id) VALUES ($1,$2) ON CONFLICT (customer_id, product_id) DO NOTHING", [req.customer.id, id]);
      }
    }
  }
  const { rows } = await query("SELECT product_id FROM wishlist_items WHERE customer_id=$1 ORDER BY created_at DESC", [req.customer.id]);
  res.json({ productIds: rows.map(r => r.product_id) });
}));

// POST /api/wishlist/:productId — idempotent add. ON CONFLICT DO NOTHING
// means adding something already there is a harmless no-op, not an error
// — matters because the frontend's toggle button can fire this from
// multiple places without needing to first check current state.
router.post("/:productId", requireAuth, asyncHandler(async (req, res) => {
  await query(
    "INSERT INTO wishlist_items (customer_id, product_id) VALUES ($1,$2) ON CONFLICT (customer_id, product_id) DO NOTHING",
    [req.customer.id, req.params.productId]
  );
  res.status(201).json({ ok: true });
}));

router.delete("/:productId", requireAuth, asyncHandler(async (req, res) => {
  await query("DELETE FROM wishlist_items WHERE customer_id=$1 AND product_id=$2", [req.customer.id, req.params.productId]);
  res.json({ ok: true });
}));

export default router;

#!/usr/bin/env node
/**
 * WHAT: Force-refresh legal/ops CMS pages from server/seed-cms.js PAGES.
 * WHY: Live site must match real rules (10-min cancel, returns only after delivery,
 *      account deletion retention). Normal db:sync does NOT touch CMS.
 * HOW: DELETE page_content rows for selected keys, then INSERT seed blocks.
 * CONNECTED TO: Admin → Site content; customer FAQ/Refund/Shipping/Privacy pages.
 *
 * Usage (Railway shell after deploy):
 *   node server/cms-legal-sync.js
 * or: npm run cms:legal-sync
 */
import { query, pool } from "./db.js";
import { PAGES } from "./seed-cms.js";

const KEYS = ["refund", "shipping", "privacy", "faq", "return-request", "terms"];

async function main() {
  for (const key of KEYS) {
    const blocks = PAGES[key];
    if (!blocks || !blocks.length) {
      console.log(`Skip "${key}" — no seed blocks.`);
      continue;
    }
    await query("DELETE FROM page_content WHERE page_key=$1", [key]);
    for (let i = 0; i < blocks.length; i++) {
      await query(
        "INSERT INTO page_content (page_key, sort_order, block_type, content) VALUES ($1,$2,$3,$4)",
        [key, i, blocks[i].type, blocks[i].content]
      );
    }
    console.log(`Replaced "${key}" — ${blocks.length} blocks.`);
  }
  console.log("\n✓ cms:legal-sync done. Check Refund, Shipping, Privacy, FAQ on the live site.");
}

main()
  .catch((err) => {
    console.error("cms:legal-sync failed:", err?.message || err);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => {}));

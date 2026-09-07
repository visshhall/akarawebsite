#!/usr/bin/env node
/**
 * Force-refresh the Privacy Policy CMS page from seed-cms.js's current
 * definition — needed specifically because seed-cms.js itself only ever
 * inserts content for a page that has NONE yet; it deliberately never
 * overwrites an already-seeded page (so a real admin edit from the
 * dashboard is never silently clobbered by re-running the seed script).
 * That's the right default, but it means the new Google Sign-In
 * disclosure added to the privacy policy (added directly in response to
 * a real Google OAuth verification rejection citing insufficient
 * privacy policy content) will never actually reach the live database
 * without a real, deliberate, one-time force-refresh — this script.
 *
 * Usage (Railway / local): node server/update-privacy.js
 */
import { query, pool } from "./db.js";

const { PAGES } = await import("./seed-cms.js");

async function replacePage(pageKey) {
  const blocks = PAGES[pageKey];
  if (!blocks?.length) throw new Error(`No blocks for ${pageKey}`);
  await query("DELETE FROM page_content WHERE page_key=$1", [pageKey]);
  for (let i = 0; i < blocks.length; i++) {
    await query(
      "INSERT INTO page_content (page_key, sort_order, block_type, content) VALUES ($1,$2,$3,$4)",
      [pageKey, i, blocks[i].type, blocks[i].content]
    );
  }
  console.log(`Replaced "${pageKey}" — ${blocks.length} blocks.`);
}

async function main() {
  await replacePage("privacy");
  console.log("Done. Privacy Policy page updated with the Google Sign-In disclosure.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});

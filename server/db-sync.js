#!/usr/bin/env node
/**
 * ONE command for Railway / production after deploying new code:
 *   npm run db:sync
 *
 * Runs in order:
 *   1) schema.sql migrate (idempotent IF NOT EXISTS)
 *   2) Force-refresh FAQ + Refund CMS pages from seed-cms.js
 *
 * Does NOT drop push subscriptions or reseed the whole CMS.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, query } from "./db.js";
import { PAGES } from "./seed-cms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrate() {
  const sql = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf-8");
  console.log("[1/2] Running schema.sql (idempotent)…");
  await pool.query(sql);
  console.log("[1/2] Migration complete.");
}

async function replacePage(pageKey) {
  const blocks = PAGES[pageKey];
  if (!blocks?.length) throw new Error(`No blocks for page_key="${pageKey}" in seed-cms.js`);
  await query("DELETE FROM page_content WHERE page_key=$1", [pageKey]);
  for (let i = 0; i < blocks.length; i++) {
    await query(
      "INSERT INTO page_content (page_key, sort_order, block_type, content) VALUES ($1,$2,$3,$4)",
      [pageKey, i, blocks[i].type, blocks[i].content]
    );
  }
  console.log(`  Replaced "${pageKey}" — ${blocks.length} blocks.`);
}

async function runCmsFaqReturns() {
  console.log("[2/2] Updating FAQ + Refund CMS pages…");
  await replacePage("faq");
  await replacePage("refund");
  console.log("[2/2] CMS FAQ + Refund done.");
}

async function main() {
  try {
    await runMigrate();
    await runCmsFaqReturns();
    console.log("\n✓ db:sync finished. Next: npm run build (if not already) and restart if needed.");
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("db:sync failed:", err?.message || err);
  process.exit(1);
});

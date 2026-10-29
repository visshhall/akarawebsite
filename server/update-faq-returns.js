#!/usr/bin/env node
/**
 * Force-refresh FAQ + Refund CMS pages from seed-cms.js definitions.
 * Usage (Railway / local): node server/update-faq-returns.js
 * Deletes existing faq + refund blocks, then inserts the latest seed content.
 */
import { query, pool } from "./db.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import PAGES by dynamically evaluating is hard; duplicate import from seed:
// We re-run the same structure by importing seed module — seed only exports via main.
// Instead: read blocks from a shared export. Patch seed-cms to export PAGES.
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
  await replacePage("faq");
  await replacePage("refund");
  // terms is multi-block; only update if we want full terms reseed — skip unless empty
  console.log("Done. FAQ and Refund policy pages updated.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});

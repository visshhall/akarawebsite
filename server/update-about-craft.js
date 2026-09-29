/**
 * Replace About + Craft CMS pages with seed-cms.js content.
 * Run on Railway: node server/update-about-craft.js
 */
import { query } from "./db.js";
import { PAGES } from "./seed-cms.js";

async function replacePage(pageKey) {
  const blocks = PAGES[pageKey];
  if (!blocks?.length) throw new Error(`No blocks for ${pageKey}`);
  await query("DELETE FROM page_content WHERE page_key=$1", [pageKey]);
  for (let i = 0; i < blocks.length; i++) {
    await query(
      `INSERT INTO page_content (page_key, sort_order, block_type, content) VALUES ($1,$2,$3,$4)`,
      [pageKey, i, blocks[i].type, blocks[i].content]
    );
  }
  console.log(`Replaced "${pageKey}" — ${blocks.length} blocks.`);
}

async function main() {
  await replacePage("about");
  await replacePage("craft");
  console.log("✓ About + Craft CMS updated.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

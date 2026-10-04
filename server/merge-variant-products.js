// ============================================================================
// ONE-TIME MERGE — Vermillion Pendant Lamp (Black/Red) and Helion Vase
// (Black/Bronze/White) from 5 separate product rows into 2 real,
// merged products with color variants. Confirmed spec:
//   - ONE description per merged product (owner will write copy that
//     covers all colors together, rather than each color keeping its
//     own separate write-up) — the first/default color's real existing
//     description is used as the starting point, since it's real
//     written content, not a placeholder; owner can rewrite it via the
//     admin editor afterward.
//   - Dimensions: each color's real, different measurements are kept —
//     genuinely different per color for both product groups (confirmed
//     directly against the live data before writing this script), so
//     product_variants.dims carries the per-color override, and the
//     product-level dims field becomes a bulleted summary of all of
//     them (using the new multi-line dims support).
//   - Order history is completely unaffected — orders.items is a
//     JSONB SNAPSHOT taken at purchase time (confirmed directly in
//     db/schema.sql before writing this), not a live foreign-key
//     reference, so past orders keep showing exactly what was actually
//     purchased regardless of what happens to the live catalog here.
//
// Safe to run only once — checks for the new merged product IDs
// existing first and refuses to run again if so, rather than risk
// creating duplicate variant rows on a second accidental run.
// ============================================================================
import { query, pool } from "./db.js";

const MERGES = [
  {
    newId: "vermillion-pendant-lamp",
    name: "Vermillion Pendant Lamp",
    category: "Ceiling Lighting",
    hsn: "9405",
    oldIds: ["vermillion-lamp-black", "vermillion-lamp-red"],
    colors: [
      { variantKey: "black", label: "Black", swatch: "#1a1a1a", price: 2066, dims: "12cm × 10cm × 20cm · 0.4kg" },
      { variantKey: "red", label: "Red", swatch: "#b91c1c", price: 2068, dims: "12cm × 10cm × 15cm · 0.4kg" },
    ],
  },
  {
    newId: "helion-vase",
    name: "Helion Vase",
    category: "Vases",
    hsn: "3924",
    oldIds: ["helion-vase-black", "helion-vase-bronze", "helion-vase-white"],
    colors: [
      { variantKey: "black", label: "Black", swatch: "#1a1a1a", price: 300, dims: "9cm × 9cm × 10cm · 0.13kg" },
      { variantKey: "bronze", label: "Bronze", swatch: "#8c6a3f", price: 370, dims: "6cm × 6cm × 25cm · 0.15kg" },
      { variantKey: "white", label: "White", swatch: "#f5f5f0", price: 370, dims: "10cm × 10cm × 20cm · 0.15kg" },
    ],
  },
];

async function main() {
  for (const merge of MERGES) {
    const { rows: existing } = await query("SELECT id FROM products WHERE id=$1", [merge.newId]);
    if (existing.length > 0) {
      console.log(`Skipping "${merge.newId}" — already exists. Delete it first if you genuinely want to redo this merge.`);
      continue;
    }

    // Real existing data, pulled directly rather than hardcoded a
    // second time — description, meta fields, media, and status come
    // from whichever old row is the "primary" (first-listed) color, so
    // real written content isn't discarded for a placeholder.
    const { rows: oldRows } = await query(
      "SELECT * FROM products WHERE id = ANY($1) ORDER BY array_position($1, id)",
      [merge.oldIds]
    );
    if (oldRows.length !== merge.oldIds.length) {
      console.log(`Skipping "${merge.newId}" — expected ${merge.oldIds.length} old products, found ${oldRows.length}. Nothing changed.`);
      continue;
    }
    const primary = oldRows[0];

    const bulletedDims = merge.colors.map(c => `${c.label}: ${c.dims}`).join("\n");

    await query(
      `INSERT INTO products (id, name, category, price, dims, hsn, status, description, meta_title, meta_desc, media)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        merge.newId, merge.name, merge.category, merge.colors[0].price, bulletedDims, merge.hsn,
        primary.status, primary.description, primary.meta_title, primary.meta_desc, primary.media,
      ]
    );

    for (let i = 0; i < merge.colors.length; i++) {
      const c = merge.colors[i];
      const { rows: colorRows } = await query(
        "INSERT INTO product_colors (product_id, variant_key, label, swatch_hex, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [merge.newId, c.variantKey, c.label, c.swatch, i]
      );
      await query(
        "INSERT INTO product_variants (product_id, color_id, price, status, dims) VALUES ($1,$2,$3,$4,$5)",
        [merge.newId, colorRows[0].id, c.price, "in-stock", c.dims]
      );
    }

    // The old rows are DELETED here — this is safe specifically BECAUSE
    // orders.items is a snapshot (see this file's own header comment);
    // nothing live still points at these old IDs by reference.
    await query("DELETE FROM products WHERE id = ANY($1)", [merge.oldIds]);

    console.log(`Merged ${merge.oldIds.join(", ")} → "${merge.newId}" with ${merge.colors.length} color variants.`);
  }
  await pool.end();
}

main().catch(err => {
  console.error("Merge failed:", err);
  process.exit(1);
});

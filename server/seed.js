// Seeds the products table from db/seed-products.json — which was
// generated directly from the current CATALOG + SEO_COPY data in
// AkaraApp.jsx (not manually retyped, to avoid transcription errors
// across 31 products). Uses ON CONFLICT DO UPDATE, so this is safe to
// re-run any time the frontend's product data changes: it'll insert new
// products and update existing ones by id, never duplicate.
//
// Usage: npm run seed
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function seed() {
  const products = JSON.parse(
    readFileSync(path.join(__dirname, "..", "db", "seed-products.json"), "utf-8")
  );
  console.log(`Seeding ${products.length} products...`);

  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, name, category, price, dims, hsn, description, meta_title, meta_desc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, category=$3, price=$4, dims=$5, hsn=$6,
         description=$7, meta_title=$8, meta_desc=$9, updated_at=now()`,
      [p.id, p.name, p.category, p.price, p.dims, p.hsn, p.description, p.metaTitle, p.metaDesc]
    );
  }

  const { rows } = await pool.query("SELECT count(*) FROM products");
  console.log(`Done. products table now has ${rows[0].count} rows.`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

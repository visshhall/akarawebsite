#!/usr/bin/env node
/**
 * ONE command for Railway / production after deploying new code:
 *   npm run db:sync
 *
 * Runs schema.sql only (idempotent IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * Does NOT touch CMS pages (FAQ, Refund, or anything in page_content) —
 * admin/CMS edits stay as-is so live content is never forced back to old seed copy.
 *
 * Extra ALTERs below catch coupon columns if an older schema.sql deploy skipped them.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrate() {
  const sql = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf-8");
  console.log("Running schema.sql (idempotent)…");
  await pool.query(sql);
  console.log("Migration complete.");

  // Coupon placement / identity columns (safe if already present)
  await pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount_amount INTEGER`);
  await pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS show_on_banner BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS show_on_checkout BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_amount INTEGER`);
  console.log("[db:sync] coupons columns ensured (first_order_only, max_discount_amount, show_on_banner, show_on_checkout)");
}

async function main() {
  try {
    await runMigrate();
    console.log("\n✓ db:sync finished (schema only — CMS pages not modified).");
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("db:sync failed:", err?.message || err);
  process.exit(1);
});

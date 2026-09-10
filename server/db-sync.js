#!/usr/bin/env node
/**
 * ONE command for Railway / production after deploying new code:
 *   npm run db:sync
 *
 * Runs schema.sql only (idempotent IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 * Does NOT touch CMS pages (FAQ, Refund, or anything in page_content) —
 * admin/CMS edits stay as-is so live content is never forced back to old seed copy.
 *
 * To intentionally refresh FAQ/Refund from seed-cms.js, run a dedicated script
 * later if needed — not part of normal db:sync.
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

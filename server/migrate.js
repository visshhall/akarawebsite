// Runs db/schema.sql against whatever DATABASE_URL points to. Safe to run
// multiple times — every statement in schema.sql uses IF NOT EXISTS, so
// re-running just confirms everything's already there rather than erroring.
//
// Usage:
//   npm run migrate          (uses DATABASE_URL from the environment)
//
// On Railway, this should be run once after the database is first
// provisioned (see README for the exact command), and again any time
// schema.sql changes.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf-8");
  console.log("Running schema.sql against the database...");
  await pool.query(sql);
  console.log("Migration complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

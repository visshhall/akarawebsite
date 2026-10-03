import { pool } from "./db.js";

const SQL = `
DROP TABLE IF EXISTS push_subscriptions;
CREATE TABLE push_subscriptions (
  id              SERIAL PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  admin_id        INTEGER,
  customer_id     TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_admin ON push_subscriptions(admin_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON push_subscriptions(customer_id);
`;

async function main() {
  console.log("Creating push_subscriptions (UUID-safe, no customer FK)...");
  await pool.query(SQL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'push_subscriptions' ORDER BY ordinal_position`
  );
  console.log("OK — columns:", rows.map((r) => r.column_name + ":" + r.data_type).join(", "));
  await pool.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

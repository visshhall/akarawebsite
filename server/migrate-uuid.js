// ============================================================================
// ONE-TIME MIGRATION — converts customers.id from SERIAL (integer) to a
// real UUID. Deliberately a standalone script, NOT part of db/schema.sql
// — every other change in that file is designed to be safely re-run on
// every deploy; this is a one-time, structural change to a live primary
// key with 5 real dependent foreign keys (addresses, orders,
// wishlist_items, reviews, return_requests), and re-running it against
// an already-migrated database would be actively wrong, not just a
// no-op.
//
// WHY THIS IS SAFE TO RUN, checked directly before writing this:
//   - Every application code path (server AND frontend, confirmed via
//     direct search of both) already treats customer.id as an OPAQUE
//     VALUE — passed through parameterized queries and JWT payloads,
//     never parsed as a number, compared numerically, or used in any
//     integer-specific way. This migration is a real database schema
//     change, not an application rewrite.
//   - orders.customer_id and return_requests.customer_id are already
//     ON DELETE SET NULL, meaning an order/return-request never
//     actually requires its customer_id to resolve to a real, live row
//     — a genuinely orphaned reference (there shouldn't be any, but if
//     one somehow existed) fails safely rather than corrupting data.
//
// THE APPROACH (why this exact sequence, not a simpler one):
// You cannot ALTER COLUMN a primary key from integer to UUID in place
// while 5 other tables hold live foreign keys pointing at the OLD
// integer values — Postgres has no single command for "change this PK's
// type and cascade the new values to every dependent table". So:
//   1. Add a new UUID column to customers, populate every row with a
//      real, fresh UUID.
//   2. Add a matching nullable UUID column to EACH dependent table.
//   3. Populate each dependent table's new UUID column by looking up
//      the OLD integer customer_id and finding that customer's NEW
//      uuid — this is the actual "carry the mapping across" step.
//   4. Drop every old integer foreign key constraint and the old
//      integer customer_id columns (both on customers.id itself and on
//      every table pointing at it).
//   5. Rename every new uuid column to customer_id, re-add real foreign
//      key constraints and the primary key, matching the exact
//      ON DELETE behavior each table already had.
// All five steps run inside ONE transaction — if anything fails partway,
// the whole migration rolls back cleanly rather than leaving the
// database in a half-migrated state with two different ID systems.
// ============================================================================
import { pool, query } from "./db.js";

const DEPENDENT_TABLES = [
  { table: "addresses", onDelete: "CASCADE", notNull: true },
  { table: "orders", onDelete: "SET NULL", notNull: false },
  { table: "wishlist_items", onDelete: "CASCADE", notNull: true },
  { table: "reviews", onDelete: "SET NULL", notNull: false },
  { table: "return_requests", onDelete: "SET NULL", notNull: false },
];

async function main() {
  const client = await pool.connect();
  try {
    // Real, upfront check: refuses to run a second time on an already-
    // migrated database, rather than silently doing something wrong to
    // a customers table that's already using UUIDs.
    const { rows: typeCheck } = await client.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='customers' AND column_name='id'`
    );
    if (typeCheck[0]?.data_type === "uuid") {
      console.log("customers.id is already a UUID — this migration has already run. Nothing to do.");
      return;
    }

    await client.query("BEGIN");

    console.log("Step 1: adding a real UUID to every existing customer...");
    await client.query("ALTER TABLE customers ADD COLUMN new_id UUID DEFAULT gen_random_uuid()");
    await client.query("UPDATE customers SET new_id = gen_random_uuid() WHERE new_id IS NULL");
    await client.query("ALTER TABLE customers ALTER COLUMN new_id SET NOT NULL");

    for (const { table } of DEPENDENT_TABLES) {
      console.log(`Step 2/3: adding + populating the new UUID column on ${table}...`);
      await client.query(`ALTER TABLE ${table} ADD COLUMN new_customer_id UUID`);
      await client.query(
        `UPDATE ${table} t SET new_customer_id = c.new_id FROM customers c WHERE t.customer_id = c.id`
      );
    }

    console.log("Step 4: dropping the old integer foreign keys and columns...");
    for (const { table } of DEPENDENT_TABLES) {
      const { rows: fkRows } = await client.query(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name=$1 AND constraint_type='FOREIGN KEY'`,
        [table]
      );
      for (const fk of fkRows) {
        await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.constraint_name}`);
      }
      await client.query(`ALTER TABLE ${table} DROP COLUMN customer_id`);
    }
    await client.query("ALTER TABLE customers DROP CONSTRAINT customers_pkey");
    await client.query("ALTER TABLE customers DROP COLUMN id");

    console.log("Step 5: renaming the new columns into place and re-adding real constraints...");
    await client.query("ALTER TABLE customers RENAME COLUMN new_id TO id");
    await client.query("ALTER TABLE customers ADD PRIMARY KEY (id)");

    for (const { table, onDelete, notNull } of DEPENDENT_TABLES) {
      await client.query(`ALTER TABLE ${table} RENAME COLUMN new_customer_id TO customer_id`);
      if (notNull) await client.query(`ALTER TABLE ${table} ALTER COLUMN customer_id SET NOT NULL`);
      await client.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_customer_id_fkey
         FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE ${onDelete}`
      );
      // Real indexes on customer_id already existed before this
      // migration (idx_addresses_customer, idx_orders_customer, etc.) —
      // dropped implicitly when their column was dropped above, so
      // they're recreated here rather than left silently missing,
      // which would quietly degrade real query performance.
      await client.query(`CREATE INDEX idx_${table}_customer ON ${table}(customer_id)`);
    }

    // reviews and wishlist_items each had a real UNIQUE(customer_id,
    // product_id) constraint before this migration — dropped implicitly
    // along with the old column, recreated here so "one review per
    // product per customer" and "no duplicate wishlist entries" both
    // keep being enforced by the database itself, not just application
    // logic.
    await client.query("ALTER TABLE reviews ADD CONSTRAINT reviews_customer_id_product_id_key UNIQUE(customer_id, product_id)");
    await client.query("ALTER TABLE wishlist_items ADD CONSTRAINT wishlist_items_customer_id_product_id_key UNIQUE(customer_id, product_id)");

    await client.query("COMMIT");
    console.log("Migration complete. customers.id and every dependent customer_id column are now real UUIDs.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed and was rolled back — no partial changes were kept:", err);
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch(() => process.exit(1));

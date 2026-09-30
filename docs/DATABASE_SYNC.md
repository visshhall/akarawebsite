# ĀKĀRA — Database sync architecture

**Last updated:** 23 September 2026

## Goal

Keep production Postgres schema aligned with the code in this repo **without** wiping live CMS copy, orders, or customers.

## Single entry point

```bash
npm run db:sync
# → node server/db-sync.js
```

Run this on **Railway shell** (or any host with `DATABASE_URL`) after deploying schema-changing code.

## What runs

1. **`db/schema.sql`** (entire file) via `pool.query(sql)`
   - Written to be **idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, safe indexes.
   - Safe to re-run: does not `DROP` customer data in normal paths.
2. **Extra coupon column ensures** (defensive if an older deploy skipped schema lines):
   - `coupons.first_order_only`
   - `coupons.max_discount_amount`
   - `coupons.show_on_banner`
   - `coupons.show_on_checkout`

## What does *not* run

| Action | Why |
|--------|-----|
| CMS / FAQ / Refund page reseed | Would overwrite admin edits in `page_content` |
| Product seed wipe | Live catalogue is authoritative |
| Destructive `DROP TABLE` of orders/customers | Never in db-sync |

Optional historical scripts (`server/migrate.js`, `cms-legal-sync.js`) are **not** part of `db:sync`. Use only when intentionally refreshing legal copy from seed.

## Connection layer

- `server/db.js` exports `pool` (and usually `query` helpers used by routes).
- **`db-sync.js` must use `pool.query` only** — a bare `query` without import caused production failure (`query is not defined`).

## Flow diagram (ops)

```
Deploy code (Railway build)
        │
        ▼
  npm run db:sync
        │
        ├─ schema.sql  ──► tables / columns / indexes
        ├─ coupon ALTERs ──► placement & abuse columns
        └─ exit 0
        │
        ▼
  App serves traffic (same DATABASE_URL)
```

## When you add a new column

1. Add `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` (or table create) to **`db/schema.sql`**.
2. Optionally mirror critical columns in `db-sync.js` extra ensures (coupons pattern).
3. Deploy + `npm run db:sync`.
4. Document in README changelog.

## Related commands

| Command | Role |
|---------|------|
| `npm run db:sync` | Production-safe schema align |
| `npm run migrate` | Legacy migrate runner (prefer db:sync) |
| App routes | Runtime data only; never alter schema |

## Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `query is not defined` | Bare `query()` in db-sync | Use `pool.query` |
| `relation "…" does not exist` | Sync never run after deploy | `npm run db:sync` |
| CMS text “reset” | Wrong script reseeded pages | Do not run cms seed on routine deploys |

# Weekly documentation update (Ākāra)

**Last process refresh:** 1 October 2026

Run this checklist **at least weekly**, and **after every meaningful ship** (new SW version, schema change, or public UX change).

## Checklist

1. **SW / version** — Read `SW_VERSION` from `public/sw.js` (must match `.sw-version-lock` after build).
2. **README.md** (root)
   - Bump **Last updated** + **Latest SW version** at the top.
   - **Prepend** a changelog block under the newest month section (do **not** delete older September/August history).
   - Include: date, SW id, why, what/how, files, deploy notes (`db:sync` yes/no).
3. **docs/AKARA_PROJECT_DOCUMENTATION.md**
   - Add a dated section when behaviour or architecture changes (shop UX, ads, payments, schema, auth).
4. **docs/AKARA_Master_Pending_List.md**
   - Move finished items to **Recently closed**.
   - Keep **Still open** honest.
   - Refresh **SW version trail** table.
5. **docs/DATABASE_SYNC.md** — only if schema/sync process changed.
6. **docs/AKARA_MARKETING_ADS.md** (+ `docs/` copy if kept in sync) — Ads/GA/Meta/creative progress.
7. **Zip / release** — Customer-facing zip should include updated README + pending + project doc, not only `src/`.

## Do not

- Reseed CMS via one-off scripts on a normal content week unless intentional.
- Leave README SW version lagging live `/sw.js`.
- Overwrite README with a 30-line stub (incident: late Sep 2026 — recovered from full history).
- Ship `public/sw.js` byte changes without a new `SW_VERSION` string.

## Template (paste into README)

```markdown
### DD Mon YYYY — short title (`vNNN`)

**SW:** `YYYY-MM-DD-slug-vNNN`

**Why:** …

**What / how:**
- …

**Files:** …

**Deploy:** `npm run db:sync` if schema changed; confirm `/sw.js` shows new SW_VERSION.
```

## Recent compliance (1 Oct 2026)

- README prepended with v114 icons + v115 atmosphere; header SW → v115.
- Project doc + master pending + this weekly file updated same day.

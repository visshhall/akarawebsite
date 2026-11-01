# Weekly documentation update process

**Last reviewed:** 29 October 2026

Update docs **weekly**, and **after every meaningful ship** (new SW version, schema change, or public UX change).

## Checklist

1. **SW / version** — Read `SW_VERSION` from `public/sw.js` (must match `.sw-version-lock` after build). Current ship: `2026-10-29-cat-icon-accessories-v122`.
2. **README.md** (root)
   - Bump **Last updated** + **Latest SW version** + **Packaged** date.
   - **Prepend** a changelog block under the newest date section (do **not** delete older history).
   - Include: date, SW id, why, what/how, files, deploy notes (`db:sync` yes/no).
3. **docs/AKARA_PROJECT_DOCUMENTATION.md**
   - Add a dated section when behaviour or architecture changes (shop UX, icons, ads, payments, schema, auth).
4. **docs/AKARA_Master_Pending_List.md**
   - Move finished items to completed sections.
   - Keep **Still open** honest.
   - Refresh **SW trail** table.
5. **docs/DATABASE_SYNC.md** — only if schema/sync process changed.
6. **docs/AKARA_MARKETING_ADS.md** — Ads/GA/Meta/creative progress when relevant.
7. **Zip / release** — Include updated README + `docs/`, not only `src/`.

## Do not

- Reseed CMS via one-off scripts on a normal content week unless intentional.
- Leave README SW version lagging live `/sw.js`.
- Overwrite README with a short stub (incident: late Sep 2026 — recovered from full history).
- Ship `public/sw.js` byte changes without a new `SW_VERSION` string.

## Template (paste into README)

```markdown
### DD Mon YYYY — short title (`vNNN`)

**SW:** `YYYY-MM-DD-slug-vNNN`

**Why:** …

**What / how:**
- …

**Files:** …

**Deploy:** … (`db:sync` yes/no)
```

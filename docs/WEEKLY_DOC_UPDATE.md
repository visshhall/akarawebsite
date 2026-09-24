# Weekly documentation update (ĀKĀRA)

**Cadence:** every week (or after any significant ship), same day you do a production deploy.

## Checklist

1. **SW / version** — Note current `SW_VERSION` from `public/sw.js`.
2. **README.md**
   - Bump **Last updated** + **Latest SW version** at the top.
   - Add a short changelog block: date, why, what/how, files, deploy notes.
3. **AKARA_PROJECT_DOCUMENTATION.md**
   - Architecture behaviour only when something structural changed (payments, schema, auth, refunds).
4. **AKARA_Master_Pending_List.md**
   - Move finished items to **Recently closed**.
   - Keep **Still open** honest (Ads, PWA opt-in, etc.).
5. **docs/DATABASE_SYNC.md** — only if schema/sync process changed.
6. **AKARA_MARKETING_ADS.md** — only if Ads/GA work moved.

## Do not

- Reseed CMS via docs scripts on a normal week.
- Leave README SW version lagging the live `/sw.js`.

## Template (paste into README)

```markdown
### DD Mon YYYY — short title (`vNNN`)

**Why:** …

**What / how:**
- …

**Files:** …

**Deploy:** `npm run db:sync` if schema changed; confirm `/sw.js`.
```

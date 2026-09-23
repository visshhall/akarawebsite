# ĀKĀRA — Master pending list

**Updated:** 23 September 2026

## Recently closed (19–23 Sep 2026)

- [x] Server-side validation for profile/address/checkout fields
- [x] Low-stock “N remaining” + max units per order (5 / stock)
- [x] Google Sign-In button without brand frame
- [x] Coupon identity abuse + account-delete archive
- [x] Sold-out status not overridden by leftover stock_qty
- [x] Product ID auto-slug on create
- [x] Coupon placement (banner vs checkout) + single coupon per order
- [x] Tax invoice PDF professional layout
- [x] Category normalize + related products + category dropdown
- [x] Header Hindi size match to wordmark
- [x] `db:sync` `query is not defined` → `pool.query`
- [x] Partial refund deep UX polish (presets, %, remaining preview, payment context)
- [x] Database sync architecture doc (`docs/DATABASE_SYNC.md`)
- [x] Weekly documentation process (`docs/WEEKLY_DOC_UPDATE.md`)

## Still open / product choice

- [ ] Google Ads / GA4 / Merchant Center full go-live (`AKARA_MARKETING_ADS.md`)
- [ ] Device fingerprinting (optional; only if automated abuse appears)
- [ ] Admin CMS for remaining homepage strings not yet editable
- [ ] Customer PWA push adoption (infra present; opt-in rate is ops)
- [ ] Optional: product slug rename + redirect map after create

## Ops hygiene

- Weekly: follow `docs/WEEKLY_DOC_UPDATE.md`
- Schema: follow `docs/DATABASE_SYNC.md` — always `npm run db:sync` after column changes
- Always bump `SW_VERSION` when `public/sw.js` bytes change

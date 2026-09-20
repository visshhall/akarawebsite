## Recently closed (19 Sep 2026)

- [x] Studio capacity UI + list warnings
- [x] Legal CMS aligned with live cancel/returns/retention

# ĀKĀRA — Master pending list

**Updated:** 19 September 2026

## Recently closed (19 Sep 2026)

- [x] Server-side validation for profile/address/checkout fields
- [x] Low-stock “N remaining” + max units per order (5 / stock)
- [x] Google Sign-In button without brand frame
- [x] Coupon identity abuse + account-delete archive

## Still open / product choice

- [ ] Google Ads / GA4 / Merchant Center full go-live (`AKARA_MARKETING_ADS.md`)
- [ ] Device fingerprinting (optional; only if automated abuse appears)
- [ ] Admin CMS for every homepage string (hero image already admin-controlled)
- [ ] Partial refund deep UX polish if finance needs finer controls
- [ ] Customer PWA push adoption (infra present; opt-in rate ops)

## Ops hygiene

- Always bump `SW_VERSION` when `public/sw.js` bytes change
- Run `npm run db:sync` after schema changes
- Prefer server validation for any new form field (import from `server/validate.js`)

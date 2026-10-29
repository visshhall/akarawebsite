# ĀKĀRA — Master pending list

**Updated:** 1 October 2026  
**Latest shipped SW:** `2026-10-02-referral-5pct-v120`

## Engineering complete (`v120` referral + earlier)

- [x] **Referral invite:** friend 5% first order; referrer one-time 5% thank-you code (`v120`)

## Engineering complete this pass (`v116`)

- [x] Category **atmosphere photo** (optional HTTPS URL) — admin Catalog → Categories; public API + Shop `CategoryAtmosphere`
- [x] Default **SVG atmospheres** for all main categories (`v115`) when photo empty
- [x] Homepage / section copy via CMS `home` + `home_sections` (admin Site content) — code only supplies **fallbacks** if CMS empty
- [x] Docs under `docs/`; README at root

## Still open — **ops / your accounts only** (not more site code)

- [ ] **Meta:** set Railway `META_PIXEL_ID` (+ optional `META_CAPI_ACCESS_TOKEN`); Test Events in Events Manager
- [ ] **Google Ads / GA4 / Merchant:** run campaigns in Google tools (`docs/AKARA_MARKETING_ADS.md`)
- [ ] **PWA push:** ask customers/admins to allow notifications (infra already live)
- [ ] **Creative backlog:** shoot lists / Reels / captions when you produce media (§7.7 marketing doc)

## Explicitly not building unless needed

- Device fingerprinting (only if automated abuse appears)
- Product slug rename + redirect map (only if you rename live URLs)

## Ops hygiene

- `npm run db:sync` after this deploy (adds `categories.atmosphere_image_url`)
- Bump `SW_VERSION` whenever `public/sw.js` bytes change
- Follow `docs/WEEKLY_DOC_UPDATE.md`

## SW trail

| Version | Note |
|---------|------|
| `2026-10-01-pending-complete-v116` | Atmosphere URL admin + API |
| `2026-10-01-category-atmosphere-v115` | SVG category atmospheres |
| `2026-10-01-category-icons-v114` | Icons + list UI |
| `2026-09-30-meta-ads-ready-v113` | Meta Pixel + CAPI + feeds |

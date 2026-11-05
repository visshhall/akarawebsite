# ĀKĀRA — Master pending list

**Updated:** 29 October 2026  
**Latest shipped SW:** `2026-10-29-cat-icon-accessories-v122`

## Engineering complete — 29 Oct 2026 (`v122`)

- [x] **Category icon `accessories` / `generic`** — neutral mark for non-décor categories (Gaming Accessories, etc.)
- [x] Admin Icon style dropdown extended; storefront never blank on unknown keys

## Engineering complete — early Oct 2026

- [x] Referral invite 5% (`v120`–`v121`) — friend first order + referrer thank-you code; display on order success
- [x] Category atmosphere photo URL + default SVG atmospheres (`v115`–`v116`)
- [x] Docs under `docs/`; full README changelog history retained

## Still open — **ops / your accounts** (not more site code)

- [ ] **Meta:** Railway `META_PIXEL_ID` (+ optional CAPI token); Test Events in Events Manager
- [ ] **Google Ads / GA4 / Merchant:** campaigns in Google tools — see `docs/AKARA_MARKETING_ADS.md`
- [ ] **PWA push:** customers/admins allow notifications (infra already live)
- [ ] **Creative backlog:** product photos / Reels when you produce media
- [ ] **Arattai OTP (optional):** OAuth tokens obtained earlier; still need approved template + wiring if replacing email OTP for signup
- [ ] **Custom category icons (optional product):** upload or larger icon set — only if accessories mark is not enough

## Behaviour notes (not bugs)

- Homepage **Shop by Category** shows only categories with **≥1 live product**.
- New category with no products: visible in admin; hidden on homepage grid until a product is assigned and published.

## Explicitly not building unless needed

- Device fingerprinting
- Product slug rename + redirect map (only if live URLs change)
- Full third-party icon pack

## Ops hygiene

- After `v122` deploy: **no** `db:sync` required (frontend + admin only)
- Bump `SW_VERSION` whenever `public/sw.js` bytes change
- Follow `docs/WEEKLY_DOC_UPDATE.md`

## SW trail (recent)

| Version | Note |
|---------|------|
| `2026-10-29-cat-icon-accessories-v122` | Accessories/generic category icon |
| `2026-10-02-referral-order-success-v121` | Referral UI on order confirmation |
| `2026-10-02-referral-5pct-v120` | Referral 5% system |
| `2026-10-01-pending-complete-v116` | Atmosphere URL admin + API |
| `2026-10-01-category-atmosphere-v115` | SVG category atmospheres |
| `2026-10-01-category-icons-v114` | Décor category icons + list UI |
| `2026-09-30-meta-ads-ready-v113` | Meta Pixel + CAPI + feeds |

# ĀKĀRA — Project documentation

**Last updated: 22 September 2026**

ĀKĀRA Website — Project Documentation

**Updated:** 19 September 2026  
**Site:** https://www.akaraonline.co.in  
**Stack:** Node/Express · Postgres · React/Vite · Railway · Cloudflare · R2 · Razorpay · Shiprocket · Resend · Gupshup · Turnstile  

This document covers work **after** the clean project zip was uploaded and the old workspace was discarded. It is the source of truth for what was built in that phase.

---

## Brand

| Token | Value |
|--------|--------|
| Teal | `#183630` |
| Cream | `#E3DAC9` |
| Gold | `#E5C690` |
| Type | Fraunces (display) + Space Grotesk (UI) |

Studio narrative: **made to order in Mumbai**, not white-labelled stock. Craft / About / PDP trust and invoice collector lines reinforce this.

---

## Architecture (high level)

- **Customer SPA:** `src/AkaraApp.jsx` + `src/shared.jsx` + Vite → `dist/`
- **Admin SPA:** lazy-loaded `src/AdminApp.jsx` (Recharts only on `/admin`)
- **API:** `server.js` + `server/routes/*`
- **DB:** Postgres; idempotent sync via `npm run db:sync` (`server/db-sync.js` + `db/schema.sql`)
- **SW:** `public/sw.js` — installability + push only (**no** page/API cache). Version stamped; `npm run build` verifies lock file.
- **CSP:** GA4, Ads domains, Turnstile, Razorpay, Google OAuth allowed without `unsafe-inline` scripts where possible.

---

## Changelog since clean zip upload

### Deploy, schema, reliability

- `npm run db:sync` — preferred one-shot schema + CMS FAQ/refund refresh
- Service worker versioning + deploy checklist (`DEPLOY_VERIFY.md`)
- Railway/GitHub deploy lessons: build from source; avoid broken `manualChunks` (caused blank site)
- **2026-09-11 white-screen fix:** removed aggressive Vite `manualChunks` that broke React (`useState` undefined)
- Long-cache for hashed `/assets/*`; `sw.js` / HTML stay no-cache
- Soft route error boundary + root boundary so one page crash does not blank the whole site
- GPU-friendly CSS transforms (`translate3d`) without harming data loading

### Security & compliance

- Shiprocket webhook `x-api-key` + rate limits
- Guest track rate limit; upload rate limit
- Cloudflare Turnstile on customer auth forms **and** admin login
- CSP expanded for Google Tag / Ads / Turnstile (see `AKARA_MARKETING_ADS.md`)
- CSRF on mutating APIs; **403 → refresh CSRF once and retry** in `apiFetch`

### Commerce & fulfilment

- Server-side pricing / GST-inclusive display rules
- Shiprocket: create shipment on dispatch (block dispatch until success when configured); AWB + tracking on customer track + admin
- Returns: **delivered-only** eligibility
- Cart: sync prices/status from catalogue on product load; block checkout if sold-out lines remain
- Care & Placement **PDF attached** to order confirmation email (`server/careCardPdf.js`)
- Invoice PDF: teal header, gold rules, collector detail, studio-made footer line
- Packing slip: collector detail block

### Auth

- Email/password + OTP; **WhatsApp signup OTP via Gupshup** (4-param template); **email fallback** if WhatsApp fails
- Google Sign-In + account linking path in profile
- Phone-change OTP paths (WhatsApp / email)
- **TurnstileWidget import** fixed on customer app (`AkaraApp.jsx`) — login/signup had been crashing with “TurnstileWidget is not defined”

### Customer experience

- Account UI (tabs, address edit, profile)
- Welcome bar (time-of-day + first name)
- Order timeline / AWB display on track page
- Trade path: `/bulk-orders` as **Interior projects & studios** (MOQ 12, 48h reply)
- Studio honesty copy: Craft / About / capacity / designed-for-print / lead time / materials
- Product gallery: true 4:5 frame, `object-contain` to avoid crop on correct assets
- Dimensions admin: size (S/M/L) + L/W/H simplified flow
- Homepage featured magazine layout; LCP: hero `fetchPriority="high"`
- FAQ expansion; stricter return policy copy in CMS scripts

### Admin

- Dashboard / Atelier pulse (auto refresh)
- Room Stories admin (boards, products, active flag; inactive dimmed)
- Returns, settings cards, sidebar brand scrollbar
- Categories management path for future catalogue growth

### Analytics foundation

- GA4 SPA `page_view` (manual + path titles)
- Internal `analytics_events` table / admin behaviour views (where deployed)
- Marketing/Ads work tracked separately in `AKARA_MARKETING_ADS.md`

### Notifications

- Resend transactional emails
- Gupshup WhatsApp templates (order + OTP)
- Web Push (VAPID) for admin/customer where configured

---

## Critical production incidents fixed (remember these)

| Issue | Cause | Fix |
|--------|--------|-----|
| Blank white site | Vite `manualChunks` split React badly | Remove custom React chunking |
| Login “section failed” | `TurnstileWidget` used but not imported in `AkaraApp.jsx` | Import from `shared.jsx` |
| Admin save flaky | Stale CSRF | Retry once after 403 in `apiFetch` |
| 4:5 still cropped | `width:100%` + `maxHeight` broke aspect | `maxWidth` + `object-contain` |
| WhatsApp OTP missing | Gupshup fail + weak fallback | Log errors; always email OTP if WA fails |
| Deploy not updating | SW/cache/old image | Versioned SW + full rebuild |

---

## Key paths

| Area | Paths |
|------|--------|
| Server entry | `server.js` |
| DB | `server/db-sync.js`, `db/schema.sql` |
| Auth | `server/routes/auth.js`, `server/googleAuth.js`, `server/turnstile.js` |
| WhatsApp | `server/whatsapp.js` |
| Email | `server/email.js`, `server/careCardPdf.js` |
| Orders / Shiprocket | `server/routes/orders.js`, `server/shiprocket.js`, `server/routes/webhooks.js` |
| Customer UI | `src/AkaraApp.jsx`, `src/shared.jsx` |
| Admin UI | `src/AdminApp.jsx` |
| Build | `vite.config.js` (no aggressive manualChunks) |
| SW | `public/sw.js`, `.sw-version-lock` |
| GA | `public/gtag-init.js` |

---

## Environment (Railway) — checklist

**Core:** `DATABASE_URL`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `CSRF_SECRET`  
**Payments:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`  
**Shiprocket:** `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, channel id if used  
**Email:** `RESEND_API_KEY`  
**Google:** OAuth client id/secret  
**Turnstile:** `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`  
**WhatsApp:** `GUPSHUP_API_KEY`, `GUPSHUP_SOURCE_NUMBER`, `GUPSHUP_APP_NAME`, `GUPSHUP_TEMPLATE_SIGNUP_OTP`, optional `GUPSHUP_TEMPLATE_LANG`, order templates, `GUPSHUP_SUPPORT_NUMBER`  
**Push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`  

Never commit real secrets; `.env.example` is the template only.

---

## Commands

```bash
npm install
npm run build          # verifies SW lock, then vite build
npm start              # production server (Railway)
npm run db:sync        # schema + FAQ/refund CMS blocks
npm run cms:about-craft
npm run migrate        # legacy; prefer db:sync
```

**After every deploy**

1. Confirm `curl -s https://www.akaraonline.co.in/sw.js | head -5` shows expected `SW_VERSION`
2. Hard refresh once if UI looks stale
3. Smoke: home products → login → cart → (optional) order track

---

## Related documents

- `README.md` — ops + short changelog pointer  
- `AKARA_Master_Pending_List.md` — remaining product work  
- `AKARA_MARKETING_ADS.md` — Google Ads / GA / Merchant (deferred items)  
- `DEPLOY_VERIFY.md` — deploy verification steps  

---

## Monorepo note

This package is **AKARA-WEB**. Mobile/APK work lives in a separate tree/chat; do not mix mobile files into website deploys.

---

## Update — 15 September 2026 (post clean-zip continuum)

**SW:** `2026-09-15-customer-gaps-v20`

### Monitoring & media
- First-party client error pipeline: `server/routes/client-errors.js` mounted at `/api/client-errors`; `reportClientError` in `shared.jsx`; global + boundary hooks in `AkaraApp.jsx`. Optional Railway env `ERROR_WEBHOOK_URL`.
- Upload pipeline (`server/upload.js`): every accepted product image is re-encoded into a fixed **4∶5** canvas (1600×2000) with cream letterbox so storefront grids no longer depend on source aspect ratio. Existing R2 objects are unchanged until re-uploaded.

### Customer experience gaps closed
- Search filters (category, availability); richer empty states.
- PDP purchase trust block (lead time, courier, payments, returns, studio origin).
- Payment methods tab educational layout (no stored cards by design).
- Track-order messaging for guest + confirmation-email link.
- Mobile nav grouped (Studio / Help); cart empty CTA.
- Multi-tab cart/wishlist sync via `localStorage` `storage` event + `BroadcastChannel` with per-tab id.

### Admin & account (14 Sep)
- Orders ledger collapsible details; batch auto-stamp on order create; GSTIN on addresses; phone OTP email fallback; address editor state fix; scroll-to-top FAB.

### Ops reminder
After deploy: `npm run db:sync`, verify `SW_VERSION` in live `/sw.js`, hard refresh once.


---

## Update — 18–19 September 2026

**SW:** `2026-09-19-server-validate-google-v77`

### Security & input integrity

| Topic | Status |
|--------|--------|
| Parameterised SQL on auth/profile/orders | **Yes** — `$1`… bindings throughout auth and data routes |
| Server-side name/address validation | **Yes** — `server/validate.js` (cannot rely on client alone) |
| Coupon abuse (delete account / re-signup) | Blocked via email + phone + `deleted_customer_archives` |
| Account deletion compliance | Row archived before delete; user informed of retention |

**Never trust the browser for money or identity fields.** Burp/Postman tests must fail on invalid names, PINs, phones, and over-qty cart lines.

### Inventory & commerce

- `products.stock_qty` drives customer badges: remaining count when ≤10; low-stock band ≤20.
- Checkout rejects qty above **min(5, stock_qty)** per product (client + server).
- Sales pause still controlled from admin (catalogue visible, purchase blocked when on).

### UX / auth chrome

- Google GIS buttons: no brand-coloured plate behind the official button.
- Sticky header search; shop filters in URL; wishlist add/remove + guest merge rules as above.

### Deploy checklist (unchanged process)

1. Deploy zip / Git push → Railway build (`npm install && npm run build` must pass SW lock).
2. `npm run db:sync` on Railway shell if schema columns were added.
3. Confirm live `/sw.js` shows current `SW_VERSION`.
4. Smoke: signup/profile name reject special chars via API; product with stock_qty ≤10 shows remaining; cart cannot exceed 5.

### Files touched in this window (reference)

- `server/validate.js`, `server/routes/auth.js`, `addresses.js`, `orders.js`, `contact.js`, `bulk-orders.js`, `reviews.js`
- `src/AkaraApp.jsx`, `src/index.css`
- `public/sw.js`, `server.js`, `.sw-version-lock`

### Intentionally not in this pass

- Device fingerprinting (not required while identity + coupon rules hold)
- Mobile/APK tree (separate package)
- Google Ads / Merchant full rollout — see `AKARA_MARKETING_ADS.md`


---

## Update — 19–22 September 2026

**Latest SW:** `2026-09-22-dbsync-query-v100`

### Architecture notes (this window)

| Area | Behaviour |
|------|-----------|
| Product availability | Admin **status** is authoritative for sold-out / draft / hidden / pre-order. `stock_qty` refines in-stock / low-stock / remaining count only when status is live inventory. Sold-out forces `stock_qty = 0`. |
| Product slug | Auto from name on **create** until ID field is edited. Immutable after create (stable URLs). |
| Coupons | Server lookup: active, dates, min order, max uses, one-per-customer / first-order-only via identity (email, phone digits, deleted archives). Placement: banner vs checkout independently. Single coupon per cart. `max_discount_amount` caps percent (“upto”). |
| Categories | Canonical names + `normalizeCategoryName` / `categoriesMatch` for shop + related. Admin selects category from dropdown fed by categories API. |
| Invoice PDF | Tax-invoice style layout (HSN, CGST/SGST, paid stamp). |
| db:sync | `pool.query` only; schema.sql + coupon column ensures; **never** rewrites `page_content` CMS. |
| Header brand | Wordmark PNG + Noto Sans Devanagari `(आकार)` sized to match logo optically. |

### Key files touched (19–22 Sep)

- `src/AkaraApp.jsx` — shop, PDP, cart/checkout coupons, header, cardStatus, invoice PDF, filters, related products
- `src/AdminApp.jsx` — product editor status/stock/slug, category dropdown, coupon settings layout
- `server/routes/admin/products.js` — sold-out stock 0, category audit helpers
- `server/routes/coupons.js`, `server/settings.js`, `server/routes/admin/settings.js`
- `server/db-sync.js`, `db/schema.sql`
- `public/sw.js`, `server.js`, `.sw-version-lock`

### Ops

```bash
npm run db:sync   # after deploy when schema/columns change
```

Confirm `/sw.js` version string after every SW-byte change.

### Out of scope here

Mobile app package; full Google Ads rollout; optional device fingerprinting.

---

## Update — 23 September 2026

### Partial refunds (admin)

- Entry: Orders ledger → **Refund** on paid / partially_refunded rows.
- Server: `POST /api/admin/orders/:orderNumber/refund` → `refundOrderPartial` → Razorpay refund API (amount in paise).
- Tracks `amount_refunded`, `payment_status` = `partially_refunded` | `refunded`.
- UI: remaining balance, % chips, reason presets, post-refund remaining preview. COD is offline-only.

### Database sync

See `docs/DATABASE_SYNC.md`. Application code never mutates schema at request time; ops run `npm run db:sync` after deploy when `db/schema.sql` changes.

### Documentation cadence

See `docs/WEEKLY_DOC_UPDATE.md`.

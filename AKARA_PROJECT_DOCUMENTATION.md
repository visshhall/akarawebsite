# ĀKĀRA Website — Project Documentation

**Updated:** 11 September 2026  
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

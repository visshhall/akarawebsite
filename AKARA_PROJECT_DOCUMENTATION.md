# ĀKĀRA Website — Project Documentation

**Updated:** 10 September 2026  
**Site:** https://www.akaraonline.co.in  
**Stack:** Node/Express, Postgres, React/Vite, Railway, Cloudflare  

Covers work **after** the clean project zip upload (old workspace files discarded).

## Brand

- Teal `#183630` · Cream `#E3DAC9` · Gold `#E5C690`
- Fraunces + Space Grotesk

## Themes of work

1. **Deploy / schema** — `npm run db:sync` schema-only; SW versioning; CSP
2. **Commerce** — server pricing, GST display, Shiprocket dispatch gate, AWB on track
3. **Returns** — delivered-only
4. **Auth** — Google link, Turnstile (customer + admin)
5. **CX** — account UI, order timeline/AWB, emails, contact SLA, route titles
6. **Admin** — dashboard, returns UX, settings cards, sidebar scroll
7. **Analytics foundation** — GA4 SPA page_view; Ads deferred to marketing doc

## Key paths

- `server.js`, `server/db-sync.js`, `server/turnstile.js`
- `server/routes/orders.js`, `auth.js`, `email.js`
- `src/AkaraApp.jsx`, `AdminApp.jsx`, `shared.jsx`
- `public/sw.js`, `public/gtag-init.js`

## Env (Railway)

Database, session, Razorpay, Shiprocket, Resend, Google OAuth, VAPID,  
`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`

## Commands

`npm run build` · `npm run db:sync` · start per Railway

## Related

- `AKARA_Master_Pending_List.md`
- `AKARA_MARKETING_ADS.md`

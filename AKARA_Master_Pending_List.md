# ĀKĀRA — Master Pending List

**Updated:** 11 September 2026  
**Scope:** Engineering / product / ops (Google Ads → `AKARA_MARKETING_ADS.md`)

## Done since clean zip (summary)

- Deploy/db:sync, SW versioning, CSP, Turnstile (customer + admin)
- Shiprocket webhook + AWB path (ops confirmed working)
- Returns delivered-only
- Google sign-in + linking path
- WhatsApp signup OTP + email fallback
- Login/Turnstile import fix; white-screen/manualChunks fix
- Cart stock sync + checkout block on sold-out
- Care PDF on confirmation; invoice/packing collector + studio lines
- Trade quiet path; studio honesty copy
- Soft + root error boundaries; CSRF retry
- Product gallery 4:5; LCP hero priority
- Room Stories admin; admin UI passes

## High priority remaining

1. Production **email QA** (order / shipped / delivered / abandoned templates)
2. Customer **PWA push** opt-in on live (VAPID + SW + UI path)
3. **Cart multi-device** edge cases (guest → login merge stress test)
4. **Partial refund** admin UX polish
5. Live **WhatsApp OTP** confirmation (Railway logs show `Sent template…`)

## Medium

- Packing slip visual parity with luxury invoice
- PDP content completeness (dims, care, photos per SKU)
- Accessibility pass
- Legal pages vs product policy alignment
- Settings/returns micro-polish if ops still sees overflow

## Deferred / separate docs

- Google Ads / Merchant / full tag audit → `AKARA_MARKETING_ADS.md`
- Mobile app / APK → separate project tree (not this zip)

## Notes

- Shiprocket: treat as **working** unless a new incident is filed
- Never re-add aggressive Vite React `manualChunks`

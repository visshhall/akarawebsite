# ĀKĀRA — Master Pending List

**Updated:** 10 September 2026  
**Scope:** Engineering / product / ops (Google Ads → `AKARA_MARKETING_ADS.md`)

## Done recently

- **Signup OTP via WhatsApp (Gupshup)** — primary; email only if template not configured

- Turnstile: customer forms + **admin login**
- CSP for GA4 / Ads / Turnstile; SPA page_view + document titles
- Returns API **delivered-only**; account return CTA only when delivered
- Order track AWB card (copy, courier link, events)
- Customer push on status change; Google link in Profile
- Partial refund server helper; SW `2026-09-10-polish`
- Invoice PDF teal header + gold rule; Contact SLA copy

## High priority

1. Shiprocket AWB live verification (dispatch + webhook + admin refresh)
2. Stock / sold-out accuracy across variants
3. Cart sync (guest → login; multi-device)
4. Production email QA (order / shipped / delivered / abandoned)
5. Customer PWA push opt-in path on live (VAPID + SW)

## Medium

- Partial refund admin UX polish
- Packing slip PDF (separate from tax invoice)
- PDP content completeness (dims, care, photos)
- Accessibility pass
- Legal refund page vs delivered-only rules
- Error monitoring (Sentry or similar)
- WhatsApp Business templates after Meta verification

## WhatsApp Business (Meta verified) — now

1. Choose Cloud API or existing BSP (e.g. Gupshup)
2. Approve templates: order_confirmed, order_dispatched (+ AWB), order_delivered
3. Hook to same events as status emails
4. Keep click-to-chat number aligned with Business profile
5. Marketing WhatsApp only with opt-in column

## Lower

- Staging env, CSV export, more CMS content

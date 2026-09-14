# Email QA (ĀKĀRA)

Manual checklist after each deploy that touches `server/email.js` or order/auth flows.

## Prerequisites
- `RESEND_API_KEY` set on Railway
- From address verified in Resend (e.g. `Ākāra <noreply@…>`)
- Use a real inbox you control (not only Gmail spam folder)

## Flows to trigger

| # | Trigger | Expected subject / content |
|---|---------|----------------------------|
| 1 | **Signup** (email OTP) | Code email, 6-digit OTP, ĀKĀRA branding, expires ~10 min |
| 2 | **Password reset** | Reset link or code, no broken URLs |
| 3 | **Order confirmed** (prepaid + COD) | Order number, items, totals, GST sense-check |
| 4 | **Care + placement** attachment (if wired) | PDF opens; studio care copy |
| 5 | **Dispatched** | Tracking / AWB when available |
| 6 | **Delivered** | Thank-you tone, returns window reminder |
| 7 | **Abandoned cart** (scheduler) | Soft recovery, correct product names |
| 8 | **Refund** (if email on refund) | Amount matches admin refund |

## Pass criteria
- Arrives within ~1–2 minutes
- Not pure spam folder only (Promotions OK)
- Mobile readable (wrapper max-width ~560px)
- Links use `https://www.akaraonline.co.in`
- No raw `undefined` / `null` in body

## Fail → check
Railway log `[email] Resend API error…` · Resend dashboard delivery · DNS/SPF for domain

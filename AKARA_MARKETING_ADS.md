# ĀKĀRA — Marketing, Google Ads & Analytics

**Separate from** `AKARA_Master_Pending_List.md` (product/engineering backlog).  
**Last updated:** 10 September 2026

---

## 1. Goals

- Measure real traffic and purchases (GA4 + first-party events)
- Run Google Ads (Search + Shopping / Performance Max) once the product feed is ready
- Keep tracking compatible with a strict Content-Security-Policy (no `unsafe-inline` scripts)

---

## 2. Analytics stack (live)

| Piece | Detail |
|--------|--------|
| GA4 Measurement ID | `G-TBCH7JXTE9` |
| Bootstrap | `/gtag-init.js` + `https://www.googletagmanager.com/gtag/js?id=G-TBCH7JXTE9` |
| SPA page views | `trackAkara("page_view")` on `navigate()` and browser back/forward (`popstate`) |
| Ecommerce | `view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `search` |
| First-party | `POST /api/analytics/event` → table `analytics_events` (admin Behaviour) |

### SPA / “page not tagged” in Tag Assistant

ĀKĀRA is a **single-page app**. Routes like `/forgot-password`, `/shop/vases`, `/product/...` do **not** reload HTML. Google’s scanner often labels them “not tagged” even when `gtag` is loaded once and `page_view` fires on client navigation.

**What we did (10 Sep 2026):**

- CSP expanded for GA4 / Ads endpoints (see §4)
- `send_page_view: false` in config — we send page views manually with `page_path`, `page_location`, `page_title`
- `popstate` also sends `page_view` (back/forward)

**How to verify:** Chrome → GA DebugView or Tag Assistant while clicking Home → Shop → Vases → a product → Forgot password. You should see a `page_view` (or virtual page) for each step.

---

## 3. Google Ads — rollout order

1. Google Ads account + link **GA4 ↔ Ads**
2. Import **Purchase** as primary conversion (secondary: add_to_cart, begin_checkout)
3. **Merchant Center** + product feed (title, INR price **GST-inclusive**, image URL, product link, availability)
4. Campaigns: brand Search + intent Search → then Performance Max / Shopping with feed
5. Creative: product photography, no discount-heavy copy

### Feed fields (minimum)

- `id`, `title`, `description`, `link`, `image_link`, `price` (e.g. `1999.00 INR`), `availability`, `brand` (ĀKĀRA), `condition` (new)

Optional later: code path to export CSV from admin/products.

---

## 4. Content-Security-Policy (Google + Turnstile)

Aligned with [Google tag CSP guide](https://developers.google.com/tag-platform/security/guides/csp).

**script-src** includes:  
`googletagmanager.com`, `tagmanager.google.com`, `google-analytics.com`, `google.com`, `gstatic.com`, Razorpay, Google OAuth, **challenges.cloudflare.com** (Turnstile)

**connect-src** includes:  
`google-analytics.com`, `analytics.google.com`, `region1.*`, `doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, etc.

**frame-src** includes:  
`googletagmanager.com`, Razorpay, OAuth, **challenges.cloudflare.com**

We do **not** use `script-src 'unsafe-inline'` for GTM’s inline snippet; bootstrap stays in `/gtag-init.js`.

---

## 5. Cloudflare Turnstile (next)

**Status:** Integrated on login, signup, forgot-password, contact, bulk-orders (+ newsletter API). Client widget + server siteverify.

**Env (Railway — never commit secrets):**

```bash
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

**Important:** If site/secret keys were shown in screenshots or chat, **rotate them** in Cloudflare Turnstile → Widget → regenerate secret.

**Planned placement:** login, signup, contact, forgot-password (server verifies token with Cloudflare siteverify).

**Do not** use “Set up with Spin” as the only path if you need explicit control of forms — prefer “Integrate the widget yourself” with the keys above.

---

## 6. Checklist — this week

- [ ] Deploy CSP + gtag-init + page_view fixes
- [ ] Tag Assistant / DebugView: walk `/`, `/shop`, `/shop/vases`, one PDP, `/forgot-password`
- [ ] GA4 Admin → Data streams → confirm enhanced measurement; Ads link
- [ ] Ads: import Purchase conversion
- [ ] Merchant Center: verify domain, upload feed for products with images
- [ ] Rotate Turnstile secret if exposed; add keys to Railway
- [ ] Wire Turnstile on auth + contact (engineering task)

---

## 7. Out of scope here

Product bugs, admin UI, Shiprocket, etc. → `AKARA_Master_Pending_List.md` / project docs.


---

## 8. Deferred Google work (do later — tracked here only)

| Task | Status |
|------|--------|
| Google Ads account structure (Search brand + intent) | Pending |
| Link GA4 ↔ Google Ads | Pending |
| Import Purchase (+ optional ATC / begin_checkout) | Pending |
| Google Merchant Center domain verify | Pending |
| Product feed CSV / automated feed from DB | Pending |
| Performance Max / Shopping after feed approved | Pending |
| Remarketing audiences | After conversions exist |
| Search Console sitemap + coverage | Pending |

**Do not block product shipping on these.** Tracking CSP + SPA page_view already shipped 10 Sep 2026.

---

## 8. Deferred Google work (later — tracked only here)

| Task | Status |
|------|--------|
| Ads account: Search brand + intent | Pending |
| Link GA4 ↔ Google Ads | Pending |
| Import Purchase conversion | Pending |
| Merchant Center verify domain | Pending |
| Product feed (CSV or auto from DB) | Pending |
| Shopping / Performance Max | After feed |
| Remarketing audiences | After conversions |
| Search Console sitemap | Pending |

CSP + SPA page_view already shipped 10 Sep 2026. Do not block product on Ads.

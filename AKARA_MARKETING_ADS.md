# ĀKĀRA — Marketing, Google Ads & Analytics

**Separate from** `AKARA_Master_Pending_List.md` (product/engineering backlog).  
**Last updated:** 13 September 2026

---

## 0. Live deploy check (13 Sep 2026)

| Check | Expected | Status |
|--------|----------|--------|
| `https://www.akaraonline.co.in/sw.js` | `SW_VERSION = "2026-09-12-lightbox-zoom-v8"` (or later) | Confirmed on check |
| Homepage | HTTP 200 | Confirmed |
| GA4 bootstrap in HTML | `gtag/js?id=G-TBCH7JXTE9` + `/gtag-init.js` | Confirmed |
| Product feed | `https://www.akaraonline.co.in/feeds/google-merchant.xml` | After this deploy |

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
| SPA page views | `trackAkara("page_view")` on first load, `navigate()`, and `popstate` |
| Ecommerce | `view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `search` |
| First-party | `POST /api/analytics/event` → `analytics_events` (admin Behaviour) |
| Merchant feed | `/feeds/google-merchant.xml` (GST-inclusive INR prices) |

### SPA / “page not tagged” in Tag Assistant

ĀKĀRA is a **single-page app**. Routes like `/forgot-password`, `/shop/vases`, `/product/...` do **not** reload HTML. Google’s scanner often labels them “not tagged” even when `gtag` is loaded once and `page_view` fires on client navigation.

**What is correct:**

- CSP allows GA4 / Ads endpoints
- `send_page_view: false` in config — we send page views manually with `page_path`, `page_location`, `page_title`
- `popstate` also sends `page_view`

**How to verify (5 min):**

1. Chrome → install **Google Analytics Debugger** or open **GA4 Admin → DebugView**
2. Open site → click Home → Shop → a category → a product → Forgot password
3. You should see a `page_view` for each step with the right `page_path`

Ignore Tag Assistant “3 pages not tagged” for SPA paths if DebugView shows the events.

---

## 3. Google Ads — do this in the Ads UI (you)

Code cannot create your Ads account. After this deploy:

1. **Link GA4 ↔ Google Ads** (Ads → Tools → Linked accounts → Google Analytics)
2. **Import conversions from GA4**: mark **purchase** as Primary; `add_to_cart` / `begin_checkout` as Secondary
3. **Merchant Center** → Products → Feeds → **Scheduled fetch**  
   URL: `https://www.akaraonline.co.in/feeds/google-merchant.xml`  
   Frequency: daily
4. Campaigns: Brand Search first → then Shopping / Performance Max using the feed
5. Optional Ads conversion snippet: after you create a conversion action, set  
   `window.__AKARA_ADS_SEND_TO = "AW-XXXXXXX/label"`  
   (purchase already calls `gtag('event','conversion',…)` when that is set)

### Feed rules (built-in)

- Skips draft/hidden
- Skips products with no HTTPS image
- Price = base × 1.18, formatted `NNNN.00 INR`
- Availability from status + `stock_qty`
- Brand: ĀKĀRA · condition: new

---

## 4. CSP (already in server.js)

script-src / connect-src / frame-src include googletagmanager, google-analytics, doubleclick, googleadservices, pagead2 — aligned with [Google tag CSP guide](https://developers.google.com/tag-platform/security/guides/csp).

---

## 5. Checklist after deploy

- [ ] Open `/feeds/google-merchant.xml` — XML loads, products with images listed
- [ ] GA4 DebugView: page_view + view_item + add_to_cart on a test path
- [ ] Link GA4 to Ads and import purchase
- [ ] Merchant Center feed URL saved
- [ ] Only then spend on Ads

---

## 6. Not in code (manual)

- Ads budget and creatives
- Merchant Center account verification / shipping settings for India
- Consent Mode v2 full UI (optional later if you run EU traffic)


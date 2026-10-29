# ĀKĀRA — Marketing, Google Ads & Analytics

**Separate from** `AKARA_Master_Pending_List.md` (product/engineering backlog).  
**Last updated:** 25 September 2026

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

---

## 7. Marketing photos & videos (brand creative)

**Last creative plan update:** 25 September 2026  
**Tone:** Calm, intentional, studio-made — never loud ecommerce or “sale” energy. Match live site: cream / deep teal, soft daylight, sculptural forms, “Let there be form.”

### 7.1 Visual system (lock ratios)

| Asset | Ratio | Min size | Use |
|--------|--------|----------|-----|
| **Product still** | **4∶5** | 2000 × 2500 px | Shop grid, PDP, Instagram feed |
| **Hero / room** | **16∶9** or **3∶2** | 2400 × 1350+ | Homepage hero, email, display ads |
| **Story / Reel** | **9∶16** | 1080 × 1920 | Instagram Reels, YouTube Shorts |
| **Pinterest** | **2∶3** | 1000 × 1500 | Pins (long lifespan) |
| **Square ad** | **1∶1** | 1080 × 1080 | Meta feed ads |
| **PDP silent loop** | **4∶5** or **1∶1** | 1080+ on short side | Product page autoplay (muted) |

**Colour & light**

- Warm daylight or soft side light (same mood as current homepage hero)
- Backgrounds: cream, soft plaster, muted teal wall, natural wood — avoid pure white catalogue look
- Brand: teal `#183630`, cream `#FFF2DF`, soft gold only as thin accent or type

**Avoid**

- Busy props that compete with the form
- Heavy filters, neon text, warehouse / stock energy
- Cropping product edges in 4∶5 frames (leave safe margin)

### 7.2 Photo set per hero product (5–7 frames)

Shoot in one batch session per piece:

1. **Hero form** — alone, 4∶5, centered, soft shadow  
2. **Detail** — layer lines, edge, material (proves craft, not white-label)  
3. **In-room** — console / shelf / table with one plant or book  
4. **Scale** — hand or known object nearby  
5. **Colour variants** — identical angle for every colour  
6. **Packaging / unbox** (optional) — studio box + care card  
7. **Magazine crop** — wider scene for homepage featured / Room Stories  

**Story to sell in every still:** printed after order · Mumbai studio · geometry · calm interiors.

### 7.3 Video types (priority order)

| Priority | Format | Length | Purpose |
|----------|--------|--------|---------|
| **A. Form reveal** | 9∶16 | 12–20s | Slow orbit or push-in; end card: name + “Made to order · Mumbai” |
| **B. Studio process** | 9∶16 | 15–30s | Print layers → remove from bed → hand-finish (anti white-label) |
| **C. One piece, three rooms** | 9∶16 | 15–25s | Same product in 3 settings |
| **D. PDP loop** | 4∶5 or 1∶1 | 8–15s silent | Autoplay on product page |
| **E. Craft / founder VO** | 9∶16 | 30–45s | Monthly trust piece |

**Hooks (first 1–2 seconds)**

- Layers printing → cut to finished piece on a console  
- “Not from a warehouse.” → studio hand  
- Empty shelf → piece placed → soft light shift  

Always use **burned-in captions** (most views are muted).

**Export for site (avoid crop)**

- Prefer **4∶5** or **1∶1** masters for PDP  
- If source is only 9∶16 / 16∶9 / 4∶3, letterbox or reframe so the product is fully visible — do not stretch  
- H.264, moderate bitrate; keep file size reasonable for mobile

### 7.4 Channel mix

| Channel | Role | Cadence |
|---------|------|---------|
| **Instagram** | Brand + Reels reach | 3–4 Reels / week + 2 feed stills |
| **Pinterest** | Long-term shop traffic | 5–10 pins / week |
| **YouTube Shorts** | Same vertical cuts as Reels | Repost |
| **Website** | Hero, PDP video, magazine / Room Stories | When new masters are ready |
| **Meta ads** | Paid only after organic winners | Boost 1–2 best Reels |

Skip trend-dance TikTok formats — wrong tone for Ākāra.

### 7.5 30-day starter pack

| Week | Focus |
|------|--------|
| **1 – Masters** | Pick 3 products (lamp, planter, vase). Full photo set + one 15s form-reveal each |
| **2 – Site** | Upload 4∶5 to admin; silent loop on those 3 PDPs; optional new hero still |
| **3 – Organic** | 6 Reels from same footage; 9 Pinterest pins (product + room + keywords) |
| **4 – Learn** | Keep saves + profile visits; only then boost winners with budget |

### 7.6 Keyword / pin themes (Pinterest & SEO-adjacent)

- Geometric planter Mumbai  
- 3D printed lamp made to order  
- Sculptural vase modern interior  
- Precision home décor India  
- Atelier lighting console styling  

### 7.7 Creative backlog (optional next docs)

- [ ] Shot list PDF — frame-by-frame for lamp / planter / vase  
- [ ] 5 ready Reel scripts in brand voice  
- [ ] AI mood boards in Ākāra palette (brief for photographer)  
- [ ] Caption bank (20 IG + Pinterest)  
- [ ] Locked export presets for phone + desktop editors  

### 7.8 Link to product media rules (engineering)

- Admin product media: prefer **4∶5** stills (site grids use this aspect)  
- Stock / sold-out badges sit on the image — leave a little top-right clear if possible  
- Merchant feed needs at least one **HTTPS** image per live product or the item is skipped  

---



---

## 9. Meta Pixel operational setup (30 Sep – 1 Oct 2026)

**Website code is ready** (`v113+`). Ads are still created in **Meta Ads Manager**, not in Ākāra admin.

### Railway env

| Variable | Where | Notes |
|----------|--------|--------|
| `META_PIXEL_ID` | Railway | Public Pixel ID from Events Manager |
| `META_CAPI_ACCESS_TOKEN` | Railway | **Secret** — server only |
| `META_TEST_EVENT_CODE` | Railway | Optional, testing only |
| `META_CATALOG_FEED_KEY` | Railway | Optional lock on catalogue CSV/XML |

### Do not

- Paste Meta’s full inline `<script>fbq('init'…)` block into `index.html` (CSP + double PageView).
- Commit CAPI tokens to Git.

### Verify

1. Deploy build with Meta routes + `meta-pixel-init.js`.
2. Set env → restart.
3. Events Manager → Test events → browse homepage, PDP, add to bag, checkout.

### Feeds

- Meta catalogue: `https://www.akaraonline.co.in/feeds/meta-catalog.csv`
- Google Merchant: existing merchant feed path (see earlier sections)


## 8. Document history

| Date | Change |
|------|--------|
| 13 Sep 2026 | Initial GA4 / Ads / Merchant / CSP notes |
| 25 Sep 2026 | §7 Marketing photos & videos — ratios, shot list, video priorities, channels, 30-day pack |
| 1 Oct 2026 | §9 Meta Pixel operational setup; site v114–v115 category UX |

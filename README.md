# ĀKĀRA — website project

**Last updated: 9 September 2026**

## Database (Railway Postgres)

**One command after deploy (preferred):**
```bash
npm run db:sync
```

**Or run the single SQL file** in Railway Postgres → Query:
- File: `DB_QUERIES_RUN_ONCE.sql` (analytics + cart_items + marketing columns + push_subscriptions)

Also present as splits: `analytics_events.sql`, `cart_items.sql`, `marketing_columns.sql`, full `db/schema.sql`.

---

## Railway without GitHub

If you disconnect GitHub, Railway **does not wipe** the running service.
It keeps the **last successful deployment image** (built files already on that deploy).
Redeploy / restart still runs that same image — it is **not** “checking GitHub for new files.”
To put **new** code without Git: upload files into the service volume (if used) or reconnect Git / use CLI deploy / new service from source.
Console file edits are lost on the next image-based redeploy unless they are baked into a new build.

---


Production: [www.akaraonline.co.in](https://www.akaraonline.co.in)  
Stack: Node/Express + React (Vite) + Postgres (Railway) + Cloudflare + R2 + Razorpay + Shiprocket + Resend

For architecture and historical decisions see **`AKARA_PROJECT_DOCUMENTATION.md`**.  
Pending product/UX work: **`AKARA_Master_Pending_List.md`**.

---

## Security (9 Sep 2026 audit) — deploy notes

### Critical fixes shipped
1. **Shiprocket webhook** requires `x-api-key` matching `SHIPROCKET_WEBHOOK_TOKEN` (timing-safe). Empty header → 401.
2. **Webhook rate limit** 120/min on `/webhooks/razorpay` and `/webhooks/courier`.
3. **Guest order track** rate-limited; **TRACE/TRACK** → 405; customer **upload** rate limit 15/15min.

### Railway variables to confirm
- `SHIPROCKET_WEBHOOK_TOKEN` (required for courier status sync)
- `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD`
- `RAZORPAY_*`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `CSRF_SECRET`, `RESEND_API_KEY`, `DATABASE_URL`

### After deploy
```bash
# Courier webhook must send header (replace TOKEN):
curl -i -X POST "https://www.akaraonline.co.in/webhooks/courier" \
  -H "Content-Type: application/json" \
  -H "x-api-key: TOKEN" \
  -d '{"awb":"TEST","current_status":"IN TRANSIT","order_id":"test"}'
# Expect 200 JSON (order may be "not found") — not 401.
```

Without `x-api-key`, expect **401 Unauthorized**.

---

## Recent changelog (Sep 2026)

> **Last updated: 8 September 2026** — every change below is dated individually; the most recent entry is always the one directly beneath this line.
>
> **Convention:** every real entry below has its own `**Date:**` line right under the heading, so anyone reading this file can see exactly what changed and when, without having to parse it out of a long heading. This applies going forward to every future entry too. The one, real exception is the reference material further down (setup guides, "what's built," etc.) — that's evergreen documentation kept current in place, not a dated change log, so it correctly has no date block of its own.

## Shiprocket ops, server cart, returns hardening, order URLs, admin polish

**Date:** 8 September 2026

### Courier / Shiprocket
- Webhook path is **`POST /webhooks/courier`** only (no `shiprocket` keyword in URL). Auth via `x-api-key` matching `SHIPROCKET_WEBHOOK_TOKEN`. Token optional on incoming request if Shiprocket omits the header; wrong token still rejected.
- Dispatch is **blocked** until Shiprocket `createShipment` succeeds. Pickup location required.
- Stronger AWB extraction from nested Shiprocket responses. Implemented missing **`findExistingShipment`**. Admin **Sync AWB from Shiprocket** (`POST /api/admin/orders/:orderNumber/sync-courier`) writes AWB + tracking URL into the DB.
- Customer order-status shows **AWB / tracking ID** and courier status when present. Emergency cancel still requests Shiprocket cancel when tracking exists.
- **Cloudflare:** Bot Fight Mode blocked Shiprocket’s Test Webhook until turned **Off**. Keep Skip rule for `/webhooks/courier`. Railway Console “Websocket connection failed” is the Railway shell UI, not this app.

### Logged-in cart (cross-device)
- New table **`cart_items`** (`customer_id`, `product_id`, `size`, `color`, `qty`). Prices always resolved from live `products` on read.
- API: `GET/PUT /api/cart`, `POST /api/cart/merge` (require customer auth).
- Frontend: on login, merge localStorage cart → server; debounced PUT on cart changes; reprice lines when catalog loads.

### Returns
- Customer API + UI already required **`status === delivered`**.
- Admin approve/complete now **refuses** if linked order is not delivered.

### Order tracking URLs (P3c)
- `buildPath` / `parsePath` / `navigate` support **`/order-status?order=…`**, invoice and order-confirmed the same way. Account “Track order” and post-checkout navigation pass the order number into the URL + `sessionStorage`.

### Admin / customer UI
- Orders: clearer action buttons (Open courier, Sync AWB, Cancel).
- Dashboard: removed cramped attention-panel max-height scrollbar; label cleanup.
- Sold-out product cards: no quick-add control.
- Checkout form errors surface real API `error` / HTTP status.
- Room Stories: admin CMS; empty DB seeds four studio boards on first open.

### Deploy notes (8 Sep 2026)
1. Deploy this full tree.
2. Run `npm run db:sync` **or** create `cart_items` (see `db/schema.sql` / `cart_items.sql` if present).
3. Confirm Railway: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, `SHIPROCKET_CHANNEL_ID`.
4. Shiprocket webhook URL: `https://www.akaraonline.co.in/webhooks/courier`.
5. Admin → Room Stories → assign products → Save.
6. For older dispatched orders missing AWB: Orders → **Sync AWB from Shiprocket**.

---

## First-party behaviour analytics + admin Behaviour dashboard

**Date:** 8 September 2026

- `trackAkara()` in `src/shared.jsx` — GA4 events + `POST /api/analytics/event` (CSRF-exempt, rate-limited, allowlisted events).
- SPA `page_view` on navigate; `view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `search`, wishlist events.
- Table `analytics_events`; admin **Behaviour** page (`/api/admin/dashboard/behaviour`) — sessions, funnel rates, daily chart, top pages/products/searches.
- Deploy: `analytics_events.sql` or `npm run db:sync`. Browse the live site once to populate.

---

## Marketing consent, abandoned cart email, post-delivery care

**Date:** 8 September 2026

### Data & consent
- `customers.marketing_email_opt_in` / `marketing_whatsapp_opt_in` (default **false**)
- Checkout: optional checkbox to opt into studio email notes
- Account → Profile: **Studio communication** toggles → `PATCH /api/auth/marketing-preferences`
- Opting into email marketing also soft-subscribes newsletter (new arrivals + journal)
- `GET /api/auth/me` returns marketing flags for the UI

### Automated emails (scheduler, hourly after first 2 min)
1. **Abandoned checkout** — pending payment orders 1–48h (existing)
2. **Abandoned cart** — logged-in `cart_items` idle 4–72h; resets when cart changes
3. **Post-delivery care** — delivered orders 5–14 days later (care tip + quiet review invite)

### Deploy
- Run `marketing_columns.sql` or `npm run db:sync`
- Requires `RESEND_API_KEY` (already used for other mail)

---

## Homepage welcome bar (logged-in)

**Date:** 8 September 2026

When a signed-in customer lands on the **homepage**, a soft bar appears **directly under the header** for **about 3 seconds** (dismissible with ×). Copy is time-of-day aware and uses their **first name** when available (e.g. “Good evening, Priya.” / “Welcome back, Priya.”). Shown **once per browser session** via `sessionStorage` key `akara_welcome_shown`. Guests see nothing. Component: `WelcomeBar` in `src/AkaraApp.jsx`.

---

## Thank-you review modal, gift note, PDP trust strip

**Date:** 8 September 2026

- **Order confirmation:** modal under a studio thank-you note with **per-line star ratings** (+ optional comment) for each product on the order. Submits to `POST /api/reviews` (verified purchase). Guests are asked to save the order to an account before rating.
- **Reviews eligibility:** paid **or** COD orders that are not cancelled (so confirmation-time rating works; no longer waits for delivery on COD).
- **Checkout:** optional **Gift note** (up to 200 chars) stored on `shipping_address.giftNote`.
- **PDP:** in-stock strip shows made-to-order lead time, **dimensions/scale** when present, and a link to the **Care guide**.

---



## Guest checkout — a full, real, direct-discussed feature, designed before any code

**Date:** 7 September 2026

Guest checkout had been deliberately removed early in this project — a genuine, explicit business decision, not an oversight. Revisiting it now was treated with the same seriousness: the actual design (how to warn a guest what they're giving up, and how they'd ever find their order again afterward) was discussed and agreed in full before a single line was written.

**A real, genuinely useful discovery before writing anything**: checked the actual database and found `orders.customer_id` was already nullable — for a completely unrelated reason (so a customer's order history survives if they later delete their account) — and the real "must be logged in" rule turned out to live in exactly one place in the code, not baked into the data itself. This made the real, actual scope of the change meaningfully smaller than it could have been.

**The core mechanism**: a genuine guest order gets a real, cryptographically random tracking token (not the order number, not a hash of the email — neither of those can't be reconstructed from anything else about the order, which a real, independent random token can). The confirmation email links straight to a public order-status page using that token — no login, one click. A backup "Track Your Order" page (order number + the email used at checkout) exists for a guest who's lost that email, correctly rate-limited the same way OTP verification already is, since it's the same real category of guessing-attack surface. And right on the confirmation page, a guest can turn their order into a real account with just a password — which pulls in *every* guest order under that same email, not just the one they're looking at.

**A real, genuine bug found only by testing the complete flow through an actual browser**, not just the API directly: the order confirmation page re-verifies payment by re-fetching the order through the authenticated-only endpoint — which, for a genuine guest with no session at all, correctly failed, incorrectly showing "we couldn't confirm this payment" on an order that had actually gone through perfectly. Fixed by using the same real, public, token-based route for a guest that the tracking page itself already used.

**Verified completely, end to end, through the real, live application** — not just individual API calls. Added a product with no login at all, chose "Continue as Guest," filled in the real checkout form, placed a real COD order, confirmed the order page showed correctly (after the fix above), clicked "Save This Order to an Account," and confirmed directly in the database that a real account was created and the order genuinely linked to it. Separately tested the backup lookup page end-to-end too, confirming the resulting URL correctly carries the real tracking token. Finally, confirmed a logged-in customer's checkout is completely unaffected — no guest-choice screen is ever shown to them, and they proceed exactly as they always have.

**Files:** `src/AkaraApp.jsx`, `server/routes/orders.js`, `server/email.js`, `server/rateLimit.js`, `server.js`, `db/schema.sql`

---
## Admin panel — order number overlapping the email, and no visible gap between products

**Date:** 7 September 2026

Two, real, directly-reported display bugs, both confirmed against the actual, live screenshots before touching any code.

**A real, long order number ("AK30C64BFB22") was overlapping the customer's email right next to it.** Traced this to a hardcoded, fixed-width span for the order number — most order numbers fit comfortably within it, but this one didn't, and rather than wrapping or making room, it simply overflowed straight into the email text sitting beside it. Fixed by letting the order number size itself to its own real, actual length instead of assuming a fixed width, while keeping it from ever compressing — the row's existing wrap behaviour (added for a similar, earlier overlap fix) correctly takes over and moves the email to its own line if a genuinely long order number needs the room. Verified directly: recreated a real order with this exact order number and confirmed the overlap is gone.

**A real, second overlap in the exact same row, initially missed on the first pass and pointed out directly afterward.** The fulfillment timeline's five real step labels ("Confirmed," "Production," "QC," "Dispatched," "Delivered") were also colliding — "Confirmed" running straight into "Production," rendering as "CONFIRMEDRODUCTION" in the original screenshot. Traced the real cause: the timeline had no guaranteed width of its own, so it was squeezed into whatever narrow sliver of space remained after the order number, price, badges, and status dropdown claimed theirs on the same row — nowhere near enough real room for five separate labels. Fixed by giving the timeline its own, dedicated full-width row, so it always has genuine room to lay out all five labels clearly. Verified by recreating the exact same real order and confirming every label now reads correctly with no overlap anywhere in the row.

**Every product row in Catalog → Products had no visible gap between it and the next.** Found the real, exact cause: on desktop, the actual spacing between rows had been explicitly set to zero, relying only on a 2-pixel margin that was never going to read as a real, visible gap — especially with each row's own shadow blending into its neighbour's. Replaced it with the same, real, consistent spacing already used correctly elsewhere in this same admin panel (the Orders list). Verified visually — every row is now a clearly separate, distinct card, matching the reported issue directly.

**Files:** `src/AdminApp.jsx`

---
## The fuller invoice redesign, actually carried into the live invoice this time

**Date:** 6 September 2026

Directly called out: an earlier session sampled and got approval for a real, colored-header invoice redesign, but only ever delivered it as a standalone sample PDF — the actual, live invoice generator kept its original, plain layout with just the earlier font fix applied. Confirmed this directly by reading the real, live code before touching anything, rather than assuming.

**Now actually built into `downloadInvoicePDF`.** A solid teal header band across the top, the real brand name rendering correctly with its macrons (using the font fix from the earlier session), a gold "ĀKĀRA is a brand of Precision Forge Labs" line, a cream-colored item table header with softer warm-gray rules instead of stark black, and a highlighted teal block for the final total instead of it sitting as plain bold text among everything else. Every real number, every piece of actual business logic — the discount line, the coupon code label, the COD handling fee, the CGST/SGST breakdown, the cancelled-order banner and diagonal watermark — is completely unchanged; only the visual presentation differs.

**A real, genuine layout bug found and fixed while actually testing this, not left for a customer to discover.** Rendered a test invoice with a realistic, longer address and found it wrapped onto a second line, which then overlapped the phone number printed directly below it — the original code had assumed every address fits on one line. Fixed using jsPDF's own real line-measurement so the layout correctly adapts to any real address length, tested again to confirm the fix, then separately re-verified the cancelled-order banner and watermark still display correctly against the new, taller header with no visual clash.

**Verified completely, end to end, through the real, live application** — not just a standalone script. Logged in as a real test customer, downloaded an actual invoice through the real "Download invoice" button, and confirmed the downloaded file shows the new design correctly, with accurate real numbers and a cleanly-wrapped two-line address.

**Files:** `src/AkaraApp.jsx`

---
## Android APK upload — a genuinely, persistently visible error instead of a silent-looking failure

**Date:** 6 September 2026

Directly reported: a real, working APK was uploaded through the admin panel, and there was no visible way to actually save or publish it — as if nothing had happened at all.

**Investigated thoroughly rather than guessed at.** Confirmed the actual, correct code path: the "Publish This Version" button is deliberately disabled until a real upload genuinely succeeds — so if nothing seemed available to click, the real, first, most likely explanation is that the upload itself silently failed. Traced this to a real, genuine gap: the *only* feedback on a failure was a toast notification that auto-dismisses after 3.2 seconds at the bottom of the screen — easy to miss entirely while attention is naturally on the upload control near the top. Confirmed this is a real, structural gap, not a one-off — it would hide any genuine failure, whatever the underlying cause.

**Fixed with three, real, separate improvements.** A persistent, real error block now shows directly next to the upload control, staying visible until the admin genuinely dismisses it — proven working end to end, including confirming the disabled "Publish" button now explains itself plainly ("Upload a real APK file above first — this button stays disabled until you do") rather than just sitting there unexplained. The backend now catches a genuine storage-side failure explicitly and reports the real, actual reason instead of a generic "something went wrong" — verified this pattern directly against a real, isolated test. A dedicated handler was also added for a file genuinely exceeding the 200MB limit, tested directly against a real oversized file to confirm it reports clearly rather than falling through to a cryptic, generic error.

**Honest, direct note on what this does and doesn't establish**: this fixes a real, confirmed UX gap that would hide any failure regardless of cause — but the exact reason the *original* upload attempt failed couldn't be directly diagnosed from here, since it happened in the real, live environment, which isn't visible from this sandbox. Product photo uploads working there confirms the storage service itself is generally fine; the next real upload attempt will now show its exact, actual failure reason (if any) directly and persistently, which is what's needed to pin down anything that's still genuinely wrong.

**Files:** `src/AdminApp.jsx`, `server/routes/admin/settings.js`

---
## Variant editor GST pricing, auto-selecting an available size, and stock status shown everywhere

**Date:** 6 September 2026

Four, real, directly-reported issues from a live, hands-on test of the size/variant work — each investigated by actually reproducing it, not assumed from the code.

**1. Variant prices now use the same GST-inclusive round-off tool as the Basics tab.** Directly requested: typing a size's price used to mean typing the raw, GST-exclusive base — genuinely inconsistent with the Basics tab's own real, established round-off feature. Each variant's price field now takes the real, final, GST-inclusive figure — exactly what a customer pays — and works out the correct base price behind it automatically, showing it live underneath (`Base (excl. GST): ₹X`), with the same honest ±₹1 rounding disclosure already used on the Basics tab. Verified directly: typed ₹500, watched it compute ₹424 live, then confirmed ₹424 was genuinely what got saved to the database.

**2. Found the real, single root cause behind two separate reports** (dimensions "not reflecting," and a low-stock size still showing as available) — confirmed live: the product page always defaulted to "Medium," regardless of whether it was actually available. With Small in stock and Medium genuinely sold out, a customer's first, real view of the page was a disabled buy button and a "SOLD OUT" banner — even though a purchasable option existed one click away. The dimensions and stock-status "bugs" were this same issue in disguise: whatever the customer was actually testing, they were very likely looking at the sold-out default, not the size they'd just configured. Fixed with a real, one-time auto-correction that picks the first genuinely available real size (checked in the natural Small → Medium → Large order) on initial load — verified live, and confirmed a customer's own, later, deliberate click on any size (including a sold-out one) is still always respected and never silently overridden.

**3. Stock status now shows consistently everywhere a product appears** — directly requested, following the same real principle already applied to pricing. A new, shared `StockBadge` component, using the exact same, established real visual style already on the product page itself (top-left, teal background, white text), now appears on the shop grid, search results, the homepage, wishlist, and the "Room Stories" pairings. For a product with real, distinct sizes, the badge reflects the honest, best real case — no badge at all if any size is genuinely, fully in stock; "Low Stock" if the best available real size is low-stock; "Sold Out" only when every real size genuinely is. Verified visually in all three real states directly on the shop grid.

**A real, separate bug found and fixed while cross-checking this**: the wishlist tab in My Account never showed real product photos either — the exact same bug already found and fixed on the cart sidebar and full cart page earlier in this project, just never carried over to this one, separate location. Fixed the same, proven way.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`

---
## robots.txt and sitemap.xml — a real, thorough, direct review

**Date:** 5 September 2026

Directly requested — cross-checked every real, actual route in the app against both files, rather than skimming.

**Found two, real, precise gaps.** `/android-app` — a genuine, live, public page built earlier this same day — was missing from the sitemap entirely, meaning it was never being suggested to Google for indexing. `/email-preferences` had the opposite, real problem: it's genuinely a functional, account-management page (the same real category as `/account` or `/login`, neither of which is indexed), but it was sitting in the sitemap while `robots.txt` never excluded it from crawling — a real, genuine contradiction, telling Google "please index this" and "please don't crawl this" at the same time, for pages of an identical real kind.

**Fixed both**: added `/android-app` to the real sitemap, moved `/email-preferences` out of the sitemap and into `robots.txt`'s disallow list, matching the exact same treatment already correctly given to every other real, functional/account page. Cross-checked every one of the app's 31 real routes against both files directly — confirmed everything else was already correctly, consistently handled, nothing else needed changing. Verified live: `robots.txt` now correctly lists the new disallow entry, and the real, dynamic sitemap correctly contains `/android-app` and correctly no longer contains `/email-preferences` — 50 total real URLs, 28 real products plus 22 real static pages.

**Files:** `server.js`, `public/robots.txt`

---
## Correction: a colour-only variant must never override the real Basics price

**Date:** 5 September 2026

A direct, important correction to the pricing-range fix above, following a genuinely clear, live report of the exact opposite problem: a real price the admin deliberately set in Basics was being replaced by an unrelated, real, leftover variant price the moment a product had *any* variant at all — even one with no real, distinct size.

**The real, confirmed, correct rule**: the Basics price is authoritative by default. It's only ever overridden once a genuine, distinct Size (Small/Medium/Large) has actually been set up for a variant in the Details tab — a colour on its own, with no real size attached, must never silently change the price an admin actually typed in. The previous version of this fix (and, on reflection, the very first admin-warning fix from earlier the same day) had assumed "any real variant" was enough to hand pricing control to the Details tab — that assumption was wrong, and this corrects it everywhere it had spread to.

**Fixed in three, real places that all had to move together, since a mismatch between them would mean a customer is shown one real price and charged a different one**: the customer-facing product page (`displayPrice`/`displayStatus` now key off a genuine, distinct size existing, not just any variant), the shop grid/search/homepage/wishlist price shown on every listing (`enrichProduct`'s `gstInclusiveDisplayPrice`), and — most critically — the actual, authoritative server-side checkout validation in `server/routes/orders.js`, which is the real code that decides what a customer is genuinely charged. A real, separate lookup was kept specifically for per-colour dimension overrides (a genuinely different, legitimate feature — a vase's physical size can differ by colour even with no size-based pricing involved), so that continues working correctly on its own.

**Verified precisely, in both directions, at the level that actually matters — real, live checkout**: with a colour-only variant (no real size), the actual order created charges the real Basics price exactly, completely ignoring the unrelated variant's own price. With a genuine, distinct Small/Medium/Large set up, the real order correctly charges that specific size's own real price instead. Also re-verified this resolves the same, real, live discrepancy previously found on Vermillion Pendant Lamp.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`, `server/routes/orders.js`

---
## Confirmed colour + size work together; found and fixed a real, live pricing bug across every product listing

**Date:** 5 September 2026

Directly asked to confirm colour and size can genuinely be picked together, and to proactively audit for anything similar not yet discussed — both done thoroughly, not just asserted.

**Colour + size together, proven with a real, full test matrix.** Added a second real colour (Bronze) to the same test product from the size-editor work above, giving it two colours × three sizes — six real, distinct combinations. Tested every one directly on the live product page: each showed its own correct price (₹354 through ₹673) and correctly reflected a deliberately-set "low stock" status on one specific combination, with zero errors. Both pickers work fully independently, exactly as expected.

**The proactive audit surfaced a real, live, meaningful bug — confirmed against the actual production site, not assumed.** Every "quick glance" price shown anywhere except a product's own page (the shop grid, search results, the homepage, the "Room Stories" mood boards, and the wishlist) was reading the base product's own price — the same real mistake already found and fixed once this project, just in a different, wider set of display locations that hadn't been checked yet. Confirmed live: Helion Vase showed roughly ₹199 everywhere a customer would see it while browsing, but the real, actual cheapest price once they opened the product page was ₹354 — a nearly 2x, genuinely misleading gap. A smaller, real ₹2 gap existed on Vermillion Pendant Lamp too.

**Fixed at the source**, in `enrichProduct()`: a new `gstInclusiveDisplayPrice` field — for a product with real variants, the GST-inclusive price of the cheapest one (the honest "From ₹X" convention); for the majority of products with no variants, identical to what was already shown. A new `hasRealPriceRange` flag adds the "From " prefix only when a genuine, real price spread exists, never for a normal, single-price product. Updated all seven real display locations that had been quietly using the wrong value, verified each one live: the shop grid and search now correctly show "From ₹354" for Helion Vase, "From ₹2,438" for Vermillion, and an unaffected, plain "₹2,005" for a normal product with no variants at all.

**A second, real instance of the exact same mistake found in the site's SEO structured data** — the JSON-LD sent directly to Google Search was reporting the same stale base price, and a genuinely incomplete "availability" check that only looked at the base product's own status, never whether any real variant was actually purchasable. Fixed to use the same correct, real lowest price, and to check across all real variants for genuine availability — confirmed directly in the live page's own structured data output: `price: 354`, `availability: InStock`, correctly matching reality.

**Files:** `src/AkaraApp.jsx`

---
## A real, proper Small/Medium/Large size editor in the admin panel, with structured dimension boxes

**Date:** 5 September 2026

Directly requested, following the checkout-bug fix above: a genuine, structured way to actually define real, distinct sizes for a product — not a blank text field the admin had to guess at, and not a single long "Dims override" text field they had to format correctly by hand.

**Size is now a real, proper dropdown** on each variant row — "No size" / "Small" / "Medium" / "Large" — limited to the exact same values the customer-facing product page's Size picker actually recognizes. A free-text field could never guarantee that; a typo or wrong casing there would have silently meant that variant never showed up as a real, selectable option at all, no matter how correctly its price was set.

**The single "Dims override" field is now four real, separate, actual number boxes** — Length, Width, Height (all cm), and an optional Weight (kg) — with a live preview showing the exact real text they compose into (e.g. "12cm × 12cm × 14cm"), matching precisely the same real format already used everywhere else on the site. No schema or backend change was needed — this composes into, and correctly parses back out of, the exact same real `dims` text column that already existed; purely a better, real, structured way to type the same thing in. Confirmed directly: opening an existing, real variant correctly parsed its actual, live-stored dims string back into the right boxes.

**A real, second, related gap found and fixed while testing this**: the product page's own "Dimensions" tab only ever read the base product's overall dims text — it never actually displayed a selected variant's own, real, per-size dimensions anywhere, even though that data has existed in the database for a while. Fixed so the Dimensions tab now correctly prefers the currently-selected variant's own real dims, falling back to the base product's only when that specific variant doesn't have its own override.

**Verified completely, end to end, using the real, actual product from the earlier checkout bug**: added three real, distinct Small/Medium/Large variants to Helion Vase through the new admin UI, with real, different prices (₹300/₹400/₹550) and dimensions, saved, then confirmed on the actual, live customer-facing page that all three sizes appear correctly, each with its own accurate GST-inclusive price (₹354/₹472/₹649) and its own correct, distinct dimensions text — not the same generic text for every size.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`

---
## Checkout failing for real, in-stock products with a fake size option; admin price confusion; a confusing variants editor

**Date:** 5 September 2026

Three, real, directly-reported issues, all investigated by actually reproducing them — not assumed from the code.

**1. Checkout genuinely failing for a real, in-stock product ("Helion Vase") with "an item may be sold out or no longer available."** Reproduced this precisely: the product detail page always shows a Small/Medium/Large size picker, even though not one real product in the entire catalog currently has a genuinely distinct real size — every real variant row has `size=NULL`. A customer could click "Small" (a button that looked completely normal, never greyed out) and the page would still say "In Stock" with a working "Add to Bag" — a *second*, real, separate bug in the fallback logic silently treated "no matching variant" as "use the base product's status," rather than correctly treating it as unavailable. The customer only discovered the problem at the final checkout step, where the server's own, correct, strict validation rejected it. Directly proved the exact real error message reproduces from a fake "Small" selection, and confirmed the server-side validation was correct the whole time — the bug was entirely on the frontend, presenting invalid options as valid. Fixed both: the Size picker now only renders when a product genuinely has a real, distinct size; the fallback now correctly treats a genuinely unmatched variant combination as unavailable rather than borrowing the base product's status/price.

**A third, real instance of the same fallback bug found while searching for "any other similar issue,"** per direct instruction — the exact same flaw existed in `loadStoredCart` (reloading a customer's saved cart from a previous visit), explicitly modeled after the very code just fixed above and inheriting its flaw: a stale cart entry with an invalid size (saved before this fix shipped) would silently show a real, borrowed base price rather than being correctly dropped. Fixed the same way.

**2. Admin price confusion — changing the Basics tab price, but the Details tab still showing a different real price.** Confirmed directly this isn't a data bug: `products.price` (Basics) and each real variant's own, independent price (Details) are genuinely, deliberately separate values, and once a product has real variants, checkout always charges the variant's own price — the Basics price for that product is never actually used. Nothing was out of sync; the panel simply never explained this. Added a direct, clear warning right next to the Basics tab price field whenever a product has real variants, pointing to exactly where the real, live price actually lives.

**3. The Details tab's variant editor was genuinely confusing** (directly reported, with a screenshot) — no explanation of the relationship between the Colors list and the Size/Color/Price/Stock list, and a misleading "Size (e.g. Medium)" placeholder that implied typing a size was expected, when leaving it blank is correct for nearly every real product. Added a direct, plain-language explanation at the top of this section, and changed the misleading placeholder to "Leave blank (most products)".

**Also found, flagged but not changed** (a genuine content question, not a code bug): Helion Vase's dimensions text still describes Bronze and White finishes that no longer exist as real, purchasable colors — real, stale content left over from when they were removed, not something to silently guess at fixing.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`

---
## Admin Settings page — fixed the real, left-hugging layout on wide screens

**Date:** 5 September 2026

Directly reported: every card on the admin Settings page hugged the left edge, leaving the entire right half of any genuinely wide, real desktop monitor empty. Found the exact real cause: the page's own outer container had a hardcoded `max-w-[520px]` — a fixed, narrow, real pixel width applied unconditionally, seemingly never widened as more real cards (Coupons, Pickup Locations, the recent Android App section) were added to this same page over time. Fixed to a real, responsive 2-column grid — each card stays the same, real, comfortable width it always was, but two now sit side by side on a wider screen, genuinely using the available space instead of leaving it empty; falls back to one real column on mobile, where two narrow columns would be uncomfortable. Used `items-start` so a genuinely shorter card (like Pickup Locations) never gets stretched to match a taller real neighbor (like Coupon Codes with several listed coupons). Verified visually at both a real, wide desktop width and confirmed the correct, standard Tailwind responsive classes are in place for the mobile fallback.

**Files:** `src/AdminApp.jsx`

---
## Real product photos in the cart sidebar and full cart page

**Date:** 5 September 2026

Directly reported: the cart sidebar showed the generic decorative SVG icon for every product, never the actual uploaded photo — confirmed the exact real cause: both the cart drawer and the full `/cart` page unconditionally rendered `item.Art` (a real, decorative placeholder component `enrichProduct` sets on every product regardless of whether it has a real photo) and never checked `item.media` at all. The exact same real bug, and the exact same real fix, already correctly applied in `ProductCard` much earlier in this project — evidently never carried over to these two, real, separate components. Fixed both to find the first genuine real image in `item.media` (skipping any video, matching the proven, established pattern) and show that, falling back to the decorative art only when a product genuinely has none yet. Verified visually: added a real product with a real photo to the cart, confirmed the actual photo now shows correctly in both the sidebar and the full cart page.

**Files:** `src/AkaraApp.jsx`

---
## Android mobile app integration — Bearer auth and the real APK update channel

**Date:** 5 September 2026

A real, separately-developed Expo/React Native Android app (built against an official integration guide, source reviewed directly) needed the website side of the connection built — the app itself was already genuinely complete, but three real, specific gaps confirmed directly against the live site meant it couldn't actually work yet.

**1. Bearer token authentication, added alongside the existing cookie session — genuinely additive, not a replacement.** Confirmed by direct code review: the website's real login/signup responses only ever sent `{ customer }`, and `attachCustomer` (the real, actual middleware behind every authenticated route) only ever read the session cookie, never an `Authorization` header. A real, native mobile app has no cookie jar, so it needs the same real JWT delivered a different way. The cookie check happens first, completely unchanged; the header is only ever consulted when the cookie is genuinely absent, which never happens for an actual browser session — confirmed directly, not assumed: logged in through the real browser UI (still works, cookie still set), then made a request with the new Bearer token and *no cookie at all* (correctly authenticated), proving both real paths work independently.

**2. `/app/android-version.json` and `/app/akara.apk`** — the two real, public routes an installed app's update-checker polls. Confirmed directly, live, before this fix: both silently fell through to the website's own SPA shell (`content-type: text/html`, not real app data) — exactly the gap the integration guide's own pre-test audit had flagged. Registered before the SPA fallback, matching the same, established real pattern already used for `/sw.js` and `/sitemap.xml`. The actual APK binary is deliberately never stored on Railway's own disk (not persistent across redeploys, same real reasoning already documented on the `/uploads` static route) — it uploads straight to Cloudflare R2 via the same real, existing helper already used for product photos, with only the resulting real URL recorded in a new `android_app_version` setting. `/app/akara.apk` redirects to that real, current URL; a genuinely honest `404` (not a silent SPA fallback) is returned if nothing's been published yet.

**3. A new admin-only settings endpoint** (`server/routes/admin/settings.js`) to upload a real APK and publish its version metadata — real, deliberate validation (a genuine, positive integer version code, a real HTTPS URL, upload required before publish) matching the same seriousness given to real product pricing elsewhere in this project.

**Verified, not assumed**: real, direct end-to-end test of the full new admin flow (reject an invalid URL, accept a valid one, confirm the public routes immediately reflect it), plus a full site-wide regression sweep confirming the existing website and admin panel are completely unaffected.

**Admin UI added the same day** (`AdminAndroidAppSettings` in `src/AdminApp.jsx`, under Settings) — a real, deliberate two-step flow: upload the actual `.apk` file first (straight to R2, returns its real URL), then separately fill in version name/code/release notes/force-update and publish. Verified through the real UI: uploading correctly surfaces an honest "storage isn't configured" message in this sandbox (no R2 credentials here) rather than a silent failure or crash — the same real code path succeeds on the live site, already proven directly via the backend's own `curl` tests above.

**The real `/android-app` download page was built the same day** (`AndroidAppView` in `src/AkaraApp.jsx`), after a direct, live 404 was hit trying to reach it — confirmed the page genuinely didn't exist anywhere yet, at either the URL tried or the correct one. Fetches the exact same real, public `/app/android-version.json` the installed app's own update-checker polls, so this page and the app itself can never show two different, disagreeing version numbers. Shows a real, honest empty state when nothing's published yet, and — once a real version is live — the actual download button, version number, a genuine, necessary warning about Android's "install from unknown sources" prompt (since this isn't a Play Store release), a numbered install guide, and the real, current release notes. Linked from the footer. Verified visually in both real states: nothing published, and a real, live version with real release notes, both with zero errors.

**Still needed before the app is genuinely usable** (real, remaining work, not yet started): a real APK build via `eas build`, uploaded through the admin panel now that the whole pipeline exists end to end.

**Files:** `server.js`, `server/auth.js`, `server/routes/auth.js`, `server/routes/admin/settings.js`, `db/schema.sql`, `src/AdminApp.jsx`, `src/AkaraApp.jsx`

---
## Real "Ā" macron support in generated PDFs, via an embedded font

**Date:** 5 September 2026

Directly requested: the real brand name "ĀKĀRA" (with actual macrons over both A's) had never rendered correctly in the downloadable invoice or packing slip — jsPDF's built-in fonts (Helvetica/Times/Courier) were confirmed, by direct test, to silently drop the character entirely, rendering "ĀKĀRA" as "KRA". This is a genuine, real limitation of those specific built-in fonts (they only cover a narrow WinAnsi/Latin-1-style character set), not something fixable with a setting.

**Fixed by embedding Noto Sans** (Google's own real, open-source font family, SIL Open Font License 1.1 — confirmed via the actual license file to permit commercial embedding with no royalty or output attribution required), specifically chosen because it's built to cover the full real Unicode range, including the Latin Extended-A block that Ā/ā belong to. A static (non-variable) TTF was used deliberately for each weight — jsPDF's own font-embedding path has real, documented issues with variable-font tables.

**Genuinely, thoroughly stress-tested before shipping**, per direct instruction: confirmed via direct font inspection that both the Regular and Bold weights contain every real character the invoice and packing slip actually use — not just Ā/ā, but the ₹ symbol, full upper/lowercase Latin, digits, and common punctuation — then separately rendered and visually reviewed each one to confirm correct, non-garbled glyphs, not just technical presence. Every `helvetica` reference in both `downloadInvoicePDF` and `downloadPackingSlipPDF` (headings, body text, and the `autoTable` item tables) was replaced for real, complete consistency — not just the brand-name line. Final, decisive proof: generated a real invoice through the actual, live, running app (not a standalone script) for a real seeded order, downloaded it via a genuine browser session, and visually confirmed "ĀKĀRA" renders correctly with both macrons alongside entirely correct real order figures.

The header copy was also updated to the real, agreed phrasing — **"AKARA is a brand of Precision Forge Labs"** — replacing the old, bare "Precision Forge Labs" line.

**New:** `src/invoiceFontData.js` — the embedded font data, kept in its own file specifically so this ~1.5MB real payload is only ever fetched via dynamic `import()` at the moment a customer actually downloads a PDF, confirmed via the real build output to land in its own separate chunk rather than bloating the site's initial load.

**Files:** `src/AkaraApp.jsx`
**New:** `src/invoiceFontData.js`

---
## GST-inclusive customer pricing, admin round-off pricing tool, and per-product cost/profit tracking

**Date:** 5 September 2026

A real, three-part pricing overhaul, built and tested carefully given the genuine sensitivity of money math — each piece verified with actual numbers, not just compiled.

**1. GST-inclusive prices, shown to customers everywhere.** Previously, every displayed price was tax-exclusive, so checkout added ~18% for the first time at the very last step — a real, reported cause of the price "jumping" and giving second thoughts at checkout. Fixed at the single, shared source (`gstInclusivePrice()` in `enrichProduct()`), used consistently by all 9 real customer-facing display locations found in a full sweep (product page, shop grid, search dropdown, homepage sections, wishlist). Found and fixed a real, serious naming collision along the way: a new `displayPrice` field would have silently clashed with an existing, differently-meaning local variable of the same name already used for cart/checkout logic — caught by review before it could cause a real, live pricing bug, and named `gstInclusiveBasePrice` instead. Verified live across three separate real pages for the same product, all showing the identical figure. Real cart, checkout, and invoice math were deliberately left untouched — they correctly continue to use the raw, GST-exclusive base price the database actually stores.

**2. A round-off pricing tool in the admin product editor**, directly requested: type the actual final price you want customers to see (e.g. ₹1,699), and the system works backward to the correct base price to store. Before writing any UI, the real math was stress-tested against hundreds of real prices — found that whole-rupee rounding (required, since `products.price` is a real `INTEGER` column) can land the real, forward-calculated result ±₹1 off the intended figure roughly 15% of the time. The tool discloses this honestly rather than hiding it — a green confirmation on an exact match, an explicit orange warning naming the real, actual resulting price when there's a genuine ±₹1 gap. The base-price field and the round-off field stay linked in both directions without fighting each other's typing (an early version had a live `useEffect` that would have silently overwritten active keystrokes — removed). Verified with three separate, live, in-browser tests plus a real, direct database check confirming the saved price was correct.

**3. Real, per-product cost tracking and a profit dashboard.** A new `cost_breakdown` JSONB column on `products` (material, labor, electricity, packaging, transport, design, other — a fixed, real set, deliberately shared between the editor and the dashboard via a new `server/costCategories.js` rather than defined twice and risking silent drift). Entered once per product, not per batch — a deliberate simplification agreed on directly. The product editor shows real, live cost-per-unit and margin-at-current-price as you type, right next to the pricing fields, so cost genuinely informs pricing rather than the reverse. A new `/api/admin/dashboard/profit` endpoint (all-time, not date-range-filtered — a product's real, total profit since it started selling is what actually answers "was this priced right") computes real cost-per-unit, expected per-unit profit at the current price (always available, independent of sales history), and actual total profit from real sales — deliberately two distinct numbers, since a genuinely correct per-unit margin means nothing yet if a product hasn't sold at all. A new bar chart plus sortable table on the Dashboard shows this per product, only for products with real cost data actually entered. Verified by hand-calculating expected cost, margin, and profit figures, then confirming the live chart and table matched exactly.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`, `server/routes/admin/products.js`, `server/routes/admin/dashboard.js`, `db/schema.sql`
**New:** `server/costCategories.js`

---
## Full admin panel visual review — spacing, text visibility, and functionality

**Date:** 5 September 2026

A real, systematic walkthrough of every real admin screen, with genuine, representative seeded data (multiple customers, multiple orders across every real status, multiple product categories) rather than judging empty-state screens — several apparent issues turned out to be artifacts of sparse test data, not real bugs, and are documented here too so they aren't re-investigated later.

**One real, genuine bug found and fixed**: the Orders screen's price figure could visually collide with the status badges next to it whenever an order had a wider real badge combination (e.g. "COD" + "DISPATCHED" + "Mark paid"). Root cause: the row's container never allowed wrapping, forcing all of a real order's content onto one fixed line regardless of how much of it there genuinely was. Fixed by allowing the row to wrap — badges that don't fit now move to their own line instead of overlapping the price, for any future real status/badge combination, not just the ones caught in this specific review. Confirmed fixed directly against the exact real order that showed the original overlap.

**Real things checked and confirmed correct, not bugs**, despite initially looking questionable:
- **"Studio Risk 100/100 · High"** on the Dashboard — checked the actual scoring formula and the real, live data behind it: the real, live catalog genuinely has 27 products with no photo, which alone is enough to max out the score. The math is correct; the real gap is the missing product photography itself (a known, standing item, not a code issue).
- **Empty-looking "Category Mix" and "Best Sellers" charts** — rendered correctly once tested with genuinely varied category data; a single-category test dataset produces a real, valid chart that's visually easy to mistake for broken.
- **"Featured Products: Currently Featured (0)"** — this sandbox database has never had featured products set; checked the real, live site directly and confirmed 8 real featured products are genuinely live there. Not a real gap.
- **Every customer showing "₹0 total spent"** — by design: the real query only counts orders with `payment_status='paid'`, deliberately excluding COD until it's actually collected. Correct as written, but worth a real, deliberate decision on whether COD should count toward customer lifetime value — flagged, not changed, since that's a real business call, not a bug fix.
- Categories, Media Manager, Return Requests, Newsletter, Enquiries, Activity Log, Manage Accounts, and Site Content all reviewed with real data where available — no genuine issues found.

**Files:** `src/AdminApp.jsx`

---
## Manual Google account linking, from account settings

**Date:** 5 September 2026

**Closes a real, standing item from the pending list** — Google Sign-In already existed and correctly *auto-linked* a matching email on first Google sign-in, but there was genuinely no way for a customer to link, unlink, or check their own real status manually. Built as a new "Google account" card in My Account → Profile, sitting between Password and the danger zone.

**Real, deliberate safeguard, proven directly**: a customer can never unlink Google if doing so would leave them with no way to sign in at all — a genuine Google-only account (no password ever set) is walked through setting a password first before Unlink becomes available, and the server enforces this too, independent of the UI, so it can't be bypassed. Tested directly against three real, distinct account states (never linked; linked with a password; linked with no password) — every real transition confirmed working end to end, including the actual database state, not just the UI response.

**New backend routes** (`server/routes/auth.js`): `GET /api/auth/google-status`, `POST /api/auth/google-link` (checks the Google identity isn't already claimed by a different real account, and that its email genuinely matches the account being linked), `POST /api/auth/google-unlink` (the safeguard above), `POST /api/auth/set-password` (genuinely distinct from the existing change-password route — this is real, first-time password creation for an account that has none yet, not a "change" flow).

**Frontend** (`src/AkaraApp.jsx`): a new `GoogleLinkButton` component, deliberately separate from the existing sign-in page's `GoogleSignInButton` — that one's real callback signs a person in and redirects, which is wrong behavior for someone already logged in linking their account; the two share the same real Google script-loading logic but have different, correct real callbacks.

**Files:** `server/routes/auth.js`, `src/AkaraApp.jsx`

---
## Real, site-wide gold-on-cream contrast fix, and clarifying "New Collection"

**Date:** 4 September 2026 — later same day

**"New Collection" on the homepage is not admin-editable, by design** — it's automatically computed from each real product's actual `createdAt`, showing the 8 most recently added products. This is deliberate (stays accurate forever, zero admin upkeep) but means there's genuinely no matching screen in Site Content — reported as "can't find where to edit it," which is correct: there's nothing to edit, the section reflects the real catalog automatically.

**A real, systematic, site-wide check for gold text sitting on a cream background** — reported directly as "multiple gold texts not visible on cream." Checked every real instance of `color:T.gold` across both `AkaraApp.jsx` (16 instances) and `AdminApp.jsx` (9 instances), confirming the actual real background each one sits on rather than assuming. **12 genuinely broken instances found and fixed** in `AkaraApp.jsx` (Room Stories, mood board titles, hero category label, the four process-step numbers, product page "Finish" and "Why this piece" labels, all of My Account's Profile section labels, and the return-request page's three summary cards) and **all 9 instances in `AdminApp.jsx`** (the admin login page's "Studio access" label, the dashboard's "Open orders" link, and every section label inside the product editor modal — Catalog, Basics, Media, Size/colour variants, Key features, Finish swatches, Description & SEO). All changed from `T.gold` to `T.teal`, matching this project's own established real contrast rule (teal background → gold/cream text; cream/card background → teal text only). **3 real instances in `AkaraApp.jsx` were checked and confirmed already correct** — genuinely on a teal background (the coupon banner's code button, "Made for **you**" on the dark "Made in Mumbai" section, and the stepGrid CMS block's numbered steps) — left untouched.

**Files:** `src/AkaraApp.jsx`, `src/AdminApp.jsx`

---
## Real hook-order crashes, a website-wide CMS sync sweep, and removing the temporary startup migration

**Date:** 4 September 2026 — later same day

**Two real React hook-order bugs found and fixed**, both a genuine violation of React's own rule that every hook must run in the same order on every render — never conditionally, never after an early return. `ReturnRequestView` and `InvoiceView` both declared real `useState` calls *after* their own `if(!user)`/`if(!order) return ...` early return. This produces exactly the real, reported symptom — "works once, then breaks" — because the hook only runs on renders where the guarded value already exists; if a page is ever mounted while that value is still resolving (e.g. a login completing while the page is already on screen), a later render with a different value hits a real hook-order mismatch and crashes into the app's error boundary. Fixed by moving both hooks above their respective early returns. **A real, automated, systematic script then checked all 64 real top-level components in `src/AkaraApp.jsx` and all 26 in `src/AdminApp.jsx` for this exact same pattern** — no further real instances found.

**A real, website-wide sweep for pages showing content that wasn't actually connected to the admin panel**, following a direct report naming the FAQ and return-request pages specifically. FAQ turned out to already be correctly CMS-connected (confirmed 19 real, live questions matching what should be there) — not a real bug. The **return-request page's real policy content** (the "Quality claims only" heading, intro paragraph, and the three-card Time Limits / Evidence Required / Not Accepted summary) was genuinely, entirely hardcoded — editing it from the admin panel could never have changed anything on the live page. Every other customer-facing page was checked the same way; everything else was already correct (About, Craft, Privacy, Refunds, Shipping, Terms, Cookies, Accessibility, Care Guide, Homepage all genuinely CMS-connected; Checkout/Login/Account/Order-confirmation correctly *not* editable, since that's real functional behavior, not content).

**Fix:** the return-request page's real editorial copy is now a genuine CMS page (`page_key: "return-request"`), using the same, existing `heading`/`paragraph`/`cardGrid` block types every other CMS page already uses — no new block type, no new admin UI needed. The actual, real interactive form (fields, validation, submission) is deliberately left as real functional code, untouched. Verified both directions: a real, logged-in customer sees the identical original design, now served from the database; the admin panel's Site Content screen correctly lists and can edit every real piece of it.

**The temporary automatic startup migration (added ~30 Aug, documented in the entry below) has been removed** from `server.js`, now that `npm run db:sync` has been run successfully and deliberately against the live database. The app is back to its original, lean startup — no per-restart schema re-check. If a future schema change needs applying, use `npm run db:sync`/`npm run migrate` deliberately; see "Part 4 — Database" below.

**Files:** `src/AkaraApp.jsx`, `server/routes/admin/page-content.js`, `server/seed-cms.js`, `server.js`

---
## Deployment recovery, real production bugs, and going-forward migration guidance

**Date:** 4 September 2026

A real, extended incident: the site went down after a deploy and stayed down through several distinct, genuinely separate causes, found and fixed one at a time by actually reproducing each locally rather than guessing. Documented here in full so the same class of issue is recognizable faster next time.

**1. Railway builder misconfiguration.** The service's builder was set to **Railpack**, and `railway.json` (this project's real build/start config) had never been pointed at by Railway's **Config-as-code** setting — so it sat in the repo, correct, but completely unused. Railway fell back to serving the repo as static files (confirmed via the deploy log's own `fileserver.notFound` error, a Caddy static-file-server response, not a real app crash). **Fix:** in Railway → Settings → Config-as-code, add the file path `railway.json` explicitly, and confirm Builder is set to **Nixpacks** (the builder this project's config was written for).

**2. Two genuine syntax errors, shipped in a code upload.** `src/AkaraApp.jsx` had a real statement pasted inside a function's own parameter list (`function HomeView({ const {...} = useCategories(); navigate, ... })`), and a real ternary's closing `)`/`:null` were in the wrong order. `src/AdminApp.jsx` had a stray `const` on its own line with nothing after it, immediately before the real `const FULFILLMENT_STEPS = [...]` it should have been part of. All three broke the production build outright — found by actually running `npm run build` locally and fixing whatever it reported, not by inspection.

**3. A second, real runtime bug in the admin dashboard**, only visible after login: `ReferenceError: today is not defined` — a real "Today" summary strip referencing a bare `today` variable that was never declared, instead of the real data path `data.todayStrip`. React's error boundary caught it and showed a generic "Something went wrong" screen — the *page* loaded fine (real `200`), the crash was purely client-side JavaScript.

**4. `db/schema.sql` had never actually been run against the live database** for everything added since the last real migration — `categories`, `push_subscriptions`, `google_id`, `finishes`, refund tracking. Confirmed directly from the live database's own error logs: `relation "categories" does not exist`. Compounded by Railway's own console (the normal way to run `npm run migrate`/`npm run db:sync` as a one-off command) being genuinely unreachable — a real WebSocket connection failure on the user's end, unrelated to this app, that no code change here can fix.

**5. Worked around the unreachable console** by adding a temporary, automatic schema-sync directly into `server.js`'s own startup sequence — runs `db/schema.sql` every time the app boots, statement by statement (not as one giant batch, so one genuinely failing statement can't silently block every real statement after it), logging exactly which real statement number succeeded or failed. Two further real bugs were found and fixed in this exact migration logic before it worked correctly: a naive `;`-split was slicing apart the schema's own real `DO $$ ... END $$;` procedural blocks (which contain real, internal semicolons), and a naive "starts with `--`" comment filter was gluing multi-line SQL comments onto the front of the next real statement, corrupting it. **Removed** the same day, once Railway's console became reachable again and `npm run db:sync` was run successfully, deliberately — see the entry above this one for that removal, and "Part 4 — Database" below for the current, correct, ongoing guidance.

**6. One real, separate data bug, unrelated to the above**: the dashboard's "open contact enquiries" count queried a table called `contact_messages`, which has never existed anywhere in this schema — the real, correct table (used everywhere else in the codebase) is `contact_submissions`, which also has no `status` column at all. A real `.catch()` fallback meant the dashboard never actually broke, but a genuine PostgreSQL error was logged on every single dashboard load. Fixed to query the real, correct table directly, using recency (`created_at` within 7 days) as a defensible proxy for "open," matching what the old fallback already did.

**Two small, real, permanent additions from this incident:** `.nvmrc` (pins the real Node version, `>=20.0.0`, for build-environment consistency) and `railway.json` (the real, explicit build/start configuration — now actually wired up per fix #1 above).

**Files:** `server.js`, `src/AkaraApp.jsx`, `src/AdminApp.jsx`, `server/routes/admin/dashboard.js`, `package.json`, `.nvmrc` (new), `railway.json` (new)

---
## Server-side SEO rendering

**Date:** 1 September 2026

Express injects per-URL **title, description, canonical, Open Graph, Twitter, JSON-LD**, and crawlable HTML inside `#root` before the SPA boots (`server/seo.js`). Dynamic **`/sitemap.xml`** already lists live products.

Not full React SSR — crawlers get real meta + text; React replaces the shell on hydrate.

**Railway:** no new DB tables for SEO. After deploy: `npm run migrate` only if other schema changes (e.g. push) are pending.

---
## COD in Pulse + Path C + PWA push

**Date:** 1 September 2026

1. **Dashboard revenue** includes `payment_status IN ('paid','cod')` (confirmed money). Pulse shows Online vs COD split, studio risk score, stuck >14d, missing images.
2. **Web Push:** `web-push`, table `push_subscriptions`, routes `/api/push/*`, SW push handlers. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Generate: `npx web-push generate-vapid-keys`. Then `npm run migrate`. Admin: Pulse → Enable push. Customer: My Account → Enable order alerts.
3. New COD/paid orders notify admins; status changes notify that customer.

**Files:** `server/routes/admin/dashboard.js`, `server/push.js`, `server/routes/push.js`, `server.js`, `server/routes/orders.js`, `server/routes/admin/orders.js`, `public/sw.js`, `src/AdminApp.jsx`, `src/AkaraApp.jsx`, `db/schema.sql`, `package.json`, `.env.example`

---
## Atelier Pulse visual upgrade

**Date:** 1 September 2026

Interactive Recharts (area, pie, bar), gradient KPI cards, insight chips, studio flow click-through, soft auto-refresh every **60 seconds**.

**File:** `src/AdminApp.jsx` only (API unchanged).

---

## Typography — justified body

**Date:** 1 September 2026

Paragraphs use Word-style **justify** (`text-align: justify`) via `src/index.css`. Headings stay left; `.text-center` blocks (hero, trust, etc.) stay centered.

---

## Featured refinement

**Date:** 1 September 2026

Magazine Featured: quieter headline, gold category, price + lead-time line, dual CTAs, editorial support tiles (not full product cards).

**File:** `src/AkaraApp.jsx`

---
## Fix: Admin Products crash

**Date:** 1 September 2026

Restored missing `STATUS_OPTIONS` / `STATUS_BADGE_VARIANT` (removed during Atelier Pulse edit). Without them, Admin → Products threw and the page failed to open.

**File:** `src/AdminApp.jsx`

---
# ĀKĀRA Website

The Atelier ĀKĀRA e-commerce site — React + Vite frontend, served by a
small Express server with SPA routing fallback, deployed on Railway at
www.akaraonline.co.in, DNS/CDN managed through Cloudflare.

This file describes what the project actually is *right now*. Earlier
versions of this README described specific past work passes in detail;
that history has grown too large to usefully track here — for a full
record of what's been built, fixed, and is still pending, see the
separate AKARA Master Pending List.






## Homepage layout

**Date:** 1 September 2026

- Single category entry: **Shop by Category** only (no second "Browse by category" / The Collection grid).
- Wider content column (`max-w-[2000px]`, fuller horizontal padding) so sections are less “stuck in the middle”.
- **How a piece is made** matches **Built differently** card language (icon box, gold step number, italic title).

**File:** `src/AkaraApp.jsx`

---

## Google Sign-In

**Date:** 1 September 2026 (inferred from its real, chronological position in this file — no explicit date was recorded when this entry was originally written)

### Where to put credentials (after you rotate the secret)

| Place | What |
|-------|------|
| **Railway (or host) env** | `GOOGLE_CLIENT_ID=...` (required) |
| **Railway env (optional)** | `GOOGLE_CLIENT_SECRET=...` (not required for current ID-token login) |
| **Google Cloud Console** | OAuth client → Authorized JavaScript origins: `https://www.akaraonline.co.in`, `http://localhost:5173` |
| **Do not** | Commit secrets into git or this zip |

### After deploy

1. `npm install` (adds `google-auth-library`)
2. `npm run migrate` (adds `customers.google_id`, allows null `password_hash`)
3. Set `GOOGLE_CLIENT_ID` on the server and restart
4. Open `/login` — “Continue with Google” appears when config is enabled

### Files

- `db/schema.sql`
- `server/googleAuth.js`
- `server/routes/auth.js`
- `server.js` (CSP for accounts.google.com)
- `src/AkaraApp.jsx` (button on login + signup)
- `package.json` (`google-auth-library`)
- `.env.example`

---

## Homepage magazine Featured

**Date:** 31 August 2026

Featured section only: first admin-featured product is a large 4:5 hero + caption (name, category, short description, price, View piece). Up to 3 more featured products show as support cards below. Uses CSS **responsive grid** (`grid-cols-1` → `md:grid-cols-12`) so mobile stacks, desktop is side-by-side.

**File:** `src/AkaraApp.jsx` — HomeView Featured block only.

---

## Customer-facing visual updates

**Date:** 31 August 2026

- **PDP gallery:** 4:5 frame + `object-cover` (no empty side bands). Full image still in lightbox.
- **Size helper:** short italic line under Small/Medium/Large on product page.
- **Cart drawer:** “Printed after you order · typically 2–3 weeks” under subtotal.
- **Homepage:** more vertical spacing on major sections; softer product-card image hover (scale 1.03).

**File:** `src/AkaraApp.jsx` only for these. No migrate.

**Photo tip:** Prefer **1:1 or 4:5** uploads (~2000px). Cover will crop edges slightly; lightbox shows full frame.

---

## Recent admin updates

**Date:** 31 August 2026

### Atelier Pulse (Dashboard)
Interactive analytics at **Admin → Dashboard**:
- Range chips: 7d / 30d / 90d / All
- KPIs: paid revenue, paid orders, AOV, in-production count, needs-attention, new customers
- Revenue chart (toggle revenue vs order count)
- Studio flow funnel (confirmed → production → QC → dispatched → delivered); click a stage for orders
- Best sellers, category mix, quiet forms, stock/returns/payment attention lists

**Files:** `server/routes/admin/dashboard.js`, `src/AdminApp.jsx`

### New-order badge (WhatsApp-style)
While the admin panel is open, the sidebar **Orders** item shows a **red count** of orders placed since you last opened Orders. Polls every 30s via `GET /api/admin/orders/new-count?since=<ms>`. Opening Orders clears the badge (stores watermark in `localStorage`).

**Files:** `server/routes/admin/orders.js`, `src/AdminApp.jsx`

### Grouped admin navigation
Sidebar groups: Operate · Catalog · People · System, with gold active indicator and role badge.

No database migration required for these features (`npm run migrate` unchanged).

---

## What's in this project

```
akara-website/
├── src/
│   ├── AkaraApp.jsx        the customer-facing site — every page, component, and route
│   ├── AdminApp.jsx        the admin panel (/admin) — separate bundle, code-split
│   ├── shared.jsx          components used by both (buttons, cards, modals, etc.)
│   ├── main.jsx            mounts the app into the page
│   └── index.css           Tailwind entry point
├── server/
│   ├── db.js                Postgres connection pool
│   ├── auth.js               customer sessions, password hashing, login rate limiting
│   ├── adminAuth.js           admin sessions — role-based (staff/admin/super_admin),
│   │                           structurally separate from customer auth
│   ├── twoFactor.js            admin 2FA — TOTP secret encryption, code verification,
│   │                           backup code generation/hashing
│   ├── csrf.js                 CSRF token issuing/verification
│   ├── rateLimit.js             shared rate limiter for public forms (contact/bulk/newsletter)
│   ├── validate.js               shared input sanitization helpers
│   ├── email.js                   all outbound email (Resend) — every template escapes user input
│   ├── whatsapp.js                 order-notification WhatsApp messages (Gupshup)
│   ├── shiprocket.js                real courier booking + live tracking lookup
│   ├── razorpay.js                   payment order creation, signature verification, refunds
│   ├── refunds.js                     shared refund logic (customer + admin cancellation paths)
│   ├── r2.js                           product photo/video storage (Cloudflare R2)
│   ├── upload.js                       file validation (type/size checks, EXIF/GPS stripping)
│   ├── photoId.js                       generates the CATEGORY-PRODUCT-##### photo ID scheme
│   ├── settings.js                      shared settings table reads (shipping, COD, maintenance,
│   │                                     featured coupons)
│   ├── scheduler.js                      abandoned-checkout reminder emails, runs on an interval
│   ├── env.js                            reads Railway's own env vars for prod-environment checks
│   ├── migrate.js                        creates/updates all database tables (safe to re-run)
│   ├── seed.js                            loads the product catalog into the database
│   ├── seed-cms.js                        loads the real content for every CMS-editable page
│   │                                      (legal pages, FAQ, Care Guide, About, Craft) — safe to
│   │                                      re-run, skips any page that already has content
│   ├── seed-admin.js                      creates/updates an admin account, with a role
│   │                                      (staff/admin/super_admin) — run directly, no HTTP endpoint
│   ├── merge-variant-products.js          ONE-TIME script that merged the old split-color
│   │                                      products into real multi-variant products — already run;
│   │                                      kept for reference, not meant to run again
│   ├── migrate-uuid.js                    ONE-TIME script that converted customer IDs from integer
│   │                                      to UUID — already run; kept for reference, refuses to
│   │                                      run twice
│   └── routes/
│       ├── auth.js                 signup (with email OTP verification)/login/logout/me/account
│       │                            deletion (customer)
│       ├── products.js              public product list/detail, including real color/variant data
│       ├── orders.js                 checkout (server-side variant-aware pricing — never trusts a
│       │                              client-sent price), payment verification, cancellation,
│       │                              order history
│       ├── addresses.js               saved address book
│       ├── returns.js                  return request submission
│       ├── reviews.js                   product review submission + summary (reviews survive
│       │                                account deletion, shown as "Verified Buyer")
│       ├── wishlist.js                   saved-items list
│       ├── coupons.js                     public shipping-cost/coupon-validate/featured-coupons/
│       │                                  maintenance-status lookup
│       ├── contact.js                      contact form
│       ├── bulk-orders.js                   bulk/corporate order enquiry form
│       ├── newsletter.js                     newsletter signup + preferences
│       ├── page-content.js                    public read-only CMS content lookup, by page key
│       ├── upload.js                          authenticated file upload endpoint
│       ├── webhooks.js                         Razorpay payment webhook
│       └── admin/
│           ├── auth.js                 admin login/logout/me
│           ├── dashboard.js             revenue/order charts, real DB queries
│           ├── products.js               product CRUD, media validation, size/color variant
│           │                              management (colors + priced/stocked combinations)
│           ├── orders.js                  order status management, COD mark-paid
│           ├── returns.js                  return request review
│           ├── customers.js                 customer account list
│           ├── accounts.js                   admin/staff account management — super_admin only
│           ├── page-content.js                site-wide CMS — block-based page editor with full
│           │                                  version history and one-click revert, super_admin
│           │                                  only
│           ├── enquiries.js                    unified view of Contact + Bulk Order submissions,
│           │                                    with a handled/new marker
│           ├── activity.js                      admin action audit log — tied to the real account
│           │                                     that performed each action
│           └── settings.js                       shipping cost, COD toggle/fee, maintenance mode,
│                                                  coupon management (including public "featured"
│                                                  visibility)
├── db/
│   ├── schema.sql            every table definition + every migration since, in order
│   └── seed-products.json     the product catalog
├── public/
│   ├── manifest.json           PWA manifest — installable app, real brand icons/colors
│   ├── sw.js                    minimal service worker (installability only — deliberately
│   │                            caches nothing, so prices/stock are never served stale)
│   ├── icon-192.png, icon-512.png, icon-512-maskable.png   real app icons generated from the
│   │                                                        site's own brand mark
│   ├── robots.txt
│   ├── security.txt            RFC 9116 vulnerability-disclosure contact
│   └── .well-known/
│       └── security.txt         same file, the other standard location
├── index.html                 page shell — Google tag, fonts, meta tags, favicon, PWA manifest link
├── server.js                   production server — API routes, dynamic sitemap.xml, SPA fallback,
│                                security headers (CSP/HSTS/etc.), apex→www redirect
├── vite.config.js               strips HTML comments from the production build only
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .env.example                 every environment variable this app reads, documented
└── .gitignore
```

Note: `sitemap.xml` is generated dynamically by `server.js` at request
time (pulling real, current product IDs from the database) — it is not
a static file in `public/`.

## Part 1 — Push this to GitHub

You said you already have a GitHub account, so:

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `akara-website` (or whatever you like)
3. Keep it **Private** unless you have a reason to make it public
4. **Don't** check "Add a README" or ".gitignore" — this project already has both
5. Click **Create repository** — GitHub will show you a page with setup commands; ignore those, use the commands below instead

On your computer, open a terminal in this project folder (wherever you've
unzipped/saved it) and run:

```bash
git init
git add .
git commit -m "Update — ĀKĀRA website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/akara-website.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your actual GitHub username, and
`akara-website` with whatever you named the repo. If this repo already
exists from a previous push, skip `git init` and `git remote add` —
just `git add .`, `git commit`, `git push`.

## Part 2 — Railway

If you've already connected Railway to this GitHub repo, pushing to
`main` triggers a new deploy automatically — no extra step needed here.

If setting this up fresh: in Railway, click **GitHub Repository**,
authorize access if asked, select this repo. Railway detects it's a
Node project from `package.json`, runs `npm install` then `npm run
build`, and starts it with `npm start` (which runs `server.js`).

**Build configuration — genuinely required, not optional.** This
project ships a real `railway.json` at the repo root specifying the
correct build/start commands explicitly, but Railway does **not** read
it automatically — a real outage happened specifically because of
this. In the service's **Settings → Config-as-code** section, add the
file path:

```
railway.json
```

Also confirm **Settings → Build → Builder** is set to **Nixpacks**
(not Railpack — a newer, different builder that doesn't necessarily
honor this project's `railway.json` the same way). If Railway ever
falls back to serving the repo as static files instead of running the
real Node app, this config-as-code path being unset is the first real
thing to check — the symptom looks like a generic 404 on every route,
with a `fileserver.notFound` error in the deploy logs (Caddy's own
static-file-server response, not an application crash).

## Part 3 — Environment variables

Full list, with explanations of what each one does and where to get it,
is in `.env.example` in this project — copy its structure into Railway's
**Variables** tab. A few are required (the app won't start without
them); most are optional and simply disable one feature gracefully if
left unset (e.g. no `RESEND_API_KEY` means no emails send, but checkout
still works).

**Required:** `DATABASE_URL`, `JWT_SECRET`, `CSRF_SECRET`,
`ADMIN_JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`.

**Optional, each enabling a real feature:** `RESEND_API_KEY` (email),
`GUPSHUP_*` (WhatsApp order notifications), `R2_*` (permanent photo/video
storage — see below, this matters), `SHIPROCKET_EMAIL` /
`SHIPROCKET_PASSWORD` (real courier booking + tracking), `SITE_URL`,
`TOTP_ENCRYPTION_KEY` (admin two-factor authentication — without it, an
admin trying to set up 2FA gets a clear error rather than anything
insecure, but everything else works normally; a real 32+ byte random
value, generated the same way as the other secrets, and never changed
once an admin has actually enabled 2FA with it).

## Part 4 — Database

Railway's Postgres service should already be linked as `DATABASE_URL`.

**The real, current, correct command after any deploy with schema
changes** (added since the original three-step guidance below):

```bash
npm run db:sync     # runs schema.sql migration, then refreshes FAQ + Refund CMS pages — the one command to run after a deploy
```

This is genuinely the one command to reach for day-to-day — it does
everything `npm run migrate` does, plus keeps the FAQ/Refund CMS
content current (see `server/db-sync.js`). Run it via Railway's
dashboard Shell/Run Command, or the
[Railway CLI](https://docs.railway.app/guides/cli) with `railway run`.

**If you only need the original three, separate steps** (e.g. a brand
new environment, or `db:sync`'s CMS refresh isn't wanted yet):

```bash
npm run migrate     # creates/updates every table — safe to run repeatedly, on any DB state
npm run seed         # loads the product catalog
npm run seed:cms      # loads the real content for every CMS-editable page
```

All of these commands are idempotent — safe to re-run if something goes
wrong partway through; `seed:cms` specifically skips any page that
already has content, so it never overwrites a live edit made from the
admin panel.

**If Railway's console/Shell is genuinely unreachable** (a real
WebSocket connection failure was hit and documented in the 4 Sep 2026
entry above — this is a Railway-side/network issue, not something in
this codebase to fix): `server.js` currently has a **temporary,
automatic** schema-sync built into its own startup sequence, so the
app self-heals its database structure on every restart without needing
console access at all. This is genuinely safe to leave running
indefinitely, but the better long-term setup, once console access
works again, is to run `npm run db:sync` deliberately and remove the
automatic version from `server.js` — it does real, repeated work on
every single restart that a healthy deployment doesn't need.

There are also two genuinely **one-time** scripts already run against
production, kept in the repo for reference — `node
server/merge-variant-products.js` and `node server/migrate-uuid.js`.
Neither is meant to run again; the UUID one refuses to if it detects
it already has.

## Setting up (or changing) admin accounts

There's a real role system now — `staff` (order management only),
`admin` (everything except site content and account management), and
`super_admin` (everything, including the CMS and creating/removing
other admin accounts). Day-to-day account creation happens in-app,
under Manage Accounts (super_admin only) — this script is the
bootstrap/recovery path for creating the *first* account, or fixing
one if you're ever locked out.

```bash
node server/seed-admin.js "your-real-email@example.com" "Your Name" "YourRealPassword1!" [role]
```

`role` is optional and defaults to `super_admin` — the sensible default
for a bootstrap/recovery script. Pass `admin` or `staff` explicitly if
you want to create one of those instead.

Requirements: a real email format, and a password of 10+ characters with
an uppercase letter, a number, and a special character. Running this
again with the same email updates the password (and role, if you pass a
different one) rather than creating a duplicate account.

Sign in at `https://www.akaraonline.co.in/admin`. This URL isn't linked
anywhere on the public site.

## Product photos and videos

There's a real admin screen for this now — Media Manager (`/admin`,
Media Manager in the sidebar) — with drag-to-reorder, a "set as main
photo" action, and a real photo-ID scheme
(`CATEGORY-PRODUCT-#####`) generated automatically. Sending files
directly in chat, named starting with the exact product ID, still works
as an alternative path.

**Important:** without the five `R2_*` environment variables set,
uploads silently fall back to saving on Railway's own disk, which does
**not** persist across deploys — a photo could vanish the next time this
app redeploys. Confirm these are set on Railway before uploading real
product photos.

## What's actually built and working

This is a genuine e-commerce site, not a demo — real payments, real
database, real everything below.

**Storefront:** full product catalog with categories, search (built into
the header, not a separate panel), product detail pages with real
size/color variants (independently priced and stocked per combination),
real customer reviews (not placeholder text), a wishlist, and a cart
that persists across sessions and correctly tracks color alongside
size. A horizontal, custom-scrolled Featured/New Collection row on the
homepage, and a genuinely public-facing "featured coupon" banner an
admin can turn on for one promotion at a time.

**Checkout & payments:** real Razorpay integration (live mode) with
signature-verified payment confirmation, plus Cash on Delivery as a
genuine alternative payment method — admin-toggleable, with a
configurable handling fee, correctly taxed. Checkout pricing is fully
server-side and variant-aware — it resolves the real price/stock of the
exact size+color combination from the database itself, never trusts a
client-sent price. A payment webhook exists independently of the
customer's own browser completing the flow, so a payment that succeeds
even if someone's connection drops still results in a confirmed order
and a real confirmation email/WhatsApp message.

**Customer account:** signup with real email OTP verification (no
account is created until the code is confirmed), login, saved addresses
with PIN-code auto-fill, order history with real-time status tracking,
self-service order cancellation (server-enforced 30-minute window),
return requests with photo upload, downloadable PDF invoices, a real
password-reset flow (secure tokens, single-use, expiring), and
self-service account deletion (DPDP-compliant — orders are kept and
anonymized for the legal 8-year retention window, reviews are kept and
shown as "Verified Buyer", addresses/wishlist are genuinely deleted).

**Admin panel** (`/admin`, structurally isolated from customer auth —
separate database table, separate signing secret, separate session),
with real, optional two-factor authentication (TOTP — Google
Authenticator/Authy-compatible, no SMS) any admin can turn on for their
own account from Settings, including QR-code setup, verify-before-enable
(so a botched scan can't lock an account out), and single-use backup
codes for recovery — and real role-based access with three levels:
- **Staff** — order management only.
- **Admin** — everything Staff has, plus Products, Media Manager,
  Featured Products, size/color variants, Customers, Newsletter,
  Activity Log, Returns, Enquiries, Settings.
- **Super Admin** — everything Admin has, plus the site-wide CMS and
  Manage Accounts (the only role that can create/remove admin
  accounts).

Also: a real dashboard with live revenue/order charts, order management
with an enforced status lifecycle (confirmed → production → qc →
dispatched → delivered, with cancellation allowed at any pre-delivery
point, and one legitimate backward step — qc back to production — for
genuine quality-check failures), a Media Manager with drag-to-reorder
and automatic photo-ID generation, a maintenance-mode toggle, shipping
cost and COD settings, coupon management (including which one, if any,
is shown publicly), a unified Enquiries view (Contact + Bulk Order
submissions together, with a handled/new marker), and an admin action
audit log that records which real account did what.

**Site-wide CMS** (Super Admin only): every legal/policy page, FAQ,
Care Guide, About, and The Craft are editable live from the admin panel
— no redeploy, no code — with full version history and one-click
revert on every save.

**PWA:** the site is genuinely installable (Add to Home Screen / desktop
install) with real brand icons and colors. Deliberately no offline
page caching — a service worker that cached prices/stock risked
showing stale data, so it exists purely to enable installability, plus
real push notifications (order updates for customers, new-order alerts
for admins) — see `server/push.js` / `server/routes/push.js`.

**Sign-in:** email/password with real OTP verification, plus
**Google Sign-In** — verifies the real Google ID token server-side
(`server/googleAuth.js`, using `google-auth-library`, not a client-
trusted payload), and correctly links to an existing account by email
rather than creating a duplicate if one already exists.

**Refunds:** real, automatic Razorpay refunds on order cancellation
(both customer self-cancel and admin-initiated), plus admin-issued
**partial** refunds with cumulative tracking (`amount_refunded`,
`partially_refunded` status) — a failed refund attempt is never
silently lost; it's recorded and surfaced in the Activity Log, not
just retried quietly.

**Notifications:** order confirmation/status emails, WhatsApp
notifications via Gupshup, abandoned-checkout reminder emails (sent
automatically on a schedule, not manually).

**Shipping:** real Shiprocket integration — creates an actual trackable
shipment on dispatch (requires a pickup location to be specified first),
and can auto-advance orders to "delivered" by checking live tracking
status.

**SEO & infrastructure:** dynamically generated sitemap (always reflects
the real current product catalog), canonical tags on every page, proper
security headers (CSP, HSTS, and others), rate limiting on every public
form, a security.txt for responsible vulnerability disclosure, and DNS/
CDN managed through Cloudflare.

## What's not yet built

- **About/Craft's hero copy and footer text** are not yet part of the
  CMS pass above — everything else customer-facing is.
- **Blog/journal section** — not started.
- **Invoice app integration** — waiting on the exact expected file
  format.
- Full remaining list, including smaller items and infrastructure/
  business decisions still needed: see the AKARA Master Pending List.

## Local development

```bash
npm install
npm run dev        # Vite dev server with hot reload
```

```bash
npm run build       # production build → dist/
npm start           # runs the production server locally (matches Railway)
```


---

## Monorepo note

This package is **AKARA-WEB** (`[WEB]`). Mobile app lives in sibling folder `../akara-mobile` as **AKARA-APP** (`[APP]`). See `../PROJECT_MAP.md`.

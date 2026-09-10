# ĀKĀRA Website — Full Project Documentation

**Document last updated: 9 September 2026** — includes Section **10b** (security audit).

**Purpose of this file:** a complete technical + reasoning reference for
this project — not just what the code does, but why it's built the way
it is. Written so that a new conversation, or a different developer
entirely, can pick this project up with real context, without having to
re-derive decisions that were already made deliberately.

**Status:** Complete — all 17 sections written and verified against the
real, live code and database, not written from memory. If this project
grows further, new sections or updates to existing ones should follow
the same discipline: check the real current state before writing,
don't assume the past is still accurate.

**Last updated:** 29 Aug 2026 — a substantial pass covering everything
built since the 23 Aug version: role-based admin access, the site-wide
CMS, size/color product variants, the admin Enquiries screen, customer
account deletion (DPDP), the PWA, admin two-factor authentication, a
real checkout pricing bug found and fixed, and the current brand color
palette. Every claim below was checked against the real code while
writing this pass, not carried over from the previous version.

---

## Table of Contents

1. What this project is (business context)
2. Architecture overview — how the pieces fit together
3. Authentication & session design — customer vs admin, roles, 2FA
4. Database design — the real schema and why it's shaped this way
5. Checkout & payments — the full real flow, both payment methods, variant pricing
6. Order lifecycle — status transitions, cancellation, returns, refunds
7. Product catalog, variants & media storage
8. Site-wide CMS — editable content without a redeploy
9. Email & WhatsApp notifications
10. Security decisions — what's protected against, and how
11. SEO & performance — the domain fix, the LCP fix, canonical tags
12. Frontend architecture — how the two apps (customer/admin) are structured
13. Third-party integrations — Razorpay, Shiprocket, Resend, Gupshup, R2, Cloudflare
14. Progressive Web App (PWA) — installability and push
15. Deployment & environment — Railway, migrations, environment variables
16. Cross-browser testing — what was verified, and the one real caveat
17. Known gaps & deliberate deferrals — what's NOT built, and why that was a choice

---

## 1. What this project is (business context)

**Atelier ĀKĀRA** is a real, live e-commerce business — luxury,
3D-printed home décor: planters, vases, ceiling and table lighting,
under the legal name Precision Forge Labs, GST-registered, based in
Mumbai. This is not a demo or a portfolio project; it processes real
Razorpay payments in live mode, and every feature described in this
document is running on the actual production site at
www.akaraonline.co.in.

**Priority order the business gave for the catalog:** planters and
lighting first, desk accessories after. This shaped which product
categories got the most design/copy attention early on, though the
underlying platform (checkout, admin, orders) treats every category
identically.

**Who runs this:** the business owner runs everything solo — there is
no separate developer, no dev team, no existing technical documentation
before this file. Every architectural decision in this project was made
collaboratively in conversation, explained in plain terms, and only
built after the owner understood and agreed to the approach — this
document exists partly to preserve *that* reasoning, not just the
resulting code.

**The brand identity that shapes design decisions throughout the
codebase:** teal (#183630), cream (#E3DAC9), and gold (#E5C690) —
referenced by name (`T.teal`, `T.cream`, `T.gold`) throughout both
`AkaraApp.jsx` and `AdminApp.jsx` via a shared theme object in
`shared.jsx`, rather than repeated hex values. **This is the second
palette** — the original (teal #243E41, cream #FFF2DF, gold #B8935A)
was replaced on direct instruction because it read as visually flat;
the current colors are deliberately more saturated for stronger real
contrast. The central `T` object in `shared.jsx` is the only place
these should ever be defined — but a handful of real, genuine
exceptions exist where raw CSS/HTML can't reference a JS object
(the Razorpay checkout theme color, the React error-boundary fallback,
the accessibility skip-link's inline CSS, every transactional email
template, and the PWA manifest/theme-color meta tag) — all of these
were updated by hand alongside `T` and confirmed with a full-project
search to have zero references to the old hex values remaining
anywhere.

## 2. Architecture overview — how the pieces fit together

**Stack:** React (frontend) + Vite (build tool) + Express (backend) +
PostgreSQL (database), deployed as a single Node process on Railway. No
separate frontend/backend hosting — `server.js` both serves the built
React app as static files AND handles every API route. This is a
deliberate simplicity choice appropriate for this business's real scale
— one Railway service, one deploy, one thing to monitor.

**Request flow, in order, as `server.js` actually processes it:**
1. Security headers (CSP, HSTS, etc.) — applied to every response
2. Static file serving (`dist/`, `/uploads` for local-disk fallback)
3. `/webhooks/razorpay` — mounted deliberately OUTSIDE `/api`, before
   CSRF protection applies. This isn't an oversight: a webhook call
   comes from Razorpay's own servers, not a browser, so it can never
   carry a CSRF token — trying to protect it with CSRF middleware would
   just break it. Its real protection is a signature check inside
   `webhooks.js` itself (HMAC-SHA256, verified against
   `RAZORPAY_WEBHOOK_SECRET`).
4. `/api/*` — CSRF protection applies here, then each route file mounts
   under its own path (`/api/orders`, `/api/products`, etc.)
5. `/api/admin/*` — same CSRF protection, but every route additionally
   requires `requireAdmin` (see Section 3) — this is a second, separate
   layer, not a replacement for admin auth.
6. Dynamic `/sitemap.xml` — generated per-request from the real, current
   product catalog in the database, not a static file (see Section 11
   for why this specific detail mattered).
7. SPA fallback (`app.get("*", ...)`) — anything not matched above
   returns `index.html`, letting React's own client-side router take
   over. This is what makes a direct visit to, say,
   `/product/aether-pendant-lamp` work correctly on first load.

**Two separate frontend bundles, not one:** `AkaraApp.jsx` (the
customer-facing site) and `AdminApp.jsx` (the admin panel at `/admin`)
are code-split — a regular customer's browser never downloads the admin
panel's code at all, confirmed via a real browser test early in this
project. `shared.jsx` holds what both genuinely need in common (the
theme object, reusable UI components like buttons and modals) — a
change to a shared component affects both apps consistently, since
there's only one copy of it.

**Why one big `AkaraApp.jsx` file rather than many small ones:** this
was a deliberate, discussed tradeoff — for a solo, non-technical owner
working with an AI assistant across many sessions, one file that can be
read and searched as a whole was judged more maintainable than
navigating a deep folder structure across sessions. This is not
necessarily how a larger dev team would structure it, but it fits how
this specific project actually gets worked on.

## 3. Authentication & session design — customer vs admin, roles, 2FA

**Deliberately two completely separate systems, not one system with a
role flag.** A customer account and an admin account live in different
database tables (`customers` vs `admins`), are signed with different
secrets (`JWT_SECRET` vs `ADMIN_JWT_SECRET`), issue different cookies
(`akara_session` vs `akara_admin_session`), and have different session
lifetimes:

- **Customer session: 30 days.** A returning shopper shouldn't have to
  log in every visit — this is an ordinary e-commerce convenience
  tradeoff.
- **Admin session: 12 hours.** Deliberately much shorter — an admin
  account can edit the entire product catalog, every order, and (for
  Super Admin) the site's own content, so a session left open (a shared
  computer, a forgotten logged-in tab) should go stale fast.

**Cookie `sameSite` also differs on purpose:** customer cookie is `lax`
(the normal, sensible default), admin cookie is `strict` — there's no
legitimate reason the admin session cookie should ever be sent on a
cross-site navigation, so it's locked down further.

**Customer signup requires real email OTP verification** — a two-step
flow (`pending_signups` table stages the submitted details; the account
row in `customers` is only actually created once the 6-digit code is
confirmed). A mistyped email genuinely can't complete signup, since the
code never reaches an inbox that doesn't exist.

**Admin accounts now have three real roles**, not one flat account:
`staff` (order management only), `admin` (everything Staff has, plus
Products, Media Manager, Featured Products, size/color variants,
Customers, Newsletter, Activity Log, Returns, Enquiries, Settings), and
`super_admin` (everything Admin has, plus the site-wide CMS and Manage
Accounts — the only role that can create or remove other admin
accounts). `requireRole(...allowedRoles)` middleware
(`server/adminAuth.js`) gates every admin route; the role is embedded in
the signed JWT at login, so a role change an admin makes to someone
else's account takes effect on that account's *next* login, not
instantly — the same trade-off any JWT-based system makes. This was
tested directly, not assumed: every admin route exercised from a Staff
session, an Admin session, and no session at all, confirming each is
correctly allowed or blocked.

**There is no public admin signup endpoint anywhere in this codebase.**
The *first* admin account is created by running `server/seed-admin.js`
directly on the server (or via Railway's shell/CLI) — never through an
HTTP request a browser could reach. From there, a Super Admin creates
every other admin/staff account through the real in-app Manage Accounts
screen; `seed-admin.js` remains the bootstrap/recovery path (it also
doubles as how a locked-out admin resets their own password, by running
it again with the same email).

**Two-factor authentication (TOTP) is real and built**, genuinely
optional per-account rather than hard-required at the database level —
a forced requirement with no working fallback risked a real lockout if
a device was lost, before this was proven out in real use.
`server/twoFactor.js` handles the actual mechanics: a real TOTP secret
(Google Authenticator/Authy-compatible, no SMS, no new third-party
service), encrypted at rest with AES-256-GCM (a separate
`TOTP_ENCRYPTION_KEY` env var, never reused from another secret) so a
leaked database dump doesn't hand over usable 2FA secrets directly, and
8 real single-use backup codes (bcrypt-hashed, same standard as a real
password) for account recovery. Login becomes genuinely two-step for an
enabled account: password verification returns a short-lived (5-minute),
narrowly-scoped "pending" JWT — not a real session — and a second
request with a valid TOTP or backup code is what actually issues the
real admin session. Setup itself is verify-before-enable: a fresh secret
is generated and shown as a QR code, but never persisted or marked
enabled until the admin proves they can produce a real valid code from
it — closing off the failure mode where a botched scan silently locks
an admin out with 2FA "on" and no working way to ever pass it again.
Tested end to end through the real login and Settings UI, with
genuinely generated live TOTP codes, not simulated: setup → enable →
full two-step login → disable, plus a wrong code correctly rejected and
a real backup code correctly single-use (confirmed directly in the
database that it was marked used).

**CSRF protection** is a separate layer from all of the above — applies
to `/api/*` generally (see Section 2), using a signed anonymous-session
cookie that's issued even to a logged-out visitor (so the CSRF token
exists before someone logs in, not just after).

**Password requirements differ too:** customer passwords have one bar,
admin passwords require 10+ characters with an uppercase letter, a
number, and a special character — deliberately higher, matching the
higher stakes of an admin account.

**Customer account deletion is real and DPDP-compliant** — self-service,
requiring password re-entry (an irreversible action deserves the same
real friction as changing a password, arguably more). Deletion behavior
is deliberately different per table, not a blanket wipe: the customer's
profile, saved addresses, and wishlist are genuinely deleted; orders
survive with `customer_id` set to `NULL` (matching the 8-year statutory
tax retention already documented in the Privacy Policy — an order is a
real transaction record, not just "the customer's data"); reviews
*also* survive with `customer_id` set to `NULL`, shown afterward as
"Verified Buyer" rather than deleted outright, since a review is real,
useful feedback other shoppers rely on. A real bug was found and fixed
while building this: the reviews API originally used an inner `JOIN` to
`customers`, which would have made any review from a deleted account
silently vanish from the product page entirely — the opposite of
"keep and anonymize." Changed to a `LEFT JOIN` and confirmed directly
with a genuinely deleted test account whose review still displayed
correctly afterward. A separate `account_deletions` table keeps a
permanent business-side compliance record (email + timestamp only — no
personal data copied) that a deletion request was actually processed.

## 4. Database design — the real schema and why it's shaped this way

**16 tables**, PostgreSQL, all defined in `db/schema.sql`. Important:
this file is not just a snapshot — it's a *history*, with `CREATE TABLE
IF NOT EXISTS` for the original tables followed by many `ALTER TABLE`
statements added over time as features grew. This means reading the
file top-to-bottom top few hundred lines does NOT necessarily show the
real, current shape of a table — later ALTERs can widen a constraint,
add a column, or change a default. (Verified directly against the live
database while writing this section, not assumed from the file alone —
e.g. `orders.payment_status` is defined in the original `CREATE TABLE`
as accepting `pending/paid/failed/refunded`, but a later `ALTER TABLE`
widens it to also accept `cod` — the file only tells the true current
story when read as a whole, in order.)

**Every migration in this file is written to be idempotent** — safe to
run against a brand-new empty database, or an already-live production
one with real orders and customers in it. This was a standing rule
throughout the project specifically because this is a real business
with real data; a migration that assumes a fresh database would be
dangerous to run against production.

**The `orders` table is the most complex, and worth understanding in
full** (real current columns, not just the original definition):
`order_number` (customer-facing ID, cryptographically random — see
Section 10 for why), `customer_id` (nullable — NOT for guest checkout,
which doesn't exist; so that order history survives if an account is
ever deleted, via `ON DELETE SET NULL`), `items` and `shipping_address`
stored as JSONB **snapshots**, not foreign keys into `products` or
`addresses` — deliberately: if a product's price changes next month, or
a customer edits their saved address, a past order's invoice must still
show exactly what was actually charged and shipped to at the time, not
today's current values. `status` (the fulfillment lifecycle — see
Section 6), `payment_status` and `payment_method` (separate concerns —
see Section 5), `discount`/`coupon_code`, `shipping_cost`, `cod_fee`,
`cgst`/`sgst` (India's GST split into two equal halves), `total`,
`razorpay_order_id`/`razorpay_payment_id`/`razorpay_refund_id`,
`courier_tracking_id`/`courier_tracking_url`, `cancellation_reason`/
`cancellation_detail`, `abandoned_reminder_sent_at`.

**Why `razorpay_order_id` has a unique index that's *partial*, not a
plain unique constraint:** `CREATE UNIQUE INDEX ... WHERE
razorpay_order_id IS NOT NULL` — a COD order never gets a Razorpay order
ID at all (it's genuinely NULL), and multiple COD orders need to coexist
without tripping a uniqueness check meant for actual Razorpay orders.
The partial index enforces uniqueness only where it matters.

**Other tables, briefly:** `products` (the catalog), `customers` /
`admins` (see Section 3), `addresses` (saved address book, phone
mandatory), `return_requests`, `reviews`, `wishlist_items`, `coupons`
(now with `featured` and `label` — see Section 8), `pickup_locations`
(for Shiprocket), `settings` (a generic key-value table — shipping
cost, COD toggle/fee, maintenance mode all live here rather than each
getting a dedicated column somewhere), `change_log` (admin action audit
trail), `contact_submissions` and `bulk_order_enquiries` (both now with
a real `handled` marker — see Section 7's Enquiries note),
`newsletter_subscribers`.

**Newer tables, added since the original schema**: `product_colors` and
`product_variants` (real size/color variants — see Section 7),
`page_content` and `page_content_history` (the site-wide CMS — see
Section 8), `pending_signups` (stages a customer signup until email OTP
is confirmed — see Section 3), `account_deletions` (a permanent,
minimal compliance record that a deletion happened — see Section 3),
`admin_backup_codes` (real single-use 2FA recovery codes — see Section
3). `customers.id` and every column that references it (across
addresses, orders, wishlist_items, reviews, return_requests) were
migrated from integer to UUID in a genuinely one-time, standalone
script (`server/migrate-uuid.js`, not part of the regular
`db/schema.sql` migration path, and it refuses to run a second time) —
tested first on a disposable copy of the database with real,
interrelated test data across all five dependent tables, then run for
real, then proven by completing a genuine end-to-end signup against the
migrated schema and confirming the new customer's UUID round-tripped
correctly through both the read and write paths with zero application
code changes needed anywhere.

## 5. Checkout & payments — the full real flow, both payment methods, variant pricing

**The core rule underlying everything in checkout: the server never
trusts a client-sent price.** The frontend cart sends only product IDs,
sizes, colors, and quantities — never prices, never the discount
amount, never the total. `priceCartServerSide()`
(`server/routes/orders.js`) independently looks up every real price,
variant, coupon, and shipping rule from the database and computes the
actual charge itself. This is deliberate, applied consistently
everywhere money is calculated in this project — someone tampering with
the browser's request can change *what* they're asking to buy, never
*what it costs*.

**Real size/color variant pricing, added since the original checkout
was built** — a genuinely significant real bug was found and fixed
here, worth documenting in full rather than glossing over. The original
`priceCartServerSide()` predated product variants entirely and always
charged `products.price` (the base price), regardless of which real
size/color combination — and its own real, different price — a
customer had actually picked on the product page. Fixed to fetch every
real `product_colors`/`product_variants` row alongside the base
product, and resolve each cart line's actual price and stock status
from the exact combination requested, rejecting the line outright (not
silently falling back to the base price, and not silently matching the
wrong variant) if the requested color doesn't genuinely exist for that
product. **A second, related bug was found while tracing a customer's
own bug report** (a cart line showing "Vermillion Pendant Lamp" with no
size at all, sitting next to correctly-labeled ones): the *actual
checkout submission* from the real cart page was never sending `color`
to the server at all, only `size` — meaning, before this was caught, a
real customer selecting a color and checking out could have been
charged the wrong variant's price, or had checkout rejected outright,
depending on the product's specific variant data. This had gone
uncaught because every earlier test of the pricing logic constructed
its own request body directly with color already included, rather than
clicking through the real, actual checkout form with a variant product
in the cart — a genuine gap in testing methodology, not just in the
code. Fixed by adding `color` to the real cart-to-checkout request, then
proven by clicking through the entire live flow — selecting a color on
the product page, adding to cart, completing the real checkout form —
and confirming the resulting order in the database held the correct
color, the correct color label, and the correct price. **A full,
dedicated audit of checkout beyond this fix is still a flagged, pending
item** — see Section 17.

**Tax calculation:** 18% GST, split into equal CGST/SGST halves — via
`Math.round(totalTax / 2)` for CGST, then SGST gets "whatever's left"
(`totalTax - cgst`), specifically so the two halves always sum to
exactly the total tax with zero rounding drift between them.

**Shipping is free above a threshold, checked against the *discounted*
subtotal, not the original** — a coupon can legitimately push an order
back below the free-shipping line, and that's checked for correctly.

**Two real payment methods, genuinely different flows:**

**Razorpay (the default):** `POST /api/orders/checkout` creates a real
Razorpay order via their API, stores our own order row with
`payment_status='pending'`, and returns what the frontend needs to open
Razorpay's checkout widget. Once the customer pays, there are actually
**two independent paths** that can mark the order paid — this
redundancy is deliberate, not accidental:
1. The customer's own browser calls `POST /api/orders/verify` with the
   payment signature, which is cryptographically checked before
   accepting it.
2. Razorpay's own webhook (`POST /webhooks/razorpay`, see Section 2)
   independently confirms the same payment.

Both paths use `UPDATE ... WHERE payment_status <> 'paid' RETURNING *`
— whichever one arrives first actually changes the row and sends the
confirmation email/WhatsApp; whichever arrives second matches zero rows
and does nothing further. This solves a real, previously-existing gap
(documented in the security review as H-09): if a customer's browser
crashed or lost connection right after paying, before `/verify` ever
ran, the webhook alone still correctly confirms their order — tested
directly with a genuinely signed webhook call and no `/verify` call at
all.

**Cash on Delivery (COD):** admin-toggleable (defaults off), with a
configurable handling fee (defaults ₹99) that's correctly folded into
the taxable value and taxed like any other charge — not silently added
after tax as an untaxed afterthought. A COD order gets
`payment_status='cod'` (a genuinely distinct value from `pending` —
see Section 4 for why) and is fully confirmed the moment it's placed,
since there's no separate payment-verification step the way Razorpay
has. The server independently re-checks that COD is actually enabled
before accepting a COD checkout request — a request claiming
`paymentMethod:'cod'` while the setting is genuinely off is rejected,
even if someone edits the browser's request directly.

**Order numbers** are generated with `crypto.randomBytes(5)`, not
`Math.random()` — genuinely unpredictable (~1.1 trillion possible
values), not just obscured. This was a real fix (H-08 in the security
review): the original sequential-feeling random numbers leaked
order-volume information and were realistically guessable.

## 6. Order lifecycle — status transitions, cancellation, returns, refunds

**Two genuinely separate concerns tracked independently:**
`orders.status` (where the physical item actually is —
confirmed/production/qc/dispatched/delivered/cancelled) and
`orders.payment_status` (whether money has actually moved —
pending/paid/failed/refunded/cod). A COD order can be `status:
'production'` while `payment_status: 'cod'` at the same time — these
were deliberately never conflated into one field.

**The real, enforced status lifecycle** (`server/routes/admin/orders.js`,
`ALLOWED_TRANSITIONS`):
```
confirmed  → production, cancelled
production → qc, cancelled
qc         → production, dispatched, cancelled   (qc→production: a real quality-check failure sends it back)
dispatched → delivered, cancelled                (cancellable even after dispatch — a real courier RTO/lost-parcel scenario)
delivered  → (final)
cancelled  → (final)
```
Any other jump (e.g. confirmed straight to delivered) is rejected by the
server with a clear message listing the actual valid next steps — this
wasn't enforced at all until a security review flagged it (M-07); before
that, any status could follow any other with zero checks. Setting a
status to what it already is is allowed as a harmless no-op (protects
against a double-click or a retried request). The admin panel's own
status dropdown (`src/AdminApp.jsx`) mirrors this same map, so an admin
is only ever shown options that will genuinely succeed — not a
separate source of truth, just a reflection of the backend's real one.

**Dispatching requires a pickup location.** `createShipment()`
(Shiprocket integration) needs to know which of the business's (more
than one) real pickup addresses a shipment is going out from — this
is checked *before* the database update runs, so a dispatch attempt
without one never reaches the database or sends a false "shipped"
notification.

**Customer self-cancellation:** a customer can cancel their own order
within a server-enforced 30-minute window from `placed_at` — enforced
server-side using the database's own timestamp, never trusting the
browser's clock. Admin cancellation has no such time limit.

**Refunds** (`server/refunds.js`) are deliberately NOT fire-and-forget
like email sends elsewhere — a failed refund is real stuck money, not a
missed notification. Only ever attempted for an order that's actually
`payment_status='paid'` (a COD order that was never marked paid, or a
Razorpay order that never completed payment, correctly has nothing to
refund — `attempted: false`, not an error). On success, `payment_status`
becomes `'refunded'`. On failure, `payment_status` deliberately stays
`'paid'` — the honest state, since the money genuinely wasn't returned
— with the failure recorded in the admin activity log so it's visible,
not silently swallowed.

**Returns** (`return_requests` table, separate from cancellation) are
for post-delivery issues — a genuinely different situation from
pre-delivery cancellation. The "Request a Return" option is only shown
to a customer when `payment_status==='paid'` (or, for COD, once it's
been marked paid — see Section 5) AND the order isn't cancelled — found
missing this exact check during testing (a customer could previously
reach the return form for an order that was never even paid for yet,
and only get rejected at the very last step by the backend).

## 7. Product catalog, variants & media storage

**The `products.status` column has six real values** — `draft`,
`in-stock`, `low-stock`, `sold-out`, `pre-order`, `hidden` — not the
three (`in-stock`/`low-stock`/`sold-out`) shown in the table's original
`CREATE TABLE` statement in `db/schema.sql`; the column itself was
renamed from `stock` and widened via later `ALTER TABLE` statements in
the same file. (Verified directly against the live database while
writing this section — the same "read the whole migration history, not
just the top" caution from Section 4 applies here too.) A `draft`
product needs a deliberate status change to ever become visible to a
customer — new products default to `draft`, not live, so an incomplete
product being set up can't accidentally appear on the site mid-edit.

**Media storage:** `products.media` is a JSONB array of
`{type: 'image'|'video', src: string}` objects. Real, structural
validation exists on every save (`validateMedia()` in
`server/routes/admin/products.js`, added as part of the M-09 security
fix — previously this accepted anything with zero checks): must be an
array, max 20 items, each item's `type` must genuinely be `image` or
`video`, and — importantly — each item's `src` must actually start with
this site's own real storage prefix (either `/uploads/` for the local-
disk fallback, or the real Cloudflare R2 public URL when configured).
An arbitrary external URL is rejected outright; this closes a real
injection-adjacent gap where a product's photo could previously point
anywhere on the internet.

**Where uploaded files actually live** (`server/r2.js`,
`server/routes/upload.js`): Cloudflare R2 (S3-compatible object storage,
zero egress fees) when the five `R2_*` environment variables are set —
this is the real, permanent home for product photos/videos in
production. If R2 isn't configured (e.g. local development), uploads
silently fall back to Railway's own local disk — which does **not**
persist across redeploys, and the server logs a clear warning every time
this fallback triggers, specifically so this degraded mode is never
silently mistaken for the real thing.

**A real admin Media Manager screen now exists** (`/admin`, Media
Manager in the sidebar) — drag-to-reorder, a "set as main photo"
action, and a real, automatically-generated photo ID scheme
(`CATEGORY-PRODUCT-#####`, see `server/photoId.js`). Sending files
directly in chat, named starting with the exact product ID, still works
as an alternative path for bulk uploads, but is no longer the only way
to manage a product's media day to day.

**Real size/color variants, added since the original catalog was
built.** A product can now have genuine color options
(`product_colors` — a label, a swatch hex, a sort order) and, per
color, independently priced and stocked size combinations
(`product_variants` — size, price, status). A product with no colors at
all is completely unaffected — same single price/status as before; this
was built and tested specifically to not disturb the majority of the
catalog that doesn't need variants. The customer-facing product page
shows a real color swatch picker (only rendered if colors actually
exist) and updates price/stock live as a combination is selected; each
swatch and size button is individually disabled (with a visible
diagonal strike, not just relying on generic opacity) if that *specific*
combination is sold out — not the whole picker going gray the moment
any one option is unavailable, which was the original, less useful
behavior. Real, previously split-color products (e.g. the Vermillion
Pendant Lamp, which existed as two entirely separate product rows —
`vermillion-lamp-black` and `vermillion-lamp-red`) were merged into
single, real multi-variant products via a genuinely one-time script
(`server/merge-variant-products.js`, already run, kept for reference) —
tested first on a disposable database copy, with care taken that order
history (a JSONB snapshot, not a foreign key — see Section 4) was
provably unaffected by the merge.

**Adding a product from the homepage/shop card versus the product page
is deliberately different for a variant product** — a real bug, found
from a customer screenshot, is why. The card's one-click "add to cart"
never had a way to ask which color/size was meant, so it silently added
an ambiguous, unlabeled cart line. Fixed: a product with real color
options now routes to the product page when its card's add button is
clicked, instead of guessing; a plain, non-variant product still adds
directly with one click, exactly as before. Tracing this same bug also
surfaced the checkout color-pricing bug described in Section 5, and a
second real bug in the cart drawer and full cart page — both matched
cart lines on product + size only, completely ignoring color, meaning
two different colors of the same size could collide into a single line
and have their quantity/removal silently affect the wrong color. Fixed
to match on product + size + color together, the same real identity the
product page itself already used to decide whether an add was a new
line or a quantity bump on an existing one.

**Every uploaded photo has its metadata stripped** (GPS location, device
model, timestamps) before storage, unconditionally, regardless of
whether it came from a product-photo upload or a customer's return-
request photo attachment — this happens in `server/upload.js`'s shared
`processUpload()` function, so both paths get the same protection
without needing to remember to apply it twice.

## 8. Site-wide CMS — editable content without a redeploy

**Real, and genuinely significant — this didn't exist in the previous
version of this document at all.** Super Admin can now edit most
customer-facing page content directly from the admin panel, live, with
no redeploy and no touching code: every legal/policy page (Privacy,
Refund, Shipping, Terms, Cookies, Accessibility), FAQ, Care Guide,
About, and The Craft.

**Block-based, not a single freeform text field.** `page_content`
stores an ordered list of typed blocks per page (`page_key`,
`sort_order`, `block_type`, `content` as JSON, `updated_at`,
`updated_by`). Ten real block types exist: the original five —
`heading`, `paragraph`, `table`, `qa` (a FAQ question+answer pair), and
`bulletList` (a titled group of points) — plus five added specifically
for About and The Craft's genuinely distinct visual layouts: `hero`
(eyebrow + heading + subtext), `quote` (an italic pull-quote with
attribution), `darkPanel` (the full-bleed dark teal callout), `stepGrid`
(a numbered process row on a dark background), and `cardGrid` (a light
card row). The deliberate choice here: rather than force About/Craft's
real, distinctive design into the plain linear legal-page block model
(which would have either flattened their visual identity or required
building one-off types used nowhere else), five genuinely reusable
layout-shape types were added, each rendered with the *exact* same real
styling the original hardcoded page components used — confirmed by
screenshotting both pages full-page after the conversion and comparing
directly against the original: visually identical, just reading real
words from the database now instead of hardcoded JSX.

**Full version history and one-click revert on every save**
(`page_content_history` — a real snapshot taken before each edit).
Tested directly: edited a real live page through the admin UI, confirmed
the edit appeared on the actual customer-facing page, then reverted
through Version History and confirmed the original content came back
exactly, for both the original block types and the newer About/Craft
ones.

**The admin editor builds real, structured form fields per block type**
— not a raw JSON textarea, which would be both unsafe (a malformed edit
could break the live page) and unpleasant to use. Backend validation
(`server/routes/admin/page-content.js`) checks the real shape of every
block type's content before accepting a save; a genuine copy-paste bug
in one of these validators (the `cardGrid` type's error message
incorrectly said "bulletList") was caught and fixed during a code
review before it ever shipped, not left for a real failure later.

**Also part of this same body of work: coupon public visibility and the
unified admin Enquiries screen.** `coupons.featured` and `coupons.label`
let an admin choose to advertise exactly one active coupon publicly (a
real, dismissible-per-session banner shown site-wide, above the header)
— deliberately not "every active coupon becomes public," since a real
coupon table can reasonably hold codes meant for one customer segment,
a gift, or a partnership that were never meant to be broadcast. And
`contact_submissions`/`bulk_order_enquiries` — both real tables that
were being written to correctly by their live forms this whole time,
but had no admin screen to actually read them — now have one unified
view (`/admin`, Enquiries), with a real handled/new marker, bulk
select-and-mark-handled (a real batch `UPDATE ... WHERE id = ANY($ids)`
per table, not N sequential calls), and a mailto reply link.

## 9. Email & WhatsApp notifications

**Email** (`server/email.js`, via Resend): nine distinct email types — order
confirmation, order status update, order cancelled (with refund info if
applicable), low-stock/sold-out alert, abandoned checkout reminder,
contact form notification, bulk order enquiry notification, password
reset, and (implicitly, via the same `sendOrderStatusEmail` function)
each fulfillment milestone. **Every one of these escapes user-supplied
text before it goes into the HTML** — a real gap found and fixed during
the security review (H-07): several templates previously interpolated
raw customer input directly, including the order-confirmation item
table, which reads a customer-controlled `size` field. Proven fixed with
real injection attempts (`<script>` tags, `onerror=` payloads) run
through every affected template and inspected in the literal HTML that
would have been sent — not just reviewed as code.

**Every email function is genuinely fire-and-forget** (called without
`await` at the call site) — a failure to send must never break the
actual action that triggered it (an order still gets created even if
Resend is briefly down). The one exception is the abandoned-checkout
reminder specifically, in how the scheduler treats a failure: see below.

**WhatsApp** (`server/whatsapp.js`, via Gupshup): three message types —
order confirmed, dispatched, delivered. Fails silently (a logged
warning, nothing thrown) if `GUPSHUP_API_KEY` or `GUPSHUP_SOURCE_NUMBER`
aren't set, matching the same graceful-degradation pattern as email —
this integration has never been tested against a real Gupshup send as
of this writing; it's built correctly against their public API
documentation, but the very first real message is the actual first
proof.

**Abandoned checkout reminders** (`server/scheduler.js`) — the one
automatic, unprompted email in this app. Runs as a simple in-process
`setInterval`, every 30 minutes, not a separate cron service —
deliberately appropriate for a single-Railway-instance app, not
over-engineered infrastructure. The real logic: finds orders where
`payment_status='pending'` (checkout was started, never completed),
between 1 and 48 hours old — the lower bound so a customer still
actively mid-checkout doesn't get nagged, the upper bound so a 3-day-old
abandoned cart doesn't get a reminder that reads as spam. Marks
`abandoned_reminder_sent_at` regardless of whether the email itself
actually succeeded — deliberate: a transient Resend outage shouldn't
mean the same customer gets hit with the reminder repeatedly on every
future scheduler run forever. One honest attempt per abandoned
checkout, not a retry loop.

## 10. Security decisions — what's protected against, and how

An independent security review was received on 22 Aug 2026 — technically
sound, nothing exaggerated. Most of its code-level findings have since
been addressed; this section documents what's actually in place now and
the real reasoning, not the original report itself.

**Security headers** (`server.js`, applied to every response):
Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options,
X-Frame-Options, Referrer-Policy, Permissions-Policy — and `X-Powered-By`
is explicitly disabled (`app.disable("x-powered-by")`), removing the
default header that would otherwise announce "Express" to any external
scanner. **CSP:** `script-src` no longer relies on inline gtag — bootstrap lives
in `public/gtag-init.js`. Styles may still allow `'unsafe-inline'` for
component-level style attributes used throughout the React UI. Further
tightening is possible later with nonces if needed.

**Applied at the application level even though Cloudflare (see Section
12) appears to add some of these headers automatically now** — if
anyone ever reached Railway's origin directly, bypassing Cloudflare,
none of that protection would exist unless the app sets it
independently. Defense in depth, not redundancy for its own sake.

**Email HTML injection (H-07)** — see Section 8.

**Order number randomness (H-08)** — see Section 5.

**Webhook confirmation reliability (H-09)** — see Section 5.

**Cookie hardening (M-01, M-03)**: the CSRF anonymous-session cookie's
lifetime was shortened from 365 days to 30 — it only needs to outlive a
browsing session, not a year. `clearCookie` calls on both customer and
admin logout now pass the exact same attributes used when the cookie
was originally set (`httpOnly`, `secure`, `sameSite`, `path`) — a
mismatch here can mean the "clear" instruction silently fails to
actually remove the original cookie in some browsers, since cookies are
matched for deletion by these same attributes.

**Rate limiting (M-04)**: Contact, Bulk Orders, and both Newsletter
endpoints now share a rate limiter (`server/rateLimit.js`) — 10
requests per 15 minutes per source. Login and password reset already
had their own, stricter limiters from earlier work; this closed the gap
on the public-facing forms that had none at all.

**Admin action validation (M-07, M-08, M-09)** — see Section 6 for
order-status transitions and dispatch requirements; see Section 7 for
product media validation.

**Database-level uniqueness (M-11)**: a partial unique index on
`orders.razorpay_order_id` (`WHERE razorpay_order_id IS NOT NULL`) —
previously enforced only in application logic. The migration that adds
this checks for existing duplicates first and skips adding the
constraint (with a clear, actionable database NOTICE) rather than
failing the whole deployment if a legacy duplicate happens to exist —
tested directly by deliberately creating a duplicate, confirming the
migration skips gracefully, then removing it and confirming the
constraint gets added successfully on a clean re-run.

**Responsible disclosure (L-01)**: `security.txt`, per RFC 9116, served
at both `/security.txt` and `/.well-known/security.txt`.

**Deliberately NOT changed, on purpose — real trade-offs, not gaps**:
customer session length (30 days — a convenience choice), whether
newsletter preference changes require login (currently they don't — an
accessibility choice, since requiring login to unsubscribe would be
user-hostile), Postgres SSL verification strictness, and whether
deleting a product should be a soft-delete (reversible) or hard-delete
(currently hard) — all flagged in the security review as items with
genuine trade-offs on both sides, intentionally left as-is pending a
real conversation about which way the business wants each one to go,
rather than the developer unilaterally picking a direction.

**Two-factor authentication (M-16) is now built** — see Section 3 for
the full real design and testing. It's genuinely optional per-account
rather than required at the database level; whether to make it
mandatory, at least for Super Admin, is a real, open decision still
worth revisiting once it's been proven out in real use.

**A real, adversarial 5-round penetration test has since been run**
(4 Sep 2026), separate from and later than the independent review
above — against the live site directly for everything except
payment-adjacent testing, which ran against a local copy only, per an
explicit, agreed constraint to never risk creating real financial
records or tripping fraud detection on the real merchant account.

- **Round 1 — Authentication & session**: real, repeated login
  attempts (both customer and admin) correctly rate-limited; the admin
  login returns the identical generic error whether or not an account
  exists (no enumeration signal); a forged, unsigned JWT and a
  correctly-shaped JWT signed with a wrong secret were both correctly
  rejected; a customer-shaped token was rejected under the admin
  cookie name too. **No findings.**
- **Round 2 — Authorization & IDOR**: systematic role sweep across
  every real admin route (Staff correctly reaches only Orders; Admin
  reaches everything except Accounts and the CMS; unauthenticated
  requests correctly rejected everywhere) plus a real attacker-vs-
  victim customer test — a second, real account could not view
  another customer's order, delete their address, submit a review for
  a product it never bought, or file a return against their order.
  **No findings.**
- **Round 3 — Injection & file upload**: SQL and XSS payloads
  submitted through every real public form were correctly neutralized
  (parameterized queries plus a real server-side HTML-tag stripper);
  the public upload endpoint correctly rejects unauthenticated
  requests and — confirmed via direct code review — validates real
  binary file signatures rather than trusting the filename or
  declared content-type; Razorpay webhook forgery (missing signature,
  and a well-formed but fake signature) was correctly rejected both
  ways. **No findings.**
- **Round 4 — Business logic & payment-adjacent (local copy only)**:
  Razorpay payment-signature forgery correctly rejected. **Two real,
  genuine, exploitable vulnerabilities found and fixed:**
  1. **Coupon bypass via Cash on Delivery** — the `one_per_customer`/
     `max_redemptions` checks only counted orders with
     `payment_status='paid'`; a COD order never reached that status,
     so any customer could reuse a coupon indefinitely by choosing COD.
     Fixed by counting `payment_status IN ('paid','cod')`, excluding
     cancelled orders so a genuinely cancelled order releases the
     coupon back.
  2. **A deeper race condition, found by actually firing 5 (then 8)
     genuinely simultaneous checkout requests** using the same
     one-per-customer coupon — 4 of 5 received the discount, since the
     "already used?" check and the order-insert were two separate,
     non-atomic operations. Fixed with a real database row lock
     (`SELECT ... FOR UPDATE` on the coupon itself, inside a real
     transaction) on both the COD and Razorpay-verify paths — a
     request that loses the race still completes as an order, just
     without the discount, the same graceful degradation an ordinary
     invalid coupon already gets. Re-proven twice, independently, at
     increasing real concurrency (5, then 8 simultaneous requests) —
     exactly one discount each time.
- **Round 5 — Infrastructure**: full real security header set present
  and consistent across the public site and admin panel; a malformed
  request returns a clean, generic error with no stack trace or
  internal path disclosed; no CORS grant to a cross-origin request on
  either a public or sensitive endpoint; every sensitive-looking path
  (`.env`, `.git/config`, `server.js`) correctly falls through to the
  SPA's own client routing rather than exposing a real file (confirmed
  via `Content-Type: text/html`, not the real file); `X-Powered-By`
  confirmed disabled; valid TLS, real HTTP→HTTPS redirect, HSTS with
  `includeSubDomains`. **No findings**, beyond the already-known,
  deliberate `'unsafe-inline'` CSP tradeoff noted above.

**One honest, real limitation of this pass**: the file-upload *content*
test (Round 3) was verified through direct code review rather than a
live authenticated upload, since that would have required creating a
real customer account with email-OTP verification not available during
testing.


## 10b. Security audit — 9 September 2026

A full re-audit of the live application and codebase was performed after
multiple feature and logistics integrations (Shiprocket, analytics, push,
marketing consent). Findings and remediations:

### Critical — fixed

**Shiprocket courier webhook (`POST /webhooks/courier`)**  
Previously accepted status updates when **no** `x-api-key` header was
sent, even if `SHIPROCKET_WEBHOOK_TOKEN` was configured. That allowed a
remote party who knew only the URL to forge courier statuses (e.g.
“delivered”).  

**Fix:** If the token env var is set, a matching header is **required**.
Comparison uses `crypto.timingSafeEqual` on equal-length buffers.
Missing or wrong token → HTTP 401. Shiprocket’s dashboard must send
`x-api-key` equal to Railway’s `SHIPROCKET_WEBHOOK_TOKEN`.

**Webhook rate limiting**  
Razorpay and courier webhook routes are limited to **120 requests per
minute** per IP (`express-rate-limit`) to reduce flood abuse.

### Hardening — fixed

| Control | Detail |
|--------|--------|
| Guest track | `GET /api/orders/track/:token` rate-limited |
| HTTP methods | `TRACE` / `TRACK` → 405 |
| Customer uploads | Authenticated upload rate limit tightened to **15 / 15 min** |
| Production errors | Stack traces logged server-side only; clients get generic 500 |

### Verified already solid (no code change)

- Razorpay order verify + webhook HMAC (`timingSafeEqual`)
- CSRF on cookie-authenticated `POST/PUT/PATCH/DELETE` under `/api`
- Separate `JWT_SECRET` / `ADMIN_JWT_SECRET` / `CSRF_SECRET`
- Login and OTP rate limits; bcrypt password hashes
- Web Push endpoint host allowlist
- CSP + HSTS + related headers; `x-powered-by` disabled
- Parameterized SQL via `pg` placeholders
- SEO HTML injection prevented via `escapeHtml` / JSON-LD escaping
- Analytics ingest is CSRF-exempt by design (`sendBeacon`) but event
  **allowlisted** and rate-limited; mounted before CSRF middleware

### Residual ops risks (not pure code)

1. **Customer `/api/upload`** remains available to signed-in customers for
   return photos — monitor R2 usage; rate limit + magic-byte validation
   already apply.
2. **Guest tracking tokens** grant full order visibility to the bearer —
   by design; tokens must stay high-entropy.
3. **Cloudflare** must not block legitimate Shiprocket IPs on `/webhooks/*`.
4. **Secrets** never belong in chat, git, or client bundles — Railway
   Variables only.

### Deploy checklist after this audit

1. Deploy build that includes `server/routes/webhooks.js` auth change.
2. Confirm `SHIPROCKET_WEBHOOK_TOKEN` in Railway.
3. Confirm Shiprocket webhook URL sends `x-api-key`.
4. Smoke-test: payment webhook still verifies; dispatch still creates
   Shiprocket shipment; courier test with valid token returns 200.


## 11. SEO & performance

**The apex domain / sitemap bug (fixed)**: the bare domain
`akaraonline.co.in` (no www) had zero DNS resolution at all — confirmed
directly, and cross-referenced against the owner's own Google Search
Console crawl data, which showed 97.7% of Google's crawl attempts going
to this exact dead domain. Every reference to it across the codebase
(sitemap generator, `robots.txt`, a real customer email link, two SEO
metadata fields) was fixed to use `www` consistently. The apex domain
now resolves via Cloudflare (after a nameserver migration — see Section
12), though HTTPS-specifically had its own separate propagation delay
that needed re-verifying afterward.

**Canonical tags**: added site-wide — found completely missing
beforehand, and directly named in Google's own Search Console report
("Duplicate without user-selected canonical"). Built deterministically
from the route itself (`buildPath()`), not from `window.location.href`
— so it's always the correct, clean `www` URL regardless of how a
visitor actually arrived (a stray bare-domain link, a tracking
parameter). Verified to update correctly on client-side navigation
between pages, not just on a fresh page load — a real risk specific to
a single-page app, where stale meta tags can otherwise silently persist
across route changes.

**noindex handling**: since a client-rendered SPA can't return a real
HTTP 404 status without duplicating the entire route list server-side,
the standard alternative is used instead — a `noindex` meta tag, which
a crawler that executes JavaScript respects correctly.

**Two real, related gaps found while writing this section — not
previously identified, flagged directly to the owner rather than
silently fixed while documenting**:
1. **The sitemap generator's product query has no status filter at
   all** (`SELECT id, updated_at FROM products` — every product,
   including `draft` and `hidden` ones). The public product-detail
   endpoint correctly excludes both (`WHERE status NOT IN
   ('draft','hidden')`), meaning a draft product's URL can end up
   listed in the sitemap while the page itself doesn't actually exist
   to a visitor — Google being told to crawl a URL that won't resolve.
2. **The `noindex` meta tag only checks the outer, routing-level "not
   found" state** — it never learns about a product that's specifically
   draft/hidden/deleted, because that check was moved to live inside
   `ProductDetailView` itself during the performance fix in Section 11,
   and never re-connected to this meta-tag logic. A draft product's page
   correctly shows "not found" to a visitor, but the page's own `robots`
   meta tag would incorrectly still say "index, follow."

Both became meaningfully more likely to actually matter once the
draft-product preview feature (Section 7) made a "create as draft, work
on it for a while, publish later" workflow more natural — not urgent
today if the catalog has few or no long-lived drafts, but worth fixing
before that becomes a real habit.

**The homepage performance fix (LCP)**: found — via a real Lighthouse
report — that the entire app, including fully static pages with zero
dependency on product data (About, FAQ, Contact), was blocked from
rendering anything at all until the product catalog finished loading.
This was the direct, measured cause of a 2,650ms "element render delay"
on the homepage's hero text. Fixed by removing the app-wide loading
gate; each view that genuinely needs product data (Home's featured
section, Shop, Search, the product page) now shows its own local
loading skeleton instead, via `ProductsContext`.

**Two real bugs were introduced and caught while building that same
fix, before it ever shipped** — worth remembering as a caution for any
future refactor of this scale: a leftover reference to a variable that
had been removed (caught by a clean compile failing), and more
seriously, component state hooks placed after a conditional return in
`ProductDetailView`, which violates React's Rules of Hooks and would
have caused real, unpredictable crashes for actual visitors. Neither
was caught by a clean compile alone — both were only found by
deliberately testing with an artificially delayed API response to force
the loading-state code path to actually execute.

## 12. Frontend architecture — how the two apps are structured

**Real numbers, checked directly, not estimated, as of this version**:
`AkaraApp.jsx` is ~4,440 lines (the entire customer-facing site — every
page, every component), `AdminApp.jsx` is ~2,170 lines (more than
doubled since the previous version of this document — role-based
access, the CMS editor, the variant editor, the Media Manager, Manage
Accounts, Enquiries, and 2FA settings are the real growth), `shared.jsx`
is ~397 lines.

**The code-split boundary is a real, verified one, not just a build
configuration hope**: `React.lazy(() => import("./AdminApp.jsx"))`,
gated at the very top of the app on whether the current URL path starts
with `/admin`. A regular customer visiting the homepage never triggers
that `import()` call at all — confirmed early in this project with a
real browser test watching actual network requests, not assumed from
the code alone.

**`ProductsContext`** (module-level, not exported outside
`AkaraApp.jsx`) is the single source of truth for the product catalog on
the customer-facing side — fetched once, in `AkaraAppRoot`, and made
available to any component via `useProducts()`. This is also what made
the admin product-preview feature (Section 7) possible without touching
`ProductDetailView` at all: the preview page wraps it in its own
*local* `ProductsContext.Provider` containing just the one previewed
product, and the exact same component that a real customer would see
renders correctly, with no special-casing inside it for "am I in
preview mode."

**Why one large file per app, rather than many small component files**:
a deliberate, discussed tradeoff — for a solo, non-technical owner
working with an AI assistant across many separate sessions, a single
file that can be read, searched, and reasoned about as a whole was
judged more maintainable in practice than navigating a deep component
folder structure across sessions with no persistent memory between
them. This is a real, acknowledged departure from how a larger
engineering team would typically structure a React codebase — noted
here so a future developer understands it was a considered choice for
this project's actual circumstances, not an accident of how the code
grew.

**`shared.jsx`** holds what both apps genuinely need in common: the
theme object (`T` — teal/cream/gold and every semantic color), spacing/
radius/elevation constants, and reusable UI primitives (buttons, modals,
badges, skeletons, the toast notification system). A change here
propagates to both apps from one place — there's no duplicated,
independently-drifting copy of, say, the button component.

**Identified, not-yet-acted-on real maintainability opportunity**:
roughly 13 near-identical async submit/error-handling blocks exist
across both files (the same try/fetch/catch/finally shape repeated with
minor variations). Recognized as a genuine candidate for a shared
helper function, but deliberately queued — explicit owner instruction —
until the active bug/feature backlog is clear, since consolidating it
touches many already-working, individually-tested code paths at once.

## 13. Third-party integrations

**Razorpay** (`server/razorpay.js`) — payments, live mode. Order
creation, payment signature verification (HMAC-SHA256, constant-time
comparison to avoid leaking timing information), webhook signature
verification (same technique), and refund creation. This is the one
integration genuinely tested against live, real payment flows during
development — every other third-party integration below has been built
carefully against documentation but not yet proven against a real send/
call.

**Resend** (`server/email.js`) — transactional email. Simple, single
`sendEmail()` core function that every specific email type calls
through.

**Gupshup** (`server/whatsapp.js`) — WhatsApp order notifications. Built
against Gupshup's public API documentation; genuinely untested against
a real send as of this writing. Credentials were provided and
configured, but the actual first live message is still the real proof.

**Shiprocket** (`server/shiprocket.js`) — real courier booking and live
tracking lookup. One known, real limitation, documented in the code
itself: package weight is currently a flat placeholder (0.5kg) per
order, not derived from real per-product weights, since those aren't
tracked yet (that's Phase 4 of the admin product system). A materially
wrong weight can mean a real weight-discrepancy fee from the courier —
worth fixing before this handles significant order volume.

**Cloudflare R2** (`server/r2.js`) — real, permanent object storage for
product photos/videos, S3-compatible API. Replaced Railway's own local
disk, which does not persist across redeploys — a real, confirmed gap
(a security-review finding, C-04) before this was built. **Falls back
to local disk gracefully, not silently**, if the five `R2_*` environment
variables aren't set (e.g. local development) — logs a clear warning
the first time this happens per server process, specifically so this
degraded mode can never be mistaken for the real, permanent thing.
Tested directly against the real, live bucket during development: a
real file uploaded, fetched back and its content verified byte-for-byte
correct, then deleted and the deletion confirmed via a 404 on re-fetch
— not just assumed to work from the SDK call succeeding.

**Cloudflare (DNS/CDN)** — the domain's nameservers were migrated from
GoDaddy to Cloudflare partway through this project, primarily to solve
the apex-domain DNS problem (Section 11) properly (Cloudflare supports
CNAME flattening at the root, which GoDaddy does not) — but this also
brought real, additional benefits along with it: free SSL covering the
apex domain properly, basic DDoS protection and a Web Application
Firewall on the free plan, and edge caching for static assets. One
practical consequence worth knowing: Cloudflare appears to now be
adding some baseline security headers automatically (observed directly
via a live header check, not something either party configured
explicitly) — this doesn't replace the application-level headers in
`server.js` (Section 10), since anyone reaching Railway's origin
directly would bypass Cloudflare entirely.

**Google tag** (`index.html`) — three separate tag IDs configured
together (`G-TBCH7JXTE9`, plus two `GT-` prefixed tags), loaded via a
single `gtag.js` script include with three separate `gtag('config', …)`
calls, rather than three separate script tags — deliberately, to avoid
loading the entire tagging library three times over for zero benefit.
Confirmed directly (via the browser's own `dataLayer`) that all three
configs genuinely fire correctly, in order.

## 14. Progressive Web App (PWA) — installability and push

**Real, built, and now includes push notifications on both sides** —
the original scoping note (installability only, push parked for later)
is no longer accurate; push was completed in a later real pass. See
below for both the original real PWA work and what was added since.

`public/manifest.json` declares the real app name, icons, and current
brand colors (Section 1), with `display: "standalone"` so an installed
instance loses the browser chrome and feels like a real app. The icons
were generated from the site's own existing brand mark
(`apple-touch-icon.png`, already on the site) rather than a placeholder
— including a real "maskable" variant with proper safe-zone padding, so
the mark survives being cropped into a circle on Android home screens
without clipping. A real mobile install banner (not just the desktop
header icon) prompts Android visitors directly via the real, native
`beforeinstallprompt` flow, and shows real, explicit "Add to Home
Screen" instructions on iOS, which has no programmatic install trigger
at all.

**The service worker (`public/sw.js`) deliberately caches nothing.** It
exists purely because most browsers, notably Chrome, won't offer a real
install prompt without a registered service worker at all, even an
empty one — not to provide offline functionality. A caching service
worker for this specific site carries a real, concrete risk: showing a
customer a stale price or "in stock" status after an admin changes it
in the CMS or product editor. Every same-origin request passes straight
through to the network, unmodified.

**A real, multi-part incident and fix, worth documenting precisely
since it caused a genuine, extended production outage**: real product
images and video silently stopped loading, on every browser that had
ever visited the site before a real CSP fix shipped, sitewide, across
both the customer site and the admin panel. Traced through several
distinct, real layers, each one a genuine, separate cause:

1. **The actual root cause**: this service worker's `fetch` handler
   called `event.respondWith(fetch(event.request))` for *every*
   request, including genuinely cross-origin ones (R2-hosted product
   images/video, Google Fonts). Even though this only ever re-issued
   the same request unmodified, the browser evaluates any request a
   service worker calls `respondWith()` on against the **CSP context
   the worker itself was associated with at install time** — not the
   page's current, live CSP. That per-worker CSP association does not
   update just because the page's own headers changed on a later
   deploy. A browser with an already-installed worker from before a
   real `media-src` CSP fix shipped kept enforcing the *old* policy
   indefinitely, completely independent of what the live server
   actually sent. **Fixed** by adding an explicit origin check: for
   any request that isn't same-origin, the worker now returns early
   without calling `respondWith()` at all, letting the browser handle
   it completely natively — judged by the browser's own current,
   correct CSP, not any frozen, per-worker one.
2. **A compounding, real CDN-layer cause**: `sw.js` itself was being
   served through the generic `express.static(dist)` rule with no
   explicit cache header of its own, and Cloudflare's real, default
   edge-caching behavior for JavaScript files was caching it for 4
   real hours (confirmed directly: `cache-control: public,
   max-age=14400` on the real live response, with `cf-cache-status:
   REVALIDATED` proving Cloudflare's edge, not just a browser, was
   serving stale copies). **Fixed** with a dedicated `/sw.js` route in
   `server.js`, registered before the generic static-file handler,
   sending explicit `Cache-Control: no-cache, no-store,
   must-revalidate`.
3. **Two, real, complementary browser-side rescue mechanisms**, for
   any browser that had already installed the old, stale worker before
   the fixes above shipped: `src/main.jsx`'s service-worker
   registration listens for the real `controllerchange` event (a new
   worker actually taking over) and forces exactly one automatic page
   reload right then — deliberately only when an *existing* controller
   is being replaced, not on a brand-new visitor's first-ever
   activation, since that would cause a real, visible double page-load
   for every new visitor. A second, more forceful rescue lives as an
   inline script directly in `index.html`'s `<head>` — checked
   unconditionally on every page load, since it runs from real,
   always-fresh HTML (confirmed the old worker's pass-through fetch
   handler never actually caches or modifies the document itself),
   independent of whether any of the app's own later JavaScript ever
   gets a chance to run.
4. **A real, permanent, automated guard against a repeat of this
   specific class of bug**: `scripts/verify-sw-version.mjs`, wired into
   `npm run build` — compares `sw.js`'s real, current file content
   against the last version this repo shipped (tracked in
   `.sw-version-lock`), and **fails the build outright** if the file's
   real content changed but its own `SW_VERSION` marker inside it did
   not. Proven directly: the exact real mistake that caused this whole
   incident (a real code change with no version bump) was deliberately
   recreated, and the build genuinely failed with a clear, specific
   error rather than silently shipping.

**Push notifications** — real, working, on both sides:
`server/push.js` and `server/routes/push.js`, using the `web-push`
library and real VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). Admins get a real push alert on every new order;
customers get one when their order's status genuinely changes to a
meaningful stage (production, QC, dispatched, delivered, cancelled —
deliberately not "confirmed," since the customer already knows they
just placed the order). A real, deliberate security allowlist
(`isAllowedPushEndpoint` in `server/routes/push.js`) restricts which
real push-service hostnames a subscription can point at (`fcm.
googleapis.com`, `push.services.mozilla.com`, `web.push.apple.com`,
and a handful of others) — stops a subscription from ever being
registered against an attacker-controlled endpoint. Dead subscriptions
(a real `404`/`410` response from the push service) are automatically
cleaned up rather than retried forever.

## 15. Deployment & environment

**Railway**, one service running the whole app — `npm install` then
`npm run build` (Vite build, produces `dist/`) then `npm start` (which
runs `server.js`, serving both the API and the built frontend). No
separate frontend/backend hosting.

**Real npm scripts** (`package.json`): `dev` (Vite dev server, hot
reload), `build` (production build), `start` (runs the production
server, matches what Railway actually runs), `migrate` (applies
`db/schema.sql` — safe to run repeatedly, on any database state, by
design), `seed` (loads the product catalog), `seed:cms` (loads CMS
page content), `db:sync` (the real, current, correct one-command
option — runs `migrate` then refreshes the FAQ/Refund CMS pages; see
`server/db-sync.js`).

**Database migrations are a deliberate standing discipline throughout
this project**, not just a one-time setup step: every single schema
change, from the very first table through the most recent security
patch, lives in one growing `db/schema.sql` file, using
`CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` throughout, so the same file can be run against a brand-new
empty database or an already-live production one with real customer
data — safely, every time. This matters because this is a real
business; a migration that assumed a fresh database would be genuinely
dangerous to run against production.

**A real, extended production outage (4 Sep 2026)** — documented in
full here since it's genuinely the most instructive real incident this
project has had, and the fixes it produced are still live in the
codebase:

The site went down after a deploy and stayed down through several
distinct, separate causes, each found by actually reproducing it
locally rather than guessing:

1. **Railway's builder was set to Railpack, and `railway.json` (this
   project's real, correct build/start config) had never been pointed
   at via Railway's own Config-as-code setting** — so it sat in the
   repo, correct, but completely unused. Railway fell back to serving
   the repo as static files. Confirmed via the deploy log's own real
   `fileserver.notFound` error — a Caddy static-file-server response,
   not an application crash. **Fixed** by adding `railway.json` as an
   explicit Config-as-code file path in Railway's settings.
2. **Two genuine syntax errors, present in a code upload** — one real
   statement pasted inside a function's own parameter list, a real
   ternary's closing `)`/`:null` swapped in order (`src/AkaraApp.jsx`),
   and a stray `const` on its own line breaking the very next, real
   declaration (`src/AdminApp.jsx`). All three broke the production
   build outright — found by actually running `npm run build` locally
   and fixing whatever it reported next, not by inspection alone.
3. **A second, real runtime bug**, only visible after a successful
   login: `ReferenceError: today is not defined` in the admin
   dashboard's "Today" summary strip — a bare, undeclared variable
   instead of the real data path `data.todayStrip`. React's own error
   boundary caught it and showed a generic "Something went wrong"
   screen; the page itself returned a real `200` the whole time — this
   was purely a client-side JavaScript crash, not a server or network
   failure.
4. **`db/schema.sql` had never actually been run against the live
   database** for everything added since the last real migration —
   `categories`, `push_subscriptions`, `google_id`, `finishes`, refund
   tracking. Confirmed directly from the live database's own error
   logs: `relation "categories" does not exist`. Compounded by
   Railway's own console (the normal way to run a one-off migration
   command) being genuinely unreachable — a real WebSocket connection
   failure on the user's end, unrelated to this codebase, that no code
   change here can fix.
5. **Worked around the unreachable console** by adding a temporary,
   automatic schema-sync directly into `server.js`'s own startup
   sequence — it runs `db/schema.sql` on every boot, statement by
   statement rather than as one giant batch, so a single genuinely
   failing statement can't silently block every real statement after
   it, logging exactly which statement number succeeded or failed.
   Two further, real bugs were found and fixed in this exact migration
   logic before it worked correctly: a naive `;`-split was slicing
   apart the schema's own real `DO $$ ... END $$;` procedural blocks
   (which contain genuine, internal semicolons), and a naive
   "starts-with-`--`" comment filter was gluing multi-line SQL comments
   onto the front of the next real statement, corrupting it — this
   second bug was the actual reason the very first fix attempt didn't
   fully resolve the outage. **Still present in `server.js` as of this
   writing** — genuinely safe to leave running indefinitely (every
   real statement uses `IF NOT EXISTS`), but the better long-term
   setup, once Railway's console is reachable again, is to run
   `npm run db:sync` deliberately and remove the automatic version —
   it does real, repeated work on every single restart that a healthy
   deployment doesn't need.
6. **One further, real, unrelated data bug** surfaced by the same
   database logs: the dashboard's "open contact enquiries" count
   queried a table called `contact_messages`, which has never existed
   anywhere in this schema — the real, correct table (used everywhere
   else in the codebase) is `contact_submissions`, which also has no
   `status` column at all. A real `.catch()` fallback meant the
   dashboard never actually broke for a real user, but a genuine
   PostgreSQL error was logged on every single dashboard load. Fixed
   to query the real, correct table directly, using recency
   (`created_at` within 7 days) as the real proxy for "open," matching
   what the old fallback already did.

Two small, real, permanent additions from this incident: `.nvmrc`
(pins the real Node version, `>=20.0.0`) and `railway.json` (the real,
explicit build/start configuration described in point 1 above).

**Environment variables**: seven required (`DATABASE_URL`,
`JWT_SECRET`, `CSRF_SECRET`, `ADMIN_JWT_SECRET`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) — the app crashes on
startup without these. `TOTP_ENCRYPTION_KEY` is required for 2FA
specifically (Section 3) — without it, 2FA setup fails with a clear
error rather than storing anything insecurely, but the rest of the app
functions normally; a real 32+ byte random value, generated the same
way as the other secrets, and — like them — never changed after admins
have already set up 2FA, since that would make their stored secret
undecryptable. Everything else is optional, each one enabling a
specific real feature gracefully when absent rather than breaking
anything (see Section 13 for what falls back to what). The full,
current, documented list lives in `.env.example` — kept genuinely in
sync with what the code actually reads, not aspirational.

**DNS**: Cloudflare, both for the apex domain and `www` (see Section
12). GoDaddy is no longer the authoritative DNS provider for this
domain — DNS records are managed from Cloudflare's dashboard now, not
GoDaddy's.

## 16. Cross-browser testing — what was verified, and the one real caveat

**Genuinely run, not assumed** — real Chromium, real Firefox, and real
WebKit (the same rendering engine Safari uses), all three actually
installed and executed, not simulated. A page-load sweep across every
real route (home, shop, product pages, cart, login, signup, about, FAQ,
privacy, admin) came back with zero real errors in Chromium and
Firefox; WebKit initially showed a batch of errors that were
investigated rather than reported at face value — every one traced
back to this specific sandboxed test environment's own outbound network
restrictions blocking Google Analytics/Fonts requests, confirmed by a
real screenshot showing the page rendering correctly (right fonts,
right colors, right layout) despite them, and by confirming Chromium
shows the identical class of blocked-request noise in its own console.

**Real functional flows tested identically across all three engines,**
not just page loads: add-to-cart via `localStorage`, the live variant
color/price switch, the navigation drawer, and a full real login with
session-cookie persistence (confirmed identical `httpOnly`/`sameSite`
flags across all three). A real mobile-viewport visual comparison on a
product page came back essentially identical across all three, one
purely cosmetic header-spacing difference in Firefox aside.

**The one real, honest caveat**: the WebKit engine used here is the
Linux build, not the literal Safari binary on macOS/iOS. It shares the
same real rendering engine and catches the large majority of genuine
WebKit-specific issues, but isn't a perfect substitute for testing on
an actual Mac or iPhone if that certainty is ever specifically needed.

## 17. Known gaps & deliberate deferrals — what's NOT built, and why

This section intentionally does not try to duplicate the full,
constantly-changing pending list (see AKARA_Master_Pending.pdf, updated
separately) — instead, it explains the *reasoning* behind the larger
gaps, for context that a bare checklist wouldn't carry. Several items
from the previous version of this section are now genuinely built —
role-based access, the CMS, size/color variants, the admin Media
Manager, account deletion/DPDP, the PWA, and 2FA — and have real
sections of their own above rather than appearing here.

**No real product photos, no seeded reviews**: purely content, not
code — real photography needs shooting and uploading (the Media
Manager, Section 7, is ready to receive it), and the review system
genuinely works but has nothing real in it yet.

**A flagged, in-depth checkout audit** — the specific real bug
described in Section 5 (color never reaching the checkout request) is
fixed and proven, but a fuller, more thorough audit of checkout beyond
that one fix was explicitly requested and deliberately deferred to a
dedicated pass, not forgotten.

**The code-consolidation pass** (the ~13 near-identical async-handler
blocks, Section 12) remains explicitly queued by the owner's own
instruction, to be done only after the active bug/feature backlog is
clear — it touches many already-working, tested code paths at once, so
sequencing it last is deliberate, not neglect.

**Hero and footer copy are not yet part of the CMS** (Section 8) — every
other real customer-facing page is; these two were explicitly scoped
out of the first CMS pass since they're structurally different (an
animated hero, a fixed footer grid) and agreed to be revisited as a
genuinely separate, second pass.

**PWA push notifications**: fully built, both sides — real, working
order-update alerts for customers and new-order alerts for admins (see
`server/push.js`, `server/routes/push.js`), not just installability.
No longer a gap; see Section 14's update.

**A blog/journal section and formal invoice-software integration** are
real, larger features discussed and acknowledged as valuable, but not
yet started — invoicing specifically is waiting on the exact expected
file format from the business.

**Advanced/adversarial penetration testing has been run** — 5 real
rounds (recon, auth/session, authorization/IDOR, injection, business-
logic/payment-adjacent, infrastructure), against the live site and a
local copy for anything payment-adjacent. Two real, exploitable
vulnerabilities were found and fixed: a coupon-limit bypass via Cash on
Delivery, and — a deeper, second layer of the same bug — a genuine race
condition letting several simultaneous checkout requests each claim a
"one per customer" coupon before any single one had recorded its use,
closed with a real database row lock. No longer a gap; see Section 10
for the full real writeup.

**Waiting on something outside this codebase entirely**: real
Shiprocket per-product weights (needs the business to actually weigh
and record them), Google Merchant Center product listings (deferred
until product photography is done), SMS OTP registration progress
(being handled separately by the business), and confirming Railway's
own Postgres backups are actually configured and tested — a real
operational habit worth having, independent of anything in this
codebase.

**Explicitly declined, not a gap**: migrating hosting/database from
Railway to Cloudflare was considered and deliberately not pursued — the
app is a genuinely stateful Node+Postgres service, and Cloudflare's
free-tier offerings (Workers, D1) are a fundamentally different runtime
and database engine, not a drop-in swap; the real re-architecture risk
didn't justify the modest cost saving. Cloudflare continues to be used
for DNS/CDN and R2 storage, both of which remain genuinely appropriate
uses of it.

---

*End of current documentation. This file is updated section-by-section
as work continues — check the file's own modification history (or ask
Claude directly) for what's changed since this line was last touched.*

# ĀKĀRA Website

The Atelier ĀKĀRA e-commerce site — React + Vite frontend, served by a
small Express server with SPA routing fallback, deployed on Railway at
www.akaraonline.co.in, DNS/CDN managed through Cloudflare.

This file describes what the project actually is *right now*. Earlier
versions of this README described specific past work passes in detail;
that history has grown too large to usefully track here — for a full
record of what's been built, fixed, and is still pending, see the
separate AKARA Master Pending List.

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
Run these once (via Railway's dashboard Shell/Run Command, or the
[Railway CLI](https://docs.railway.app/guides/cli) with `railway run`):

```bash
npm run migrate     # creates/updates every table — safe to run repeatedly, on any DB state
npm run seed         # loads the product catalog
npm run seed:cms      # loads the real content for every CMS-editable page
```

All three commands are idempotent — safe to re-run if something goes
wrong partway through; `seed:cms` specifically skips any page that
already has content, so it never overwrites a live edit made from the
admin panel.

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
showing stale data, so it exists purely to enable installability.

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
- **PWA push notifications.** Installability is done; push notifications
  are a genuinely separate, larger piece (a real backend to send them,
  not just receive) — deliberately not started.
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

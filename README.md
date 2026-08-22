# ĀKĀRA Website

The Atelier ĀKĀRA e-commerce site — React + Vite frontend, served by a
small Express server with SPA routing fallback, ready for Railway.

## What's in this project

```
akara-website/
├── src/
│   ├── AkaraApp.jsx      the whole app — every page, component, and route
│   ├── main.jsx          mounts AkaraApp into the page
│   └── index.css         Tailwind entry point
├── server/
│   ├── db.js              Postgres connection pool
│   ├── auth.js             password hashing, sessions, rate limiting
│   ├── asyncHandler.js      wraps async routes so errors don't hang
│   ├── migrate.js           creates the database tables
│   ├── seed.js               loads the 31 products into the database
│   └── routes/
│       ├── auth.js            signup/login/logout/me
│       └── products.js         product list/detail
├── db/
│   ├── schema.sql          the actual table definitions
│   └── seed-products.json   the 31 products, extracted from the frontend
├── public/
│   ├── robots.txt
│   └── sitemap.xml
├── index.html             page shell (title, meta tags, favicon slot)
├── server.js               production server — API routes + SPA fallback
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .env.example            copy structure into Railway, never commit real values
└── .gitignore
```

Verified locally before handing this off: `npm install`, `npm run build`,
and `npm start` all run clean, and every route (including a direct
product URL — the thing that needs the SPA fallback) returns 200. The
new backend (auth + products API) was also tested against a real local
Postgres database — see "What's built so far" below for exactly what was
verified.

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
git commit -m "Initial commit — ĀKĀRA website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/akara-website.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your actual GitHub username, and
`akara-website` with whatever you named the repo. GitHub will ask you to
sign in the first time — follow whatever prompt it gives you (browser
login or a personal access token).

If you don't have `git` installed locally: GitHub also lets you drag-and-
drop the whole project folder into the repo page in your browser instead
of using the command line — slower for future updates, but works for this
first push.

## Part 2 — Connect Railway to that repo

Back in Railway, on the screen you showed me:

1. Click **GitHub Repository** (not Empty Project this time — the code
   now actually lives in a repo, so this option applies)
2. Authorize Railway to access your GitHub account if it asks
3. Select the `akara-website` repo you just created
4. Railway will detect it's a Node project automatically (it reads
   `package.json`) and start a build

That's it for the website itself — Railway runs `npm install` then
`npm run build`, and starts it with `npm start` (which runs `server.js`).

## Part 3 — Environment variables

In your new Railway service: **Variables** tab (left sidebar) → add:

- `RAZORPAY_KEY_ID` — your Razorpay Key ID (safe to store here; not secret)
- `RAZORPAY_KEY_SECRET` — your Razorpay Key Secret. **Only ever goes here
  — never in code, never in this repo, never pasted in chat.**
- `JWT_SECRET` — any long random string, used to sign customer login
  sessions. Generate one with `openssl rand -hex 32` (or ask me and I'll
  generate one for you to paste in — it doesn't need to be memorable,
  just long and random). **Only ever goes here, same rule as the Razorpay
  secret.**
- `DATABASE_URL` — see Part 4 below, Railway mostly sets this one for you.

Railway auto-sets `PORT` itself — you don't need to add that one.

## Part 4 — Database (Postgres) — already added, here's the rest

You've already added a Postgres service and linked
`${{ Postgres.DATABASE_PRIVATE_URL }}` to your website service as
`DATABASE_URL` — that part's done.

What's left is running the schema and loading the initial 31 products
into it. Railway lets you run one-off commands against your deployed
service from its dashboard — look for a **Shell** or **Run Command**
option on your service (sometimes under the service's menu, or via
Railway's CLI if you install it locally). Run these two, once each:

```bash
npm run migrate    # creates the products/customers/addresses/orders tables
npm run seed        # loads the 31 products into the products table
```

If Railway's dashboard doesn't offer a direct shell for your plan, the
alternative is installing the [Railway CLI](https://docs.railway.app/guides/cli)
on your own computer, running `railway login`, `railway link` (select
this project), then `railway run npm run migrate` and
`railway run npm run seed` — this runs the command using Railway's
environment variables without needing a shell in the dashboard.

Both commands are safe to run more than once if something goes wrong
partway — `migrate` only creates tables that don't already exist, and
`seed` updates-or-inserts by product id rather than duplicating rows.

## Security & data-integrity sweep (this pass)

Went back through the whole app looking specifically for gaps that
wouldn't show up unless you were looking for them — not new features,
fixes to things already built.

- **No duplicate accounts by email OR phone.** Previously only email had
  a uniqueness constraint — phone was accepted, but never checked. Now:
  a real database-level UNIQUE constraint on phone (with a migration that
  safely applies to your *already-live* database, not just fresh ones),
  and the signup endpoint validates format and checks both fields before
  creating an account — tested with a duplicate email, a duplicate phone
  in a different format, and a genuinely new number, all confirmed
  working against the real database.
- **Found and fixed a real pre-existing bug while testing the above**:
  entering a phone number exactly the way the signup form's own
  placeholder suggests (`+91 XXXXX XXXXX`) silently failed validation on
  both frontend and backend — neither stripped the "91" country code,
  only the `+` and spaces. Fixed on both sides, retested with the exact
  placeholder format.
- **The cart coupon code (`AKARA10`) had zero connection to the real
  payment flow** — a customer could see a discounted total on the Cart
  page but be charged full price at Checkout. This is now properly wired
  through end to end: the client sends only the *code*, the server
  validates it and computes the actual discount itself (never trusts a
  client-sent discount amount, same principle as pricing), and the
  Invoice page now shows the real discount line instead of silently
  ignoring it. Tested with a valid coupon (confirmed correct discounted
  total), an invalid one (silently ignored, full price charged, no
  error), and case-insensitivity (`akara10` still works).
- **Login rate limiting was silently broken behind Railway's reverse
  proxy.** Without `trust proxy` configured, Express couldn't correctly
  read the real visitor's IP from Railway's forwarded headers — meaning
  every request looked like it came from the same address, so the login
  rate limiter couldn't actually distinguish between different people.
  Demonstrated this directly (a request with a legitimate forwarded IP
  header still showed as `127.0.0.1` without the fix, and correctly
  showed the real IP with it) before fixing it.
- **Cookie `secure` flags depended entirely on `NODE_ENV === "production"`**,
  which Railway doesn't reliably set for a plain Node app — meaning
  session/admin/CSRF cookies could silently ship without the `Secure`
  flag on your real HTTPS site. Replaced with a check against Railway's
  own environment variables (which Railway *does* always set), so this
  no longer depends on an assumption that might not hold.
- **Audited every single admin route** to confirm `requireAdmin` is
  actually applied — all 10 real admin endpoints confirmed protected;
  only login/logout correctly lack it (you can't require being logged in
  to log in).

## What's built so far (backend)

- **Database, real auth, products API, CSRF protection, secure uploads,
  real orders + Razorpay payments** — from earlier passes.
- **Full admin panel**, at `/admin`, completely separate from the
  customer-facing site:
  - **Admin authentication is structurally isolated from customer auth**
    — a separate `admins` database table (not a flag on `customers`), a
    separate signing secret (`ADMIN_JWT_SECRET`), a separate session
    cookie, and a separate 12-hour session lifetime (vs. 30 days for
    customers — this account can edit the whole catalog and every order,
    so a left-open session goes stale fast on purpose). **There is no
    public admin signup endpoint anywhere** — the one admin account is
    created exclusively by running `server/seed-admin.js` directly (see
    below), never through an HTTP request.
  - **Tested for the exact guarantee you asked for**: a real, fully
    logged-in customer session — valid cookies, valid CSRF token,
    everything legitimate — was tested against every single admin
    endpoint (dashboard, product list, product edit, order list) and
    correctly blocked on all of them (401 "Admin sign-in required"),
    while that same customer's own account access kept working normally.
    This is the actual security boundary; see the note in
    `server/adminAuth.js` about what the frontend hiding admin UI does
    and doesn't guarantee on its own.
  - **Dashboard** — real charts (not mockups): revenue trend, best-
    sellers, low-stock/sold-out list, recent orders, from live database
    queries. Confirmed rendering real data and real chart SVGs in an
    actual browser test.
  - **Product management** — view, edit (price/stock/description/etc),
    create, delete. Edits take effect immediately on the public site,
    since it's the same database, not a separate copy.
  - **Order management** — every order in the system (not scoped to one
    customer, unlike the customer-facing endpoint), with real status
    control (Confirmed → Production → QC → Dispatched → Delivered →
    Cancelled) — this is what makes the order-tracking page's 5-stage
    display something a real person sets, rather than the simulated,
    elapsed-time guess it used before.
  - **Change log** — every product edit and order status change is
    recorded with who did it, when, and exactly what changed (old value
    → new value), not just "something was updated."
  - **Code-split for performance**: the admin panel (and its ~400KB
    charting library) lives in its own JS file (`src/AdminApp.jsx`,
    `src/shared.jsx`) and is only downloaded by a browser that actually
    visits `/admin` — confirmed with a real browser test that the
    regular customer site never requests it. The customer-facing bundle
    is unaffected by any of this admin work (still ~307KB, same as before).

## Setting up your admin account

This is a one-time step, run directly (same place you ran `migrate`/`seed`):

```bash
node server/seed-admin.js "your-real-email@example.com" "Your Name" "YourRealPassword1!"
```

Requirements: a real email format, and a password of 10+ characters with
an uppercase letter, a number, and a special character (a higher bar than
customer passwords, deliberately — this account can edit everything).

This is also how you change the admin password later — just run the same
command again with the same email and a new password; it updates rather
than duplicates.

Once that's run, go to `https://www.akaraonline.co.in/admin` and sign in.
**This URL is not linked from anywhere on the public site** — it only
works if you know it and have the real account credentials.

## What's NOT done yet

- Product **sizes/colours** still placeholder UI — waiting on the real
  size list.
- **Reviews** still the placeholder "4.6 · 89 reviews" text.
- **Uploaded files use local disk storage** — needs real object storage
  before it holds real product photos (the admin panel doesn't have a
  photo upload screen wired up yet either — the secure upload pipeline
  from an earlier pass is ready, just not connected to a UI screen).
- **FAQ content and shipping settings are still hardcoded** in the
  frontend, not editable from the admin panel yet — a reasonable next
  addition. (Coupon codes now work correctly end-to-end at real checkout
  — see the sweep section above — but the code itself, `AKARA10`, is
  still a hardcoded constant server-side, not something the admin panel
  can create/edit yet. Real coupon *management* — multiple codes,
  expiry, usage limits — is admin-panel territory for later.)
- **No 2FA on the admin account** — worth adding before this handles a
  fully live store, given what this one login can do.
- **Homepage featured-product selection** is still `PRODUCTS.slice(0,3)`
  in code, not admin-editable.

## Bug fixes (this pass)

A real bug-hunting pass, each one reproduced (where possible) and
confirmed fixed with a real test, not just patched and assumed correct:

- **Cart didn't show what's already in it.** Revisiting a product page
  gave no indication it was already in your cart. Fixed — shows
  "N already in your cart" for the currently-selected size.
- **Saved addresses vanished after logging out.** Root cause: addresses
  were never actually saved to the database — pure local React state
  that reset every session. Built a real backend (new table + API,
  properly scoped to each customer) and directly reproduced, then
  confirmed fixed, the exact reported scenario (save → log out → log
  back in → address still there).
- **Checkout ignored saved addresses, and phone wasn't required.**
  Checkout now offers your saved addresses to pick from, and phone is
  mandatory everywhere an address is collected — you can't ship a parcel
  with no way to contact the customer.
- **Order showed "confirmed" even after cancelling payment.** Hardened:
  the confirmation page now independently re-verifies payment status
  with the server before showing any "we'll ship it" messaging, rather
  than trusting client-side state alone.
- **Invoice download didn't produce anything.** It was relying entirely
  on the browser's Print dialog, which requires manually choosing "Save
  as PDF" — not obvious or available everywhere. Added real PDF
  generation (a genuine file download), kept Print as a secondary
  option. Confirmed it's properly code-split — the PDF library only
  loads for someone who actually clicks download, not on every page load.
- **No way to cancel an order.** Built for real, with a server-enforced
  30-minute window (never trusts the browser's clock) — tested three
  ways: cancel within the window succeeds, cancelling twice is rejected,
  and a backdated order past 30 minutes is correctly rejected. Customers
  get a live countdown; admins get an explicit Cancel action with
  confirmation. Honest limitation: this does not auto-refund via
  Razorpay — that still needs manual handling for now.
- **Return Request form had no validation and couldn't accept photos.**
  The old version used a `mailto:` link, which fundamentally cannot
  support file attachments (a real protocol limitation, not a quick
  fix) — so it's rebuilt on a real backend. Every field is now
  mandatory, "Changed my mind" was removed as a reason, and photo
  upload is wired through the existing secure upload pipeline (the same
  one that strips GPS/device metadata, tested with a real photo).
  Added an admin-side view too, since a return request with nowhere to
  see it isn't a finished feature.

## Files changed in this pass (Bug fixes)

**New files:**
- `server/routes/addresses.js`
- `server/routes/returns.js`
- `server/routes/admin/returns.js`

**Modified files:**
- `db/schema.sql` — `addresses.phone` now mandatory, new
  `return_requests` table (safe migrations for an already-live database)
- `server.js` — new routes wired in
- `server/routes/orders.js` — new customer-facing cancel endpoint
- `src/AkaraApp.jsx` — all the frontend fixes above
- `src/AdminApp.jsx` — admin cancel action, Return Requests page
- `package.json` / `package-lock.json` — added `jspdf`, `jspdf-autotable`
- `README.md` (this file)

## Files changed in the previous pass (Security sweep + Admin Panel)

**New files:**
- `server/env.js`
- `server/adminAuth.js`
- `server/seed-admin.js`
- `server/routes/admin/auth.js`
- `server/routes/admin/dashboard.js`
- `server/routes/admin/products.js`
- `server/routes/admin/orders.js`
- `src/AdminApp.jsx`
- `src/shared.jsx`

## Required environment variables — full, current list

- `DATABASE_URL`, `JWT_SECRET`, `CSRF_SECRET`, `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ADMIN_JWT_SECRET` —
  unchanged this pass, no new secrets required.

As always: missing any of these causes an instant crash on startup.

## Local development

```bash
npm install
npm run dev        # starts Vite dev server with hot reload
```

```bash
npm run build       # production build → dist/
npm start           # runs the production server locally (matches Railway)
```

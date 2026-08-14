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

## What's built so far (backend)

- **Database schema** — `products`, `customers`, `addresses`, `orders`
  tables (see `db/schema.sql` for the full definitions and reasoning).
- **Real authentication** — `/api/auth/signup`, `/api/auth/login`,
  `/api/auth/logout`, `/api/auth/me`. Passwords are hashed with bcrypt
  (never stored plain — verified locally before shipping this), sessions
  are httpOnly cookies (not readable by JavaScript, safer than
  localStorage), and login attempts are rate-limited **server-side** (5
  per 15 minutes per IP) — this replaces the old frontend-only limiter,
  which was explicitly flagged earlier as bypassable by clearing browser
  storage. This one isn't.
- **Products API** — `GET /api/products` (list), `GET /api/products/:id`
  (single product), reading from the real database instead of the
  hardcoded array that used to live in the frontend bundle.
- **The frontend is fully wired to this backend.** `AkaraApp.jsx` no
  longer contains a hardcoded product catalog at all — it fetches
  `/api/products` on load via a `ProductsContext`, and every page reads
  from that shared, live data instead. Login and Signup call the real
  `/api/auth` endpoints. A session now genuinely survives a page refresh.
- **CSRF protection** on every state-changing API request (`POST`/`PUT`/
  `PATCH`/`DELETE`) — a double-submit token pattern (`server/csrf.js`),
  now that real cookie-based sessions exist and are worth protecting.
  The frontend fetches a token once on load and attaches it automatically
  (see `apiFetch()` in `AkaraApp.jsx`).
- **Secure file upload pipeline** (`server/upload.js`,
  `server/routes/upload.js`) for when product-photo upload (admin panel)
  or return-request photos get built. Every uploaded image or video goes
  through, in order: (1) a real byte-signature check — the file's actual
  content is verified, not just trusted from its filename or the
  Content-Type header the browser sent, (2) a strict size limit, (3) a
  strict format allowlist (JPEG/PNG/WebP images; MP4/WebM/MOV videos),
  (4) full metadata stripping — images are completely re-encoded from
  scratch (removing 100% of EXIF data: GPS location, device model,
  timestamps), videos have their metadata atoms stripped via ffmpeg
  without a full re-encode (fast, but still removes GPS/device/timestamp
  data). The endpoint itself requires login and a valid CSRF token.

**All of the above was tested against a real local Postgres database, in
a real headless browser, and with real files carrying real embedded GPS
coordinates and device metadata — not just written and assumed correct.**
This caught and fixed four genuine bugs in the process:

1. A category-icon lookup (`CAT_ART`) had been accidentally deleted
   during an earlier cleanup edit.
2. A React effect ordering bug where the "save cart" effect fired on the
   very first render too, briefly wiping a real stored cart with an
   empty one before the async product-fetch-and-hydrate step could read
   it — add-to-cart worked, but silently emptied on refresh.
3. Two wrong-API-name bugs while wiring up `csrf-csrf` (`generateToken`
   vs. the real `generateCsrfToken`; a missing required
   `getSessionIdentifier`, since this app uses stateless JWTs rather than
   server-side sessions — fixed with a lightweight anonymous session-ID
   cookie specifically for binding CSRF tokens).
4. **A file path bug in the upload route**: `server/routes/upload.js`
   only went up one directory level instead of two, so uploaded files
   were silently landing in a nonexistent `server/uploads/` instead of
   the project-root `uploads/` folder `server.js` actually serves from.
   The API reported success either way — this was only caught by
   actually checking the filesystem after a real upload, not by reading
   the response.

Every one of these is fixed and reverified with the same real-testing
approach — GPS coordinates and device metadata confirmed present before
processing and confirmed completely absent afterward, independently
checked with `exiftool` (not just trusting the app's own claim).

## What's NOT done yet

- **Orders, Razorpay integration, and the admin panel** are not built
  yet — these are next.
- Product **sizes/colours are still placeholder UI**, not driven by real
  per-product data — waiting on the real size list.
- **Reviews are still the placeholder "4.6 · 89 reviews" text** — real or
  removed, pending a decision from an earlier conversation.
- **Uploaded files use local disk storage**, which is fine for local
  development but Railway's filesystem is NOT persistent across
  redeploys — before this handles real product photos, switch
  `server/routes/upload.js` to write to real object storage (e.g. an
  S3-compatible bucket) instead.
- There's currently no actual UI screen that *calls* `/api/upload` yet
  (no admin panel, no return-request photo upload built) — the pipeline
  is ready and tested, waiting for a real feature to use it.

## Files changed in this pass (CSRF + secure uploads)

Copy these into your GitHub repo, replacing what's there — no changes
needed anywhere else:

**New files:**
- `server/csrf.js`
- `server/upload.js`
- `server/routes/upload.js`

**Modified files:**
- `server.js`
- `src/AkaraApp.jsx`
- `package.json`
- `package-lock.json`
- `.env.example`
- `README.md` (this file)

## Required environment variables — full, current list

Whatever was there before, make sure Railway's Variables tab has ALL of
these, or the app will crash immediately on startup (which shows up on
Railway as "Application failed to respond" / 502 — the container starts,
the process exits instantly, nothing is ever listening on the port):

- `DATABASE_URL` — should already be set as `${{Postgres.DATABASE_PRIVATE_URL}}`
- `JWT_SECRET` — long random string (see earlier setup)
- `CSRF_SECRET` — **new in this pass** — long random string, generate
  with `openssl rand -hex 32`, must be DIFFERENT from `JWT_SECRET`

## About the "railpack prepare exited with an error" / 502 you're seeing

This exact message previously meant one specific thing: Railway's builder
couldn't find `package.json` because the **Root Directory** setting
wasn't pointed at the `akara-website` folder. If it's back, the first
thing to check is whether that setting reverted — **Settings → Source →
Root Directory** should still say `akara-website`. This can happen if a
service gets disconnected and reconnected, or a new service gets created
by accident instead of reusing the existing one.

Separately: the "Application failed to respond / 502" symptom is very
likely just the missing `CSRF_SECRET` above, once this new code gets
deployed — confirmed locally (see testing notes) that a missing required
secret causes an instant crash with no server ever starting, which is
exactly what a 502 with no useful page looks like from the outside.

If Root Directory is already correct and all three env vars are set and
it still fails, the next thing to check is the **Build Logs** tab
specifically (not just the deployment summary) — paste the full text and
I can pin it down further.

## Local development

```bash
npm install
npm run dev        # starts Vite dev server with hot reload
```

```bash
npm run build       # production build → dist/
npm start           # runs the production server locally (matches Railway)
```

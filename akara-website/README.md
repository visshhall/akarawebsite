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
├── public/
│   ├── robots.txt
│   └── sitemap.xml
├── index.html             page shell (title, meta tags, favicon slot)
├── server.js               production server — serves the build + SPA fallback
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .env.example            copy structure into Railway, never commit real values
└── .gitignore
```

Verified locally before handing this off: `npm install`, `npm run build`,
and `npm start` all run clean, and every route (including a direct
product URL — the thing that needs the SPA fallback) returns 200.

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

Railway auto-sets `PORT` itself — you don't need to add that one.

## Part 4 — Add a database (when we get to that)

Same Railway project → **New** → **Database** → pick Postgres (or
whichever we settle on) → Railway provisions it and automatically adds a
`DATABASE_URL` variable to your project. Nothing to configure by hand.

## Known limitation, on purpose

Both `RAZORPAY_KEY_SECRET` handling above and the actual payment/backend
logic don't exist in this codebase yet — this project is the frontend,
packaged and deployable, which is what unblocks Railway setup right now.
Backend (real accounts, real orders, real payments, the admin panel) is
the next phase.

## Local development

```bash
npm install
npm run dev        # starts Vite dev server with hot reload
```

```bash
npm run build       # production build → dist/
npm start           # runs the production server locally (matches Railway)
```

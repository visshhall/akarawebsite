// Production server for Railway. Serves the Vite build output (dist/) as
// static files, with an SPA fallback: any path that isn't a real file goes
// to index.html, so AkaraApp.jsx's client-side router can handle it. This
// is the exact "SPA fallback" requirement flagged repeatedly during
// development — without it, a direct link like /product/vayu-round-planter
// would 404 on refresh even though it works fine when clicked to from
// within the site.
//
// Backend API routes (auth, products, upload, orders, admin) are
// registered under /api/... BEFORE the static/catch-all handlers below.
// The Razorpay webhook is the one exception — see the /webhooks mount
// below for why.

import express from "express";
import cookieParser from "cookie-parser";
import { query } from "./server/db.js";
import { asyncHandler } from "./server/asyncHandler.js";
import { startScheduler } from "./server/scheduler.js";
import path from "path";
import { fileURLToPath } from "url";
import { attachCustomer } from "./server/auth.js";
import { attachAdmin } from "./server/adminAuth.js";
import { csrfTokenRoute, doubleCsrfProtection, ensureAnonId } from "./server/csrf.js";
import authRoutes from "./server/routes/auth.js";
import productRoutes from "./server/routes/products.js";
import pageContentRoutes from "./server/routes/page-content.js";
import uploadRoutes from "./server/routes/upload.js";
import orderRoutes from "./server/routes/orders.js";
import webhookRoutes from "./server/routes/webhooks.js";
import couponRoutes from "./server/routes/coupons.js";
import addressRoutes from "./server/routes/addresses.js";
import returnRoutes from "./server/routes/returns.js";
import wishlistRoutes from "./server/routes/wishlist.js";
import reviewRoutes from "./server/routes/reviews.js";
import contactRoutes from "./server/routes/contact.js";
import bulkOrderRoutes from "./server/routes/bulk-orders.js";
import newsletterRoutes from "./server/routes/newsletter.js";
import adminAuthRoutes from "./server/routes/admin/auth.js";
import adminDashboardRoutes from "./server/routes/admin/dashboard.js";
import adminProductRoutes from "./server/routes/admin/products.js";
import adminOrderRoutes from "./server/routes/admin/orders.js";
import adminCustomerRoutes from "./server/routes/admin/customers.js";
import adminAccountRoutes from "./server/routes/admin/accounts.js";
import adminPageContentRoutes from "./server/routes/admin/page-content.js";
import adminEnquiriesRoutes from "./server/routes/admin/enquiries.js";
import adminNewsletterRoutes from "./server/routes/admin/newsletter.js";
import adminActivityRoutes from "./server/routes/admin/activity.js";
import adminReturnRoutes from "./server/routes/admin/returns.js";
import adminSettingsRoutes from "./server/routes/admin/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Trusts the first proxy hop (Railway's edge) so Express correctly reads
// the X-Forwarded-For / X-Forwarded-Proto headers Railway sets. Without
// this: (1) req.ip returns Railway's internal proxy address for every
// single request, not the real visitor's — meaning the login rate
// limiters (server/auth.js, server/adminAuth.js), which key off req.ip,
// couldn't actually distinguish between different users at all, and
// (2) req.secure always reports false even on a real HTTPS request,
// which is what the cookie `secure` flags below now check directly
// instead of guessing from NODE_ENV (Railway doesn't reliably set that
// for arbitrary Node apps). Verified locally: without this line, a
// request with a legitimate X-Forwarded-For header still showed up as
// 127.0.0.1; with it, the real forwarded IP and protocol are read correctly.
app.set("trust proxy", 1);

// H-02 — a real, still-open gap confirmed directly against the live
// site: the apex domain (akaraonline.co.in, no www) resolves and
// returns a genuine 200, not a redirect — meaning Google (or anyone
// else) can reach the exact same content at two different URLs with no
// signal about which one is canonical, undermining the canonical tag
// work elsewhere in this app that assumes www is the one true version.
// req.hostname respects "trust proxy" above, so this correctly sees the
// real original host even behind Cloudflare, not Railway's internal one.
app.use((req, res, next) => {
  if (req.hostname === "akaraonline.co.in") {
    return res.redirect(301, `https://www.akaraonline.co.in${req.originalUrl}`);
  }
  next();
});

// Security headers — a real, confirmed gap: an external scan (Cloudflare
// Radar) fingerprinted this server as Express with 100% confidence,
// matched directly via the X-Powered-By header, and found several
// standard protective headers absent. Cloudflare's own proxy has since
// started adding some of these automatically (confirmed by re-checking
// live headers directly), but that's an infrastructure-layer behavior
// this app shouldn't depend on — if anyone ever reaches Railway's origin
// directly, bypassing Cloudflare, none of that protection would exist
// unless the application sets it too. CSP allows 'unsafe-inline' for
// scripts/styles deliberately, not by oversight — this app injects fonts
// via an inline <style> tag and Google's gtag snippet is inline in
// index.html; tightening that further means refactoring those first.
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    // https: (scheme-only) rather than naming every possible host — this
    // app's own uploads now live on Cloudflare R2 at a pub-xxxx.r2.dev
    // URL, and images are simple <img> tags, not fetch()/XHR calls, so
    // this is the right level of permissiveness for images specifically.
    "img-src 'self' data: blob: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://checkout.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://www.google-analytics.com https://api.postalpincode.in",
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  ].join("; "));
  next();
});

// The `verify` callback captures the raw, unparsed request body alongside
// the normal parsed one — needed specifically for the Razorpay webhook,
// which must verify its signature against the exact original bytes
// Razorpay sent, not a re-serialized version of the parsed JSON (key
// order/whitespace differences would produce a different, wrong signature).
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());
app.use(attachCustomer);
app.use(attachAdmin);
app.use(ensureAnonId);

// Health check — useful for Railway/any platform's deploy health checks.
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Razorpay webhook — mounted at /webhooks (deliberately NOT under /api, and
// registered BEFORE the CSRF middleware below) because this request comes
// from Razorpay's own servers, not a customer's browser. It can never carry
// a CSRF token or session cookie, and doesn't need to — its authenticity is
// proven by the webhook signature check inside webhooks.js instead.
app.use("/webhooks", webhookRoutes);

// The frontend calls this once on load to get a CSRF token (see csrf.js) —
// deliberately registered BEFORE the CSRF protection middleware below,
// since fetching the token can't itself require having the token.
app.get("/api/csrf-token", csrfTokenRoute);

// From here down, every POST/PUT/PATCH/DELETE under /api requires a valid
// CSRF token (GET/HEAD/OPTIONS are automatically exempted — see csrf.js).
// This covers /api/admin/* too — an admin session is still cookie-based
// auth, and worth the same CSRF protection as customer auth.
app.use("/api", doubleCsrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/page-content", pageContentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/bulk-orders", bulkOrderRoutes);
app.use("/api/newsletter", newsletterRoutes);
// Admin API — every route inside these four files individually enforces
// requireAdmin (see adminAuth.js) except /api/admin/auth/login itself.
// There is no public admin signup route anywhere — the one admin account
// is created only via server/seed-admin.js, run directly, never through
// an HTTP endpoint.
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/admin/products", adminProductRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);
app.use("/api/admin/accounts", adminAccountRoutes);
app.use("/api/admin/page-content", adminPageContentRoutes);
app.use("/api/admin/enquiries", adminEnquiriesRoutes);
app.use("/api/admin/newsletter", adminNewsletterRoutes);
app.use("/api/admin/activity-log", adminActivityRoutes);
app.use("/api/admin/returns", adminReturnRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);

// Any /api/... path that didn't match a route above is a genuine API 404
// — without this, it would otherwise fall through to the SPA catch-all
// below and silently return the HTML page with a 200 status, which would
// make a typo'd fetch URL in the frontend fail confusingly instead of
// clearly.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Generic error handler — catches anything thrown/rejected inside a route
// (e.g. the database being briefly unreachable, or an invalid CSRF token)
// so the server returns a real JSON error instead of crashing the whole
// process or hanging.
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "Your session expired — please refresh the page and try again." });
  }
  console.error("API error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

// Uploaded media (see server/routes/upload.js). NOTE: this is local disk
// storage — fine for development, but Railway's filesystem is NOT
// persistent across redeploys. Before this holds real product photos,
// switch this to real object storage (e.g. an S3-compatible bucket).
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Dynamic sitemap — replaces the static public/sitemap.xml (a snapshot
// from whenever it was last hand-generated) with one built live from the
// real product catalog every time it's requested. Registered before
// express.static below specifically so this takes precedence over the
// old static file sitting in dist/ — a product added or removed via the
// admin panel now shows up here immediately, no redeploy needed.
app.get("/sitemap.xml", asyncHandler(async (req, res) => {
  // Found while writing the project documentation: this used to select
  // every product with no status filter at all — meaning a draft or
  // hidden product's URL could end up listed here even though the real
  // product page (server/routes/products.js) correctly refuses to serve
  // it. Google would be told to crawl a URL that doesn't actually
  // resolve to anything. Same filter as that endpoint, kept consistent
  // on purpose — a sitemap listing a page and that page actually
  // existing publicly should never be able to disagree.
  const { rows: products } = await query("SELECT id, updated_at FROM products WHERE status NOT IN ('draft','hidden')");
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    ["/", "1.0", "weekly"], ["/shop", "0.9", "weekly"],
    ["/shop/planters", "0.8", "weekly"], ["/shop/vases", "0.8", "weekly"],
    ["/shop/ceiling-lighting", "0.8", "weekly"], ["/shop/table-lamps", "0.8", "weekly"],
    ["/shop/lanterns", "0.8", "weekly"], ["/shop/floor-lamps", "0.8", "weekly"],
    ["/about", "0.6", "weekly"], ["/craft", "0.6", "weekly"], ["/contact", "0.6", "weekly"], ["/faq", "0.5", "weekly"],
    ["/bulk-orders", "0.6", "weekly"], ["/care-guide", "0.5", "weekly"],
    ["/return-request", "0.3", "weekly"], ["/privacy", "0.3", "weekly"],
    ["/refund", "0.3", "weekly"], ["/shipping", "0.3", "weekly"], ["/terms", "0.3", "weekly"],
    ["/cookies", "0.3", "weekly"], ["/accessibility", "0.3", "weekly"], ["/email-preferences", "0.2", "weekly"],
  ];
  const entries = [
    // Found via a real Google Search Console error ("This site can't be
    // reached") plus a direct DNS test: the bare domain (akaraonline.co.in,
    // no www) has no DNS resolution at all — confirmed with curl, not
    // assumed. Every URL here previously used that broken bare domain,
    // meaning even if Google successfully fetched this sitemap, every
    // single link inside it would fail. www is the domain that's
    // actually live and resolves correctly.
    ...staticPages.map(([path_, priority, freq]) =>
      `<url><loc>https://www.akaraonline.co.in${path_}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`),
    ...products.map(p =>
      `<url><loc>https://www.akaraonline.co.in/product/${p.id}</loc><lastmod>${new Date(p.updated_at || Date.now()).toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ];
  res.set("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`);
}));

app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback — must be last. Anything not matched above (and not a real
// static file) gets index.html, letting the client-side router take over.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ĀKĀRA server running on port ${PORT}`);
  startScheduler();
});

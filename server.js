// Production server for Railway. Serves the Vite build output (dist/) as
// static files, with an SPA fallback: any path that isn't a real file goes
// to index.html, so AkaraApp.jsx's client-side router can handle it. This
// is the exact "SPA fallback" requirement flagged repeatedly during
// development — without it, a direct link like /product/vayu-round-planter
// would 404 on refresh even though it works fine when clicked to from
// within the site.
//
// Backend API routes (auth, products, upload — orders/Razorpay/admin next)
// are registered under /api/... BEFORE the static/catch-all handlers below,
// as this comment always said they should be.

import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { attachCustomer } from "./server/auth.js";
import { csrfTokenRoute, doubleCsrfProtection, ensureAnonId } from "./server/csrf.js";
import authRoutes from "./server/routes/auth.js";
import productRoutes from "./server/routes/products.js";
import uploadRoutes from "./server/routes/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(attachCustomer);
app.use(ensureAnonId);

// Health check — useful for Railway/any platform's deploy health checks.
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// The frontend calls this once on load to get a CSRF token (see csrf.js) —
// deliberately registered BEFORE the CSRF protection middleware below,
// since fetching the token can't itself require having the token.
app.get("/api/csrf-token", csrfTokenRoute);

// From here down, every POST/PUT/PATCH/DELETE under /api requires a valid
// CSRF token (GET/HEAD/OPTIONS are automatically exempted — see csrf.js).
// FUTURE NOTE: a Razorpay webhook endpoint, when built, must be mounted
// BEFORE this line (or otherwise excluded) — webhooks come from Razorpay's
// servers directly, not a browser with cookies, and are authenticated by
// signature verification instead, not CSRF tokens.
app.use("/api", doubleCsrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/upload", uploadRoutes);

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

app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback — must be last. Anything not matched above (and not a real
// static file) gets index.html, letting the client-side router take over.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ĀKĀRA server running on port ${PORT}`);
});

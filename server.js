// Production server for Railway. Serves the Vite build output (dist/) as
// static files, with an SPA fallback: any path that isn't a real file goes
// to index.html, so AkaraApp.jsx's client-side router can handle it. This
// is the exact "SPA fallback" requirement flagged repeatedly during
// development — without it, a direct link like /product/vayu-round-planter
// would 404 on refresh even though it works fine when clicked to from
// within the site.
//
// Backend API routes (auth, products so far — orders/Razorpay/admin next)
// are registered under /api/... BEFORE the static/catch-all handlers below,
// as this comment always said they should be.

import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { attachCustomer } from "./server/auth.js";
import authRoutes from "./server/routes/auth.js";
import productRoutes from "./server/routes/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(attachCustomer);

// Health check — useful for Railway/any platform's deploy health checks.
app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);

// Any /api/... path that didn't match a route above is a genuine API 404
// — without this, it would otherwise fall through to the SPA catch-all
// below and silently return the HTML page with a 200 status, which would
// make a typo'd fetch URL in the frontend fail confusingly instead of
// clearly.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Generic error handler — catches anything thrown/rejected inside a route
// (e.g. the database being briefly unreachable) so the server returns a
// real JSON error instead of crashing the whole process or hanging.
app.use((err, req, res, next) => {
  console.error("API error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback — must be last. Anything not matched above (and not a real
// static file) gets index.html, letting the client-side router take over.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ĀKĀRA server running on port ${PORT}`);
});

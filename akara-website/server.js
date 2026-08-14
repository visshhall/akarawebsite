// Production server for Railway. Serves the Vite build output (dist/) as
// static files, with an SPA fallback: any path that isn't a real file goes
// to index.html, so AkaraApp.jsx's client-side router can handle it. This
// is the exact "SPA fallback" requirement flagged repeatedly during
// development — without it, a direct link like /product/vayu-round-planter
// would 404 on refresh even though it works fine when clicked to from
// within the site.
//
// This same server is also where future backend API routes (P6/P7 — auth,
// orders, Razorpay webhooks, admin panel endpoints) should get added later,
// as app.get("/api/...")/app.post("/api/...") routes registered BEFORE the
// static/catch-all handlers below.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Health check — useful for Railway/any platform's deploy health checks.
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// --- Future backend routes go here, before the static handler below ---
// e.g. app.use("/api/orders", ordersRouter);

app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback — must be last. Anything not matched above (and not a real
// static file) gets index.html, letting the client-side router take over.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ĀKĀRA server running on port ${PORT}`);
});

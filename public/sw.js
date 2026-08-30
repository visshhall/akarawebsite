// ============================================================================
// MINIMAL SERVICE WORKER — exists to make the site genuinely installable
// (many browsers, notably Chrome, won't offer an install prompt without
// a registered service worker, even an empty one) — NOT to cache pages,
// prices, or stock data.
//
// Deliberately does NOT cache anything real. A real e-commerce site
// caching product pages/API responses risks showing a stale price or
// "in stock" status after an admin changes it — exactly the risk
// flagged before this was ever built. This worker passes every request
// straight to the network, unmodified — it exists purely to satisfy
// the browser's installability requirement, not to provide offline
// functionality. If genuine offline support is wanted later, that's a
// deliberate, separate decision — not a side effect of installability.
//
// SW_VERSION exists purely so this file's own byte content changes
// whenever something about it (or how it's meant to behave) is
// updated — browsers decide whether to install a new service worker
// by comparing the actual file bytes to what's currently installed,
// byte-for-byte, so a real code or intent change with unchanged text
// elsewhere could otherwise go unnoticed indefinitely on a browser
// that installed an old copy. Bumped here as the direct fix for a
// real, live incident: a stale, already-installed worker on real
// customer/admin browsers kept intercepting every image, video, and
// font request and evaluating it against a long-outdated security
// policy baked into that OLD install — even though this worker's own
// logic (below) has never actually enforced any policy of its own;
// it was the BROWSER's per-service-worker CSP association, tied to
// whatever page state existed at that worker's original install time,
// that went stale. See main.jsx's own registration code for the other
// half of this real fix (an explicit reg.update() call).
const SW_VERSION = "2026-08-30-02";
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

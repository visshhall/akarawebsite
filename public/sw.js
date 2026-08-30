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
// ============================================================================
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

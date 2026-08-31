// ============================================================================
// MINIMAL SERVICE WORKER — exists so the site is installable (PWA).
// Does NOT cache product pages, prices, or stock data.
//
// CRITICAL: do not intercept cross-origin requests (Cloudflare R2 images/
// videos, fonts, analytics). respondWith(fetch()) on those requests was
// hanging shop-grid thumbnails while the same URLs worked on PDP / curl.
// Same-origin only — browser loads R2 directly.
// ============================================================================
const SW_VERSION = "2026-08-31-01";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) {
    return; // R2, Google Fonts, GTM, Razorpay, etc. — leave to the browser
  }
  event.respondWith(fetch(event.request));
});

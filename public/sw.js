// Install-only service worker — does not cache product/API data.
// Must NOT intercept cross-origin requests (R2 images/videos), or shop thumbnails hang.
const SW_VERSION = "2026-08-31-01";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Same-origin only. Let the browser load R2 / fonts / analytics directly.
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(fetch(event.request));
});
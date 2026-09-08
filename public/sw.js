// ============================================================================
// MINIMAL SERVICE WORKER — exists so the site is installable (PWA).
// Does NOT cache product pages, prices, or stock data.
//
// CRITICAL: do not intercept cross-origin requests (Cloudflare R2 images/
// videos, fonts, analytics). respondWith(fetch()) on those requests was
// hanging shop-grid thumbnails while the same URLs worked on PDP / curl.
// Same-origin only — browser loads R2 directly.
// ============================================================================
const SW_VERSION = "2026-09-01-push";

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

self.addEventListener("push", (event) => {
  let data = { title: "ĀKĀRA", body: "You have an update.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "ĀKĀRA", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

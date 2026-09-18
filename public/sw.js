// ============================================================================
// MINIMAL SERVICE WORKER — installability + push. Does NOT cache pages/API.
// Same-origin fetch passthrough only — never touch R2 / third-party.
// Served inline from server.js so production cannot stick on a stale file.
// ============================================================================
const SW_VERSION = "2026-09-18-video-34-v64";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});

// Customer + admin web push (VAPID). Payload JSON: { title, body, url }
self.addEventListener("push", (event) => {
  let data = { title: "ĀKĀRA", body: "Update from the studio", url: "/" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") data = { ...data, ...parsed };
    }
  } catch (_) {
    try { data.body = event.data.text(); } catch (_) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "ĀKĀRA", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
      tag: data.tag || "akara-order",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url && "focus" in c) {
          await c.focus();
          if (c.navigate) try { await c.navigate(target); } catch (_) {}
          return;
        }
      }
      if (clients.openWindow) await clients.openWindow(target);
    })()
  );
});

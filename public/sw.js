// ============================================================================
// MINIMAL SERVICE WORKER — installability only. Does NOT cache pages/API.
// Same-origin fetch passthrough only — never touch R2 / third-party.
// Served inline from server.js so production cannot stick on a stale file.
// ============================================================================
const SW_VERSION = "2026-09-12-inline-v5";

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

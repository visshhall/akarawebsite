import React from "react";
import ReactDOM from "react-dom/client";
import AkaraApp from "./AkaraApp.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AkaraApp />
  </React.StrictMode>
);

// Registers the minimal install-only service worker (public/sw.js) —
// feature-detected (older browsers without support just silently skip
// this, no error) and deferred to the window "load" event specifically
// so it never competes with real page content for network/CPU during
// the initial page render. See sw.js's own header comment for why it
// deliberately caches nothing.
if ("serviceWorker" in navigator) {
  // REAL BUG FIX, ROUND 2 — the first fix (reg.update() below) genuinely
  // works, but only closes half the real gap: it makes the browser
  // check for and download a new worker sooner, but a browser's own,
  // more conservative rules can still leave that new worker sitting
  // "waiting" rather than actually taking over an already-open tab —
  // confirmed directly from a second real incident, on a fresh deploy,
  // where the live server was already serving the correct, fixed sw.js
  // (checked directly) but a real user's open tab was still running the
  // stale one. skipWaiting()/clients.claim() inside sw.js itself are
  // the worker's own half of "take over immediately, don't wait" — this
  // is the PAGE's own half: listening for the moment a new worker
  // actually takes control (the real "controllerchange" event) and
  // forcing one, single, automatic reload right then — so a customer or
  // admin never has to know a service worker exists, let alone
  // manually clear one, to see a real fix take effect. refreshing
  // guards against a real, rare double-fire some browsers can produce.
  // Only reload when an *existing* controller is replaced (real update).
  // First-time activation also fires controllerchange — reloading then
  // causes the homepage to visibly load twice for every new visitor.
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      // REAL BUG FIX: a genuine, live outage traced directly to this —
      // an already-installed, stale service worker kept enforcing an
      // OLD, cached copy of the site's security policy (from before a
      // real media-src fix shipped), silently blocking every real
      // image/video/font fetch on the page, on every browser that had
      // ever visited before the fix — completely independent of what
      // the live server now actually sends. Confirmed directly from a
      // real user's browser console: every failure was reported by
      // sw.js's own fetch handler, quoting the exact old policy text.
      // update() explicitly asks the browser to re-check for a new
      // sw.js right now, rather than waiting for its own internal
      // schedule (browsers already do this periodically, but "next
      // navigation, eventually" isn't good enough after a real fix has
      // shipped and is actively blocking things this very session).
      // The real "controllerchange" listener above is what actually
      // gets a customer/admin onto the new worker automatically once
      // it exists — this update() call is what makes that happen
      // promptly, rather than waiting on the browser's own schedule.
      reg.update();
    }).catch(() => {
      // A failed registration (e.g. served over plain HTTP in some
      // local/dev setups) should never break the actual site — it just
      // means "not installable this session," not a real error worth
      // surfacing to a customer.
    });
  });
}

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
      reg.update();
    }).catch(() => {
      // A failed registration (e.g. served over plain HTTP in some
      // local/dev setups) should never break the actual site — it just
      // means "not installable this session," not a real error worth
      // surfacing to a customer.
    });
  });
}

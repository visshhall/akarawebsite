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
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration (e.g. served over plain HTTP in some
      // local/dev setups) should never break the actual site — it just
      // means "not installable this session," not a real error worth
      // surfacing to a customer.
    });
  });
}

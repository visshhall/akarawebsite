/**
 * Meta Pixel bootstrap — loads only when Pixel ID is configured.
 * ID is public by design; access token is NEVER here (CAPI is server-only).
 */
(function () {
  function boot(pixelId) {
    if (!pixelId || window.fbq) return;
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
  }

  function start() {
    if (window.__AKARA_META_PIXEL_ID__) {
      boot(String(window.__AKARA_META_PIXEL_ID__));
      return;
    }
    fetch("/api/meta/config", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.pixelId) return;
        window.__AKARA_META_PIXEL_ID__ = cfg.pixelId;
        window.__AKARA_META_CAPI = !!cfg.capiEnabled;
        boot(cfg.pixelId);
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

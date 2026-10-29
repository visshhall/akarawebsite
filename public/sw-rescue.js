/* SW rescue — runs before main bundle.
   Clears broken Cache API entries once per browser after deploy issues.
   Does NOT force reload (that caused double homepage loads). */
(function () {
  try {
    var KEY = "akara_sw_rescue_20260909";
    if (localStorage.getItem(KEY) === "1") return;
    if (!("serviceWorker" in navigator)) return;
    localStorage.setItem(KEY, "1");
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {});
    }
  } catch (e) {}
})();

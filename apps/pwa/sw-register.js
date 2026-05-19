(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (!(location.protocol === "https:" || location.hostname === "localhost"))
    return;

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/pwa/service-worker.js", { scope: "/" })
      .catch(function (err) {
        try {
          console.warn("Service worker registration failed", err);
        } catch (e) {}
      });
  });
})();

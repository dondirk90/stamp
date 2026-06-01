(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (!(location.protocol === "https:" || location.hostname === "localhost"))
    return;

  var SW_VERSION = "20260601b";
  var reloading = false;

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    try {
      window.location.reload();
    } catch (e) {}
  }

  function promoteWaitingWorker(reg) {
    try {
      if (reg && reg.waiting) {
        reg.waiting.postMessage("SKIP_WAITING");
      }
    } catch (e) {}
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/pwa/service-worker.js?v=" + SW_VERSION, { scope: "/" })
      .then(function (reg) {
        try {
          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener("controllerchange", function () {
              reloadOnce();
            });
          }
        } catch (e0) {}

        promoteWaitingWorker(reg);

        try {
          reg.addEventListener("updatefound", function () {
            try {
              var worker = reg.installing;
              if (!worker) return;
              worker.addEventListener("statechange", function () {
                if (worker.state === "installed") {
                  promoteWaitingWorker(reg);
                }
              });
            } catch (e1) {}
          });
        } catch (e2) {}

        try {
          reg.update();
        } catch (e3) {}

        return reg;
      })
      .catch(function (err) {
        try {
          console.warn("Service worker registration failed", err);
        } catch (e) {}
      });
  });
})();

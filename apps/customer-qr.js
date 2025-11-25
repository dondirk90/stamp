// External helper for customer-qr.html — lightweight diagnostic and fallback loader
(function () {
  try {
    const s = document.getElementById("jsStatus");
    if (s) s.innerText = "JS: active (external)";
  } catch (e) {}

  function dbgBanner(msg) {
    try {
      let panel = document.getElementById("dbgPanel");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "dbgPanel";
        panel.style.fontFamily = "monospace";
        panel.style.fontSize = "12px";
        panel.style.background = "#0f172a";
        panel.style.color = "#e2e8f0";
        panel.style.padding = "8px";
        panel.style.borderRadius = "8px";
        panel.style.marginTop = "10px";
        panel.style.maxHeight = "140px";
        panel.style.overflow = "auto";
        panel.style.whiteSpace = "pre-wrap";
        const card = document.querySelector(".card") || document.body;
        card.appendChild(panel);
      }
      const time = new Date().toLocaleTimeString();
      panel.textContent = `${time} – ${msg}\n` + panel.textContent;
    } catch (e) {}
  }
  dbgBanner("[ext] external script loaded");

  // If QR lib is available, try to call tryAutoRender
  try {
    if (typeof QRCode !== "undefined") {
      dbgBanner("[ext] QRCode available");
      if (typeof tryAutoRender === "function") tryAutoRender();
    } else {
      dbgBanner("[ext] QRCode not present");
      // try to load local vendor as a last attempt
      const s = document.createElement("script");
      s.src = "/vendor/qrcode.min.js";
      s.onload = function () {
        dbgBanner("[ext] loaded /vendor/qrcode.min.js");
        if (typeof tryAutoRender === "function") tryAutoRender();
      };
      s.onerror = function () {
        dbgBanner("[ext] failed to load /vendor/qrcode.min.js");
      };
      document.head.appendChild(s);
    }
  } catch (e) {
    dbgBanner("[ext] QR check error " + (e && e.message));
  }
})();

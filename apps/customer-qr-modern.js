// Customer QR (modern): auth + map + wallet passes + history
(function () {
  "use strict";

  var STORAGE_KEY_V1 = "customer_session_v1";
  var STORAGE_KEY_V2 = "customer_session_v2"; // read-only (backward compat)
  var FAVORITES_KEY_V1 = "customer_favorites_v1";

  var REWARD_THRESHOLD = 10;
  var WALLET_MODE = "stack"; // parity across desktop/iOS/Android

  var el = {
    buildBadge: document.getElementById("buildBadge"),
    sessionBadge: document.getElementById("sessionBadge"),
    logoutBtn: document.getElementById("logoutBtn"),

    authPanel: document.getElementById("authPanel"),
    mainPanel: document.getElementById("mainPanel"),
    layoutGrid: document.getElementById("layoutGrid"),

    modeRegister: document.getElementById("modeRegister"),
    modeLogin: document.getElementById("modeLogin"),
    registerFields: document.getElementById("registerFields"),
    username: document.getElementById("username"),
    email: document.getElementById("email"),
    password: document.getElementById("password"),
    confirmPassword: document.getElementById("confirmPassword"),
    confirmPasswordWrap: document.getElementById("confirmPasswordWrap"),
    authSubmit: document.getElementById("authSubmit"),
    authMsg: document.getElementById("authMsg"),
    credsPanel: document.getElementById("credsPanel"),

    mainModeHome: document.getElementById("mainModeHome"),
    mainModeMap: document.getElementById("mainModeMap"),
    mainModeWallet: document.getElementById("mainModeWallet"),
    mainModeHistory: document.getElementById("mainModeHistory"),

    welcomeBadge: document.getElementById("welcomeBadge"),
    addressLine: document.getElementById("addressLine"),

    mapPanel: document.getElementById("mapPanel"),
    cafeMap: document.getElementById("cafeMap"),
    mapList: document.getElementById("mapList"),
    discoverPick: document.getElementById("discoverPick"),
    discoverPickName: document.getElementById("discoverPickName"),
    discoverPickAddr: document.getElementById("discoverPickAddr"),
    discoverPickAddBtn: document.getElementById("discoverPickAddBtn"),

    cafeSearch: document.getElementById("cafeSearch"),
    cafeResults: document.getElementById("cafeResults"),

    walletPanel: document.getElementById("walletPanel"),
    walletSubtitle: document.getElementById("walletSubtitle"),
    walletEmpty: document.getElementById("walletEmpty"),
    walletList: document.getElementById("walletList"),

    historyPanel: document.getElementById("historyPanel"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyError: document.getElementById("historyError"),
    historyEmpty: document.getElementById("historyEmpty"),
    historyList: document.getElementById("historyList"),

    cafeModalBackdrop: document.getElementById("cafeModalBackdrop"),
    cafeModalClose: document.getElementById("cafeModalClose"),
    cafeModalName: document.getElementById("cafeModalName"),
    cafeModalAddr: document.getElementById("cafeModalAddr"),
    cafeModalImageWrap: document.getElementById("cafeModalImageWrap"),
    cafeModalImage: document.getElementById("cafeModalImage"),
    cafeModalGallery: document.getElementById("cafeModalGallery"),
    cafeModalAbout: document.getElementById("cafeModalAbout"),
    cafeModalAboutEmpty: document.getElementById("cafeModalAboutEmpty"),
    cafeModalAddBtn: document.getElementById("cafeModalAddBtn"),
    cafeModalProfileLink: document.getElementById("cafeModalProfileLink"),
  };

  var apiBase =
    location.protocol === "file:"
      ? "http://127.0.0.1:3000"
      : location.origin + "/api";

  var session = null;
  var authMode = "register";

  var cafesByCafeAddress = {};

  var cafes = [];

  var leafletMap = null;
  var leafletMarkers = [];
  var pickedCafe = null;
  var mapInitTimer = 0;
  var mapInitAttempts = 0;

  var walletState = {
    stackDrag: null,
    ignoreClickUntil: 0,
    dragRaf: 0,
    dragTx: 0,
    dragTy: 0,
    dragRz: 0,
    dragOp: 1,
    dragTxCur: 0,
    dragTyCur: 0,
    dragRzCur: 0,
    dragOpCur: 1,
  };

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function clamp(v, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function isIOS() {
    try {
      var ua = navigator.userAgent || "";
      return /iP(hone|ad|od)/.test(ua);
    } catch (e) {
      return false;
    }
  }

  function normalizeAddr(v) {
    return v ? String(v).trim().toLowerCase() : "";
  }

  function setBootOk() {
    try {
      window.__STAMP_BOOT_OK = true;
      window.dispatchEvent(new CustomEvent("stamp:boot-ok"));
    } catch (e) {}
  }

  function setBuildBadge() {
    if (!el.buildBadge) return;
    try {
      el.buildBadge.textContent = "v " + new Date().toLocaleString();
    } catch (e) {
      el.buildBadge.textContent = "ready";
    }
  }

  function showMsg(kind, text) {
    if (!el.authMsg) return;
    el.authMsg.style.display = "block";
    el.authMsg.className = "notice" + (kind === "danger" ? " danger" : "");
    el.authMsg.textContent = String(text || "");
  }

  function clearMsg() {
    if (!el.authMsg) return;
    el.authMsg.style.display = "none";
    el.authMsg.textContent = "";
  }

  function loadSession() {
    var raw = null;
    try {
      raw =
        localStorage.getItem(STORAGE_KEY_V1) ||
        localStorage.getItem(STORAGE_KEY_V2);
    } catch (e) {
      raw = null;
    }
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || !s.address) return null;
      return s;
    } catch (e2) {
      return null;
    }
  }

  function saveSession(s) {
    session = s;
    try {
      localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(s));
    } catch (e) {}
  }

  function clearSession() {
    session = null;
    try {
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch (e) {}
  }

  function setAuthMode(mode) {
    authMode = mode === "login" ? "login" : "register";
    clearMsg();

    if (el.modeRegister)
      el.modeRegister.classList.toggle("active", authMode === "register");
    if (el.modeLogin)
      el.modeLogin.classList.toggle("active", authMode === "login");

    if (el.registerFields)
      el.registerFields.style.display = authMode === "register" ? "" : "none";
    if (el.confirmPasswordWrap)
      el.confirmPasswordWrap.style.display =
        authMode === "register" ? "" : "none";
    if (el.authSubmit)
      el.authSubmit.textContent =
        authMode === "register" ? "Account erstellen" : "Einloggen";

    if (el.password) {
      el.password.autocomplete =
        authMode === "register" ? "new-password" : "current-password";
    }
  }

  function setAuthedUI() {
    var isAuthed = !!(session && session.address);

    if (el.logoutBtn)
      el.logoutBtn.style.display = isAuthed ? "inline-flex" : "none";
    if (el.authPanel) el.authPanel.style.display = isAuthed ? "none" : "block";
    if (el.mainPanel) el.mainPanel.style.display = isAuthed ? "block" : "none";
    if (el.layoutGrid) el.layoutGrid.classList.toggle("authed", isAuthed);

    if (el.welcomeBadge && isAuthed) {
      var uname = session.username || session.email || "";
      el.welcomeBadge.textContent = uname
        ? "Willkommen, " + uname
        : "Willkommen";
    }
    if (el.addressLine) {
      el.addressLine.style.display = "none";
      el.addressLine.textContent = "";
    }
  }

  function navSetActive(which) {
    var w = which || "home";
    if (el.mainModeHome)
      el.mainModeHome.classList.toggle("active", w === "home");
    if (el.mainModeMap) el.mainModeMap.classList.toggle("active", w === "map");
    if (el.mainModeWallet)
      el.mainModeWallet.classList.toggle("active", w === "wallet");
    if (el.mainModeHistory)
      el.mainModeHistory.classList.toggle("active", w === "history");
  }

  function getPageMode() {
    try {
      var p = String(location.pathname || "").toLowerCase();
      if (p.indexOf("/customer-map") === 0) return "map";
      if (p.indexOf("/customer-history") === 0) return "history";
      if (p.indexOf("/customer-wallet") === 0) return "wallet";
      if (p.indexOf("/customer-qr") === 0) return "wallet";
      if (
        p.indexOf("/customer-home") === 0 ||
        p.indexOf("/customer-start") === 0
      )
        return "wallet";
      return "wallet";
    } catch (e) {
      return "wallet";
    }
  }

  function navigateToMode(mode) {
    var m = mode || "wallet";
    var href = "/customer-wallet";
    if (m === "map") href = "/customer-map";
    if (m === "history") href = "/customer-history";
    if (m === "wallet") href = "/customer-wallet";
    try {
      if (location.pathname === href || location.pathname === href + "/") {
        applyPageMode(m);
        return;
      }
    } catch (e) {}
    try {
      location.href = href;
    } catch (e2) {}
  }

  function buildCafeProfileHref(cafe) {
    try {
      if (!cafe) return null;
      var id = cafe.id != null ? String(cafe.id) : "";
      if (!id) return null;
      return "/cafe-public.html?id=" + encodeURIComponent(id);
    } catch (e) {
      return null;
    }
  }

  function renderCafeResults(query) {
    if (!el.cafeResults) return;
    var q = String(query || "")
      .trim()
      .toLowerCase();
    var list = Array.isArray(cafes) ? cafes.slice() : [];

    if (q) {
      list = list.filter(function (c) {
        var name = c && c.name ? String(c.name).toLowerCase() : "";
        var addr = c && c.address ? String(c.address).toLowerCase() : "";
        return name.indexOf(q) !== -1 || addr.indexOf(q) !== -1;
      });
    }

    list.sort(function (a, b) {
      var an = a && a.name ? String(a.name) : "";
      var bn = b && b.name ? String(b.name) : "";
      return an.localeCompare(bn);
    });

    el.cafeResults.innerHTML = "";

    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = q ? "Keine Treffer." : "Noch keine Cafés.";
      el.cafeResults.appendChild(empty);
      return;
    }

    var max = Math.min(20, list.length);
    for (var i = 0; i < max; i++) {
      (function (cafe) {
        var href = buildCafeProfileHref(cafe);
        var wrap = document.createElement("div");
        wrap.className = "stack";
        wrap.style.gap = "4px";

        var a = document.createElement("a");
        a.className = "btn secondary";
        a.href = href || "#";
        a.textContent = cafe && cafe.name ? String(cafe.name) : "Café";
        if (!href) {
          a.addEventListener("click", function (ev) {
            try {
              ev.preventDefault();
            } catch (e) {}
          });
        }

        var addr = document.createElement("div");
        addr.className = "muted";
        addr.style.fontSize = "12px";
        addr.textContent = cafe && cafe.address ? String(cafe.address) : "";

        wrap.appendChild(a);
        if (addr.textContent) wrap.appendChild(addr);
        el.cafeResults.appendChild(wrap);
      })(list[i]);
    }
  }

  function wireCafeSearch() {
    if (!el.cafeSearch) return;
    var t = 0;
    var on = function () {
      try {
        if (t) window.clearTimeout(t);
      } catch (e) {}
      t = window.setTimeout(function () {
        t = 0;
        renderCafeResults(el.cafeSearch ? el.cafeSearch.value : "");
      }, 90);
    };

    el.cafeSearch.addEventListener("input", on, { passive: true });
    renderCafeResults("");
  }

  function applyPageMode(mode) {
    var m = mode || getPageMode();
    navSetActive(m === "wallet" ? "wallet" : m);

    // These panels live on the same HTML, but we show only one per route.
    if (el.mapPanel) el.mapPanel.style.display = m === "map" ? "block" : "none";
    if (el.walletPanel)
      el.walletPanel.style.display = m === "wallet" ? "block" : "none";
    if (el.historyPanel)
      el.historyPanel.style.display = m === "history" ? "block" : "none";

    if (m === "map") {
      ensureMapInit();
    }
    if (m === "history") {
      refreshHistory();
    }
    if (m === "wallet") {
      refreshWallet();
    }
  }

  function scrollToPanel(node) {
    if (!node) return;
    try {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      try {
        node.scrollIntoView(true);
      } catch (e2) {}
    }
  }

  function getFavorites() {
    var raw = null;
    try {
      raw = localStorage.getItem(FAVORITES_KEY_V1);
    } catch (e) {
      raw = null;
    }
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e2) {
      return [];
    }
  }

  function setFavorites(list) {
    try {
      localStorage.setItem(
        FAVORITES_KEY_V1,
        JSON.stringify(Array.isArray(list) ? list : []),
      );
    } catch (e) {}
  }

  function addFavorite(addr) {
    var a = normalizeAddr(addr);
    if (!a) return false;
    var cur = getFavorites();
    for (var i = 0; i < cur.length; i++) {
      if (normalizeAddr(cur[i]) === a) return false;
    }
    cur.push(a);
    setFavorites(cur);
    return true;
  }

  function hideDiscoverPick() {
    pickedCafe = null;
    if (!el.discoverPick) return;
    el.discoverPick.style.display = "none";
  }

  function showDiscoverPick(cafe) {
    pickedCafe = cafe || null;
    if (el.discoverPickName)
      el.discoverPickName.textContent =
        cafe && cafe.name ? String(cafe.name) : "Café";
    if (el.discoverPickAddr)
      el.discoverPickAddr.textContent =
        cafe && cafe.address ? String(cafe.address) : "";
    if (el.discoverPick) el.discoverPick.style.display = "block";
  }

  function onAddPickedCafe() {
    if (!pickedCafe) return;
    var addr = normalizeAddr(pickedCafe.cafeAddress || pickedCafe.address);
    if (!addr) return;
    addFavorite(addr);
    hideDiscoverPick();
    refreshWallet();
  }

  function teardownMap() {
    try {
      if (leafletMarkers && leafletMarkers.length) {
        for (var i = 0; i < leafletMarkers.length; i++) {
          try {
            leafletMarkers[i].remove();
          } catch (e) {}
        }
      }
    } catch (e2) {}
    leafletMarkers = [];
    try {
      if (leafletMap) leafletMap.remove();
    } catch (e3) {}
    leafletMap = null;
  }

  function renderMapList() {
    if (!el.mapList) return;
    if (!cafes || !cafes.length) {
      el.mapList.textContent = "Noch keine Cafés.";
      return;
    }

    el.mapList.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "stack";
    wrap.style.gap = "8px";

    var max = Math.min(12, cafes.length);
    for (var i = 0; i < max; i++) {
      (function (cafe) {
        var href = buildCafeProfileHref(cafe);
        var a = document.createElement("a");
        a.className = "btn secondary";
        a.href = href || "#";
        a.textContent = cafe && cafe.name ? String(cafe.name) : "Café";
        wrap.appendChild(a);
      })(cafes[i]);
    }
    el.mapList.appendChild(wrap);
  }

  function initMapIfReady() {
    if (!el.cafeMap) return false;
    if (leafletMap) return true;
    if (!cafes || !cafes.length) return false;
    if (!window.L || !window.L.map) return false;

    var firstWithPos = null;
    for (var i = 0; i < cafes.length; i++) {
      var c = cafes[i];
      if (c && isFinite(Number(c.lat)) && isFinite(Number(c.lng))) {
        firstWithPos = c;
        break;
      }
    }
    var center = firstWithPos
      ? [Number(firstWithPos.lat), Number(firstWithPos.lng)]
      : [52.52, 13.405];

    try {
      leafletMap = window.L.map(el.cafeMap, {
        zoomControl: false,
        attributionControl: false,
      }).setView(center, firstWithPos ? 14 : 5);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(leafletMap);

      leafletMap.on("click", function () {
        hideDiscoverPick();
      });

      for (var j = 0; j < cafes.length; j++) {
        var cafe = cafes[j];
        if (!cafe || !isFinite(Number(cafe.lat)) || !isFinite(Number(cafe.lng)))
          continue;
        (function (cafe2) {
          var marker = window.L.marker([Number(cafe2.lat), Number(cafe2.lng)]);
          marker.addTo(leafletMap);
          marker.on("click", function () {
            var href = buildCafeProfileHref(cafe2);
            if (href) {
              try {
                location.href = href;
                return;
              } catch (e) {}
            }
            showDiscoverPick(cafe2);
          });
          leafletMarkers.push(marker);
        })(cafe);
      }

      // Leaflet often needs a size recalculation after being shown.
      window.setTimeout(function () {
        try {
          if (leafletMap) leafletMap.invalidateSize();
        } catch (e) {}
      }, 120);
      return true;
    } catch (e2) {
      teardownMap();
      return false;
    }
  }

  function ensureMapInit() {
    if (initMapIfReady()) return;
    if (mapInitTimer) return;

    mapInitAttempts = 0;
    mapInitTimer = window.setInterval(function () {
      mapInitAttempts++;
      if (initMapIfReady()) {
        try {
          window.clearInterval(mapInitTimer);
        } catch (e) {}
        mapInitTimer = 0;
        return;
      }
      if (mapInitAttempts > 40) {
        try {
          window.clearInterval(mapInitTimer);
        } catch (e2) {}
        mapInitTimer = 0;
      }
    }, 150);
  }

  function setWalletEmptyVisible(show) {
    if (el.walletEmpty) el.walletEmpty.style.display = show ? "block" : "none";
  }

  function buildStampSvg(filled) {
    if (filled) {
      return (
        '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="44" fill="currentColor"></circle>' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="var(--brand-50)" stroke-width="3" opacity="0.9"></circle>' +
        '<path d="M40 18 C22 34 22 66 40 82" fill="none" stroke="var(--brand-50)" stroke-width="7" stroke-linecap="round"></path>' +
        '<path d="M60 18 C78 34 78 66 60 82" fill="none" stroke="var(--brand-50)" stroke-width="7" stroke-linecap="round"></path>' +
        '<path d="M50 16 C44 34 44 66 50 84" fill="none" stroke="var(--brand-50)" stroke-width="3" stroke-linecap="round" opacity="0.7"></path>' +
        "</svg>"
      );
    }
    return (
      '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="4" opacity="0.45"></circle>' +
      '<circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2" opacity="0.20"></circle>' +
      '<path d="M40 18 C22 34 22 66 40 82" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity="0.35"></path>' +
      '<path d="M60 18 C78 34 78 66 60 82" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity="0.35"></path>' +
      '<path d="M50 16 C44 34 44 66 50 84" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.25"></path>' +
      "</svg>"
    );
  }

  function renderStampGrid(container, count) {
    var n = clamp(Number(count || 0) || 0, 0, REWARD_THRESHOLD);
    container.innerHTML = "";
    for (var i = 0; i < REWARD_THRESHOLD; i++) {
      var cell = document.createElement("div");
      var filled = i < n;
      cell.className = "stamp " + (filled ? "filled" : "empty");
      cell.innerHTML = buildStampSvg(filled);
      container.appendChild(cell);
    }
  }

  function buildCafeLink(cafeAddress) {
    if (!session || !session.address) return null;
    var cafeScannerUrl = location.origin + "/cafe-scanner-new.html";
    var u = new URL(cafeScannerUrl);
    u.searchParams.set("customer", session.address);
    u.searchParams.set("customerName", session.username || "");
    if (cafeAddress) u.searchParams.set("cafe", cafeAddress);
    return u.toString();
  }

  function ensureQrCanvas(passEl) {
    var box = passEl.querySelector(".passQrBox");
    if (!box) return null;
    var c = box.querySelector("canvas");
    if (c) return c;
    c = document.createElement("canvas");
    box.appendChild(c);
    return c;
  }

  function openPass(passEl) {
    if (!passEl) return;
    passEl.classList.add("open");
    try {
      var cafeAddress = passEl.getAttribute("data-cafe") || "";
      var link = buildCafeLink(cafeAddress);
      if (!link) return;
      var canvas = ensureQrCanvas(passEl);
      if (!canvas) return;
      if (typeof QRCode === "undefined" || !QRCode || !QRCode.toCanvas) return;
      QRCode.toCanvas(
        canvas,
        link,
        { width: 240, margin: 1, errorCorrectionLevel: "M" },
        function () {},
      );
    } catch (e) {}
  }

  function closePass(passEl) {
    if (!passEl) return;
    passEl.classList.remove("open");
  }

  function buildPassCard(card) {
    var cafeAddress = String(card.cafeAddress || "");
    var title = String(card.name || "Café");
    var stampCount = clamp(Number(card.netStamps || 0) || 0, 0, 999);
    var theme = card.cardTheme ? String(card.cardTheme) : "clean";

    var passCard = document.createElement("div");
    passCard.className = "passCard";
    passCard.setAttribute("data-cafe", cafeAddress);
    passCard.setAttribute("data-pass-theme", theme);

    var flip = document.createElement("div");
    flip.className = "passFlip";

    var mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "passMain";
    mainBtn.setAttribute("aria-label", "Karte öffnen");

    var head = document.createElement("div");
    head.className = "passHead";

    var left = document.createElement("div");
    left.className = "stack";
    left.style.minWidth = "0";

    var h = document.createElement("div");
    h.className = "passTitle";
    h.textContent = title;

    var sub = document.createElement("div");
    sub.className = "passSub";
    sub.textContent =
      clamp(stampCount, 0, REWARD_THRESHOLD) +
      " / " +
      REWARD_THRESHOLD +
      " Stempel";

    left.appendChild(h);
    left.appendChild(sub);

    var right = document.createElement("div");
    right.className = "passRight";

    var badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent =
      stampCount >= REWARD_THRESHOLD
        ? "Voll"
        : clamp(stampCount, 0, REWARD_THRESHOLD) + "/" + REWARD_THRESHOLD;

    right.appendChild(badge);

    var logoWrap = document.createElement("div");
    logoWrap.className = "passLogoWrap";
    if (card.logoDataUrl) {
      var img = document.createElement("img");
      img.className = "passLogo";
      img.alt = "Logo";
      img.decoding = "async";
      img.loading = "lazy";
      img.src = String(card.logoDataUrl);
      logoWrap.appendChild(img);
    }
    right.appendChild(logoWrap);

    head.appendChild(left);
    head.appendChild(right);

    var grid = document.createElement("div");
    grid.className = "stampGrid";
    renderStampGrid(grid, stampCount);

    var hint = document.createElement("div");
    hint.className = "passHint";
    hint.textContent = "Tippe für QR";

    mainBtn.appendChild(head);
    mainBtn.appendChild(grid);
    mainBtn.appendChild(hint);

    var qr = document.createElement("div");
    qr.className = "passQr";

    var qrBox = document.createElement("div");
    qrBox.className = "passQrBox";
    qrBox.setAttribute("role", "button");
    qrBox.setAttribute("aria-label", "QR anzeigen / schließen");
    qr.appendChild(qrBox);

    flip.appendChild(mainBtn);
    flip.appendChild(qr);
    passCard.appendChild(flip);

    mainBtn.addEventListener("click", function () {
      if (nowMs() < walletState.ignoreClickUntil) return;
      openPass(passCard);
    });
    qrBox.addEventListener("click", function () {
      closePass(passCard);
    });

    return passCard;
  }

  function applyWalletStackVisibility(scroller) {
    if (!scroller) return;
    var cards = scroller.querySelectorAll(".passCard");
    for (var i = 0; i < cards.length; i++) {
      var node = cards[i];
      // Only the top card may ever show the back (QR). Keep the stack clean.
      if (i > 0 && node.classList && node.classList.contains("open")) {
        closePass(node);
      }
      if (i > 2) {
        node.style.display = "none";
        node.style.pointerEvents = "none";
        continue;
      }

      node.style.display = "block";
      node.style.pointerEvents = i === 0 ? "auto" : "none";

      // Keep the deck hinted visually (2 cards behind).
      var op = i === 0 ? 1 : i === 1 ? 0.72 : 0.55;
      var sc = i === 0 ? 1 : i === 1 ? 0.985 : 0.97;
      var sy = i === 0 ? 0 : i === 1 ? 10 : 18;

      node.style.setProperty("--wheel-tx", "0px");
      node.style.setProperty("--stack-swipe-y", "0px");
      node.style.setProperty("--wheel-rz", "0deg");
      node.style.setProperty("--wheel-opacity", String(op));
      node.style.setProperty("--wheel-scale", String(sc));
      node.style.setProperty("--stack-y", String(sy) + "px");
      try {
        node.style.zIndex = String(100 - i);
      } catch (e2) {}
    }
  }

  function resetVisiblePassesToFront(scroller) {
    if (!scroller) return;
    try {
      var nodes = scroller.querySelectorAll(".passCard");
      for (var i = 0; i < nodes.length && i < 3; i++) {
        closePass(nodes[i]);
      }
    } catch (e) {}
  }

  function sendTopCardToBack(scroller, opts) {
    if (!scroller) return;
    var cardEl = scroller.querySelector(".passCard");
    if (!cardEl) return;

    var tx = opts && isFinite(opts.tx) ? Number(opts.tx) : 0;
    var ty = opts && isFinite(opts.ty) ? Number(opts.ty) : 0;
    var dir = opts && opts.dir ? opts.dir : tx >= 0 ? 1 : -1;

    cardEl.classList.add("isSwapping");

    // Push it a bit further in the swipe direction, fade it out, then reorder.
    cardEl.style.setProperty("--wheel-tx", String(tx) + "px");
    cardEl.style.setProperty("--stack-swipe-y", String(ty) + "px");
    cardEl.style.setProperty("--wheel-rz", String(dir * 4.8) + "deg");
    cardEl.style.setProperty("--wheel-opacity", "0");
    cardEl.style.setProperty("--wheel-scale", "0.965");

    window.setTimeout(function () {
      try {
        scroller.appendChild(cardEl);
      } catch (e) {}

      try {
        // Always reset to the front when it goes to the back.
        closePass(cardEl);
        cardEl.classList.remove("isSwapping");
        cardEl.style.setProperty("--wheel-tx", "0px");
        cardEl.style.setProperty("--stack-swipe-y", "0px");
        cardEl.style.setProperty("--wheel-opacity", "1");
        cardEl.style.setProperty("--wheel-rz", "0deg");
        cardEl.style.setProperty("--wheel-scale", "1");
        cardEl.style.setProperty("--stack-y", "0px");
      } catch (e2) {}

      // And ensure the newly revealed card is also on the front.
      resetVisiblePassesToFront(scroller);
      applyWalletStackVisibility(scroller);
    }, 170);
  }

  function cycleTopToBottom(scroller, direction) {
    var cardEl = scroller.querySelector(".passCard");
    if (!cardEl) return;

    cardEl.classList.add("isSwapping");
    var dir = direction || 1;

    // Animate into the back of the deck (so the user sees it going to the end).
    cardEl.style.setProperty("--wheel-tx", String(dir * 28) + "px");
    cardEl.style.setProperty("--stack-swipe-y", "0px");
    cardEl.style.setProperty("--wheel-rz", String(dir * 3.2) + "deg");
    cardEl.style.setProperty("--wheel-opacity", "0.55");
    cardEl.style.setProperty("--wheel-scale", "0.97");
    cardEl.style.setProperty("--stack-y", "18px");

    window.setTimeout(function () {
      try {
        scroller.appendChild(cardEl);
      } catch (e) {}

      try {
        closePass(cardEl);
        cardEl.classList.remove("isSwapping");
        cardEl.style.setProperty("--wheel-tx", "0px");
        cardEl.style.setProperty("--stack-swipe-y", "0px");
        cardEl.style.setProperty("--wheel-opacity", "1");
        cardEl.style.setProperty("--wheel-rz", "0deg");
        cardEl.style.setProperty("--wheel-scale", "1");
        cardEl.style.setProperty("--stack-y", "0px");
      } catch (e2) {}

      resetVisiblePassesToFront(scroller);
      applyWalletStackVisibility(scroller);
    }, 220);
  }

  function enableWalletStackMode(scroller) {
    if (!scroller) return;
    scroller.classList.add("isStack");
    applyWalletStackVisibility(scroller);

    function onPointerDown(ev) {
      var top = scroller.querySelector(".passCard");
      if (!top) return;

      walletState.stackDrag = {
        id: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        moved: false,
        activeEl: top,
      };
      try {
        top.setPointerCapture(ev.pointerId);
      } catch (e) {}
    }

    function onPointerMove(ev) {
      var d = walletState.stackDrag;
      if (!d || d.id !== ev.pointerId) return;
      var dx = ev.clientX - d.startX;
      var dy = ev.clientY - d.startY;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;

      if (!d.moved) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        d.moved = true;
        scroller.classList.add("isDragging");
      }

      var card = d.activeEl;
      if (!card) return;
      var tx = clamp(dx, -260, 260);
      var ty = clamp(dy, -220, 220);
      var dist = Math.sqrt(tx * tx + ty * ty);
      var rz = clamp(tx / 18, -10, 10);
      var op = 1 - Math.min(0.68, dist / 520);

      var w = Math.max(1, card.getBoundingClientRect().width || 0);
      var trigger = Math.min(165, Math.max(95, w * 0.32));
      if (dist >= trigger) {
        // Trigger immediately once it's far enough away.
        walletState.ignoreClickUntil = nowMs() + 340;
        walletState.stackDrag = null;
        scroller.classList.remove("isDragging");
        try {
          if (walletState.dragRaf)
            window.cancelAnimationFrame(walletState.dragRaf);
        } catch (e0) {}
        walletState.dragRaf = 0;
        walletState.dragTxCur = 0;
        walletState.dragTyCur = 0;
        walletState.dragRzCur = 0;
        walletState.dragOpCur = 1;

        var dir = Math.abs(tx) >= Math.abs(ty) ? (tx >= 0 ? 1 : -1) : ty >= 0 ? 1 : -1;
        sendTopCardToBack(scroller, {
          tx: tx * 1.25,
          ty: ty * 1.15,
          dir: dir,
        });
        return;
      }

      // Throttle style updates to rAF for smoother motion.
      walletState.dragTx = tx;
      walletState.dragTy = ty;
      walletState.dragRz = rz;
      walletState.dragOp = op;
      if (walletState.dragRaf) return;

      var step = function () {
        walletState.dragRaf = 0;
        try {
          var dd = walletState.stackDrag;
          var card2 = dd && dd.activeEl ? dd.activeEl : null;
          if (!card2) return;

          // Smooth interpolation (reduces jitter on mobile).
          walletState.dragTxCur +=
            (walletState.dragTx - walletState.dragTxCur) * 0.35;
          walletState.dragTyCur +=
            (walletState.dragTy - walletState.dragTyCur) * 0.35;
          walletState.dragRzCur +=
            (walletState.dragRz - walletState.dragRzCur) * 0.35;
          walletState.dragOpCur +=
            (walletState.dragOp - walletState.dragOpCur) * 0.45;

          card2.style.setProperty(
            "--wheel-tx",
            walletState.dragTxCur.toFixed(2) + "px",
          );
          card2.style.setProperty(
            "--stack-swipe-y",
            walletState.dragTyCur.toFixed(2) + "px",
          );
          card2.style.setProperty(
            "--wheel-rz",
            walletState.dragRzCur.toFixed(2) + "deg",
          );
          card2.style.setProperty(
            "--wheel-opacity",
            String(walletState.dragOpCur.toFixed(3)),
          );
        } catch (e) {}

        if (walletState.stackDrag) {
          walletState.dragRaf = window.requestAnimationFrame(step);
        }
      };

      walletState.dragRaf = window.requestAnimationFrame(step);
    }

    function onPointerUp(ev) {
      var d = walletState.stackDrag;
      if (!d || d.id !== ev.pointerId) return;
      walletState.stackDrag = null;
      scroller.classList.remove("isDragging");

      try {
        if (walletState.dragRaf)
          window.cancelAnimationFrame(walletState.dragRaf);
      } catch (e0) {}
      walletState.dragRaf = 0;
      walletState.dragTxCur = 0;
      walletState.dragTyCur = 0;
      walletState.dragRzCur = 0;
      walletState.dragOpCur = 1;

      var dx = ev.clientX - d.startX;
      var dy = ev.clientY - d.startY;
      var moved = !!d.moved;
      var card = d.activeEl;
      if (!card) return;

      var w = Math.max(1, card.getBoundingClientRect().width || 0);
      var threshold = Math.min(110, Math.max(70, w * 0.22));

      var tx = clamp(dx, -260, 260);
      var ty = clamp(dy, -220, 220);
      var dist = Math.sqrt(tx * tx + ty * ty);
      if (moved && dist > threshold) {
        walletState.ignoreClickUntil = nowMs() + 340;
        var dir = Math.abs(tx) >= Math.abs(ty) ? (tx >= 0 ? 1 : -1) : ty >= 0 ? 1 : -1;
        sendTopCardToBack(scroller, {
          tx: tx * 1.25,
          ty: ty * 1.15,
          dir: dir,
        });
        return;
      }

      card.style.setProperty("--wheel-tx", "0px");
      card.style.setProperty("--stack-swipe-y", "0px");
      card.style.setProperty("--wheel-rz", "0deg");
      card.style.setProperty("--wheel-opacity", "1");
      if (moved) walletState.ignoreClickUntil = nowMs() + 180;
    }

    scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
    scroller.addEventListener("pointermove", onPointerMove, { passive: true });
    scroller.addEventListener("pointerup", onPointerUp, { passive: true });
    scroller.addEventListener("pointercancel", onPointerUp, { passive: true });
  }

  function refreshWallet() {
    if (!el.walletList) return;

    var fav = getFavorites();
    var cards = [];
    for (var i = 0; i < fav.length; i++) {
      var a = normalizeAddr(fav[i]);
      if (!a) continue;
      var cafe = cafesByCafeAddress[a] || null;
      cards.push({
        cafeAddress: a,
        name: cafe && cafe.name ? cafe.name : a.slice(0, 10) + "…",
        netStamps: 0,
        cardTheme: (cafe && cafe.cardTheme) || "clean",
        logoDataUrl: cafe && cafe.logoDataUrl ? cafe.logoDataUrl : null,
      });
    }

    el.walletList.innerHTML = "";

    if (!cards.length) {
      setWalletEmptyVisible(true);
      return;
    }

    setWalletEmptyVisible(false);

    for (var j = 0; j < cards.length; j++) {
      el.walletList.appendChild(buildPassCard(cards[j]));
    }

    if (WALLET_MODE === "stack") {
      enableWalletStackMode(el.walletList);
    }
  }

  function wireAuth() {
    if (el.modeRegister)
      el.modeRegister.addEventListener("click", function () {
        setAuthMode("register");
      });
    if (el.modeLogin)
      el.modeLogin.addEventListener("click", function () {
        setAuthMode("login");
      });
    if (el.authSubmit)
      el.authSubmit.addEventListener("click", function () {
        handleAuthSubmit();
      });
  }

  function wireLogout() {
    if (!el.logoutBtn) return;
    el.logoutBtn.addEventListener("click", function () {
      clearSession();
      if (el.historyPanel) el.historyPanel.style.display = "none";
      if (el.walletList) el.walletList.innerHTML = "";
      setWalletEmptyVisible(true);
      setAuthedUI();
      navSetActive("home");
    });
  }

  function wireNavigation() {
    if (el.mainModeHome) {
      el.mainModeHome.addEventListener("click", function () {
        navigateToMode("wallet");
      });
    }
    if (el.mainModeMap) {
      el.mainModeMap.addEventListener("click", function () {
        navigateToMode("map");
      });
    }
    if (el.mainModeWallet) {
      el.mainModeWallet.addEventListener("click", function () {
        navigateToMode("wallet");
      });
    }
    if (el.mainModeHistory) {
      el.mainModeHistory.addEventListener("click", function () {
        navigateToMode("history");
      });
    }
  }

  function apiFetch(path, init) {
    var url = apiBase + path;
    return fetch(url, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(t || "HTTP " + res.status);
        });
      }
      return res.json();
    });
  }

  function handleAuthSubmit() {
    clearMsg();

    var email = el.email ? String(el.email.value || "").trim() : "";
    var password = el.password ? String(el.password.value || "").trim() : "";
    var username = el.username ? String(el.username.value || "").trim() : "";
    var confirmPassword = el.confirmPassword
      ? String(el.confirmPassword.value || "").trim()
      : "";

    if (!email || !password) {
      showMsg("danger", "Bitte E-Mail und Passwort ausfüllen.");
      return;
    }

    if (authMode === "register") {
      if (!username) {
        showMsg("danger", "Bitte Username ausfüllen.");
        return;
      }
      if (confirmPassword !== password) {
        showMsg("danger", "Passwörter stimmen nicht überein.");
        return;
      }

      apiFetch("/customers/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: username,
          email: email,
          password: password,
        }),
      })
        .then(function (data) {
          if (!data || !data.address) throw new Error("Ungültige Antwort");
          saveSession({
            address: data.address,
            email: email,
            username: username,
            customer_id: data.customer_id || null,
          });
          setAuthedUI();
          refreshWallet();
        })
        .catch(function (e) {
          showMsg("danger", String(e && e.message ? e.message : e));
        });
      return;
    }

    apiFetch("/customers/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (data2) {
        if (!data2 || !data2.address) throw new Error("Ungültige Antwort");
        saveSession({
          address: data2.address,
          email: email,
          username: data2.username || null,
          customer_id: data2.customer_id || null,
        });
        setAuthedUI();
        refreshWallet();
      })
      .catch(function (e2) {
        showMsg("danger", String(e2 && e2.message ? e2.message : e2));
      });
  }

  function refreshHistory() {
    if (!el.historyList) return;
    if (!session || !session.address) return;

    if (el.historyError) {
      el.historyError.style.display = "none";
      el.historyError.textContent = "";
    }
    if (el.historyEmpty) el.historyEmpty.style.display = "none";
    el.historyList.innerHTML = "";

    apiFetch("/stamps/history/" + encodeURIComponent(session.address))
      .then(function (data) {
        var events =
          data && data.events ? data.events : Array.isArray(data) ? data : [];
        if (!Array.isArray(events) || !events.length) {
          if (el.historyEmpty) el.historyEmpty.style.display = "block";
          return;
        }
        for (var i = 0; i < events.length; i++) {
          var ev = events[i] || {};
          var row = document.createElement("div");
          row.className = "historyRow";
          row.textContent =
            String(ev.event_type || "event") +
            " · " +
            String(ev.cafe || "") +
            " · " +
            String(ev.delta != null ? ev.delta : "");
          el.historyList.appendChild(row);
        }
      })
      .catch(function (e) {
        if (el.historyError) {
          el.historyError.style.display = "block";
          el.historyError.textContent = String(e && e.message ? e.message : e);
        }
      });
  }

  function bootAuthed() {
    refreshWallet();
    apiFetch("/cafes/public")
      .then(function (data) {
        var list = Array.isArray(data)
          ? data
          : data && data.cafes
            ? data.cafes
            : [];
        cafes = Array.isArray(list) ? list : [];
        cafesByCafeAddress = {};
        for (var i = 0; i < cafes.length; i++) {
          var c = cafes[i] || {};
          var addr = normalizeAddr(c.cafeAddress || c.address);
          if (!addr) continue;
          cafesByCafeAddress[addr] = c;
        }

        renderMapList();
        wireCafeSearch();
        ensureMapInit();
      })
      .catch(function () {
        // non-fatal
      })
      .then(function () {
        // Avoid Promise.prototype.finally for older Safari/WebView builds.
        refreshWallet();
      });
  }

  function main() {
    if (isIOS()) {
      try {
        document.documentElement.classList.add("ios");
      } catch (e) {}
    }

    setBuildBadge();
    wireAuth();
    wireLogout();
    wireNavigation();

    if (el.discoverPickAddBtn) {
      el.discoverPickAddBtn.addEventListener("click", function () {
        onAddPickedCafe();
      });
    }

    // Accept ?cafe=<address> deep link (from cafe-public) and add to favorites.
    try {
      var sp = new URLSearchParams(location.search || "");
      var caf = sp.get("cafe");
      if (caf) {
        addFavorite(caf);
        sp.delete("cafe");
        var next =
          location.pathname +
          (sp.toString() ? "?" + sp.toString() : "") +
          (location.hash || "");
        history.replaceState(null, "", next);
      }
    } catch (e9) {}

    var s = loadSession();
    if (s) saveSession(s);
    setAuthedUI();
    setAuthMode("register");
    applyPageMode(getPageMode());

    if (session && session.address) {
      bootAuthed();
    }

    try {
      window.addEventListener("load", function () {
        ensureMapInit();
      });
    } catch (e) {}

    setBootOk();
  }

  main();
})();

// Customer QR (modern): auth + map + wallet passes + history
(function () {
  "use strict";

  var STORAGE_KEY_V1 = "customer_session_v1";
  var STORAGE_KEY_V2 = "customer_session_v2"; // read-only (backward compat)
  var FAVORITES_KEY_V1 = "customer_favorites_v1";
  var CAFE_META_CACHE_KEY_V1 = "customer_cafe_meta_v1";
  var MAP_CENTER_CACHE_KEY_V1 = "customer_map_center_v1";

  var REWARD_THRESHOLD = 10;
  // Keep the wallet interaction model consistent across phone, tablet and notebook:
  // cards move horizontally everywhere instead of switching to a vertical stack on desktop.
  var WALLET_MODE = "carousel";
  var CAMPAIGN_SEEN_KEY = "customer_campaign_seen_v1";

  // Redeem QR tokens (single-use). Cache briefly so the QR stays stable
  // while the customer holds it up to be scanned.
  var redeemTokenState = {
    byKey: {},
  };

  var shellMenuState = {
    open: false,
  };

  var qrSheetState = {
    open: false,
    passEl: null,
  };

  var currentPageMode = null;

  var el = {
    buildBadge: document.getElementById("buildBadge"),
    liveBadge: document.getElementById("liveBadge"),
    bottomTabs: document.querySelector(".bottomTabs"),
    qrSheetBackdrop: document.getElementById("qrSheetBackdrop"),
    qrSheet: document.getElementById("qrSheet"),
    qrSheetTitle: document.getElementById("qrSheetTitle"),
    qrSheetSub: document.getElementById("qrSheetSub"),
    qrSheetBox: document.getElementById("qrSheetBox"),
    qrSheetHint: document.getElementById("qrSheetHint"),
    qrSheetClose: document.getElementById("qrSheetClose"),
    walletOverlayBackdrop: document.getElementById("walletOverlayBackdrop"),
    walletOverlay: document.getElementById("walletOverlay"),
    walletOverlayClose: document.getElementById("walletOverlayClose"),

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
    authForgotToggle: document.getElementById("authForgotToggle"),
    authResendVerificationBtn: document.getElementById(
      "authResendVerificationBtn",
    ),
    authForgotPanel: document.getElementById("authForgotPanel"),
    authForgotSubmit: document.getElementById("authForgotSubmit"),
    authForgotMsg: document.getElementById("authForgotMsg"),

    bottomModeMap: document.getElementById("bottomModeMap"),
    bottomModeWallet: document.getElementById("bottomModeWallet"),
    bottomModeHistory: document.getElementById("bottomModeHistory"),
    mainModeMap: document.getElementById("mainModeMap"),
    mainModeWallet: document.getElementById("mainModeWallet"),
    mainModeHistory: document.getElementById("mainModeHistory"),
    mainModeAccount: document.getElementById("mainModeAccount"),
    topUtilityBtn: document.getElementById("topUtilityBtn"),
    utilityMenu: document.getElementById("utilityMenu"),
    utilityMapBtn: document.getElementById("utilityMapBtn"),
    utilityHistoryBtn: document.getElementById("utilityHistoryBtn"),
    utilityAccountBtn: document.getElementById("utilityAccountBtn"),
    utilityLogoutBtn: document.getElementById("utilityLogoutBtn"),

    welcomePanel: document.getElementById("welcomePanel"),
    welcomeTitle: document.getElementById("welcomeTitle"),
    welcomeLead: document.getElementById("welcomeLead"),
    welcomeCardCount: document.getElementById("welcomeCardCount"),
    welcomeStateTitle: document.getElementById("welcomeStateTitle"),
    welcomeNextHint: document.getElementById("welcomeNextHint"),
    welcomePrimaryAction: document.getElementById("welcomePrimaryAction"),
    welcomeCardsEmpty: document.getElementById("welcomeCardsEmpty"),
    welcomeCardsList: document.getElementById("welcomeCardsList"),
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
    screenPager: document.getElementById("screenPager"),

    walletPanel: document.getElementById("walletPanel"),
    walletSubtitle: document.getElementById("walletSubtitle"),
    walletEmpty: document.getElementById("walletEmpty"),
    walletEmptyMapBtn: document.getElementById("walletEmptyMapBtn"),
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
    cafeModalLogoWrap: document.getElementById("cafeModalLogoWrap"),
    cafeModalLogo: document.getElementById("cafeModalLogo"),
    cafeModalMetaRow: document.getElementById("cafeModalMetaRow"),
    cafeModalStatus: document.getElementById("cafeModalStatus"),
    cafeModalRewardCycle: document.getElementById("cafeModalRewardCycle"),
    cafeModalRewardHint: document.getElementById("cafeModalRewardHint"),
    cafeModalAbout: document.getElementById("cafeModalAbout"),
    cafeModalAboutEmpty: document.getElementById("cafeModalAboutEmpty"),
    cafeModalLinks: document.getElementById("cafeModalLinks"),
    cafeModalWebsite: document.getElementById("cafeModalWebsite"),
    cafeModalInstagram: document.getElementById("cafeModalInstagram"),
    cafeModalAddBtn: document.getElementById("cafeModalAddBtn"),
    cafeModalWalletBtn: document.getElementById("cafeModalWalletBtn"),
    cafeModalQrBtn: document.getElementById("cafeModalQrBtn"),
  };

  var apiBase =
    location.protocol === "file:"
      ? "http://127.0.0.1:3000"
      : location.origin + "/api";

  var session = null;
  var authMode = "login";

  var toastState = {
    el: null,
    t: 0,
  };

  var sseState = {
    es: null,
    retryT: 0,
    lastToastAt: 0,
  };

  var cafesByCafeAddress = {};

  // Incremented whenever cafe metadata is refreshed.
  var cafesVersion = 0;

  var cafes = [];
  var cafesLoaded = false;
  var walletServerCardsByCafe = {};
  var walletServerCardsDigest = "";

  var leafletMap = null;
  var leafletMarkers = [];
  var pickedCafe = null;
  var mapInitTimer = 0;
  var mapInitAttempts = 0;
  var mapHasAskedForLocation = false;
  var mapUserMarker = null;
  var mapLastKnownCenter = null;

  var walletState = {
    stackDrag: null,
    ignoreClickUntil: 0,
    dragRaf: 0,
    dragTx: 0,
    dragTy: 0,
    dragRz: 0,
    dragRy: 0,
    dragOp: 1,
    dragTxCur: 0,
    dragTyCur: 0,
    dragRzCur: 0,
    dragRyCur: 0,
    dragOpCur: 1,

    // Wallet render cache (avoid rebuilding DOM on every tab switch)
    lastFavKey: "",
    lastCardCount: 0,
    lastCafesVersion: 0,
    lastStampIconOk: false,
    lastServerCardsDigest: "",

    // Stamp refresh throttling
    stampsRefreshTimer: 0,
    stampsRefreshQueuedAt: 0,
    stampsLastRunAt: 0,
    stampsInFlight: {},
    overlayOpen: false,
  };

  var rewardCelebrationState = {
    host: null,
    timer: 0,
    prefersReducedMotion:
      !!(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ),
  };

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function clamp(v, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function ensureRewardCelebrationHost() {
    if (rewardCelebrationState.host) return rewardCelebrationState.host;
    try {
      var host = document.createElement("div");
      host.className = "rewardBalloons";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
      rewardCelebrationState.host = host;
    } catch (e) {
      rewardCelebrationState.host = null;
    }
    return rewardCelebrationState.host;
  }

  function launchRewardCelebration() {
    if (rewardCelebrationState.prefersReducedMotion) return;
    var host = ensureRewardCelebrationHost();
    if (!host) return;

    try {
      host.innerHTML = "";
      host.classList.add("active");
    } catch (e0) {}

    var colors = ["#f2c94c", "#e58f65", "#d66853", "#6b452c", "#8fb996", "#d7b98e"];
    for (var i = 0; i < 14; i++) {
      var balloon = document.createElement("span");
      balloon.className = "rewardBalloon";
      balloon.style.left = 4 + i * 7 + Math.random() * 6 + "%";
      balloon.style.animationDelay = (Math.random() * 0.45).toFixed(2) + "s";
      balloon.style.animationDuration = (4.6 + Math.random() * 1.4).toFixed(2) + "s";
      balloon.style.setProperty("--balloon-color", colors[i % colors.length]);
      balloon.style.setProperty(
        "--balloon-drift",
        (Math.random() * 90 - 45).toFixed(0) + "px",
      );
      balloon.style.setProperty(
        "--balloon-scale",
        (0.86 + Math.random() * 0.42).toFixed(2),
      );
      host.appendChild(balloon);
    }

    try {
      window.clearTimeout(rewardCelebrationState.timer);
    } catch (e1) {}
    rewardCelebrationState.timer = window.setTimeout(function () {
      try {
        host.classList.remove("active");
        host.innerHTML = "";
      } catch (e2) {}
    }, 6200);
  }

  function launchRedeemCelebration() {
    if (rewardCelebrationState.prefersReducedMotion) return;
    var host = ensureRewardCelebrationHost();
    if (!host) return;

    try {
      host.innerHTML = "";
      host.classList.add("active", "isRedeem");
    } catch (e0) {}

    for (var i = 0; i < 20; i++) {
      var burst = document.createElement("span");
      burst.className = i % 4 === 0 ? "rewardSpark" : "rewardBean";
      burst.style.left = 16 + Math.random() * 68 + "%";
      burst.style.top = 26 + Math.random() * 24 + "%";
      burst.style.animationDelay = (Math.random() * 0.18).toFixed(2) + "s";
      burst.style.animationDuration = (1.6 + Math.random() * 0.9).toFixed(2) + "s";
      burst.style.setProperty(
        "--burst-x",
        (Math.random() * 320 - 160).toFixed(0) + "px",
      );
      burst.style.setProperty(
        "--burst-y",
        (-140 - Math.random() * 180).toFixed(0) + "px",
      );
      burst.style.setProperty(
        "--burst-rot",
        (Math.random() * 420 - 210).toFixed(0) + "deg",
      );
      burst.style.setProperty(
        "--burst-scale",
        (0.8 + Math.random() * 0.7).toFixed(2),
      );
      host.appendChild(burst);
    }

    try {
      window.clearTimeout(rewardCelebrationState.timer);
    } catch (e1) {}
    rewardCelebrationState.timer = window.setTimeout(function () {
      try {
        host.classList.remove("active", "isRedeem");
        host.innerHTML = "";
      } catch (e2) {}
    }, 3200);
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

  function dedupeCafes(list) {
    var src = Array.isArray(list) ? list : [];
    var out = [];
    var seen = {};
    for (var i = 0; i < src.length; i++) {
      var c = src[i] || {};
      var id = c.id != null ? String(c.id) : "";
      var addr = normalizeAddr(c.cafeAddress || c.address);
      var lat = c.lat != null ? String(c.lat) : "";
      var lng = c.lng != null ? String(c.lng) : "";
      var name = c.name != null ? String(c.name) : "";

      // Prefer stable ids; otherwise fall back to address; otherwise lat/lng+name.
      var key = id
        ? "id:" + id
        : addr
          ? "addr:" + addr
          : "pos:" + lat + "," + lng + ":" + name;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(c);
    }
    return out;
  }

  function randomHex(bytesLen) {
    var n = Math.max(8, Math.min(64, Number(bytesLen || 16) || 16));
    try {
      var bytes = new Uint8Array(n);
      var c =
        (window.crypto || window.msCrypto) &&
        (window.crypto || window.msCrypto).getRandomValues
          ? window.crypto || window.msCrypto
          : null;
      if (c) c.getRandomValues(bytes);
      else {
        for (var i = 0; i < bytes.length; i++)
          bytes[i] = (Math.random() * 256) | 0;
      }
      var out = "";
      for (var j = 0; j < bytes.length; j++) {
        out += bytes[j].toString(16).padStart(2, "0");
      }
      return out;
    } catch (e) {
      // Best-effort fallback
      var s = "";
      for (var k = 0; k < 32; k++) s += ((Math.random() * 16) | 0).toString(16);
      return s;
    }
  }

  function shortAddr(a) {
    var s = String(a || "");
    if (!s) return "";
    if (s.length <= 14) return s;
    return s.slice(0, 6) + "?" + s.slice(-4);
  }

  function formatTs(ts) {
    try {
      var n = Number(ts);
      if (!isFinite(n) || !n) return "";
      return new Date(n).toLocaleString();
    } catch (e) {
      return "";
    }
  }

  function setBootOk() {
    try {
      window.__STAMP_BOOT_OK = true;
      window.dispatchEvent(new CustomEvent("stamp:boot-ok"));
    } catch (e) {}
  }

  function setBuildBadge() {}

  function setLiveConnected(isConnected) {
    if (!el.liveBadge) return;
    try {
      if (isConnected) {
        el.liveBadge.textContent = "Live";
        el.liveBadge.style.display = "inline-flex";
      } else {
        el.liveBadge.style.display = "none";
      }
    } catch (e) {}
  }

  function clearRedeemTokenForCafe(cafeAddress) {
    if (!session || !session.address) return;
    var key =
      normalizeAddr(session.address) + "|" + normalizeAddr(cafeAddress || "");
    try {
      if (redeemTokenState && redeemTokenState.byKey)
        delete redeemTokenState.byKey[key];
    } catch (e) {}
  }

  function showMsg(kind, text) {
    if (!el.authMsg) return;
    el.authMsg.style.display = "block";
    el.authMsg.className = "notice" + (kind === "danger" ? " danger" : "");
    el.authMsg.textContent = String(text || "");
  }

  function showToast(text, kind) {
    var msg = String(text || "").trim();
    if (!msg) return;
    try {
      if (!toastState.el) {
        var node = document.createElement("div");
        node.id = "customerToast";
        node.className = "notice";
        node.style.display = "none";
        document.body.appendChild(node);
        toastState.el = node;
      }
      if (!toastState.el) return;
      var k = "";
      if (kind === true) k = "danger";
      else if (kind === false || kind == null) k = "";
      else if (typeof kind === "string") k = String(kind || "").trim();
      toastState.el.className = "notice" + (k ? " " + k : "");
      toastState.el.textContent = msg;
      toastState.el.style.display = "block";
      try {
        if (toastState.t) window.clearTimeout(toastState.t);
      } catch (e0) {}
      toastState.t = window.setTimeout(function () {
        toastState.t = 0;
        try {
          if (toastState.el) toastState.el.style.display = "none";
        } catch (e1) {}
      }, 2600);
    } catch (e) {}
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

    if (el.authForgotToggle)
      el.authForgotToggle.style.display =
        authMode === "login" ? "inline-flex" : "none";
    if (authMode !== "login") {
      if (el.authForgotPanel) el.authForgotPanel.style.display = "none";
      if (el.authForgotMsg) {
        el.authForgotMsg.style.display = "none";
        el.authForgotMsg.textContent = "";
        el.authForgotMsg.className = "notice";
      }
    }

    if (el.password) {
      el.password.autocomplete =
        authMode === "register" ? "new-password" : "current-password";
    }
  }

  function setAuthedUI() {
    var isAuthed = !!(session && session.address);
    if (el.authPanel) el.authPanel.style.display = isAuthed ? "none" : "block";
    if (el.mainPanel) el.mainPanel.style.display = isAuthed ? "block" : "none";
    if (el.bottomTabs) el.bottomTabs.style.display = isAuthed ? "" : "none";
    if (el.layoutGrid) el.layoutGrid.classList.toggle("authed", isAuthed);
    if (!isAuthed) closeWalletOverlay({ silent: true });
    if (el.topUtilityBtn) {
      el.topUtilityBtn.style.display = isAuthed ? "" : "none";
    }
    if (!isAuthed) setShellMenuOpen(false);

    if (el.welcomeBadge && isAuthed) {
      var uname = session.username || session.email || "";
      el.welcomeBadge.textContent = uname
        ? "Willkommen, " + uname
        : "Willkommen";
    }
    if (isAuthed) updateWelcomeUI();
    if (el.addressLine) {
      el.addressLine.style.display = "none";
      el.addressLine.textContent = "";
    }
  }

  function navSetActive(which) {
    var w = which || "map";
    if (el.bottomModeWallet)
      el.bottomModeWallet.classList.toggle("active", w === "wallet");
    if (el.mainModeMap) el.mainModeMap.classList.toggle("active", w === "map");
    if (el.mainModeWallet)
      el.mainModeWallet.classList.toggle("active", w === "wallet");
    if (el.mainModeHistory)
      el.mainModeHistory.classList.toggle("active", w === "history");
  }

  function updateWelcomeUI() {
    var uname = "";
    try {
      uname = String((session && (session.username || session.email)) || "").trim();
    } catch (e) {
      uname = "";
    }
    var favCount = 0;
    try {
      favCount = getFavorites().length;
    } catch (eFav) {
      favCount = 0;
    }
    if (el.welcomeTitle) {
      el.welcomeTitle.textContent = uname ? "Hallo, " + uname + " ☕" : "Hallo ☕";
    }
    if (el.welcomeLead) {
      el.welcomeLead.textContent =
        favCount > 0
          ? "Willkommen zur\u00fcck. Deine Karten sind bereit f\u00fcr den n\u00e4chsten Kaffee."
          : "Hol dir deine erste Kaffeekarte und sammle deinen n\u00e4chsten Stempel digital.";
    }
    if (el.welcomeCardCount) {
      el.welcomeCardCount.textContent = String(favCount || 0);
    }
    if (el.welcomeStateTitle) {
      el.welcomeStateTitle.textContent = favCount > 0 ? "QR zeigen" : "Caf\u00e9s entdecken";
    }
    if (el.welcomeNextHint) {
      el.welcomeNextHint.textContent =
        favCount > 0
          ? "Dein n\u00e4chster Stempel ist nur einen Scan entfernt."
          : "\u00d6ffne Caf\u00e9s im Men\u00fc oben rechts und hol dir deine erste digitale Kaffeekarte.";
    }
    if (el.welcomePrimaryAction) {
      el.welcomePrimaryAction.textContent =
        favCount > 0 ? "In Wallet \u00f6ffnen" : "Caf\u00e9s entdecken";
    }
    renderWelcomeCards();
  }

  function renderWelcomeCards() {
    if (!el.welcomeCardsList || !el.welcomeCardsEmpty) return;

    var favorites = [];
    try {
      favorites = getFavorites();
    } catch (eFav) {
      favorites = [];
    }

    var favNorm = [];
    for (var i = 0; i < favorites.length; i++) {
      var addr = normalizeAddr(favorites[i]);
      if (!addr) continue;
      favNorm.push(addr);
    }

    el.welcomeCardsList.innerHTML = "";

    if (!favNorm.length) {
      el.welcomeCardsEmpty.style.display = "block";
      return;
    }

    el.welcomeCardsEmpty.style.display = "none";

    var frag = document.createDocumentFragment();
    for (var j = 0; j < favNorm.length; j++) {
      var cafeAddress = favNorm[j];
      var cafe = cafesByCafeAddress[cafeAddress] || null;
      var serverCard = getServerCard(cafeAddress);
      var serverStats = serverCard && serverCard.stats ? serverCard.stats : {};
      var meta = resolveCafeDisplayMeta(cafeAddress, serverCard, cafe);
      var rewardThreshold = serverCard
        ? getCardRewardThreshold(serverCard)
        : cafe
          ? getCardRewardThreshold(cafe)
          : REWARD_THRESHOLD;
      var rewardLabel = "";
      try {
        rewardLabel = String(
          (serverCard && (serverCard.rewardDescription || serverCard.reward)) ||
            (cafe && (cafe.rewardDescription || cafe.reward)) ||
            "",
        ).trim();
      } catch (eReward) {
        rewardLabel = "";
      }
      var stampCount =
        Number(serverStats.netStamps || (serverCard && serverCard.netStamps) || 0) || 0;
      var isFull = stampCount >= rewardThreshold;
      var remaining = Math.max(
        0,
        rewardThreshold - clamp(stampCount, 0, rewardThreshold),
      );
      var countLine = formatStampCountLine(stampCount, rewardThreshold, Math.max(0, stampCount - rewardThreshold));
      var article = document.createElement("article");
      article.className = "welcomePreviewCard";

      var head = document.createElement("div");
      head.className = "welcomePreviewHead";

      var logoWrap = document.createElement("div");
      logoWrap.className = "welcomePreviewLogo";
      logoWrap.setAttribute("data-cafe-name", meta.name);
      if (cafe && cafe.logoDataUrl) {
        var img = document.createElement("img");
        img.src = String(cafe.logoDataUrl);
        img.alt = "";
        img.decoding = "async";
        img.loading = "lazy";
        img.addEventListener("error", function () {
          try {
            var parent = this.parentNode;
            var cafeName = parent
              ? String(parent.getAttribute("data-cafe-name") || "Kaffeekarte")
              : "Kaffeekarte";
            if (parent) {
              parent.innerHTML = "";
              parent.appendChild(buildPassLogoFallback(cafeName));
            }
          } catch (eLogo) {}
        });
        logoWrap.appendChild(img);
      } else {
        logoWrap.appendChild(buildPassLogoFallback(meta.name));
      }

      var metaWrap = document.createElement("div");
      metaWrap.className = "welcomePreviewMeta";

      var title = document.createElement("div");
      title.className = "welcomePreviewTitle";
      title.textContent = meta.name;

      var count = document.createElement("div");
      count.className = "welcomePreviewCount";
      count.textContent = countLine;

      metaWrap.appendChild(title);
      metaWrap.appendChild(count);
      head.appendChild(logoWrap);
      head.appendChild(metaWrap);

      var message = document.createElement("div");
      message.className = "welcomePreviewMessage";
      message.textContent = formatRewardProgressLine(remaining, isFull, rewardLabel);

      var track = document.createElement("div");
      track.className = "welcomePreviewTrack";
      var fill = document.createElement("div");
      fill.className = "welcomePreviewFill";
      fill.style.width = String(
        Math.max(0, Math.min(100, (Math.min(stampCount, rewardThreshold) / rewardThreshold) * 100)),
      ) + "%";
      track.appendChild(fill);

      var footer = document.createElement("div");
      footer.className = "welcomePreviewFooter";

      var hint = document.createElement("div");
      hint.className = "welcomePreviewHint";
      hint.textContent = formatNextStampLine(remaining, isFull);

      var btn = document.createElement("button");
      btn.className = "btn secondary welcomePreviewBtn";
      btn.type = "button";
      btn.textContent = "QR zeigen";
      btn.addEventListener("click", (function (addr) {
        return function (ev) {
          try {
            ev.preventDefault();
            ev.stopPropagation();
          } catch (e) {}
          openWalletForCafe(addr, { ensureFavorite: true, showQr: true });
        };
      })(cafeAddress));

      footer.appendChild(hint);
      footer.appendChild(btn);

      article.appendChild(head);
      article.appendChild(message);
      article.appendChild(track);
      article.appendChild(footer);

      article.addEventListener("click", (function (addr) {
        return function () {
          openWalletForCafe(addr, { ensureFavorite: true, showQr: false });
        };
      })(cafeAddress));

      frag.appendChild(article);
    }

    el.welcomeCardsList.appendChild(frag);
  }

  function setWalletOverlayOpen(open) {
    var next = !!open;
    walletState.overlayOpen = next;
    try {
      if (el.walletOverlayBackdrop)
        el.walletOverlayBackdrop.classList.toggle("open", next);
      if (el.walletOverlay)
        el.walletOverlay.classList.toggle("open", next);
      if (el.walletOverlay)
        el.walletOverlay.setAttribute("aria-hidden", next ? "false" : "true");
      document.body.classList.toggle("walletOverlayOpen", next);
      document.documentElement.classList.toggle("walletMode", next);
    } catch (e) {}
  }

  function openWalletOverlay() {
    closeQrSheet();
    refreshWallet();
    setWalletOverlayOpen(true);
    navSetActive("wallet");
    window.setTimeout(function () {
      try {
        closeAllPasses();
        centerWalletPrimaryCard();
      } catch (e0) {}
    }, 24);
  }

  function closeWalletOverlay(opts) {
    var o = opts || {};
    closeQrSheet();
    try {
      if (el.walletList) {
        var cards = el.walletList.querySelectorAll(".passCard.open");
        for (var i = 0; i < cards.length; i++) {
          closePass(cards[i]);
        }
      }
    } catch (e0) {}
    setWalletOverlayOpen(false);
    if (o.silent) return;
    if (currentPageMode === "wallet") {
      navigateToMode("welcome");
      return;
    }
    navSetActive(currentPageMode === "wallet" ? "wallet" : "");
  }

  function closeAllPasses(exceptEl) {
    try {
      if (!el.walletList) return;
      var cards = el.walletList.querySelectorAll(".passCard.open, .passCard.isFocused");
      for (var i = 0; i < cards.length; i++) {
        if (exceptEl && cards[i] === exceptEl) continue;
        closePass(cards[i]);
      }
    } catch (e) {}
  }

  function focusPass(passEl) {
    if (!passEl) return;
    closeAllPasses(passEl);
    try {
      if (passEl.classList) passEl.classList.add("isFocused");
      if (passEl.scrollIntoView) {
        passEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    } catch (e) {}
  }

  function centerWalletPrimaryCard() {
    try {
      if (!el.walletList) return;
      var target =
        el.walletList.querySelector(".passCard.isFocused") ||
        el.walletList.querySelector(".passCard.open") ||
        el.walletList.querySelector(".passCard");
      if (!target || !target.scrollIntoView) return;
      target.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "center",
      });
    } catch (e) {}
  }

  function setShellMenuOpen(open) {
    shellMenuState.open = !!open;
    try {
      if (el.utilityMenu) el.utilityMenu.classList.toggle("open", shellMenuState.open);
      if (el.topUtilityBtn)
        el.topUtilityBtn.setAttribute("aria-expanded", shellMenuState.open ? "true" : "false");
    } catch (e) {}
  }

  function wireShellMenu() {
    if (el.topUtilityBtn) {
      el.topUtilityBtn.addEventListener("click", function () {
        setShellMenuOpen(!shellMenuState.open);
      });
    }
    if (el.utilityMapBtn) {
      el.utilityMapBtn.addEventListener("click", function () {
        setShellMenuOpen(false);
        navigateToMode("map");
      });
    }
    if (el.utilityHistoryBtn) {
      el.utilityHistoryBtn.addEventListener("click", function () {
        setShellMenuOpen(false);
        navigateToMode("history");
      });
    }
    if (el.utilityAccountBtn) {
      el.utilityAccountBtn.addEventListener("click", function () {
        setShellMenuOpen(false);
        location.href = "/customer-profile";
      });
    }
    if (el.utilityLogoutBtn) {
      el.utilityLogoutBtn.addEventListener("click", function () {
        setShellMenuOpen(false);
        if (!window.confirm("Moechtest du dich wirklich ausloggen?")) return;
        clearSession();
        disconnectEventsStream();
        if (el.walletList) el.walletList.innerHTML = "";
        setWalletEmptyVisible(true);

        try {
          walletState.lastFavKey = "";
          walletState.lastCardCount = 0;
          walletState.lastCafesVersion = 0;
          walletState.lastStampIconOk = false;
          walletState.lastServerCardsDigest = "";
        } catch (e0) {}
        try {
          if (walletState.stampsRefreshTimer)
            window.clearTimeout(walletState.stampsRefreshTimer);
        } catch (e1) {}
        setAuthedUI();
        setAuthMode("login");
        try {
          history.replaceState({ mode: "welcome" }, "", "/wallet");
        } catch (e2) {}
        currentPageMode = null;
        applyPageMode("welcome");
      });
    }
    if (el.qrSheetBackdrop) {
      el.qrSheetBackdrop.addEventListener("click", function () {
        closeQrSheet();
      });
    }
    if (el.qrSheetClose) {
      el.qrSheetClose.addEventListener("click", function () {
        closeQrSheet();
      });
    }
    try {
      document.addEventListener("keydown", function (ev) {
        if (ev && (ev.key === "Escape" || ev.key === "Esc")) {
          if (qrSheetState.open) {
            closeQrSheet();
            return;
          }
          if (shellMenuState.open) {
            setShellMenuOpen(false);
            return;
          }
          closeQrSheet();
        }
      });
    } catch (e4) {}
    try {
      document.addEventListener("click", function (ev) {
        var t = ev && ev.target ? ev.target : null;
        if (!t) return;

        if (shellMenuState.open) {
          if (el.utilityMenu && el.utilityMenu.contains(t)) return;
          if (el.topUtilityBtn && el.topUtilityBtn.contains(t)) return;
          setShellMenuOpen(false);
        }

        if (!walletState.overlayOpen || !el.walletList) return;
        if (qrSheetState.open) return;

        try {
          var openPass = el.walletList.querySelector(
            ".passCard.open, .passCard.isFocused",
          );
          if (!openPass) return;
          if (openPass.contains(t)) return;
          if (
            t.closest &&
            t.closest(
              ".passInfoLink, .passQr, .passQrBox, .walletOverlayClose, #walletEmpty",
            )
          )
            return;
          if (el.walletOverlay && el.walletOverlay.contains(t)) {
            closeWalletOverlay();
            return;
          }
          closeAllPasses();
        } catch (eWalletClose) {}
      });
    } catch (e5) {}
  }

  function bindBrandLinksToWelcome() {
    try {
      var links = document.querySelectorAll('.kk-brand[href="/wallet"]');
      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener("click", function (ev) {
          try {
            ev.preventDefault();
          } catch (e0) {}
          setShellMenuOpen(false);
          closeWalletOverlay({ silent: true });
          try {
            history.pushState({ mode: "welcome" }, "", "/wallet");
          } catch (e1) {}
          currentPageMode = "welcome";
          applyPageMode("welcome");
        });
      }
    } catch (e) {}
  }

  function getPageMode() {
    if (currentPageMode) return currentPageMode;
    try {
      var stateMode =
        history && history.state && history.state.mode
          ? String(history.state.mode)
          : "";
      if (
        stateMode === "welcome" ||
        stateMode === "map" ||
        stateMode === "wallet" ||
        stateMode === "history"
      )
        return stateMode;
    } catch (eState) {}
    try {
      var p = String(location.pathname || "").toLowerCase();
      var qs = "";
      try {
        qs = String(location.search || "");
      } catch (eQs) {
        qs = "";
      }
      var forceMap = /[?&]view=map(?:&|$)/i.test(qs);
      if (p.indexOf("/customer-map") === 0) {
        if (forceMap) return "map";
        return session && session.address ? "welcome" : "map";
      }
      if (p.indexOf("/customer-history") === 0) return "history";
      if (p.indexOf("/customer-wallet") === 0) return "welcome";
      if (p.indexOf("/customer-qr") === 0) return "welcome";
      if (
        p.indexOf("/customer-home") === 0 ||
        p.indexOf("/customer-start") === 0
      )
        return "welcome";
      if (p === "/wallet" || p === "/wallet/") return "welcome";
      return "welcome";
    } catch (e) {
      return "welcome";
    }
  }

  function getModeHref(mode) {
    var m = mode || "map";
    if (m === "welcome") return "/wallet";
    if (m === "history") return "/customer-history";
    if (m === "wallet") return "/customer-wallet";
    return "/customer-map?view=map";
  }

  function getCustomerVerifyTokenFromUrl() {
    try {
      var u = new URL(location.href);
      return u.searchParams.get("verifyToken") || "";
    } catch (e) {
      return "";
    }
  }

  function clearCustomerVerifyTokenFromUrl() {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has("verifyToken")) return;
      u.searchParams.delete("verifyToken");
      history.replaceState(
        history && history.state ? history.state : null,
        "",
        u.pathname + (u.search ? u.search : "") + (u.hash || ""),
      );
    } catch (e) {}
  }

  function processCustomerVerifyToken() {
    var token = getCustomerVerifyTokenFromUrl();
    if (!token) return Promise.resolve(false);
    return apiFetch("/customers/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token }),
    })
      .then(function () {
        clearCustomerVerifyTokenFromUrl();
        clearSession();
        setAuthedUI();
        setAuthMode("login");
        showMsg(
          "success",
          "Deine E-Mail-Adresse ist jetzt bestaetigt. Du kannst dich direkt anmelden.",
        );
        return true;
      })
      .catch(function (e) {
        clearCustomerVerifyTokenFromUrl();
        clearSession();
        setAuthedUI();
        setAuthMode("login");
        showMsg(
          "danger",
          "Der Bestaetigungslink ist ungueltig oder abgelaufen. Du kannst dir unten direkt einen neuen senden lassen.",
        );
        return false;
      });
  }

  function getAdjacentMode(mode, direction) {
    var order = ["welcome", "map", "wallet", "history"];
    var current = String(mode || "welcome");
    var idx = order.indexOf(current);
    if (idx < 0) idx = 0;
    var next = idx + (direction > 0 ? 1 : -1);
    if (next < 0 || next >= order.length) return null;
    return order[next];
  }

  function getModeIndex(mode) {
    var order = ["welcome", "map", "wallet", "history"];
    var idx = order.indexOf(String(mode || "welcome"));
    return idx < 0 ? 0 : idx;
  }

  function getModeSlide(mode) {
    var target = null;
    if (mode === "welcome") target = el.welcomePanel;
    else if (mode === "history") target = el.historyPanel;
    else target = el.mapPanel;
    try {
      return target && target.closest ? target.closest(".screenSlide") : null;
    } catch (e) {
      return null;
    }
  }

  function navigateToMode(mode) {
    var m = mode || "map";
    var href = getModeHref(m);
    setShellMenuOpen(false);
    try {
      if (location.pathname === href || location.pathname === href + "/") {
        applyPageMode(m);
        return;
      }
    } catch (e) {}
    try {
      history.pushState({ mode: m }, "", href);
      applyPageMode(m);
      return;
    } catch (e2) {}
    try {
      location.href = href;
    } catch (e3) {}
  }

  function buildCafeProfileHref(cafe) {
    // Kept for backwards compatibility (older UI), but we no longer navigate
    // away from the customer app. Details are shown in a modal.
    return null;
  }

  function normalizeExternalUrl(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    if (/^(https?:)?\/\//i.test(value)) {
      return /^\/\//.test(value) ? "https:" + value : value;
    }
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
      return "mailto:" + value;
    }
    return "https://" + value.replace(/^\/+/, "");
  }

  function normalizeInstagramUrl(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    if (/^(https?:)?\/\//i.test(value)) {
      return /^\/\//.test(value) ? "https:" + value : value;
    }
    if (value.charAt(0) === "@") value = value.slice(1).trim();
    if (!value) return "";
    if (/^instagram\.com\//i.test(value)) {
      return "https://" + value;
    }
    if (/^[a-z0-9._]+$/i.test(value)) {
      return "https://instagram.com/" + value;
    }
    return normalizeExternalUrl(value);
  }

  var cafeModalState = {
    open: false,
    cafeId: null,
    cafeAddress: null,
    reqSeq: 0,
  };

  function setCafeModalVisible(show) {
    if (!el.cafeModalBackdrop) return;
    try {
      if (show) {
        el.cafeModalBackdrop.style.display = "flex";
        // Let display apply before starting the transition.
        window.requestAnimationFrame(function () {
          try {
            el.cafeModalBackdrop.classList.add("open");
          } catch (e1) {}
        });
      } else {
        el.cafeModalBackdrop.classList.remove("open");
        // Wait for the transition so the close feels smooth.
        window.setTimeout(function () {
          try {
            if (!cafeModalState.open)
              el.cafeModalBackdrop.style.display = "none";
          } catch (e2) {}
        }, 200);
      }
    } catch (e0) {}
  }

  function closeCafeModal() {
    cafeModalState.open = false;
    cafeModalState.cafeId = null;
    cafeModalState.cafeAddress = null;
    setCafeModalVisible(false);
  }

  function isCafeInWallet(cafeAddr) {
    try {
      var want = normalizeAddr(cafeAddr || "");
      if (!want) return false;
      var fav = getFavorites();
      for (var i = 0; i < fav.length; i++) {
        if (normalizeAddr(fav[i]) === want) return true;
      }
    } catch (e) {}
    return false;
  }

  function openWalletForCafe(cafeAddr, opts) {
    var want = normalizeAddr(cafeAddr || "");
    if (!want) return;
    var o = opts || {};
    try {
      if (o.ensureFavorite && !isCafeInWallet(want)) {
        addFavorite(want);
      }
    } catch (e0) {}
    try {
      refreshWallet();
    } catch (e1) {}
    closeCafeModal();
    openWalletOverlay();

    var attempts = 0;
    var t = window.setInterval(function () {
      attempts++;
      var passEl = findWalletPassCardByCafe(want);
      if (passEl) {
        try {
          focusPass(passEl);
          if (o.showQr) {
            window.setTimeout(function () {
              try {
                openQrSheet(passEl);
              } catch (e2) {}
            }, 120);
          }
        } catch (e3) {}
        try {
          window.clearInterval(t);
        } catch (e4) {}
        return;
      }
      if (attempts > 12) {
        try {
          window.clearInterval(t);
        } catch (e5) {}
      }
    }, 90);
  }

  function pickCafeHeroImage(cafe) {
    try {
      var imgs =
        cafe && cafe.images && Array.isArray(cafe.images) ? cafe.images : [];
      if (imgs.length) return String(imgs[0] || "");
    } catch (e) {}
    try {
      if (cafe && cafe.cardBackgroundDataUrl)
        return String(cafe.cardBackgroundDataUrl || "");
    } catch (e2) {}
    return "";
  }

  function renderCafeModal(cafe, opts) {
    var o = opts || {};
    var name = cafe && cafe.name ? String(cafe.name) : "Caf\u00e9";
    var addr = cafe && cafe.address ? String(cafe.address) : "";
    var about = cafe && cafe.about ? String(cafe.about) : "";
    var program = cafe && cafe.program ? cafe.program : {};
    var rewardThreshold =
      program && program.stampsForReward != null
        ? Number(program.stampsForReward)
        : 10;
    if (!Number.isFinite(rewardThreshold) || rewardThreshold < 1)
      rewardThreshold = 10;
    var rewardDescription =
      program && program.rewardDescription
        ? String(program.rewardDescription).trim()
        : "";
    var websiteUrl = normalizeExternalUrl(
      cafe && cafe.websiteUrl ? String(cafe.websiteUrl).trim() : "",
    );
    var instagramUrl = normalizeInstagramUrl(
      cafe && cafe.instagramUrl ? String(cafe.instagramUrl).trim() : "",
    );
    var cafeAddr = normalizeAddr(
      (cafe && (cafe.cafeAddress || cafe.address)) || "",
    );

    if (el.cafeModalName) el.cafeModalName.textContent = name;
    if (el.cafeModalAddr) el.cafeModalAddr.textContent = addr;
    if (el.cafeModalLogoWrap && el.cafeModalLogo) {
      var logo = cafe && cafe.logoDataUrl ? String(cafe.logoDataUrl) : "";
      if (logo) {
        el.cafeModalLogoWrap.style.display = "grid";
        el.cafeModalLogo.src = logo;
      } else {
        el.cafeModalLogoWrap.style.display = "none";
        try {
          el.cafeModalLogo.removeAttribute("src");
        } catch (eLogo) {}
      }
    }

    if (el.cafeModalLinks && el.cafeModalWebsite && el.cafeModalInstagram) {
      var hasLinks = false;
      if (websiteUrl) {
        el.cafeModalWebsite.style.display = "inline-flex";
        el.cafeModalWebsite.href = websiteUrl;
        hasLinks = true;
      } else {
        el.cafeModalWebsite.style.display = "none";
        el.cafeModalWebsite.href = "#";
      }
      if (instagramUrl) {
        el.cafeModalInstagram.style.display = "inline-flex";
        el.cafeModalInstagram.href = instagramUrl;
        hasLinks = true;
      } else {
        el.cafeModalInstagram.style.display = "none";
        el.cafeModalInstagram.href = "#";
      }
      el.cafeModalLinks.style.display = hasLinks ? "flex" : "none";
    }

    if (
      el.cafeModalMetaRow &&
      el.cafeModalStatus &&
      el.cafeModalRewardCycle &&
      el.cafeModalRewardHint
    ) {
      var alreadyInWallet = isCafeInWallet(cafeAddr);
      el.cafeModalStatus.style.display = "inline-flex";
      el.cafeModalStatus.textContent = alreadyInWallet
        ? "Schon in deiner Wallet"
        : "Neu fuer deine Wallet";
      el.cafeModalRewardCycle.style.display = "inline-flex";
      el.cafeModalRewardCycle.textContent =
        "Jeder " + rewardThreshold + ". Kaffee";
      if (rewardDescription) {
        el.cafeModalRewardHint.style.display = "inline-flex";
        el.cafeModalRewardHint.textContent = rewardDescription;
      } else {
        el.cafeModalRewardHint.style.display = "none";
        el.cafeModalRewardHint.textContent = "";
      }
      el.cafeModalMetaRow.style.display = "flex";
    }

    // About text
    if (el.cafeModalAbout) {
      if (about) {
        el.cafeModalAbout.style.display = "block";
        el.cafeModalAbout.textContent = about;
        if (el.cafeModalAboutEmpty)
          el.cafeModalAboutEmpty.style.display = "none";
      } else {
        el.cafeModalAbout.style.display = "none";
        if (el.cafeModalAboutEmpty)
          el.cafeModalAboutEmpty.style.display = o.loading ? "none" : "block";
      }
    }

    // Images / gallery
    var hero = pickCafeHeroImage(cafe);
    if (el.cafeModalImageWrap && el.cafeModalImage) {
      if (hero) {
        el.cafeModalImageWrap.style.display = "grid";
        el.cafeModalImage.src = hero;
      } else {
        el.cafeModalImageWrap.style.display = "none";
        try {
          el.cafeModalImage.removeAttribute("src");
        } catch (e0) {}
      }
    }

    if (el.cafeModalGallery) {
      el.cafeModalGallery.innerHTML = "";
      var imgs2 =
        cafe && cafe.images && Array.isArray(cafe.images)
          ? cafe.images.slice(0)
          : [];
      if (imgs2.length > 1) {
        el.cafeModalGallery.style.display = "flex";
        for (var i = 0; i < Math.min(6, imgs2.length); i++) {
          (function (src) {
            var img = document.createElement("img");
            img.className = "modalThumb";
            img.alt = "";
            img.loading = "lazy";
            img.decoding = "async";
            img.src = String(src || "");
            img.addEventListener("click", function () {
              if (el.cafeModalImage && el.cafeModalImageWrap) {
                el.cafeModalImageWrap.style.display = "grid";
                el.cafeModalImage.src = String(src || "");
              }
            });
            el.cafeModalGallery.appendChild(img);
          })(imgs2[i]);
        }
      } else {
        el.cafeModalGallery.style.display = "none";
      }
    }

    // Action button state
    if (el.cafeModalAddBtn) {
      var already = isCafeInWallet(cafeAddr);
      el.cafeModalAddBtn.style.display = already ? "none" : "inline-flex";
      el.cafeModalAddBtn.disabled = !cafeAddr;
      el.cafeModalAddBtn.textContent = "Stempelkarte holen";
    }
    if (el.cafeModalWalletBtn) {
      var already2 = isCafeInWallet(cafeAddr);
      el.cafeModalWalletBtn.style.display = already2 ? "inline-flex" : "none";
      el.cafeModalWalletBtn.disabled = !already2 || !cafeAddr;
    }
    if (el.cafeModalQrBtn) {
      var already3 = isCafeInWallet(cafeAddr);
      el.cafeModalQrBtn.style.display = already3 ? "inline-flex" : "none";
      el.cafeModalQrBtn.disabled = !already3 || !cafeAddr;
    }
  }

  function openCafeModal(cafe) {
    if (!cafe) return;
    var cafeAddr = normalizeAddr(cafe.cafeAddress || cafe.address || "");
    cafeModalState.open = true;
    cafeModalState.cafeId = cafe.id != null ? Number(cafe.id) : null;
    cafeModalState.cafeAddress = cafeAddr || null;

    // Render immediately with what we have.
    renderCafeModal(
      {
        id: cafe.id,
        name: cafe.name,
        address: cafe.address,
        cafeAddress: cafe.cafeAddress,
        about: cafe.about || "",
        program: cafe.program || null,
        websiteUrl: cafe.websiteUrl || "",
        instagramUrl: cafe.instagramUrl || "",
        logoDataUrl: cafe.logoDataUrl || null,
        cardBackgroundDataUrl: cafe.cardBackgroundDataUrl || null,
        images: cafe.images || null,
      },
      { loading: true },
    );

    setCafeModalVisible(true);

    // Fetch full profile (nicer about + images) if we have an id.
    var id = cafeModalState.cafeId;
    if (!id || !Number.isFinite(id)) return;
    var seq = ++cafeModalState.reqSeq;
    apiFetch("/cafes/public/" + encodeURIComponent(String(id)))
      .then(function (data) {
        if (!cafeModalState.open || cafeModalState.reqSeq !== seq) return;
        var c = data && data.cafe ? data.cafe : null;
        if (!c) return;
        renderCafeModal(c, { loading: false });
      })
      .catch(function () {
        // non-fatal
      });
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
      empty.className = "mapEmpty";
      empty.textContent = q
        ? "Keine Treffer. Vielleicht \u00fcbt sich das richtige Caf\u00e9 gerade noch in Understatement."
        : "Noch keine Caf\u00e9s.";
      el.cafeResults.appendChild(empty);
      return;
    }

    var max = Math.min(20, list.length);
    for (var i = 0; i < max; i++) {
      (function (cafe) {
        var a = document.createElement("a");
        a.className = "mapItem";
        a.href = "#";

        var main = document.createElement("div");
        main.className = "mapItemMain";

        var name = document.createElement("div");
        name.className = "mapItemName";
        name.textContent = cafe && cafe.name ? String(cafe.name) : "Caf\u00e9";

        var addr = document.createElement("div");
        addr.className = "mapItemAddr";
        addr.textContent = cafe && cafe.address ? String(cafe.address) : "";

        main.appendChild(name);
        if (addr.textContent) main.appendChild(addr);

        var hint = document.createElement("div");
        hint.className = "mapItemHint";
        hint.textContent = "\u00d6ffnen";

        a.appendChild(main);
        a.appendChild(hint);
        a.addEventListener("click", function (ev) {
          try {
            ev.preventDefault();
          } catch (e) {}
          openCafeModal(cafe);
        });

        el.cafeResults.appendChild(a);
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
    currentPageMode = m;
    navSetActive(m === "wallet" ? "wallet" : m);

    try {
      var welcomeSlide = getModeSlide("welcome");
      var mapSlide = getModeSlide("map");
      var historySlide = getModeSlide("history");
      if (welcomeSlide) welcomeSlide.style.display = m === "welcome" ? "block" : "none";
      if (mapSlide) mapSlide.style.display = m === "map" ? "block" : "none";
      if (historySlide) historySlide.style.display = m === "history" ? "block" : "none";
      if (el.screenPager) {
        el.screenPager.scrollLeft = 0;
      }
    } catch (eScroll) {}

    if (m === "history") {
      closeWalletOverlay({ silent: true });
      refreshHistory();
      return;
    }

    if (m === "wallet") {
      openWalletOverlay();
      return;
    }

    closeWalletOverlay({ silent: true });

    if (m === "welcome") {
      return;
    }

    if (m === "map") {
      ensureMapInit();
      requestCurrentMapLocation();
      try {
        if (leafletMap) {
          try {
            if (leafletMap.dragging && leafletMap.dragging.enable)
              leafletMap.dragging.enable();
            if (leafletMap.touchZoom && leafletMap.touchZoom.enable)
              leafletMap.touchZoom.enable();
            if (leafletMap.doubleClickZoom && leafletMap.doubleClickZoom.enable)
              leafletMap.doubleClickZoom.enable();
            if (leafletMap.scrollWheelZoom && leafletMap.scrollWheelZoom.enable)
              leafletMap.scrollWheelZoom.enable();
            if (leafletMap.boxZoom && leafletMap.boxZoom.enable)
              leafletMap.boxZoom.enable();
            if (leafletMap.tap && leafletMap.tap.enable)
              leafletMap.tap.enable();
          } catch (eEnable0) {}
          window.setTimeout(function () {
            try {
              if (leafletMap) leafletMap.invalidateSize();
            } catch (e0) {}
          }, 40);
        }
      } catch (e1) {}
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

  function getDefaultMapCenter() {
    return [50.9375, 6.9603];
  }

  function readCachedMapCenter() {
    try {
      var raw = localStorage.getItem(MAP_CENTER_CACHE_KEY_V1);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var lat = Number(parsed && parsed.lat);
      var lng = Number(parsed && parsed.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    } catch (e) {
      return null;
    }
  }

  function cacheMapCenter(lat, lng) {
    try {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      localStorage.setItem(
        MAP_CENTER_CACHE_KEY_V1,
        JSON.stringify({
          lat: Number(lat),
          lng: Number(lng),
          ts: Date.now(),
        }),
      );
    } catch (e) {}
  }

  function getPreferredMapCenter() {
    if (
      Array.isArray(mapLastKnownCenter) &&
      mapLastKnownCenter.length === 2 &&
      Number.isFinite(Number(mapLastKnownCenter[0])) &&
      Number.isFinite(Number(mapLastKnownCenter[1]))
    ) {
      return [Number(mapLastKnownCenter[0]), Number(mapLastKnownCenter[1])];
    }
    var cached = readCachedMapCenter();
    if (cached) return cached;
    var firstWithPos = null;
    for (var i = 0; i < cafes.length; i++) {
      var c = cafes[i];
      if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) {
        firstWithPos = c;
        break;
      }
    }
    if (firstWithPos) return [Number(firstWithPos.lat), Number(firstWithPos.lng)];
    return getDefaultMapCenter();
  }

  function getPreferredMapZoom() {
    if (mapLastKnownCenter || readCachedMapCenter()) return 14;
    for (var i = 0; i < cafes.length; i++) {
      var c = cafes[i];
      if (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) {
        return 13;
      }
    }
    return 12;
  }

  function isAddressLike(value) {
    var s = String(value || "").trim();
    if (!s) return false;
    if (/^0x[0-9a-f]{12,}$/i.test(s)) return true;
    if (/^[0-9a-f]{20,}$/i.test(s)) return true;
    return false;
  }

  function getCafeMetaCache() {
    try {
      var raw = localStorage.getItem(CAFE_META_CACHE_KEY_V1);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function setCafeMetaCache(map) {
    try {
      localStorage.setItem(CAFE_META_CACHE_KEY_V1, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function rememberCafeMeta(addr, meta) {
    var key = normalizeAddr(addr || "");
    if (!key) return;
    var name = meta && meta.name ? String(meta.name).trim() : "";
    var address = meta && meta.address ? String(meta.address).trim() : "";
    if (isAddressLike(name)) name = "";
    if (!name && !address) return;
    var map = getCafeMetaCache();
    map[key] = {
      name: name || "",
      address: address || "",
    };
    setCafeMetaCache(map);
  }

  function getRememberedCafeMeta(addr) {
    var key = normalizeAddr(addr || "");
    if (!key) return null;
    try {
      var map = getCafeMetaCache();
      return map && map[key] ? map[key] : null;
    } catch (e) {
      return null;
    }
  }

  function resolveCafeDisplayMeta(addr, serverCard, cafe) {
    var remembered = getRememberedCafeMeta(addr) || {};
    var name = "";
    var address = "";

    if (serverCard && serverCard.name) name = String(serverCard.name || "").trim();
    if (isAddressLike(name)) name = "";
    if (!name && cafe && cafe.name) name = String(cafe.name || "").trim();
    if (isAddressLike(name)) name = "";
    if (!name && remembered && remembered.name) name = String(remembered.name || "").trim();
    if (isAddressLike(name)) name = "";

    if (serverCard && serverCard.address) address = String(serverCard.address || "").trim();
    if (!address && cafe && cafe.address) address = String(cafe.address || "").trim();
    if (!address && remembered && remembered.address)
      address = String(remembered.address || "").trim();

    return {
      name: name || "Kaffeekarte",
      address: address || "",
      loading: !name && !cafesLoaded,
    };
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

  function mergeFavorites(addrs) {
    var src = Array.isArray(addrs) ? addrs : [];
    var cur = getFavorites();
    var changed = false;

    for (var i = 0; i < src.length; i++) {
      var a = normalizeAddr(src[i]);
      if (!a) continue;

      var exists = false;
      for (var j = 0; j < cur.length; j++) {
        if (normalizeAddr(cur[j]) === a) {
          exists = true;
          break;
        }
      }

      if (!exists) {
        cur.push(a);
        changed = true;
      }
    }

    if (changed) setFavorites(cur);
    return changed;
  }

  function getServerCard(cafeAddress) {
    var addr = normalizeAddr(cafeAddress || "");
    if (!addr) return null;
    try {
      return walletServerCardsByCafe && walletServerCardsByCafe[addr]
        ? walletServerCardsByCafe[addr]
        : null;
    } catch (e) {
      return null;
    }
  }

  function getCardProgram(card) {
    return card && card.program ? card.program : {};
  }

  function getCardRewardThreshold(card) {
    var program = getCardProgram(card);
    return clamp(
      Number(program && program.stampsForReward) || REWARD_THRESHOLD,
      1,
      50,
    );
  }

  function getPassRewardThreshold(passEl) {
    if (!passEl) return REWARD_THRESHOLD;
    try {
      var raw = Number(passEl.getAttribute("data-reward-threshold") || "");
      if (Number.isFinite(raw) && raw > 0) {
        return clamp(raw, 1, 50);
      }
    } catch (e0) {}
    try {
      return getCardRewardThreshold(
        getServerCard(passEl.getAttribute("data-cafe") || ""),
      );
    } catch (e1) {
      return REWARD_THRESHOLD;
    }
  }

  function formatStampCountLine(stampCount, rewardThreshold, extra) {
    var threshold = clamp(Number(rewardThreshold || REWARD_THRESHOLD) || REWARD_THRESHOLD, 1, 50);
    var stamps = clamp(Number(stampCount || 0) || 0, 0, 999);
    var base = clamp(stamps, 0, threshold);
    var bonus = Math.max(0, Number(extra || 0) || 0);
    var line = base + " von " + threshold + " Stempeln";
    if (bonus > 0) line += " + " + bonus + " extra";
    return line;
  }

  function formatRewardProgressLine(remaining, isFull, rewardLabel) {
    var hasCustomReward = !!String(rewardLabel || "").trim();
    if (isFull) {
      return hasCustomReward ? "Deine Belohnung wartet ☕" : "Dein Gratiskaffee wartet ☕";
    }
    if (hasCustomReward) {
      return remaining === 1
        ? "Noch 1 Kaffee bis zur Belohnung"
        : "Noch " + remaining + " Kaffees bis zur Belohnung";
    }
    return remaining === 1
      ? "Noch 1 Kaffee bis zum Gratiskaffee"
      : "Noch " + remaining + " Kaffees bis zum Gratiskaffee";
  }

  function formatNextStampLine(remaining, isFull) {
    if (isFull) return "QR zeigen und deine Belohnung im Café einlösen.";
    if (remaining === 1) return "Dein nächster Stempel ist nur einen Scan entfernt.";
    return "Im Café scannen lassen und den nächsten Stempel sammeln.";
  }

  function formatFooterProgressLine(remaining, isFull) {
    if (isFull) return "GRATISKAFFEE WARTET";
    return remaining === 1 ? "NOCH 1 KAFFEE" : "NOCH " + remaining + " KAFFEES";
  }

  function getCampaignSeenMap() {
    try {
      var raw = localStorage.getItem(CAMPAIGN_SEEN_KEY);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function setCampaignSeenMap(map) {
    try {
      localStorage.setItem(CAMPAIGN_SEEN_KEY, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function markCampaignSeen(key) {
    if (!key) return;
    var map = getCampaignSeenMap();
    map[String(key)] = nowMs();
    setCampaignSeenMap(map);
  }

  function wasCampaignSeenRecently(key, ttlMs) {
    if (!key) return false;
    var ttl = Math.max(60 * 1000, Number(ttlMs) || 0);
    var seen = getCampaignSeenMap();
    var ts = Number(seen[String(key)] || 0);
    return !!(ts && nowMs() - ts < ttl);
  }

  function formatCampaignText(template, vars, fallback) {
    var text = String(template || "").trim() || String(fallback || "").trim();
    var data = vars || {};
    return text.replace(/\{(\w+)\}/g, function (_, key) {
      var value = data[key];
      return value == null ? "" : String(value);
    });
  }

  function buildServerCardsDigest(cards) {
    var src = Array.isArray(cards) ? cards : [];
    var parts = [];
    for (var i = 0; i < src.length; i++) {
      var card = src[i] || {};
      var stats = card.stats || {};
      var program = getCardProgram(card);
      parts.push(
        [
          normalizeAddr(card.cafeAddress || ""),
          Number(stats.netStamps || card.netStamps || 0) || 0,
          Number(stats.lastActivityTs || 0) || 0,
          Number(program.stampsForReward || REWARD_THRESHOLD) || REWARD_THRESHOLD,
          Number(program.popupInactiveEnabled || 0) || 0,
          Number(program.popupInactiveDays || 0) || 0,
          Number(program.popupAlmostRewardEnabled || 0) || 0,
          Number(program.popupAlmostRewardRemaining || 0) || 0,
        ].join(":"),
      );
    }
    parts.sort();
    return parts.join("|");
  }

  function evaluateCardCampaigns(cards) {
    if (!session || !session.address) return;
    var src = Array.isArray(cards) ? cards : [];
    for (var i = 0; i < src.length; i++) {
      var card = src[i] || {};
      var stats = card.stats || {};
      var program = getCardProgram(card);
      var cafeAddress = normalizeAddr(card.cafeAddress || "");
      if (!cafeAddress) continue;

      var cafeLabel =
        String(card.name || card.cafeName || "").trim() ||
        String(card.address || "").trim() ||
        "deinem Cafe";
      var rewardGoal = getCardRewardThreshold(card);
      var netStamps = Math.max(
        0,
        Number(stats.netStamps || card.netStamps || 0) || 0,
      );
      var remaining = Math.max(0, rewardGoal - netStamps);
      var lastActivityTs = Number(stats.lastActivityTs || 0) || 0;

      if (
        Number(program.popupAlmostRewardEnabled || 0) &&
        remaining > 0 &&
        remaining <= clamp(Number(program.popupAlmostRewardRemaining) || 2, 1, 10)
      ) {
        var almostKey = [
          normalizeAddr(session.address),
          cafeAddress,
          "almost_reward",
          netStamps,
          rewardGoal,
        ].join("|");
        if (!wasCampaignSeenRecently(almostKey, 24 * 60 * 60 * 1000)) {
          showToast(
            formatCampaignText(
              program.popupAlmostRewardMessage,
              {
                cafe: cafeLabel,
                remaining: remaining,
                stamps: netStamps,
                goal: rewardGoal,
                reward: program.rewardDescription || "deine Belohnung",
              },
              "Nur noch {remaining} Stempel bis zur Belohnung bei {cafe}.",
            ),
            null,
          );
          markCampaignSeen(almostKey);
          return;
        }
      }

      if (
        Number(program.popupInactiveEnabled || 0) &&
        lastActivityTs > 0 &&
        netStamps > 0
      ) {
        var inactiveDays = clamp(Number(program.popupInactiveDays) || 21, 7, 365);
        var silentMs = inactiveDays * 24 * 60 * 60 * 1000;
        var ageMs = nowMs() - lastActivityTs;
        if (ageMs >= silentMs) {
          var ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          var inactiveBucket = Math.floor(ageDays / inactiveDays);
          var inactiveKey = [
            normalizeAddr(session.address),
            cafeAddress,
            "inactive",
            inactiveBucket,
            lastActivityTs,
          ].join("|");
          if (!wasCampaignSeenRecently(inactiveKey, 24 * 60 * 60 * 1000)) {
            showToast(
              formatCampaignText(
                program.popupInactiveMessage,
                {
                  cafe: cafeLabel,
                  days: ageDays,
                  remaining: remaining,
                  goal: rewardGoal,
                  reward: program.rewardDescription || "deine Belohnung",
                },
                "Schon {days} Tage kein Besuch bei {cafe}. Deine Karte wartet noch auf dich.",
              ),
              null,
            );
            markCampaignSeen(inactiveKey);
            return;
          }
        }
      }
    }
  }

  function syncFavoritesFromServerCards() {
    if (!session || !session.address) {
      return Promise.resolve(false);
    }

    return apiFetch(
      "/customers/" + encodeURIComponent(session.address) + "/cards",
    )
      .then(function (data) {
        var cards = data && Array.isArray(data.cards) ? data.cards : [];
        var nextMap = {};
        var addrs = [];
        for (var i = 0; i < cards.length; i++) {
          var card = cards[i] || {};
          var addr = normalizeAddr(card.cafeAddress);
          if (!addr) continue;
          addrs.push(addr);
          nextMap[addr] = card;
          rememberCafeMeta(addr, {
            name: card.name || card.cafeName || "",
            address: card.address || "",
          });
        }
      walletServerCardsByCafe = nextMap;
      var nextDigest = buildServerCardsDigest(cards);
      var digestChanged = nextDigest !== walletServerCardsDigest;
      walletServerCardsDigest = nextDigest;
      evaluateCardCampaigns(cards);
      try {
        if (cards && cards.length) refreshWallet();
      } catch (eR0) {}
      return mergeFavorites(addrs) || digestChanged;
      })
      .catch(function () {
        return false;
      });
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
        cafe && cafe.name ? String(cafe.name) : "Caf\u00e9";
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
    navigateToMode("wallet");
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
      el.mapList.innerHTML = "";
      var empty = document.createElement("div");
      empty.className = "mapEmpty";
      empty.textContent = "Noch keine Caf\u00e9s.";
      el.mapList.appendChild(empty);
      return;
    }

    el.mapList.innerHTML = "";

    var max = Math.min(12, cafes.length);
    for (var i = 0; i < max; i++) {
      (function (cafe) {
        var a = document.createElement("a");
        a.className = "mapItem";
        a.href = "#";

        var main = document.createElement("div");
        main.className = "mapItemMain";

        var name = document.createElement("div");
        name.className = "mapItemName";
        name.textContent = cafe && cafe.name ? String(cafe.name) : "Caf\u00e9";

        var addr = document.createElement("div");
        addr.className = "mapItemAddr";
        addr.textContent = cafe && cafe.address ? String(cafe.address) : "";

        main.appendChild(name);
        if (addr.textContent) main.appendChild(addr);

        var hint = document.createElement("div");
        hint.className = "mapItemHint";
        hint.textContent = "\u00d6ffnen";

        a.appendChild(main);
        a.appendChild(hint);
        a.addEventListener("click", function (ev) {
          try {
            ev.preventDefault();
          } catch (e) {}
          openCafeModal(cafe);
        });
        el.mapList.appendChild(a);
      })(cafes[i]);
    }
  }

  function cafeInitials(name) {
    var s = String(name || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!s) return "C";
    var parts = s.split(" ").filter(Boolean);
    if (parts.length > 1 && /^caf/i.test(parts[0] || "")) parts = parts.slice(1);
    if (!parts.length) parts = ["C"];
    var first = String(parts[0] || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    var second = parts.length > 1 ? String(parts[1] || "") : "";
    first = first.replace(/^[^A-Za-z0-9]+/, "");
    second = second
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^[^A-Za-z0-9]+/, "");
    var out = "";
    if (second) {
      out = (first.charAt(0) + second.charAt(0)).toUpperCase();
    } else {
      out = first.slice(0, 2).toUpperCase();
    }
    return out.slice(0, 2) || "C";
  }

  function buildPassLogoFallback(name) {
    var fallback = document.createElement("div");
    fallback.className = "passLogoInitial";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = cafeInitials(name);
    return fallback;
  }

  function buildCafePinIcon(cafe) {
    try {
      if (!window.L || !window.L.divIcon) return null;
      var logo = cafe && cafe.logoDataUrl ? String(cafe.logoDataUrl) : "";
      var html = "";
      if (logo) {
        html =
          '<div class="cafePin">' +
          '<img class="cafePinImg" alt="" aria-hidden="true" draggable="false" src="' +
          logo.replace(/"/g, "&quot;") +
          '">' +
          "</div>";
      } else {
        html =
          '<div class="cafePin"><div class="cafePinLetter">' +
          cafeInitials(cafe && cafe.name ? cafe.name : "Caf\u00e9") +
          "</div></div>";
      }

      return window.L.divIcon({
        className: "",
        html: html,
        // 40x40 head + 10px pointer = 50px total height
        iconSize: [40, 50],
        iconAnchor: [20, 50],
      });
    } catch (e) {
      return null;
    }
  }

  function syncMapMarkers() {
    if (!leafletMap || !window.L || !window.L.marker) return;
    try {
      if (leafletMarkers && leafletMarkers.length) {
        for (var i = 0; i < leafletMarkers.length; i++) {
          try {
            leafletMarkers[i].remove();
          } catch (e0) {}
        }
      }
    } catch (e1) {}
    leafletMarkers = [];

    for (var j = 0; j < cafes.length; j++) {
      var cafe = cafes[j];
      if (!cafe || !Number.isFinite(Number(cafe.lat)) || !Number.isFinite(Number(cafe.lng))) {
        continue;
      }
      (function (cafe2) {
        var icon = buildCafePinIcon(cafe2);
        var marker = window.L.marker(
          [Number(cafe2.lat), Number(cafe2.lng)],
          icon ? { icon: icon } : undefined,
        );
        marker.addTo(leafletMap);
        marker.on("click", function (ev) {
          try {
            if (ev && ev.originalEvent) {
              if (ev.originalEvent.preventDefault)
                ev.originalEvent.preventDefault();
              if (ev.originalEvent.stopPropagation)
                ev.originalEvent.stopPropagation();
            }
          } catch (eStop0) {}
          walletState.ignoreClickUntil = nowMs() + 420;
          openCafeModal(cafe2);
        });
        leafletMarkers.push(marker);
      })(cafe);
    }
  }

  function ensureUserLocationMarker(lat, lng) {
    if (!leafletMap || !window.L || !window.L.circleMarker) return;
    try {
      if (!mapUserMarker) {
        mapUserMarker = window.L.circleMarker([lat, lng], {
          radius: 8,
          weight: 3,
          color: "#fffaf2",
          fillColor: "#5b7cfa",
          fillOpacity: 0.95,
        }).addTo(leafletMap);
      } else {
        mapUserMarker.setLatLng([lat, lng]);
      }
    } catch (e) {}
  }

  function requestCurrentMapLocation() {
    if (mapHasAskedForLocation) return;
    mapHasAskedForLocation = true;
    try {
      if (!navigator.geolocation || !leafletMap) return;
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          try {
            var lat = Number(pos && pos.coords && pos.coords.latitude);
            var lng = Number(pos && pos.coords && pos.coords.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !leafletMap) return;
            mapLastKnownCenter = [lat, lng];
            cacheMapCenter(lat, lng);
            ensureUserLocationMarker(lat, lng);
            leafletMap.setView([lat, lng], Math.max(leafletMap.getZoom(), 14), {
              animate: true,
            });
          } catch (e1) {}
        },
        function () {},
        {
          enableHighAccuracy: false,
          timeout: 4500,
          maximumAge: 300000,
        },
      );
    } catch (e) {}
  }

  function initMapIfReady() {
    if (!el.cafeMap) return false;
    if (leafletMap) return true;
    if (!window.L || !window.L.map) return false;
    var center = getPreferredMapCenter();
    var zoom = getPreferredMapZoom();

    try {
      leafletMap = window.L.map(el.cafeMap, {
        zoomControl: false,
        attributionControl: false,
      }).setView(center, zoom);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(leafletMap);

      leafletMap.on("click", function (ev) {
        try {
          if (ev && ev.originalEvent) {
            if (ev.originalEvent.preventDefault)
              ev.originalEvent.preventDefault();
            if (ev.originalEvent.stopPropagation)
              ev.originalEvent.stopPropagation();
          }
        } catch (eStop1) {}
        walletState.ignoreClickUntil = nowMs() + 280;
        hideDiscoverPick();
      });
      leafletMap.on("movestart", function () {
        walletState.ignoreClickUntil = nowMs() + 520;
      });
      leafletMap.on("moveend", function () {
        walletState.ignoreClickUntil = nowMs() + 520;
      });
      leafletMap.on("dragstart", function () {
        walletState.ignoreClickUntil = nowMs() + 520;
      });
      leafletMap.on("dragend", function () {
        walletState.ignoreClickUntil = nowMs() + 520;
      });
      syncMapMarkers();

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
    if (el.walletEmpty) {
      try {
        var lead = el.walletEmpty.querySelector(".walletEmptyLead");
        var body = el.walletEmpty.querySelector(".walletEmptyBody");
        var cta = el.walletEmpty.querySelector("#walletEmptyMapBtn");
        if (lead) {
          lead.textContent = "Noch keine Karten";
        }
        if (body) {
          body.textContent =
            "Entdecke zuerst ein Caf\u00e9 auf der Karte und hol dir dort deine erste digitale Stempelkarte. Der Rest ergibt sich erfreulich von selbst.";
        }
        if (cta) {
          cta.textContent = "Caf\u00e9s entdecken";
        }
        var nodes = el.walletEmpty.childNodes || [];
        for (var i = nodes.length - 1; i >= 0; i--) {
          var node = nodes[i];
          if (node && node.nodeType === 3 && String(node.nodeValue || "").trim()) {
            el.walletEmpty.removeChild(node);
          }
        }
      } catch (e) {}
    }
  }

  var stampSvgSeq = 0;
  var stampIconState = {
    url: null,
    ok: false,
    promise: null,
  };

  function getStampIconUrl() {
    try {
      // Optional override (e.g. set in console or injected by a wrapper page)
      // window.STAMP_ICON_URL = "/assets/stamp-bean.png?v=2";
      if (typeof window !== "undefined" && window && window.STAMP_ICON_URL) {
        return String(window.STAMP_ICON_URL);
      }
    } catch (e) {}

    // Default location for the exact reference image.
    return "/assets/stamp-bean.png?v=1";
  }

  function primeStampIcon() {
    if (stampIconState.promise) return stampIconState.promise;
    stampIconState.url = getStampIconUrl();

    stampIconState.promise = fetch(stampIconState.url, {
      method: "GET",
      cache: "no-store",
    })
      .then(function (res) {
        stampIconState.ok = !!(res && res.ok);
        return stampIconState.ok;
      })
      .catch(function () {
        stampIconState.ok = false;
        return false;
      });

    return stampIconState.promise;
  }

  function buildStampSvg(filled, style) {
    stampSvgSeq = (stampSvgSeq + 1) % 1000000;
    var uid = String(stampSvgSeq);
    var kind = String(style || "bean").trim().toLowerCase();
    if (kind === "cup") kind = "bean";

    if (kind === "bean") {
      var beanSrc = stampIconState && stampIconState.url
        ? String(stampIconState.url)
        : getStampIconUrl();
      var beanOpacity = filled ? "0.96" : "0.18";
      return (
        '<img class="stampIcon stampIconImg" src="' +
        beanSrc +
        '" alt="" aria-hidden="true" draggable="false" style="opacity:' +
        beanOpacity +
        ';" />'
      );
    }

    if (kind === "star") {
      if (filled) {
        return (
          '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
          '<path d="M50 13 L60 37 L86 39 L66 56 L72 82 L50 68 L28 82 L34 56 L14 39 L40 37 Z" fill="currentColor" opacity="0.92"></path>' +
          "</svg>"
        );
      }
      return (
        '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
        '<path d="M50 13 L60 37 L86 39 L66 56 L72 82 L50 68 L28 82 L34 56 L14 39 L40 37 Z" fill="none" stroke="currentColor" stroke-width="4.8" opacity="0.4" stroke-linejoin="round"></path>' +
        "</svg>"
      );
    }

    if (kind === "circle") {
      if (filled) {
        return (
          '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
          '<circle cx="50" cy="50" r="26" fill="currentColor" opacity="0.92"></circle>' +
          "</svg>"
        );
      }
      return (
        '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="4.2" opacity="0.46"></circle>' +
        "</svg>"
      );
    }

    if (filled) {
      return (
        '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
        "<defs>" +
        '<filter id="stampPrint-' +
        uid +
        '" x="-24%" y="-24%" width="148%" height="148%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="1" seed="4" result="noise"></feTurbulence>' +
        '<feColorMatrix in="noise" type="saturate" values="0" result="mono"></feColorMatrix>' +
        '<feComponentTransfer in="mono" result="grain">' +
        '<feFuncA type="table" tableValues="0 0.03 0.07 0.11 0.16 0.2"></feFuncA>' +
        "</feComponentTransfer>" +
        '<feComposite in="grain" in2="SourceAlpha" operator="in" result="grainIn"></feComposite>' +
        '<feBlend in="SourceGraphic" in2="grainIn" mode="multiply"></feBlend>' +
        "</filter>" +
        "</defs>" +
        '<path d="M24 48h42c8 0 15 6 15 15v1H33c-8 0-14-6-14-14v-2c0-7 5-12 12-12h19c10 0 15 6 15 13 0 7-5 12-13 12H24" fill="none" stroke="currentColor" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#stampPrint-' +
        uid +
        ')" opacity="0.96"></path>' +
        '<path d="M66 39h8c6 0 12 5 12 12 0 7-6 12-12 12h-7" fill="none" stroke="currentColor" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"></path>' +
        '<path d="M24 68c6 7 18 11 31 11 18 0 30-5 37-11" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round" opacity="0.9"></path>' +
        '<path d="M41 31c3-8 10-12 20-12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" opacity="0.34"></path>' +
        "</svg>"
      );
    }

    return (
      '<svg class="stampIcon" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="4.2" opacity="0.46"></circle>' +
      "</svg>"
    );
  }

  function getOrdinalLabel(n) {
    var num = Math.max(1, Number(n || 0) || 1);
    var mod10 = num % 10;
    var mod100 = num % 100;
    if (mod10 === 1 && mod100 !== 11) return String(num) + "st";
    if (mod10 === 2 && mod100 !== 12) return String(num) + "nd";
    if (mod10 === 3 && mod100 !== 13) return String(num) + "rd";
    return String(num) + "th";
  }

  function stripCardMarkup(raw) {
    return String(raw || "")
      .replace(/[*_`>#-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCardPrintSubtitle(card) {
    var about = stripCardMarkup(card && card.about ? card.about : "");
    if (about) {
      var line = about.split(/[.!?\n]/)[0] || "";
      line = String(line).trim();
      if (line && line.length <= 34) return line.toUpperCase();
    }
    return "KAFFEESPEZIALITAETEN";
  }

  function getCardFrontKicker(threshold) {
    return "JEDER " + String(threshold) + ". KAFFEE GRATIS";
  }


  function getCardFrontNote(card, about) {
    var note = card && card.cardBackText ? String(card.cardBackText || "").trim() : "";
    if (note) return note;
    var fallback = String(about || "").trim();
    if (!fallback) return "";
    return fallback.length > 120 ? fallback.slice(0, 117).trim() + "..." : fallback;
  }

  function getCardStampStyle(card) {
    try {
      var program = getCardProgram(card);
      var raw =
        program && program.stampStyle != null
          ? String(program.stampStyle)
          : card && card.stampStyle != null
            ? String(card.stampStyle)
            : "";
      var style = raw.trim().toLowerCase();
      if (
        style === "cup" ||
        style === "bean" ||
        style === "star" ||
        style === "circle"
      ) {
        return style;
      }
    } catch (e) {}
    return "bean";
  }

  function getRewardSideNote(label, isFull) {
    if (isFull) return "PRAEMIE BEREIT";
    var src = String(label || "").trim();
    if (!src) return "GRATIS";
    var normalized = src
      .replace(/^1\s+/i, "")
      .replace(/freigetr[a\u00e4]nk/i, "gratis")
      .replace(/free cup/i, "gratis")
      .replace(/free/i, "gratis")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    if (!normalized) return "GRATIS";
    return normalized.length > 18 ? "GRATIS" : normalized;
  }

  function getCardFooterLabel(card) {
    var address = stripCardMarkup(card && card.address ? card.address : "");
    if (address) {
      var shortAddress = address.split(",")[0] || address;
      shortAddress = String(shortAddress).trim();
      if (shortAddress && shortAddress.length <= 24)
        return shortAddress.toUpperCase();
    }
    return "KAFFEEKARTE";
  }

  function renderStampGrid(container, count) {
    var threshold = REWARD_THRESHOLD;
    var stampStyle = "bean";
    try {
      var pass = null;
      if (container && container.closest)
        pass = container.closest(".passCard, .face");
      threshold = getPassRewardThreshold(pass);
      stampStyle = pass
        ? String(pass.getAttribute("data-stamp-style") || "bean")
            .trim()
            .toLowerCase()
        : "bean";
    } catch (eThreshold0) {}
    function hash32(str) {
      var s = String(str || "");
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function mulberry32(seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function getStampSeedKey() {
      try {
        var pass = null;
        if (container && container.closest)
          pass = container.closest(".passCard, .face");
        var cafe = "";
        try {
          cafe = pass ? String(pass.getAttribute("data-cafe") || "") : "";
        } catch (e0) {
          cafe = "";
        }
        var user = "";
        try {
          user =
            session && session.address ? normalizeAddr(session.address) : "";
        } catch (e1) {
          user = "";
        }
        return (user || "") + "|" + (cafe || "");
      } catch (e) {
        return "seed";
      }
    }

    var n = clamp(Number(count || 0) || 0, 0, threshold);
    var prev = null;
    if (arguments.length >= 3) {
      try {
        prev = clamp(Number(arguments[2] || 0) || 0, 0, threshold);
      } catch (ePrev0) {
        prev = null;
      }
    }
    var seedKey = getStampSeedKey();
    container.innerHTML = "";
    for (var i = 0; i < threshold; i++) {
      var cell = document.createElement("div");
      var filled = i < n;
      var isNew = prev != null && filled && i >= prev;
      cell.className =
        "stamp " + (filled ? "filled" : "empty") + (isNew ? " isNew" : "");

      // Subtle deterministic jitter so stamps look like real ink impressions.
      // Deterministic (seeded) prevents stamps from "jumping" on re-render.
      if (filled) {
        try {
          var rnd = mulberry32(hash32(seedKey + "|" + String(i)));
          var jx = (rnd() * 2 - 1) * 2.0; // px
          var jy = (rnd() * 2 - 1) * 1.6; // px
          var jr = rnd() * 360; // deg (full rotation)
          var size = 88 + rnd() * 8; // % (88..96)
          var ink = 0.78 + rnd() * 0.16; // opacity (0.78..0.94)
          cell.style.setProperty("--stamp-jx", jx.toFixed(2) + "px");
          cell.style.setProperty("--stamp-jy", jy.toFixed(2) + "px");
          cell.style.setProperty("--stamp-jr", jr.toFixed(2) + "deg");
          cell.style.setProperty("--stamp-icon-size", size.toFixed(1) + "%");
          cell.style.setProperty("--stamp-ink", ink.toFixed(3));
        } catch (eJ) {}
      }

      cell.innerHTML = buildStampSvg(filled, stampStyle);
      container.appendChild(cell);
    }
  }

  function wireScreenPager() {
    try {
      window.addEventListener(
        "resize",
        function () {
          applyPageMode(currentPageMode || getPageMode());
        },
        { passive: true },
      );
    } catch (e2) {}
  }

  function findWalletPassCardByCafe(cafeAddress) {
    if (!el.walletList) return null;
    var want = normalizeAddr(cafeAddress || "");
    if (!want) return null;
    try {
      var cards = el.walletList.querySelectorAll(".passCard");
      for (var i = 0; i < cards.length; i++) {
        var got = "";
        try {
          got = normalizeAddr(cards[i].getAttribute("data-cafe") || "");
        } catch (e0) {
          got = "";
        }
        if (got && got === want) return cards[i];
      }
    } catch (e1) {}
    return null;
  }

  function buildCafeLink(cafeAddress) {
    if (!session || !session.address) return null;
    try {
      // When opened via file://, location.origin is "null" which breaks URL building.
      // Default to the local apps server in that case.
      var base =
        location.protocol === "file:"
          ? "http://127.0.0.1:8080"
          : location.origin;
      var cafeScannerUrl = base + "/cafe-scanner-new.html";
      var u = new URL(cafeScannerUrl);
      u.searchParams.set("customer", session.address);
      u.searchParams.set("customerName", session.username || "");
      if (cafeAddress) u.searchParams.set("cafe", cafeAddress);
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  function buildRedeemLink(cafeAddress) {
    if (!session || !session.address) return null;
    try {
      var base =
        location.protocol === "file:"
          ? "http://127.0.0.1:8080"
          : location.origin;
      var cafeScannerUrl = base + "/cafe-scanner-new.html";
      var u = new URL(cafeScannerUrl);
      u.searchParams.set("customer", session.address);
      u.searchParams.set("customerName", session.username || "");
      if (cafeAddress) u.searchParams.set("cafe", cafeAddress);
      u.searchParams.set("action", "redeem");

      // Single-use redeem token (scanner enforces it).
      var key =
        normalizeAddr(session.address) + "|" + normalizeAddr(cafeAddress || "");
      var cached = redeemTokenState.byKey[key] || null;
      var now = nowMs();
      if (
        !cached ||
        !cached.token ||
        !cached.ts ||
        now - cached.ts > 5 * 60 * 1000
      ) {
        cached = { token: randomHex(16), ts: now };
        redeemTokenState.byKey[key] = cached;
      }
      if (cached && cached.token)
        u.searchParams.set("rt", String(cached.token));

      return u.toString();
    } catch (e) {
      return null;
    }
  }

  function getPassStampCount(passEl) {
    if (!passEl) return 0;
    try {
      var raw = passEl.getAttribute("data-stamps");
      if (raw == null) return null;
      var n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }

  function ensureQrCanvas(passEl) {
    var box = passEl.querySelector(".passQrBox");
    if (!box) return null;
    var c = box.querySelector("canvas");
    if (c) return c;
    try {
      // Do not clear here; only clear when we have a real QR to render.
    } catch (e0) {}
    c = document.createElement("canvas");
    box.appendChild(c);
    return c;
  }

  function ensureQrImg(passEl) {
    var box = passEl.querySelector(".passQrBox");
    if (!box) return null;
    var img = box.querySelector("img");
    if (img) return img;
    try {
      // Do not clear here; only clear when we have a real QR to render.
    } catch (e0) {}
    img = document.createElement("img");
    img.alt = "QR";
    try {
      img.decoding = "async";
    } catch (e1) {}
    box.appendChild(img);
    return img;
  }

  function clearQrHint(passEl) {
    var box = passEl ? passEl.querySelector(".passQrBox") : null;
    if (!box) return;
    try {
      box.removeAttribute("data-qr-msg");
      box.removeAttribute("data-qr-kind");
    } catch (e) {}
  }

  function setQrPlaceholder(passEl, text, kind) {
    var box = passEl ? passEl.querySelector(".passQrBox") : null;
    if (!box) return;
    var t = String(text || "");
    try {
      box.setAttribute("data-qr-msg", t);
    } catch (e0) {}
    try {
      if (kind === "error") box.setAttribute("data-qr-kind", "error");
      else if (kind === "loading") box.setAttribute("data-qr-kind", "loading");
      else box.removeAttribute("data-qr-kind");
    } catch (e1) {}
  }

  function clearQrBox(passEl) {
    var box = passEl ? passEl.querySelector(".passQrBox") : null;
    if (!box) return null;
    try {
      box.innerHTML = "";
    } catch (e0) {
      try {
        box.textContent = "";
      } catch (e1) {}
    }
    return box;
  }

  function syncPassFaceHeight(passEl) {
    if (!passEl) return;
    try {
      var flip = passEl.querySelector(".passFlip");
      if (!flip) return;
      var w = Number(passEl.clientWidth || flip.clientWidth || 0) || 0;
      if (w <= 0) return;
      var ratio = 1.58;
      try {
        var ratioRaw = window.getComputedStyle(passEl).getPropertyValue(
          "--pass-card-ratio",
        );
        var ratioNum = Number(String(ratioRaw || "").trim());
        if (Number.isFinite(ratioNum) && ratioNum > 0) ratio = ratioNum;
      } catch (eRatio) {}
      var h = w / ratio;
      flip.style.minHeight = "0px";
      flip.style.height = String(Math.ceil(h)) + "px";
    } catch (e) {}
  }

  function setQrSvg(passEl, svgText) {
    var box = passEl ? passEl.querySelector(".passQrBox") : null;
    if (!box) return false;
    if (!svgText) return false;
    try {
      box.innerHTML = String(svgText);
      clearQrHint(passEl);
      syncPassFaceHeight(passEl);
      return true;
    } catch (e0) {
      return false;
    }
  }

  function renderQrCanvas(passEl, link, box) {
    try {
      // We are about to render a real QR; clear any placeholder.
      clearQrBox(passEl);
      var canvas = ensureQrCanvas(passEl);
      if (!canvas) return;
      QRCode.toCanvas(
        canvas,
        link,
        { width: 240, margin: 1, errorCorrectionLevel: "M" },
        function (err2) {
          if (!err2) {
            clearQrHint(passEl);
            syncPassFaceHeight(passEl);
            return;
          }
          try {
            clearQrBox(passEl);
            setQrPlaceholder(passEl, "QR Fehler.", "error");
          } catch (eQr1) {}
        },
      );
    } catch (e2) {
      try {
        clearQrBox(passEl);
        setQrPlaceholder(passEl, "QR Fehler.", "error");
      } catch (e3) {}
    }
  }

  function renderQrImg(passEl, link, box) {
    if (!QRCode || typeof QRCode.toDataURL !== "function") {
      renderQrCanvas(passEl, link, box);
      return;
    }
    try {
      QRCode.toDataURL(
        link,
        { width: 240, margin: 1, errorCorrectionLevel: "M" },
        function (err, url) {
          if (err || !url) {
            renderQrCanvas(passEl, link, box);
            return;
          }
          clearQrBox(passEl);
          var img = ensureQrImg(passEl);
          if (!img) {
            renderQrCanvas(passEl, link, box);
            return;
          }
          try {
            try {
              img.onerror = function () {
                try {
                  clearQrBox(passEl);
                  setQrPlaceholder(passEl, "QR Fehler.", "error");
                } catch (eImg0) {}
                renderQrCanvas(passEl, link, box);
              };
            } catch (eOnErr) {}
            try {
              img.onload = function () {
                clearQrHint(passEl);
                syncPassFaceHeight(passEl);
              };
            } catch (eOnLoad) {}
            img.src = String(url);
          } catch (eSet) {
            renderQrCanvas(passEl, link, box);
          }
        },
      );
    } catch (eUrl) {
      renderQrCanvas(passEl, link, box);
    }
  }

  function renderQrSvg(passEl, link, box) {
    if (!QRCode || typeof QRCode.toString !== "function") {
      renderQrImg(passEl, link, box);
      return;
    }
    try {
      QRCode.toString(
        link,
        { type: "svg", width: 240, margin: 1, errorCorrectionLevel: "M" },
        function (errSvg, svgText) {
          if (!errSvg && svgText && setQrSvg(passEl, svgText)) return;
          renderQrImg(passEl, link, box);
        },
      );
    } catch (eSvg) {
      renderQrImg(passEl, link, box);
    }
  }

  function renderQrIntoBox(box, link, onDone) {
    if (!box || !link) return;
    box.innerHTML = "";
    if (
      typeof QRCode === "undefined" ||
      !QRCode ||
      (!QRCode.toString && !QRCode.toDataURL && !QRCode.toCanvas)
    ) {
      box.textContent = "QR konnte nicht erzeugt werden.";
      return;
    }
    if (QRCode && typeof QRCode.toString === "function") {
      try {
        QRCode.toString(
          link,
          { type: "svg", width: 360, margin: 1, errorCorrectionLevel: "M" },
          function (errSvg, svgText) {
            if (!errSvg && svgText) {
              box.innerHTML = String(svgText);
              if (onDone) onDone(true);
              return;
            }
            renderQrIntoBoxWithImage(box, link, onDone);
          },
        );
        return;
      } catch (eSvg) {}
    }
    renderQrIntoBoxWithImage(box, link, onDone);
  }

  function renderQrIntoBoxWithImage(box, link, onDone) {
    if (!box || !link) return;
    if (QRCode && typeof QRCode.toDataURL === "function") {
      try {
        QRCode.toDataURL(
          link,
          { width: 360, margin: 1, errorCorrectionLevel: "M" },
          function (err, url) {
            if (!err && url) {
              box.innerHTML = "";
              var img = document.createElement("img");
              img.alt = "QR Code";
              img.src = String(url);
              box.appendChild(img);
              if (onDone) onDone(true);
              return;
            }
            renderQrIntoBoxWithCanvas(box, link, onDone);
          },
        );
        return;
      } catch (eImg) {}
    }
    renderQrIntoBoxWithCanvas(box, link, onDone);
  }

  function renderQrIntoBoxWithCanvas(box, link, onDone) {
    if (!box || !link) return;
    box.innerHTML = "";
    var canvas = document.createElement("canvas");
    box.appendChild(canvas);
    try {
      QRCode.toCanvas(
        canvas,
        link,
        { width: 360, margin: 1, errorCorrectionLevel: "M" },
        function (err) {
          if (err) {
            box.textContent = "QR konnte nicht erzeugt werden.";
            if (onDone) onDone(false);
            return;
          }
          if (onDone) onDone(true);
        },
      );
    } catch (eCanvas) {
      box.textContent = "QR konnte nicht erzeugt werden.";
      if (onDone) onDone(false);
    }
  }

  function setQrSheetOpen(open) {
    var next = !!open;
    qrSheetState.open = next;
    try {
      if (el.qrSheetBackdrop) el.qrSheetBackdrop.classList.toggle("open", next);
      if (el.qrSheet) el.qrSheet.classList.toggle("open", next);
      if (el.qrSheet) el.qrSheet.setAttribute("aria-hidden", next ? "false" : "true");
      document.body.classList.toggle("qrSheetOpen", next);
    } catch (e) {}
  }

  function closeQrSheet() {
    qrSheetState.passEl = null;
    setQrSheetOpen(false);
    try {
      if (el.qrSheetBox) el.qrSheetBox.innerHTML = "";
    } catch (e) {}
  }

  function openQrSheet(passEl) {
    if (!passEl) return;
    qrSheetState.passEl = passEl;
    try {
      if (el.qrSheetTitle) {
        var titleEl = passEl.querySelector(".passTitle");
        el.qrSheetTitle.textContent = titleEl
          ? String(titleEl.textContent || "Kaffeekarte")
          : "Kaffeekarte";
      }
      if (el.qrSheetSub) {
        var countEl = passEl.querySelector(".passCountLine");
        el.qrSheetSub.textContent = countEl
          ? String(countEl.textContent || "QR wird geladen\u2026")
          : "QR wird geladen\u2026";
      }
      if (el.qrSheetHint) {
        var stamps = getPassStampCount(passEl);
        var full = Number(stamps || 0) >= getPassRewardThreshold(passEl);
        el.qrSheetHint.textContent = full
          ? "Im Caf\u00e9 scannen lassen und die Belohnung einl\u00f6sen."
          : "Im Caf\u00e9 scannen lassen und den n\u00e4chsten Stempel sammeln.";
      }
      if (el.qrSheetBox) {
        el.qrSheetBox.textContent = "QR wird geladen\u2026";
      }
    } catch (eMeta) {}

    setQrSheetOpen(true);

    try {
      var cafeAddress = passEl.getAttribute("data-cafe") || "";
      var stamps = getPassStampCount(passEl);
      var renderLink = function (count) {
        var full = Number(count || 0) >= getPassRewardThreshold(passEl);
        var link = full ? buildRedeemLink(cafeAddress) : buildCafeLink(cafeAddress);
        if (!link || !el.qrSheetBox) {
          if (el.qrSheetBox) el.qrSheetBox.textContent = "QR konnte nicht erzeugt werden.";
          return;
        }
        renderQrIntoBox(el.qrSheetBox, link);
      };

      if (stamps == null) {
        apiFetch(
          "/stamps/" +
            encodeURIComponent(session.address) +
            "?fallback=1&cafe=" +
            encodeURIComponent(cafeAddress),
        )
          .then(function (data) {
            var s =
              data && data.stamps != null
                ? Number(data.stamps)
                : data && data.count != null
                  ? Number(data.count)
                  : 0;
            if (!Number.isFinite(s)) s = 0;
            try {
              setPassCardStamps(passEl, s);
            } catch (e1) {}
            renderLink(s);
          })
          .catch(function () {
            if (el.qrSheetBox) el.qrSheetBox.textContent = "QR Fehler.";
          });
        return;
      }
      renderLink(stamps);
    } catch (e) {
      if (el.qrSheetBox) el.qrSheetBox.textContent = "QR Fehler.";
    }
  }

  function openPass(passEl) {
    if (!passEl) return;
    closeAllPasses(passEl);
    try {
      if (passEl.__forceBackTimer) {
        window.clearTimeout(passEl.__forceBackTimer);
        passEl.__forceBackTimer = 0;
      }
      if (passEl.classList) {
        passEl.classList.add("forceBack");
        passEl.classList.add("isFocused");
      }
    } catch (ePrepOpen) {}
    passEl.classList.add("open");
    syncPassFaceHeight(passEl);
    try {
      var cafeAddress = passEl.getAttribute("data-cafe") || "";
      var stamps = getPassStampCount(passEl);
      var box = passEl.querySelector(".passQrBox");

      if (stamps == null) {
        // If the user opens instantly after boot, stamps might not be loaded yet.
        // Fetch once so we can show the correct QR (redeem vs stamp).
        try {
          setQrPlaceholder(passEl, "Stempelstand wird geladen\u2026", "loading");
        } catch (e0) {}
        apiFetch(
          "/stamps/" +
            encodeURIComponent(session.address) +
            "?fallback=1&cafe=" +
            encodeURIComponent(cafeAddress),
        )
          .then(function (data) {
            var s =
              data && data.stamps != null
                ? Number(data.stamps)
                : data && data.count != null
                  ? Number(data.count)
                  : 0;
            if (!Number.isFinite(s)) s = 0;
            try {
              setPassCardStamps(passEl, s);
            } catch (e1) {}

            var full2 = s >= getPassRewardThreshold(passEl);
            var link2 = full2
              ? buildRedeemLink(cafeAddress)
              : buildCafeLink(cafeAddress);
            if (!link2) {
              clearQrBox(passEl);
              setQrPlaceholder(
                passEl,
                "QR konnte nicht erzeugt werden.",
                "error",
              );
              return;
            }
            window.requestAnimationFrame(function () {
              window.requestAnimationFrame(function () {
                renderQrSvg(passEl, link2, box);
                syncPassFaceHeight(passEl);
              });
            });
          })
          .catch(function () {
            try {
              clearQrBox(passEl);
              setQrPlaceholder(passEl, "QR Fehler.", "error");
            } catch (e2) {}
          });
        return;
      }

      var full = Number(stamps || 0) >= getPassRewardThreshold(passEl);
      var link = full
        ? buildRedeemLink(cafeAddress)
        : buildCafeLink(cafeAddress);
      if (!link) {
        try {
          clearQrBox(passEl);
          setQrPlaceholder(passEl, "QR konnte nicht erzeugt werden.", "error");
        } catch (eLink) {}
        return;
      }
      if (
        typeof QRCode === "undefined" ||
        !QRCode ||
        (!QRCode.toString && !QRCode.toDataURL && !QRCode.toCanvas)
      ) {
        try {
          clearQrBox(passEl);
          setQrPlaceholder(passEl, "QR Library fehlt.", "error");
        } catch (eLib) {}
        return;
      }

      // Show something immediately so an empty backside doesn't look broken.
      try {
        setQrPlaceholder(
          passEl,
          full ? "Einl\u00f6sen-QR wird geladen\u2026" : "QR wird geladen\u2026",
          "loading",
        );
      } catch (eTxt) {}

      // If nothing renders (e.g. canvas/dataURL blocked), show an explicit error.
      window.setTimeout(function () {
        try {
          var b = passEl.querySelector(".passQrBox");
          if (!b) return;
          var has =
            (b.querySelector &&
              (b.querySelector("svg") ||
                b.querySelector("img") ||
                b.querySelector("canvas"))) ||
            false;
          if (has) return;
          clearQrBox(passEl);
          setQrPlaceholder(passEl, "QR Fehler.", "error");
        } catch (eW) {}
      }, 1500);

      // Delay rendering until after the "open" class applied and layout settled.
      // This avoids rare cases where the canvas ends up 0-sized / not painted.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          renderQrSvg(passEl, link, box);
          syncPassFaceHeight(passEl);
        });
      });
    } catch (e) {}
  }

  function closePass(passEl) {
    if (!passEl) return;
    try {
      if (passEl.__forceBackTimer) {
        window.clearTimeout(passEl.__forceBackTimer);
        passEl.__forceBackTimer = 0;
      }
      if (passEl.classList) {
        passEl.classList.remove("forceBack");
        passEl.classList.remove("isFocused");
      }
    } catch (ePrepClose) {}
    passEl.classList.remove("open");
  }

  function buildPassCard(card) {
    var cafeAddress = String(card.cafeAddress || "");
    var title = String(card.name || "Caf\u00e9");
    var address = card && card.address ? String(card.address) : "";
    var about = card && card.about ? String(card.about) : "";
    var stampCount = clamp(Number(card.netStamps || 0) || 0, 0, 999);
    var theme = card.cardTheme ? String(card.cardTheme) : "clean";
    if (theme === "ink") theme = "clean";
    var rewardThreshold = getCardRewardThreshold(card);
    var rewardLabel = "";
    try {
      rewardLabel = String(
        (card && (card.rewardDescription || card.reward)) || "",
      ).trim();
    } catch (eReward0) {
      rewardLabel = "";
    }
    var isFull = stampCount >= rewardThreshold;
    var extra = Math.max(0, stampCount - rewardThreshold);
    var remaining = Math.max(
      0,
      rewardThreshold - clamp(stampCount, 0, rewardThreshold),
    );
    var serialTail = cafeAddress
      ? cafeAddress.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(-6)
      : "";
    if (!serialTail) serialTail = "STAMP";
    var kickerText = getCardFrontKicker(rewardThreshold);
    var subtitle = getCardPrintSubtitle(card);
    var rewardSideNote = getRewardSideNote(rewardLabel, isFull);
    var footerLabel = getCardFooterLabel(card);
    var countLine = formatStampCountLine(stampCount, rewardThreshold, extra);

    var passCard = document.createElement("div");
    passCard.className = "passCard";
    passCard.setAttribute("data-cafe", cafeAddress);
    passCard.setAttribute("data-pass-theme", theme);
    passCard.setAttribute("data-reward-threshold", String(rewardThreshold));
    passCard.setAttribute("data-reward-label", rewardLabel || "");
    passCard.setAttribute("data-stamp-style", getCardStampStyle(card));

    if (card && card.cardBackgroundDataUrl) {
      try {
        var url = String(card.cardBackgroundDataUrl || "");
        if (url) {
          // Avoid breaking CSS with quotes.
          var safeUrl = url.replace(/"/g, "%22");
          passCard.style.setProperty(
            "--pass-card-bg",
            'url("' + safeUrl + '")',
          );
        }
      } catch (eBg) {}
    }

    var flip = document.createElement("div");
    flip.className = "passFlip";

    var mainBtn = document.createElement("div");
    mainBtn.className = "passMain";
    mainBtn.setAttribute("role", "button");
    mainBtn.setAttribute("tabindex", "0");
    mainBtn.setAttribute("aria-label", "Karte oeffnen");

    var head = document.createElement("div");
    head.className = "passHead";

    var left = document.createElement("div");
    left.className = "stack";
    left.style.minWidth = "0";

    var eyebrow = document.createElement("div");
    eyebrow.className = "passEyebrow";
    eyebrow.textContent = kickerText;

    var brandLockup = document.createElement("div");
    brandLockup.className = "passBrandLockup";

    if (card.logoDataUrl) {
      var logoWrap = document.createElement("div");
      logoWrap.className = "passLogoWrap";
      var img = document.createElement("img");
      img.className = "passLogo";
      img.alt = "Logo";
      img.decoding = "async";
      img.loading = "lazy";
      img.src = String(card.logoDataUrl);
      img.addEventListener("error", function () {
        try {
          logoWrap.innerHTML = "";
          logoWrap.appendChild(buildPassLogoFallback(title));
        } catch (eLogoFallback) {}
      });
      logoWrap.appendChild(img);
      brandLockup.appendChild(logoWrap);
    } else {
      var fallbackLogoWrap = document.createElement("div");
      fallbackLogoWrap.className = "passLogoWrap";
      fallbackLogoWrap.appendChild(buildPassLogoFallback(title));
      brandLockup.appendChild(fallbackLogoWrap);
    }

    var titleBlock = document.createElement("div");
    titleBlock.className = "passTitleBlock";

    var h = document.createElement("div");
    h.className = "passTitle";
    h.textContent = title;

    var sub = document.createElement("div");
    sub.className = "passSub";
    sub.textContent = subtitle;

    titleBlock.appendChild(h);
    titleBlock.appendChild(sub);
    brandLockup.appendChild(titleBlock);

    left.appendChild(eyebrow);
    left.appendChild(brandLockup);

    head.appendChild(left);

    var stampField = document.createElement("div");
    stampField.className = "passStampField";

    var stampGuide = document.createElement("div");
    stampGuide.className = "passStampGuide";

    var stampLead = document.createElement("div");
    stampLead.className = "passStampLead";
    stampLead.textContent = "Fortschritt";

    var stampNeed = document.createElement("div");
    stampNeed.className = "passStampNeed";
    stampNeed.textContent = countLine;

    stampGuide.appendChild(stampLead);
    stampGuide.appendChild(stampNeed);
    stampField.appendChild(stampGuide);

    var grid = document.createElement("div");
    grid.className = "stampGrid";
    renderStampGrid(grid, stampCount);
    stampField.appendChild(grid);
    var rewardNote = document.createElement("div");
    rewardNote.className = "passRewardNote";
    rewardNote.textContent = rewardSideNote;
    stampField.appendChild(rewardNote);

    var infoBlock = document.createElement("div");
    infoBlock.className = "passInfoBlock";

    var frontNote = getCardFrontNote(card, about);
    if (frontNote) {
      var noteEl = document.createElement("div");
      noteEl.className = "passCardNote";
      noteEl.textContent = frontNote;
      infoBlock.appendChild(noteEl);
    }

    var frontWebsiteUrl = normalizeExternalUrl(
      card && card.websiteUrl ? String(card.websiteUrl).trim() : "",
    );
    var frontInstagramUrl = normalizeInstagramUrl(
      card && card.instagramUrl ? String(card.instagramUrl).trim() : "",
    );
    if (frontWebsiteUrl || frontInstagramUrl) {
      var linkRow = document.createElement("div");
      linkRow.className = "passLinkRow";
      if (frontWebsiteUrl) {
        var websiteLink = document.createElement("a");
        websiteLink.className = "passInfoLink";
        websiteLink.href = frontWebsiteUrl;
        websiteLink.target = "_blank";
        websiteLink.rel = "noopener noreferrer";
        websiteLink.textContent = "Website";
        websiteLink.addEventListener("click", function (ev) {
          try {
            ev.stopPropagation();
          } catch (e) {}
        });
        linkRow.appendChild(websiteLink);
      }
      if (frontInstagramUrl) {
        var instagramLink = document.createElement("a");
        instagramLink.className = "passInfoLink";
        instagramLink.href = frontInstagramUrl;
        instagramLink.target = "_blank";
        instagramLink.rel = "noopener noreferrer";
        instagramLink.textContent = "Instagram";
        instagramLink.addEventListener("click", function (ev) {
          try {
            ev.stopPropagation();
          } catch (e) {}
        });
        linkRow.appendChild(instagramLink);
      }
      infoBlock.appendChild(linkRow);
    }

    var metaRow = document.createElement("div");
    metaRow.className = "passMetaRow";

    var progressText = document.createElement("div");
    progressText.className = "passProgressText";
    var progressHeadline = document.createElement("strong");
    progressHeadline.className = "passProgressHeadline";
    progressHeadline.textContent = formatRewardProgressLine(remaining, isFull, rewardLabel);
    var progressSub = document.createElement("span");
    progressSub.className = "passProgressSub";
    progressSub.textContent = formatNextStampLine(remaining, isFull);
    progressText.appendChild(progressHeadline);
    progressText.appendChild(progressSub);

    var rewardChip = document.createElement("div");
    rewardChip.className = "passRewardChip";
    rewardChip.textContent = rewardLabel || "Belohnung";

    metaRow.appendChild(progressText);
    metaRow.appendChild(rewardChip);

    var hint = document.createElement("div");
    hint.className = "passHint";
    hint.textContent = isFull ? "QR zeigen und einl\u00f6sen" : "QR zeigen";

    var footer = document.createElement("div");
    footer.className = "passFooter";

    var footerMeta = document.createElement("div");
    footerMeta.className = "passFooterMeta";

    var serial = document.createElement("span");
    serial.className = "passSerial";
    serial.textContent = footerLabel;

    var footerType = document.createElement("span");
    footerType.className = "passCountLine";
    footerType.textContent = countLine;

    footerMeta.appendChild(serial);
    footerMeta.appendChild(footerType);

    var footerVisit = document.createElement("div");
    footerVisit.className = "passFooterVisit";
    footerVisit.textContent = formatFooterProgressLine(remaining, isFull);

    footer.appendChild(footerMeta);
    footer.appendChild(footerVisit);

    mainBtn.appendChild(head);
    mainBtn.appendChild(stampField);
    if (infoBlock.childNodes.length) mainBtn.appendChild(infoBlock);
    mainBtn.appendChild(footer);

    var qr = document.createElement("div");
    qr.className = "passQr";

    var backMeta = document.createElement("div");
    backMeta.className = "passBackMeta";

    var backTitle = document.createElement("div");
    backTitle.className = "passBackTitle";
    backTitle.textContent = title;
    backMeta.appendChild(backTitle);

    var backClose = document.createElement("button");
    backClose.className = "passBackClose";
    backClose.type = "button";
    backClose.setAttribute("aria-label", "Karte schlie\u00dfen");
    backMeta.appendChild(backClose);

    if (address) {
      var backAddr = document.createElement("div");
      backAddr.className = "passBackAddr";
      backAddr.textContent = address;
      backMeta.appendChild(backAddr);
    }
    qr.appendChild(backMeta);

    var backText = document.createElement("div");
    backText.className = "passBackText";
    backText.textContent =
      card && card.cardBackText
        ? String(card.cardBackText)
        : about
          ? about
          : "Tippe auf den QR-Code zum Schlie\u00dfen";
    try {
      passCard.setAttribute(
        "data-backtext-base",
        String(backText.textContent || ""),
      );
    } catch (eBt0) {}
    qr.appendChild(backText);

    var qrBox = document.createElement("div");
    qrBox.className = "passQrBox";
    qrBox.setAttribute("role", "button");
    qrBox.setAttribute("aria-label", "QR anzeigen / schlie\u00dfen");
    qr.appendChild(qrBox);

    var qrCaption = document.createElement("div");
    qrCaption.className = "passQrCaption";
    qrCaption.textContent = isFull
      ? "Im Caf\u00e9 scannen lassen, um die Belohnung einzul\u00f6sen."
      : "Im Caf\u00e9 scannen lassen und den n\u00e4chsten Stempel sammeln.";
    qr.appendChild(qrCaption);

    var backNote = document.createElement("div");
    backNote.className = "passBackNote";
    backNote.textContent =
      "Tippe irgendwo auf die Rueckseite, um wieder zur Karte zu wechseln.";
    qr.appendChild(backNote);

    flip.appendChild(mainBtn);
    flip.appendChild(qr);
    passCard.appendChild(flip);
    try {
      window.requestAnimationFrame(function () {
        syncPassFaceHeight(passCard);
      });
    } catch (eSync0) {}

    mainBtn.addEventListener("click", function () {
      if (nowMs() < walletState.ignoreClickUntil) return;
      try {
        if (passCard.classList && passCard.classList.contains("open")) {
          closePass(passCard);
        } else if (passCard.classList && passCard.classList.contains("isFocused")) {
          openQrSheet(passCard);
        } else {
          focusPass(passCard);
        }
      } catch (e0) {
        focusPass(passCard);
      }
    });
    mainBtn.addEventListener("keydown", function (ev) {
      var key = ev && ev.key ? String(ev.key) : "";
      if (key !== "Enter" && key !== " ") return;
      try {
        ev.preventDefault();
      } catch (e) {}
      mainBtn.click();
    });

    // On phones (stack mode), the wallet swipe handler listens on the scroller and
    // can pointer-capture the top card; prevent it from hijacking taps meant to close.
    var stop = function (ev) {
      try {
        ev.stopPropagation();
      } catch (e) {}
    };
    qr.addEventListener("pointerdown", stop);
    qrBox.addEventListener("pointerdown", stop);

    var close = function () {
      closePass(passCard);
    };
    backClose.addEventListener("click", close);
    backClose.addEventListener("pointerup", close);
    backClose.addEventListener("touchend", close, { passive: true });
    // Click for desktop, pointerup/touchend for mobile reliability.
    qrBox.addEventListener("click", close);
    qrBox.addEventListener("pointerup", close);
    qrBox.addEventListener("touchend", close, { passive: true });
    // Also allow closing by tapping anywhere on the back side.
    qr.addEventListener("click", close);
    qr.addEventListener("pointerup", close);
    qr.addEventListener("touchend", close, { passive: true });

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
      // Keep background cards below 0.5 opacity so strict UI checks
      // still treat the stack as showing a single visible card.
      var op = i === 0 ? 1 : i === 1 ? 0.62 : 0.4;
      var sc = i === 0 ? 1 : i === 1 ? 0.984 : 0.965;
      var sy = i === 0 ? 0 : i === 1 ? 12 : 24;
      var tz = i === 0 ? 0 : i === 1 ? -6 : -12;
      var ry = i === 0 ? 0 : i === 1 ? -1.4 : -2.8;

      node.style.setProperty("--wheel-tx", "0px");
      node.style.setProperty("--stack-swipe-y", "0px");
      node.style.setProperty("--wheel-rz", "0deg");
      node.style.setProperty("--wheel-ry", String(ry) + "deg");
      node.style.setProperty("--wheel-tz", String(tz) + "px");
      node.style.transition = "";
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

  function updateWalletStackFollowers(scroller, dy) {
    if (!scroller) return;
    try {
      var cards = scroller.querySelectorAll(".passCard");
      var second = cards && cards[1] ? cards[1] : null;
      var third = cards && cards[2] ? cards[2] : null;
      var dist = Math.abs(dy);
      var progress = Math.min(1, dist / 140);
      var swayX = 0;
      var tilt = 0;
      var liftY2 = 12 - progress * 6;
      var liftY3 = 24 - progress * 9;

      if (second) {
        second.style.setProperty("--wheel-tx", swayX.toFixed(2) + "px");
        second.style.setProperty("--stack-y", liftY2.toFixed(2) + "px");
        second.style.setProperty("--wheel-ry", tilt.toFixed(2) + "deg");
        second.style.setProperty(
          "--wheel-tz",
          String((-6 + progress * 4).toFixed(2)) + "px",
        );
        second.style.setProperty(
          "--wheel-scale",
          String((0.984 + progress * 0.012).toFixed(3)),
        );
        second.style.setProperty(
          "--wheel-opacity",
          String((0.62 + progress * 0.08).toFixed(3)),
        );
      }
      if (third) {
        third.style.setProperty("--wheel-tx", (swayX * 0.45).toFixed(2) + "px");
        third.style.setProperty("--stack-y", liftY3.toFixed(2) + "px");
        third.style.setProperty(
          "--wheel-ry",
          (tilt * 0.72).toFixed(2) + "deg",
        );
        third.style.setProperty(
          "--wheel-tz",
          String((-12 + progress * 5).toFixed(2)) + "px",
        );
        third.style.setProperty(
          "--wheel-scale",
          String((0.965 + progress * 0.011).toFixed(3)),
        );
        third.style.setProperty(
          "--wheel-opacity",
          String((0.4 + progress * 0.06).toFixed(3)),
        );
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
    var speed = opts && isFinite(opts.speed) ? Number(opts.speed) : 0.7;
    var duration = Math.round(clamp(260 + speed * 90, 260, 340));

    cardEl.classList.add("isSwapping");

    try {
      cardEl.style.transition =
        "transform " +
        duration +
        "ms cubic-bezier(0.22, 0.82, 0.24, 1), filter " +
        Math.max(220, duration - 20) +
        "ms ease";
    } catch (ePrep) {}

    window.requestAnimationFrame(function () {
      // Slide the top card deeper into the stack without fading it away.
      cardEl.style.setProperty("--wheel-tx", String(tx) + "px");
      cardEl.style.setProperty("--stack-swipe-y", String(ty) + "px");
      cardEl.style.setProperty("--wheel-rz", String(clamp(tx / 32, -0.8, 0.8)) + "deg");
      cardEl.style.setProperty("--wheel-ry", "0deg");
      cardEl.style.setProperty(
        "--wheel-tz",
        String(clamp(6 + Math.abs(ty) * 0.02, 6, 12)) + "px",
      );
      cardEl.style.setProperty("--wheel-opacity", "1");
      cardEl.style.setProperty("--wheel-scale", "0.989");
      cardEl.style.setProperty("--wheel-sat", "1");
      cardEl.style.setProperty("--wheel-bright", "1");
      updateWalletStackFollowers(scroller, ty * 0.9);
    });

    window.setTimeout(function () {
      try {
        scroller.appendChild(cardEl);
      } catch (e) {}

      try {
        // Always reset to the front when it goes to the back.
        closePass(cardEl);
        cardEl.classList.remove("isSwapping");
        cardEl.style.transition = "";
        cardEl.style.setProperty("--wheel-tx", "0px");
        cardEl.style.setProperty("--stack-swipe-y", "0px");
        cardEl.style.setProperty("--wheel-opacity", "1");
        cardEl.style.setProperty("--wheel-rz", "0deg");
        cardEl.style.setProperty("--wheel-ry", "0deg");
        cardEl.style.setProperty("--wheel-tz", "0px");
        cardEl.style.setProperty("--wheel-scale", "1");
        cardEl.style.setProperty("--wheel-sat", "1");
        cardEl.style.setProperty("--wheel-bright", "1");
        cardEl.style.setProperty("--stack-y", "0px");
      } catch (e2) {}

      // And ensure the newly revealed card is also on the front.
      resetVisiblePassesToFront(scroller);
      applyWalletStackVisibility(scroller);
    }, duration);
  }

  function cycleTopToBottom(scroller, direction) {
    var cardEl = scroller.querySelector(".passCard");
    if (!cardEl) return;

    cardEl.classList.add("isSwapping");
    var dir = direction || 1;

    // Animate into the back of the deck (so the user sees it going to the end).
    try {
      cardEl.style.transition =
        "transform 280ms cubic-bezier(0.22, 0.82, 0.24, 1), opacity 220ms ease, filter 220ms ease";
    } catch (ePrep) {}
    window.requestAnimationFrame(function () {
      cardEl.style.setProperty("--wheel-tx", "0px");
      cardEl.style.setProperty("--stack-swipe-y", String(dir * 28) + "px");
      cardEl.style.setProperty("--wheel-rz", "0deg");
      cardEl.style.setProperty("--wheel-ry", "0deg");
      cardEl.style.setProperty("--wheel-tz", "10px");
      cardEl.style.setProperty("--wheel-opacity", "1");
      cardEl.style.setProperty("--wheel-scale", "0.99");
      cardEl.style.setProperty("--wheel-sat", "1");
      cardEl.style.setProperty("--wheel-bright", "1");
      cardEl.style.setProperty("--stack-y", "14px");
      updateWalletStackFollowers(scroller, dir * 20);
    });

    window.setTimeout(function () {
      try {
        scroller.appendChild(cardEl);
      } catch (e) {}

      try {
        closePass(cardEl);
        cardEl.classList.remove("isSwapping");
        cardEl.style.transition = "";
        cardEl.style.setProperty("--wheel-tx", "0px");
        cardEl.style.setProperty("--stack-swipe-y", "0px");
        cardEl.style.setProperty("--wheel-opacity", "1");
        cardEl.style.setProperty("--wheel-rz", "0deg");
        cardEl.style.setProperty("--wheel-ry", "0deg");
        cardEl.style.setProperty("--wheel-tz", "0px");
        cardEl.style.setProperty("--wheel-scale", "1");
        cardEl.style.setProperty("--wheel-sat", "1");
        cardEl.style.setProperty("--wheel-bright", "1");
        cardEl.style.setProperty("--stack-y", "0px");
      } catch (e2) {}

      resetVisiblePassesToFront(scroller);
      applyWalletStackVisibility(scroller);
    }, 360);
  }

  function enableWalletStackMode(scroller) {
    if (!scroller) return;
    scroller.classList.add("isStack");
    applyWalletStackVisibility(scroller);

    // refreshWallet() can run multiple times (boot + after cafes load).
    // Avoid wiring duplicate pointer listeners which can break swipe/close.
    try {
      if (scroller.__stampStackWired) return;
      scroller.__stampStackWired = true;
    } catch (eFlag) {}

    function beginStackDrag(pointerId, clientX, clientY, target) {
      var top = scroller.querySelector(".passCard");
      if (!top) return;

      // If the top card is open, first close it so the stack doesn't get stuck.
      // (Also restores swipe immediately after opening a pass.)
      try {
        if (top.classList && top.classList.contains("open")) {
          closePass(top);
          walletState.ignoreClickUntil = nowMs() + 180;
          return;
        }
      } catch (e0) {}

      // If the event originated from the back-side interactive area, ignore.
      try {
        var t = target;
        if (t && t.closest) {
          if (t.closest(".passQr") || t.closest(".passQrBox")) return;
        }
      } catch (e1) {}

      walletState.stackDrag = {
        id: pointerId,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastY: clientY,
        lastMoveAt: nowMs(),
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        moved: false,
        activeEl: top,
        captured: false,
      };
      try {
        top.style.transition = "none";
      } catch (e2) {}
    }

    function moveStackDrag(pointerId, clientX, clientY, allowCapture) {
      var d = walletState.stackDrag;
      if (!d || d.id !== pointerId) return false;
      var dx = clientX - d.startX;
      var dy = clientY - d.startY;
      var ddx = clientX - d.lastX;
      var ddy = clientY - d.lastY;
      var tNow = nowMs();
      var dt = Math.max(1, tNow - (d.lastMoveAt || tNow));
      var instVx = ddx / dt;
      var instVy = ddy / dt;
      d.vx = d.vx * 0.58 + instVx * 0.42;
      d.vy = d.vy * 0.58 + instVy * 0.42;
      d.ax = d.ax * 0.7 + (instVx - d.vx) * 0.3;
      d.ay = d.ay * 0.7 + (instVy - d.vy) * 0.3;
      d.lastX = clientX;
      d.lastY = clientY;
      d.lastMoveAt = tNow;

      if (!d.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) < Math.abs(dx) * 1.05) return;
        d.moved = true;
        scroller.classList.add("isDragging");

        // Only capture once it is clearly a drag gesture.
        if (allowCapture && !d.captured && d.activeEl) {
          try {
            d.activeEl.setPointerCapture(pointerId);
            d.captured = true;
          } catch (eCap) {}
        }
      }

      var card = d.activeEl;
      if (!card) return;
      var tx = clamp(dx * 0.025, -4, 4);
      var ty = clamp(dy * 0.98, -180, 180);
      var rz = clamp(dx / 110, -0.9, 0.9);
      var ry = 0;
      var op = 1;
      var lift = clamp(Math.abs(ty) * 0.012, 0, 4);

      card.style.setProperty("--wheel-tx", tx.toFixed(2) + "px");
      card.style.setProperty("--stack-swipe-y", ty.toFixed(2) + "px");
      card.style.setProperty("--wheel-rz", rz.toFixed(2) + "deg");
      card.style.setProperty("--wheel-ry", String(ry.toFixed(2)) + "deg");
      card.style.setProperty("--wheel-opacity", String(op.toFixed(3)));
      card.style.setProperty("--wheel-sat", "1");
      card.style.setProperty("--wheel-bright", "1");
      card.style.setProperty("--wheel-tz", String(lift.toFixed(2)) + "px");
      updateWalletStackFollowers(scroller, ty);
      return !!d.moved;
    }

    function endStackDrag(pointerId, clientX, clientY) {
      var d = walletState.stackDrag;
      if (!d || d.id !== pointerId) return;
      walletState.stackDrag = null;
      scroller.classList.remove("isDragging");

      var dx = clientX - d.startX;
      var dy = clientY - d.startY;
      var moved = !!d.moved;
      var card = d.activeEl;
      if (!card) return;

      var h = Math.max(1, card.getBoundingClientRect().height || 0);
      var threshold = Math.min(96, Math.max(56, h * 0.16));

      var ty = clamp(dy * 0.98, -180, 180);
      var dist = Math.abs(ty);
      var releaseSpeed = Math.abs(d.vy || 0);
      if (moved && (dist > threshold || (releaseSpeed > 0.32 && dist > 26))) {
        walletState.ignoreClickUntil = nowMs() + 340;
        var dir = ty >= 0 ? 1 : -1;
        sendTopCardToBack(scroller, {
          tx: 0,
          ty: dir * clamp(dist + 40 + releaseSpeed * 18, 92, 148),
          dir: dir,
          speed: releaseSpeed,
        });
        return;
      }

      try {
        card.style.transition =
          "transform 300ms cubic-bezier(0.22, 0.82, 0.24, 1), opacity 220ms ease, filter 220ms ease";
      } catch (e1) {}
      updateWalletStackFollowers(scroller, 0);
      card.style.setProperty("--wheel-tx", "0px");
      card.style.setProperty("--stack-swipe-y", "0px");
      card.style.setProperty("--wheel-rz", "0deg");
      card.style.setProperty("--wheel-ry", "0deg");
      card.style.setProperty("--wheel-tz", "0px");
      card.style.setProperty("--wheel-opacity", "1");
      card.style.setProperty("--wheel-scale", "1");
      card.style.setProperty("--wheel-sat", "1");
      card.style.setProperty("--wheel-bright", "1");
      if (moved) walletState.ignoreClickUntil = nowMs() + 180;
    }

    function findTouchById(list, id) {
      if (!list) return null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].identifier === id) return list[i];
      }
      return null;
    }

    function onPointerDown(ev) {
      beginStackDrag(ev.pointerId, ev.clientX, ev.clientY, ev.target);
    }

    function onPointerMove(ev) {
      moveStackDrag(ev.pointerId, ev.clientX, ev.clientY, true);
    }

    function onPointerUp(ev) {
      endStackDrag(ev.pointerId, ev.clientX, ev.clientY);
    }

    function onTouchStart(ev) {
      if (!ev.touches || !ev.touches.length) return;
      var t = ev.touches[0];
      beginStackDrag(t.identifier, t.clientX, t.clientY, ev.target);
    }

    function onTouchMove(ev) {
      var d = walletState.stackDrag;
      if (!d) return;
      var t = findTouchById(ev.touches, d.id) || findTouchById(ev.changedTouches, d.id);
      if (!t) return;
      var moved = moveStackDrag(t.identifier, t.clientX, t.clientY, false);
      if (moved) {
        try {
          ev.preventDefault();
        } catch (ePrevent) {}
      }
    }

    function onTouchEnd(ev) {
      var d = walletState.stackDrag;
      if (!d) return;
      var t = findTouchById(ev.changedTouches, d.id);
      if (!t) return;
      endStackDrag(t.identifier, t.clientX, t.clientY);
    }

    scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
    scroller.addEventListener("pointermove", onPointerMove, { passive: true });
    scroller.addEventListener("pointerup", onPointerUp, { passive: true });
    scroller.addEventListener("pointercancel", onPointerUp, { passive: true });
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
  }

  function refreshWallet() {
    if (!el.walletList) return;

    var fav = getFavorites();
    var favNorm = [];
    for (var i = 0; i < fav.length; i++) {
      var a = normalizeAddr(fav[i]);
      if (!a) continue;
      favNorm.push(a);
    }

    // Stable cache key: order matters (we preserve user ordering).
    var favKey = favNorm.join("|");

    // If nothing changed and cards already exist, avoid tearing down the DOM.
    // This prevents flicker/layout shifts when switching tabs or when boot refresh runs twice.
    try {
      var existingCards = el.walletList.querySelectorAll(".passCard");
      if (
        favKey &&
        walletState.lastFavKey === favKey &&
        existingCards &&
        existingCards.length === walletState.lastCardCount &&
        existingCards.length === favNorm.length &&
        walletState.lastCafesVersion === cafesVersion &&
        walletState.lastStampIconOk === !!stampIconState.ok &&
        walletState.lastServerCardsDigest === walletServerCardsDigest
      ) {
        setWalletEmptyVisible(false);
        if (WALLET_MODE === "stack") enableWalletStackMode(el.walletList);
        if (WALLET_MODE === "snap") enableWalletSnapMode(el.walletList);
        if (WALLET_MODE === "carousel") enableWalletCarouselMode(el.walletList);
        scheduleWalletStampsRefresh(80);
        return;
      }
    } catch (eCache) {}

    // Full rebuild (favorites changed)
    el.walletList.innerHTML = "";

    if (!favNorm.length) {
      walletState.lastFavKey = "";
      walletState.lastCardCount = 0;
      setWalletEmptyVisible(true);
      renderWelcomeCards();
      return;
    }

    setWalletEmptyVisible(false);

    var frag = document.createDocumentFragment();
    for (var j = 0; j < favNorm.length; j++) {
      var addr = favNorm[j];
      var cafe = cafesByCafeAddress[addr] || null;
      var serverCard = getServerCard(addr);
      var serverStats = serverCard && serverCard.stats ? serverCard.stats : {};
      var meta = resolveCafeDisplayMeta(addr, serverCard, cafe);
      frag.appendChild(
        buildPassCard({
          cafeAddress: addr,
          name: meta.name,
          address: meta.address,
          about: (cafe && cafe.about) || "",
          netStamps:
            Number(serverStats.netStamps || (serverCard && serverCard.netStamps) || 0) || 0,
          program: serverCard && serverCard.program ? serverCard.program : null,
          cardTheme:
            cafe && cafe.cardTheme && String(cafe.cardTheme) === "ink"
              ? "clean"
              : (cafe && cafe.cardTheme) || "clean",
          logoDataUrl: cafe && cafe.logoDataUrl ? cafe.logoDataUrl : null,
          cardBackgroundDataUrl:
            cafe && cafe.cardBackgroundDataUrl
              ? cafe.cardBackgroundDataUrl
              : null,
          cardBackText:
            cafe && cafe.cardBackText
              ? cafe.cardBackText
              : meta.loading
                ? "Caf\u00e9 wird geladen\u2026"
                : null,
        }),
      );
    }

    el.walletList.appendChild(frag);
    walletState.lastFavKey = favKey;
    walletState.lastCardCount = favNorm.length;
    walletState.lastCafesVersion = cafesVersion;
    walletState.lastStampIconOk = !!stampIconState.ok;
    walletState.lastServerCardsDigest = walletServerCardsDigest;

    if (WALLET_MODE === "stack") enableWalletStackMode(el.walletList);
    if (WALLET_MODE === "snap") enableWalletSnapMode(el.walletList);
    if (WALLET_MODE === "carousel") enableWalletCarouselMode(el.walletList);

    renderWelcomeCards();
    scheduleWalletStampsRefresh(40);
  }

  function scheduleWalletStampsRefresh(delayMs) {
    // Coalesce bursts (SSE + tab switches + boot) into a single refresh.
    var delay = clamp(Number(delayMs || 0) || 0, 0, 2000);
    var now = nowMs();

    // If we ran very recently, bias towards a short delay to keep UI responsive.
    var minGap = 260;
    var since = now - (walletState.stampsLastRunAt || 0);
    if (since < minGap) delay = Math.max(delay, minGap - since);

    try {
      walletState.stampsRefreshQueuedAt = now;
      if (walletState.stampsRefreshTimer) {
        window.clearTimeout(walletState.stampsRefreshTimer);
      }
    } catch (e0) {
      walletState.stampsRefreshTimer = 0;
    }

    walletState.stampsRefreshTimer = window.setTimeout(function () {
      walletState.stampsRefreshTimer = 0;
      refreshWalletStamps();
    }, delay);
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
      disconnectEventsStream();
      if (el.walletList) el.walletList.innerHTML = "";
      setWalletEmptyVisible(true);

      try {
        walletState.lastFavKey = "";
        walletState.lastCardCount = 0;
        walletState.lastCafesVersion = 0;
        walletState.lastStampIconOk = false;
        walletState.lastServerCardsDigest = "";
      } catch (e0) {}
      try {
        if (walletState.stampsRefreshTimer)
          window.clearTimeout(walletState.stampsRefreshTimer);
      } catch (e1) {}
      walletState.stampsRefreshTimer = 0;
      walletState.stampsInFlight = {};
      walletServerCardsByCafe = {};
      walletServerCardsDigest = "";
      closeWalletOverlay({ silent: true });

      setAuthedUI();
      currentPageMode = "map";
      navSetActive("map");
    });
  }

  function wireVisibility() {
    function onHidden() {
      try {
        disconnectEventsStream();
      } catch (e0) {}
      try {
        if (walletState && walletState.stampsRefreshTimer) {
          window.clearTimeout(walletState.stampsRefreshTimer);
          walletState.stampsRefreshTimer = 0;
        }
      } catch (e1) {}
    }

    function onVisible() {
      try {
        if (session && session.address) {
          connectEventsStream();
          syncFavoritesFromServerCards()
            .then(function (changed) {
              if (changed) refreshWallet();
            })
            .catch(function () {});
          scheduleWalletStampsRefresh(120);
          try {
            if (currentPageMode === "history") {
              refreshHistory();
            }
          } catch (eH) {}
        }
      } catch (e2) {}
    }

    try {
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) onHidden();
        else onVisible();
      });
    } catch (e3) {}

    // iOS Safari/WebView sometimes prefers pagehide/pageshow.
    try {
      window.addEventListener("pagehide", function () {
        onHidden();
      });
      window.addEventListener("pageshow", function () {
        onVisible();
      });
    } catch (e4) {}
  }

  function wireAccount() {
    function onAccountClick() {
      var isAuthed = !!(session && session.address);
      if (isAuthed) {
        try {
          location.href = "/customer-profile";
        } catch (e0) {}
        return;
      }

      // Not authed: bring the auth panel into view and default to login.
      try {
        setAuthMode("login");
      } catch (e1) {}
      try {
        if (el.authPanel) el.authPanel.style.display = "block";
        if (el.mainPanel) el.mainPanel.style.display = "none";
        if (el.layoutGrid) el.layoutGrid.classList.remove("authed");
      } catch (e2) {}
      try {
        if (el.authPanel && el.authPanel.scrollIntoView) {
          el.authPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } catch (e3) {
        try {
          if (el.authPanel && el.authPanel.scrollIntoView)
            el.authPanel.scrollIntoView(true);
        } catch (e4) {}
      }
      try {
        if (el.email && el.email.focus) el.email.focus();
        else if (el.username && el.username.focus) el.username.focus();
      } catch (e5) {}
    }

    if (el.sessionBadge) el.sessionBadge.addEventListener("click", onAccountClick);
  }

  function wireNavigation() {
    function bindModeButton(node, mode) {
      if (!node) return;
      node.addEventListener("click", function () {
        navigateToMode(mode);
      });
    }

    bindModeButton(el.bottomModeWallet, "wallet");
    bindModeButton(el.mainModeMap, "map");
    bindModeButton(el.mainModeWallet, "wallet");
    bindModeButton(el.mainModeHistory, "history");
    if (el.mainModeAccount) {
      el.mainModeAccount.addEventListener("click", function () {
        location.href = "/customer-profile";
      });
    }
  }

  function resetPassCardMotion(node) {
    if (!node) return;
    node.style.display = "block";
    node.style.pointerEvents = "auto";
    node.style.transition = "";
    node.style.setProperty("--wheel-tx", "0px");
    node.style.setProperty("--stack-swipe-y", "0px");
    node.style.setProperty("--wheel-rz", "0deg");
    node.style.setProperty("--wheel-ry", "0deg");
    node.style.setProperty("--wheel-tz", "0px");
    node.style.setProperty("--wheel-opacity", "1");
    node.style.setProperty("--wheel-scale", "1");
    node.style.setProperty("--wheel-sat", "1");
    node.style.setProperty("--wheel-bright", "1");
    node.style.setProperty("--stack-y", "0px");
    try {
      node.style.zIndex = "";
    } catch (eZ) {}
  }

  function enableWalletSnapMode(scroller) {
    if (!scroller) return;
    scroller.classList.remove("isCarousel");
    scroller.classList.remove("isStack");
    scroller.classList.remove("isDragging");
    scroller.classList.add("isSnap");
    try {
      var cards = scroller.querySelectorAll(".passCard");
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].classList && cards[i].classList.contains("open")) {
          closePass(cards[i]);
        }
        resetPassCardMotion(cards[i]);
      }
    } catch (e) {}
  }

  function enableWalletCarouselMode(scroller) {
    if (!scroller) return;
    scroller.classList.remove("isStack");
    scroller.classList.remove("isDragging");
    scroller.classList.remove("isSnap");
    scroller.classList.add("isCarousel");
    try {
      var cards = scroller.querySelectorAll(".passCard");
      for (var i = 0; i < cards.length; i++) {
        resetPassCardMotion(cards[i]);
        cards[i].style.pointerEvents = "auto";
      }
    } catch (e) {}
  }

  function apiFetch(path, init) {
    var url = apiBase + path;
    return fetch(url, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var err = new Error("api_error");
          try {
            err.status = res.status;
          } catch (e0) {}
          try {
            err.responseText = t || "";
          } catch (e1) {}
          throw err;
        });
      }
      return res.json();
    });
  }

  function setPassCardStamps(passCardEl, stamps) {
    if (!passCardEl) return;
    var stampCount = clamp(Number(stamps || 0) || 0, 0, 999);
    var rewardThreshold = getPassRewardThreshold(passCardEl);

    var prevCount = null;
    try {
      prevCount = getPassStampCount(passCardEl);
    } catch (ePrev0) {
      prevCount = null;
    }
    if (prevCount == null) prevCount = stampCount;

    try {
      passCardEl.setAttribute("data-stamps", String(stampCount));
    } catch (e0) {}

    var isFull = stampCount >= rewardThreshold;
    var extra = Math.max(0, stampCount - rewardThreshold);
    var remaining = Math.max(
      0,
      rewardThreshold - clamp(stampCount, 0, rewardThreshold),
    );
    var hint = passCardEl.querySelector(".passHint");
    if (hint)
      hint.textContent = isFull ? "QR zeigen und einl\u00f6sen" : "QR zeigen";

    var backText = passCardEl.querySelector(".passBackText");
    if (backText) {
      var existing = "";
      try {
        existing = String(backText.textContent || "").trim();
      } catch (e0) {
        existing = "";
      }

      var base = "";
      try {
        base = String(passCardEl.getAttribute("data-backtext-base") || "");
      } catch (eBase0) {
        base = "";
      }
      if (!base) {
        // Best-effort bootstrap for older cards: strip any existing full-info header.
        base = existing;
        if (
          base.indexOf("?? Karte voll!") === 0 ||
          base.indexOf("Karte voll!") === 0
        ) {
          var nl = base.indexOf("\n");
          base = nl >= 0 ? String(base.slice(nl + 1)).trim() : "";
        }
        try {
          passCardEl.setAttribute("data-backtext-base", String(base || ""));
        } catch (eBase1) {}
      }

      if (isFull) {
        var cafeTitle = "";
        try {
          var tEl =
            passCardEl.querySelector(".passBackTitle") ||
            passCardEl.querySelector(".passTitle");
          cafeTitle = tEl ? String(tEl.textContent || "").trim() : "";
        } catch (eT) {
          cafeTitle = "";
        }
        var info =
          "Karte voll! Einl\u00f6sen" +
          (cafeTitle ? " bei: " + cafeTitle : "") +
          ". Extra Stempel bleiben erhalten.";

        backText.textContent = base ? info + "\n" + base : info;
      } else {
        backText.textContent = base || existing || "";
      }
    }

    var sub = passCardEl.querySelector(".passSub");
    if (sub) sub.setAttribute("data-card-static", "1");

    var countLine = passCardEl.querySelector(".passCountLine");
    if (countLine) {
      countLine.textContent = formatStampCountLine(stampCount, rewardThreshold, extra);
    }

    var stampNeed = passCardEl.querySelector(".passStampNeed");
    if (stampNeed) {
      stampNeed.textContent = formatStampCountLine(stampCount, rewardThreshold, extra);
    }

    var progressHeadline = passCardEl.querySelector(".passProgressHeadline");
    if (progressHeadline) {
      progressHeadline.textContent = formatRewardProgressLine(
        remaining,
        isFull,
        passCardEl.getAttribute("data-reward-label") || "",
      );
    }

    var progressSub = passCardEl.querySelector(".passProgressSub");
    if (progressSub) {
      progressSub.textContent = formatNextStampLine(remaining, isFull);
    }

    var rewardNote = passCardEl.querySelector(".passRewardNote");
    if (rewardNote) {
      rewardNote.textContent = getRewardSideNote(
        passCardEl.getAttribute("data-reward-label") || "",
        isFull,
      );
    }

    var footerVisit = passCardEl.querySelector(".passFooterVisit");
    if (footerVisit) {
      footerVisit.textContent = formatFooterProgressLine(remaining, isFull);
    }

    var grid = passCardEl.querySelector(".stampGrid");
    if (grid) {
      renderStampGrid(grid, stampCount, prevCount);
    }

    if (
      prevCount != null &&
      Number(prevCount) < rewardThreshold &&
      stampCount >= rewardThreshold
    ) {
      launchRewardCelebration();
    }
  }

  function refreshWalletStamps() {
    if (!session || !session.address) return;
    if (!el.walletList) return;
    walletState.stampsLastRunAt = nowMs();
    var cards = el.walletList.querySelectorAll(".passCard");
    for (var i = 0; i < cards.length; i++) {
      (function (passEl) {
        try {
          var cafeAddress = passEl.getAttribute("data-cafe") || "";
          if (!cafeAddress) return;

          var key = normalizeAddr(cafeAddress);
          try {
            if (walletState.stampsInFlight && walletState.stampsInFlight[key]) {
              return;
            }
            if (walletState.stampsInFlight) walletState.stampsInFlight[key] = 1;
          } catch (eFlag) {}

          apiFetch(
            "/stamps/" +
              encodeURIComponent(session.address) +
              "?fallback=1&cafe=" +
              encodeURIComponent(cafeAddress),
          )
            .then(function (data) {
              var stamps =
                data && data.stamps != null
                  ? Number(data.stamps)
                  : data && data.count != null
                    ? Number(data.count)
                    : 0;
              setPassCardStamps(passEl, stamps);
            })
            .catch(function () {
              // non-fatal
            })
            .then(
              function () {
                try {
                  if (walletState.stampsInFlight)
                    delete walletState.stampsInFlight[key];
                } catch (eDel) {}
              },
              function () {
                try {
                  if (walletState.stampsInFlight)
                    delete walletState.stampsInFlight[key];
                } catch (eDel2) {}
              },
            );
        } catch (e) {}
      })(cards[i]);
    }
  }

  function disconnectEventsStream() {
    try {
      if (sseState.retryT) window.clearTimeout(sseState.retryT);
    } catch (e0) {}
    sseState.retryT = 0;
    try {
      if (sseState.es) sseState.es.close();
    } catch (e1) {}
    sseState.es = null;
    setLiveConnected(false);
  }

  function connectEventsStream() {
    if (!session || !session.address) return;
    if (typeof EventSource === "undefined") return;
    if (sseState.es) return;

    try {
      var url = apiBase + "/events/stream";
      var es = new EventSource(url);
      sseState.es = es;

      setLiveConnected(false);
      try {
        es.onopen = function () {
          setLiveConnected(true);
        };
      } catch (eOpen) {}

      es.onmessage = function (ev) {
        try {
          var obj = ev && ev.data ? JSON.parse(ev.data) : null;
          if (!obj) return;
          var who = normalizeAddr(obj.user || obj.customer || "");
          if (!who || who !== normalizeAddr(session.address)) return;

          var now = nowMs();
          if (now - (sseState.lastToastAt || 0) > 650) {
            sseState.lastToastAt = now;

            var cafeLabel =
              obj.cafeName || obj.cafe_name || obj.cafe || obj.qrCafe || "";
            cafeLabel = cafeLabel ? String(cafeLabel) : "";
            // Avoid showing address-like codes in the popup.
            if (
              /^0x[0-9a-f]{40}$/i.test(cafeLabel) ||
              /0x[0-9a-f]{12,}/i.test(cafeLabel)
            ) {
              cafeLabel = "";
            }

            var deltaRaw = obj.delta != null ? Number(obj.delta) : 0;
            var delta = isFinite(deltaRaw) ? deltaRaw : 0;
            var type = String(obj.event_type || obj.eventType || "");
            if (!type) type = delta < 0 ? "redeem" : delta > 0 ? "stamp" : "";

            var cafeAddr = normalizeAddr(
              obj.cafe ||
                obj.qrCafe ||
                obj.cafeAddress ||
                obj.cafe_address ||
                obj.cafe_addr ||
                "",
            );

            if (type === "stamp" && delta > 0) {
              showToast(
                "Stempel angekommen" +
                  (delta ? " (+" + delta + ")" : "") +
                  (cafeLabel ? " \u00b7 " + cafeLabel : ""),
                null,
              );
              try {
                if (cafeAddr) {
                  var passEl = findWalletPassCardByCafe(cafeAddr);
                  var prev = getPassStampCount(passEl);
                  if (passEl && prev != null)
                    setPassCardStamps(passEl, prev + delta);
                }
              } catch (eOpt) {}
            } else if (type === "redeem") {
              if (cafeAddr) clearRedeemTokenForCafe(cafeAddr);
              launchRedeemCelebration();
              showToast(
                "Belohnung eingel\u00f6st. Lass dir dein Getr\u00e4nk schmecken." +
                  (cafeLabel ? " \u00b7 " + cafeLabel : ""),
                null,
              );
            } else if (type === "card_start") {
              showToast(
                "Neue Karte gestartet" + (cafeLabel ? " \u00b7 " + cafeLabel : ""),
                null,
              );
            }
          }

          try {
            syncFavoritesFromServerCards()
              .then(function (changed) {
                if (changed) refreshWallet();
              })
              .catch(function () {});
          } catch (eSync) {}
          try {
            scheduleWalletStampsRefresh(120);
          } catch (eW) {}
          try {
            if (currentPageMode === "history") {
              refreshHistory();
            }
          } catch (eH) {}
        } catch (e2) {}
      };

      es.onerror = function () {
        setLiveConnected(false);
        try {
          disconnectEventsStream();
        } catch (e0) {}
        try {
          if (sseState.retryT) window.clearTimeout(sseState.retryT);
        } catch (e1) {}
        sseState.retryT = window.setTimeout(function () {
          sseState.retryT = 0;
          connectEventsStream();
        }, 1400);
      };
    } catch (e) {
      disconnectEventsStream();
    }
  }

  function handleAuthSubmit() {
    clearMsg();

    var email = el.email ? String(el.email.value || "").trim() : "";
    var password = el.password ? String(el.password.value || "").trim() : "";
    var username = el.username ? String(el.username.value || "").trim() : "";
    var confirmPassword = el.confirmPassword
      ? String(el.confirmPassword.value || "").trim()
      : "";
    var acceptPrivacy = !!document.getElementById("acceptPrivacy")?.checked;
    var acceptTerms = !!document.getElementById("acceptTerms")?.checked;

    if (!email || !password) {
      showMsg("danger", "Bitte E-Mail und Passwort ausf\u00fcllen.");
      return;
    }

    if (authMode === "register") {
      if (!username) {
        showMsg("danger", "Bitte Username ausf\u00fcllen.");
        return;
      }
      if (confirmPassword !== password) {
        showMsg("danger", "Passw\u00f6rter stimmen nicht \u00fcberein.");
        return;
      }

      if (!acceptPrivacy) {
        showMsg("danger", "Bitte best\u00e4tige die Datenschutzerkl\u00e4rung.");
        return;
      }
      if (!acceptTerms) {
        showMsg("danger", "Bitte akzeptiere die AGB.");
        return;
      }

      apiFetch("/customers/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: username,
          email: email,
          password: password,
          acceptPrivacy: acceptPrivacy,
          acceptTerms: acceptTerms,
        }),
      })
        .then(function (data) {
          if (!data || !data.verificationRequired) {
            throw new Error("Ungueltige Antwort");
          }
          if (el.email) el.email.value = email;
          if (el.password) el.password.value = "";
          if (el.confirmPassword) el.confirmPassword.value = "";
          clearSession();
          setAuthedUI();
          setAuthMode("login");
          showMsg(
            "success",
            "Fast geschafft. Bitte bestaetige jetzt deine E-Mail-Adresse. Danach kannst du dich direkt anmelden.",
          );
        })
        .catch(function (e) {
          var msg = window.stampUI
            ? stampUI.userSafeErrorMessage(e, "Registrierung fehlgeschlagen.")
            : "Registrierung fehlgeschlagen.";
          showMsg("danger", msg);
        });
      return;
    }

    apiFetch("/customers/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (data2) {
        if (!data2 || !data2.address) throw new Error("Ung\u00fcltige Antwort");
        saveSession({
          address: data2.address,
          email: email,
          username: data2.username || null,
          customer_id: data2.customer_id || null,
        });
        setAuthedUI();
        bootAuthed();
        applyPageMode(getPageMode());
      })
      .catch(function (e2) {
        var msg2 = window.stampUI
          ? stampUI.userSafeErrorMessage(e2, "Anmelden fehlgeschlagen.")
          : "Anmelden fehlgeschlagen.";
        showMsg("danger", msg2);
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
        var events = Array.isArray(data)
          ? data
          : data && data.events
            ? data.events
            : [];

        if (!Array.isArray(events) || !events.length) {
          if (el.historyEmpty) el.historyEmpty.style.display = "block";
          return;
        }

        // Merge consecutive stamp events from the same cafe within 5 minutes.
        var merged = [];
        for (var i = 0; i < events.length; i++) {
          var e = events[i] || {};
          var tsRaw = e.timestamp != null ? e.timestamp : e.ts;
          var ts = tsRaw != null ? Number(tsRaw) : null;
          var deltaRaw = e.delta != null ? Number(e.delta) : 0;
          var delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
          var type = String(e.eventType || e.event_type || "");
          if (!type) type = delta < 0 ? "redeem" : delta > 0 ? "stamp" : "";

          var last = merged.length ? merged[merged.length - 1] : null;
          if (
            last &&
            String(last.__type) === type &&
            normalizeAddr(last.cafe || "") === normalizeAddr(e.cafe || "") &&
            type === "stamp" &&
            ts != null &&
            last.timestamp != null &&
            Number.isFinite(Number(last.timestamp)) &&
            Math.abs(Number(last.timestamp) - ts) <= 5 * 60 * 1000
          ) {
            last.delta = Number(last.delta || 0) + delta;
            continue;
          }

          e.__type = type;
          e.timestamp = ts != null && Number.isFinite(ts) ? ts : null;
          e.delta = delta;
          merged.push(e);
        }

        for (var j = 0; j < merged.length; j++) {
          var ev = merged[j] || {};
          var item = document.createElement("div");
          item.className = "historyItem";

          var left = document.createElement("div");
          left.className = "historyLeft";

          var main = document.createElement("div");
          main.className = "historyMain";

          var cafeName = ev.cafeName || ev.cafe_name || ev.cafe || "";
          var cafeLabel = String(cafeName || "");
          if (/^0x[0-9a-f]{40}$/i.test(cafeLabel))
            cafeLabel = shortAddr(cafeLabel);
          if (!cafeLabel) cafeLabel = "Caf\u00e9";

          var cafe = document.createElement("div");
          cafe.className = "historyCafe";
          cafe.textContent = cafeLabel;

          var meta = document.createElement("div");
          meta.className = "historyMeta";
          var when = formatTs(ev.timestamp);
          var t = String(ev.__type || "");
          var verb =
            t === "redeem"
              ? "Belohnung eingel\u00f6st"
              : t === "card_start"
                ? "Neue Karte"
                : t === "stamp"
                  ? "Stempel"
                  : "Event";
          meta.textContent = (when ? when + " \u00b7 " : "") + verb;

          main.appendChild(cafe);
          main.appendChild(meta);
          left.appendChild(main);

          var right = document.createElement("div");
          right.className = "historyTx";
          if (t === "stamp") {
            right.textContent = "+" + Math.max(0, Number(ev.delta || 0));
          } else if (t === "redeem") {
            right.textContent = "-10";
          } else {
            right.textContent = ev.delta ? String(ev.delta) : "";
          }

          item.appendChild(left);
          item.appendChild(right);
          el.historyList.appendChild(item);
        }
      })
      .catch(function (e) {
        if (el.historyError) {
          el.historyError.style.display = "block";
          el.historyError.textContent = window.stampUI
            ? stampUI.userSafeErrorMessage(e, "Historie konnte nicht geladen werden.")
            : "Historie konnte nicht geladen werden.";
      }
    });
  }

  function wireForgotPasswordInline() {
    if (!el.authForgotToggle || !el.authForgotPanel) return;

    function resetForgotNotice() {
      if (!el.authForgotMsg) return;
      el.authForgotMsg.style.display = "none";
      el.authForgotMsg.textContent = "";
      el.authForgotMsg.className = "notice";
    }

    function setForgotOpen(open) {
      el.authForgotPanel.style.display = open ? "flex" : "none";
      el.authForgotToggle.textContent = open
        ? "Schlie\u00dfen"
        : "Passwort vergessen?";
      if (!open) resetForgotNotice();
    }

    el.authForgotToggle.addEventListener("click", function () {
      var isOpen = el.authForgotPanel.style.display !== "none";
      setForgotOpen(!isOpen);
      if (!isOpen) {
        try {
          if (el.email && el.email.focus) el.email.focus();
        } catch (e) {}
      }
    });

    if (el.authForgotSubmit) {
      el.authForgotSubmit.addEventListener("click", function () {
        var email = el.email ? String(el.email.value || "").trim() : "";
        if (!el.authForgotMsg) return;
        el.authForgotMsg.style.display = "block";
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
          el.authForgotMsg.className = "notice danger";
          el.authForgotMsg.textContent =
            "Bitte zuerst eine g\u00fcltige E-Mail eingeben.";
          return;
        }
        el.authForgotSubmit.disabled = true;
        el.authForgotSubmit.textContent = "Wird gesendet...";
        apiFetch("/customers/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        })
          .then(function () {
            el.authForgotMsg.className = "notice";
            el.authForgotMsg.textContent =
              "Wenn die Adresse existiert, wurde ein Reset-Link versendet.";
          })
          .catch(function (e) {
            el.authForgotMsg.className = "notice danger";
            el.authForgotMsg.textContent =
              window.stampUI && window.stampUI.userSafeErrorMessage
                ? window.stampUI.userSafeErrorMessage(
                    e,
                    "Reset-Link konnte nicht gesendet werden.",
                  )
                : "Reset-Link konnte nicht gesendet werden.";
          })
          .finally(function () {
            el.authForgotSubmit.disabled = false;
            el.authForgotSubmit.textContent = "OK";
          });
      });
    }

    if (el.authResendVerificationBtn) {
      el.authResendVerificationBtn.addEventListener("click", function () {
        var email = el.email ? String(el.email.value || "").trim() : "";
        clearMsg();
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
          showMsg("danger", "Bitte zuerst oben eine gueltige E-Mail eingeben.");
          return;
        }
        el.authResendVerificationBtn.disabled = true;
        el.authResendVerificationBtn.textContent = "Wird gesendet...";
        apiFetch("/customers/resend-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        })
          .then(function (data) {
            if (data && data.alreadyVerified) {
              showMsg(
                "success",
                "Diese E-Mail-Adresse ist bereits bestaetigt. Du kannst dich direkt anmelden.",
              );
              return;
            }
            showMsg(
              "success",
              "Wenn die Adresse zu einem unbestaetigten Konto gehoert, haben wir dir gerade einen neuen Bestaetigungslink geschickt.",
            );
          })
          .catch(function (e) {
            showMsg(
              "danger",
              window.stampUI
                ? stampUI.userSafeErrorMessage(
                    e,
                    "Bestaetigungslink konnte nicht neu gesendet werden.",
                  )
                : "Bestaetigungslink konnte nicht neu gesendet werden.",
            );
          })
          .then(function () {
            el.authResendVerificationBtn.disabled = false;
            el.authResendVerificationBtn.textContent =
              "Bestaetigungslink erneut senden";
          });
      });
    }
  }

  function bootAuthed() {
    refreshWallet();
    connectEventsStream();
    syncFavoritesFromServerCards()
      .then(function (changed) {
        if (changed) refreshWallet();
      })
      .catch(function () {
        // non-fatal
      });
    apiFetch("/cafes/public")
      .then(function (data) {
        var list = Array.isArray(data)
          ? data
          : data && data.cafes
            ? data.cafes
            : [];
        cafes = dedupeCafes(list);
        cafesLoaded = true;
        cafesByCafeAddress = {};
        for (var i = 0; i < cafes.length; i++) {
          var c = cafes[i] || {};
          var addr = normalizeAddr(c.cafeAddress || c.address);
          if (!addr) continue;
          cafesByCafeAddress[addr] = c;
          rememberCafeMeta(addr, {
            name: c.name || "",
            address: c.address || "",
          });
        }

        cafesVersion = (cafesVersion || 0) + 1;

        // The map page uses the searchable list (#cafeResults). A second list would duplicate items.
        wireCafeSearch();
        syncMapMarkers();
        ensureMapInit();
      })
      .catch(function () {
        cafesLoaded = true;
        // non-fatal
      })
      .then(function () {
        try {
          syncFavoritesFromServerCards().then(function (changed) {
            if (changed) refreshWallet();
          });
        } catch (eSync) {}
        // Avoid Promise.prototype.finally for older Safari/WebView builds.
        refreshWallet();
        try {
          connectEventsStream();
        } catch (e0) {}
      });
  }

  function main() {
    if (isIOS()) {
      try {
        document.documentElement.classList.add("ios");
      } catch (e) {}
    }

    try {
      if (el.walletSubtitle) {
        el.walletSubtitle.textContent =
          "W\u00e4hle eine Karte und zeig im Caf\u00e9 direkt deinen QR-Code.";
      }
      if (el.utilityMapBtn) {
        el.utilityMapBtn.textContent = "Caf\u00e9s";
      }
      if (el.mainModeMap) {
        var lbl = el.mainModeMap.querySelector(".lbl");
        if (lbl) lbl.textContent = "Entdecken";
      }
      if (el.mainModeWallet) {
        var walletLbl = el.mainModeWallet.querySelector(".lbl");
        if (walletLbl) walletLbl.textContent = "Karten";
      }
      if (el.authPanel) {
        var authHint = el.authPanel.querySelector(".hint:last-of-type");
        if (authHint) {
          authHint.textContent =
            "Kein Schl\u00fcssel, kein Technikstress. Stamp legt die technische Kunden-Adresse automatisch f\u00fcr dich an.";
        }
      }
    } catch (eText) {}

    setBuildBadge();
    // Try to load an exact stamp image; if present, re-render the wallet so
    // the icon becomes pixel-identical to the provided reference.
    try {
      primeStampIcon().then(function (ok) {
        if (!ok) return;
        try {
          if (session && session.address) refreshWallet();
        } catch (e0) {}
      });
    } catch (ePrime) {}

    wireAuth();
    wireForgotPasswordInline();
    wireAccount();
    wireLogout();
    wireShellMenu();
    bindBrandLinksToWelcome();
    wireNavigation();
    wireScreenPager();
    wireVisibility();
    try {
      window.addEventListener("popstate", function () {
        currentPageMode = null;
        applyPageMode(getPageMode());
      });
    } catch (ePop) {}

    // CafÃƒÂ© details modal
    if (el.cafeModalClose)
      el.cafeModalClose.addEventListener("click", function () {
        closeCafeModal();
      });
    if (el.cafeModalBackdrop)
      el.cafeModalBackdrop.addEventListener("click", function (ev) {
        // Click outside modal closes
        try {
          if (ev && ev.target === el.cafeModalBackdrop) closeCafeModal();
        } catch (e) {}
      });
    if (el.cafeModalAddBtn)
      el.cafeModalAddBtn.addEventListener("click", function () {
        var addr = cafeModalState.cafeAddress || "";
        if (!addr) return;
        openWalletForCafe(addr, { ensureFavorite: true, showQr: false });
      });
    if (el.cafeModalWalletBtn)
      el.cafeModalWalletBtn.addEventListener("click", function () {
        var addr = cafeModalState.cafeAddress || "";
        if (!addr) return;
        openWalletForCafe(addr, { ensureFavorite: true, showQr: false });
      });
    if (el.cafeModalQrBtn)
      el.cafeModalQrBtn.addEventListener("click", function () {
        var addr = cafeModalState.cafeAddress || "";
        if (!addr) return;
        openWalletForCafe(addr, { ensureFavorite: true, showQr: true });
      });

    if (el.discoverPickAddBtn) {
      el.discoverPickAddBtn.addEventListener("click", function () {
        onAddPickedCafe();
      });
    }
    if (el.walletEmptyMapBtn) {
      el.walletEmptyMapBtn.addEventListener("click", function () {
        closeWalletOverlay({ silent: true });
        navigateToMode("map");
      });
    }
    if (el.welcomePrimaryAction) {
      el.welcomePrimaryAction.addEventListener("click", function () {
        var hasCards = false;
        try {
          hasCards = getFavorites().length > 0;
        } catch (eFav) {
          hasCards = false;
        }
        if (hasCards) {
          openWalletOverlay();
          return;
        }
        navigateToMode("map");
      });
    }
    if (el.walletOverlayBackdrop) {
      el.walletOverlayBackdrop.addEventListener("click", function () {
        closeWalletOverlay();
      });
    }
    if (el.walletOverlayClose) {
      el.walletOverlayClose.addEventListener("click", function () {
        closeWalletOverlay();
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
    setAuthMode("login");
    applyPageMode(getPageMode());
    processCustomerVerifyToken();

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

  try {
    main();
  } catch (e) {
    try {
      window.__STAMP_BOOT_CRASH = String(
        (e && (e.stack || e.message)) || e || "unknown",
      ).slice(0, 800);
    } catch (e2) {}

    // Avoid leaving the user stuck behind the boot overlay.
    try {
      setBootOk();
    } catch (e3) {}

    try {
      var msg = window.stampUI
        ? stampUI.userSafeErrorMessage(
            e,
            "Die App konnte nicht geladen werden. Bitte neu laden.",
          )
        : "Die App konnte nicht geladen werden. Bitte neu laden.";
      showMsg("danger", msg);
    } catch (e4) {}

    try {
      console.error("Customer app boot crashed", e);
    } catch (e5) {}
  }
})();






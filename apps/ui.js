(function () {
  function isDebugEnabled() {
    try {
      var sp = new URLSearchParams(window.location.search || "");
      if (sp.get("debug") === "1") return true;
    } catch (e) {}
    try {
      return window.localStorage.getItem("stamp_debug") === "1";
    } catch (e2) {
      return false;
    }
  }

  function tryParseJson(text) {
    if (!text || typeof text !== "string") return null;
    var t = String(text).trim();
    if (!t) return null;
    var first = t[0];
    if (first !== "{" && first !== "[") return null;
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  }

  function redactTechnical(text) {
    var s = String(text || "");

    // Hide long hex addresses and token-like substrings.
    s = s.replace(/0x[0-9a-f]{12,}/gi, "0x…");
    s = s.replace(/bearer\s+[a-z0-9._\-]+/gi, "Bearer …");

    // Avoid dumping full HTML error pages or stack traces.
    if (s.length > 220) s = s.slice(0, 220) + "…";

    // Strip newlines for compact UI.
    s = s.replace(/[\r\n]+/g, " ").trim();
    return s;
  }

  function extractDetails(err) {
    var info = {
      status: null,
      code: "",
      message: "",
      responseText: "",
      raw: err,
    };

    try {
      if (err && typeof err === "object") {
        if (err.status != null) info.status = Number(err.status);
        else if (err.statusCode != null) info.status = Number(err.statusCode);

        if (err.code != null) info.code = String(err.code || "");
        if (err.message != null) info.message = String(err.message || "");

        if (err.responseText != null)
          info.responseText = String(err.responseText || "");
        else if (err.body != null) info.responseText = String(err.body || "");
        else if (err.detail != null && typeof err.detail === "string")
          info.responseText = String(err.detail || "");
      } else if (typeof err === "string") {
        info.message = err;
      }
    } catch (e) {}

    // If message is a JSON blob, try to unpack it.
    var parsed = tryParseJson(info.responseText || info.message);
    if (parsed && typeof parsed === "object") {
      try {
        if (parsed.status != null && info.status == null)
          info.status = Number(parsed.status);
      } catch (e0) {}
      try {
        if (!info.code && (parsed.code || parsed.error))
          info.code = String(parsed.code || parsed.error || "");
      } catch (e1) {}
      try {
        if (!info.message && (parsed.message || parsed.error))
          info.message = String(parsed.message || parsed.error || "");
      } catch (e2) {}
    }

    // If message looks like "HTTP 401" etc, extract status.
    if (info.status == null) {
      try {
        var m = String(info.message || "").match(/\bHTTP\s*(\d{3})\b/i);
        if (m) info.status = Number(m[1]);
      } catch (e3) {}
    }

    return info;
  }

  function mapToUserMessage(info, fallback) {
    var status = info && info.status != null ? Number(info.status) : null;
    var code = String((info && (info.code || "")) || "").trim();
    var msg = String((info && (info.message || "")) || "").trim();
    var raw = (code || msg || "").toLowerCase();

    // Network / connectivity
    if (
      raw.indexOf("failed to fetch") >= 0 ||
      raw.indexOf("networkerror") >= 0 ||
      raw.indexOf("load failed") >= 0 ||
      raw.indexOf("network request failed") >= 0 ||
      raw.indexOf("ecconnrefused") >= 0 ||
      raw.indexOf("econnrefused") >= 0
    ) {
      return api.copy.feedback.networkError;
    }

    if (
      raw.indexOf("wrong_password") >= 0 ||
      raw.indexOf("invalid_email_or_password") >= 0 ||
      raw.indexOf("invalid_credentials") >= 0
    ) {
      return "E-Mail oder Passwort stimmt nicht.";
    }
    if (raw.indexOf("email_already_registered") >= 0) {
      return "Zu dieser E-Mail gibt es bereits ein Konto. Bitte einloggen oder Passwort zurücksetzen.";
    }
    if (raw.indexOf("email_verification_pending") >= 0) {
      return "Fast geschafft. Wir haben dir gerade einen Bestaetigungslink per E-Mail geschickt.";
    }
    if (raw.indexOf("verification_email_failed") >= 0) {
      return "Die Bestaetigungs-Mail konnte gerade nicht verschickt werden. Bitte gleich noch einmal versuchen.";
    }
    if (raw.indexOf("email_not_verified") >= 0) {
      return "Bitte bestaetige zuerst deine E-Mail-Adresse. Danach kannst du dich direkt anmelden.";
    }
    if (raw.indexOf("google_no_account") >= 0) {
      return "Zu dieser Google-Adresse gibt es noch kein Konto. Bitte registriere dich zuerst.";
    }
    if (raw.indexOf("google_legal_required") >= 0) {
      return "Bitte bestaetige vor der Google-Registrierung Datenschutz und AGB.";
    }
    if (raw.indexOf("google_auth_not_configured") >= 0) {
      return "Google-Anmeldung ist gerade noch nicht freigeschaltet.";
    }
    if (raw.indexOf("password_not_set") >= 0) {
      return "Fuer dieses Konto ist noch kein Passwort gesetzt.";
    }
    if (raw.indexOf("invalid_or_expired") >= 0) {
      return "Der Link ist ungueltig oder abgelaufen. Bitte fordere einen neuen Bestaetigungs- oder Reset-Link an.";
    }
    if (raw.indexOf("invalid_token") >= 0) {
      return "Der Reset-Link ist ungueltig.";
    }
    if (raw.indexOf("not_found") >= 0 || raw.indexOf("customer_not_found") >= 0) {
      return "Konto nicht gefunden.";
    }
    if (
      raw.indexOf("invalid_oauth_token") >= 0 ||
      raw.indexOf("invalid_or_expired_oauth_token") >= 0
    ) {
      return "Die Google-Anmeldung ist abgelaufen. Bitte versuche es noch einmal.";
    }

    // Session/auth
    if (
      raw.indexOf("unauthorized") >= 0 ||
      raw.indexOf("forbidden") >= 0 ||
      raw.indexOf("invalid_token") >= 0 ||
      raw.indexOf("token_expired") >= 0 ||
      raw.indexOf("session_expired") >= 0 ||
      raw.indexOf("auth") === 0
    ) {
      return "Sitzung abgelaufen. Bitte neu anmelden.";
    }

    // Common app codes
    if (raw.indexOf("cafe_not_found") >= 0) {
      return "Café nicht gefunden.";
    }
    if (raw.indexOf("file_read_failed") >= 0) {
      return "Datei konnte nicht gelesen werden. Bitte erneut versuchen.";
    }

    // Validation-ish
    if (
      status === 400 ||
      status === 422 ||
      raw.indexOf("validation") >= 0 ||
      raw.indexOf("ungült") >= 0
    ) {
      return "Eingaben bitte prüfen und erneut versuchen.";
    }

    // Not found
    if (status === 404) {
      return "Nicht gefunden.";
    }

    // Conflict
    if (status === 409 || raw.indexOf("already") >= 0) {
      return "Das gibt es bereits. Bitte prüfen und erneut versuchen.";
    }

    // Server errors
    if (status != null && status >= 500) {
      return "Serverfehler. Bitte später erneut versuchen.";
    }

    // Default
    return String(fallback || api.copy.feedback.genericError);
  }

  function userSafeErrorMessage(err, fallback) {
    var info = extractDetails(err);
    var base = mapToUserMessage(info, fallback);

    if (isDebugEnabled()) {
      var parts = [];
      try {
        if (info.status != null && isFinite(info.status))
          parts.push("HTTP " + info.status);
      } catch (e0) {}
      try {
        var raw = info && (info.responseText || info.message || info.code);
        raw = redactTechnical(raw);
        if (raw) parts.push(raw);
      } catch (e1) {}
      if (parts.length) return base + " (" + parts.join(" · ") + ")";
    }

    return base;
  }

  // Shared bottom tab bar (one design source for all pages).
  // Guest pages get the dark espresso bar, café pages the cream bar.
  var TABBAR_CSS =
    ".kk-tabbar{position:fixed;left:0;right:0;margin:0 auto;" +
    "bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;align-items:stretch;" +
    "gap:4px;padding:6px;border-radius:999px;z-index:120;width:max-content;" +
    "max-width:min(460px,calc(100vw - 20px));}" +
    // !important: App-Seiten stylen <button> global sehr aggressiv.
    ".kk-tab{appearance:none;border:none !important;background:transparent !important;" +
    "min-height:52px;padding:6px 18px;border-radius:999px !important;font:inherit;" +
    "display:inline-flex;flex-direction:column;align-items:center;justify-content:center;" +
    "gap:2px;cursor:pointer;white-space:nowrap;box-shadow:none !important;filter:none !important;" +
    "text-decoration:none;transition:background 160ms ease,color 160ms ease;}" +
    ".kk-tabIcon{display:flex;align-items:center;justify-content:center;width:20px;height:20px;}" +
    ".kk-tabIcon svg{width:100%;height:100%;display:block;}" +
    ".kk-tabLabel{font-size:11px;font-weight:800;letter-spacing:0.01em;}" +
    // Zentraler, hervorgehobener Nav-Button (z.B. Wallet) - ragt wie ein FAB
    // ueber die Bottom-Bar hinaus statt nur bei "active" aufzufallen.
    ".kk-tab--featured{min-height:62px !important;padding:8px 26px !important;" +
    "background:linear-gradient(180deg,#fffaf3,#f5ecdf) !important;color:#241710 !important;" +
    "box-shadow:0 14px 26px rgba(20,10,4,0.32),0 1px 0 rgba(255,255,255,0.9) inset !important;}" +
    ".kk-tab--featured:hover{color:#241710 !important;}" +
    ".kk-tab--featured .kk-tabLabel{font-size:12px;}" +
    ".kk-tabbar--espresso{background:linear-gradient(180deg,#2c1e15,#1d130d);" +
    "border:1px solid rgba(255,241,233,0.1);" +
    "box-shadow:0 18px 40px rgba(30,18,10,0.35),0 1px 0 rgba(255,255,255,0.06) inset;}" +
    ".kk-tabbar--espresso .kk-tab{background:transparent !important;" +
    "border:none !important;color:rgba(242,228,216,0.62) !important;}" +
    ".kk-tabbar--espresso .kk-tab:hover{color:rgba(255,248,241,0.92) !important;}" +
    ".kk-tabbar--espresso .kk-tab.active{background:#f5ecdf !important;color:#241710 !important;" +
    "box-shadow:0 6px 14px rgba(0,0,0,0.25) !important;}" +
    ".kk-tabbar--cream{background:linear-gradient(180deg,rgba(252,248,242,0.98),rgba(240,229,216,0.96));" +
    "border:1px solid rgba(81,58,40,0.14);" +
    "box-shadow:0 18px 40px rgba(20,12,7,0.45),0 1px 0 rgba(255,255,255,0.85) inset;}" +
    ".kk-tabbar--cream .kk-tab{background:transparent !important;" +
    "border:none !important;color:rgba(59,42,31,0.6) !important;}" +
    ".kk-tabbar--cream .kk-tab:hover{color:rgba(43,28,20,0.92) !important;}" +
    ".kk-tabbar--cream .kk-tab.active{background:#2a1d15 !important;color:#f5ecdf !important;" +
    "box-shadow:0 6px 14px rgba(0,0,0,0.3) !important;}" +
    "body.kk-hasTabbar{padding-bottom:calc(92px + env(safe-area-inset-bottom,0px));}" +
    "body.installHintOpen .kk-tabbar{opacity:0;pointer-events:none;}" +
    "@media (max-width:520px){.kk-tabbar{width:calc(100vw - 20px);}" +
    ".kk-tab{flex:1 1 0;padding:6px 4px;}.kk-tabLabel{font-size:10px;}}";

  // Simple single-color stroke icons (currentColor) - no external assets,
  // so they automatically pick up the tab's existing hover/active/featured
  // color rules.
  var TAB_ICON_DISCOVER =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M15.3 8.7l-2.1 4.9-4.9 2.1 2.1-4.9z"/></svg>';
  var TAB_ICON_WALLET =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.2h18"/>' +
    '<circle cx="16.6" cy="14.3" r="1" fill="currentColor" stroke="none"/></svg>';
  var TAB_ICON_HISTORY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.3 1.9"/></svg>';

  function injectTabbarCss() {
    if (document.getElementById("kkTabbarStyles")) return;
    var style = document.createElement("style");
    style.id = "kkTabbarStyles";
    style.textContent = TABBAR_CSS;
    document.head.appendChild(style);
  }

  function mountBottomNav(options) {
    var o = options || {};
    injectTabbarCss();
    var existing = document.querySelector(".kk-tabbar");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var nav = document.createElement("nav");
    nav.className =
      "kk-tabbar " +
      (o.theme === "cream" ? "kk-tabbar--cream" : "kk-tabbar--espresso");
    nav.setAttribute("aria-label", "Hauptnavigation");
    var items = Array.isArray(o.items) ? o.items : [];
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        if (!item || !item.label) return;
        var node = document.createElement(item.href ? "a" : "button");
        // "ghost" nimmt die Buttons aus den aggressiven globalen
        // button:not(...)-Regeln von theme.css heraus.
        node.className = "kk-tab ghost" + (item.active ? " active" : "");
        if (item.id) node.id = item.id;
        if (item.href) node.href = item.href;
        else node.type = "button";
        if (item.icon) {
          var iconSpan = document.createElement("span");
          iconSpan.className = "kk-tabIcon";
          iconSpan.innerHTML = item.icon;
          node.appendChild(iconSpan);
        }
        var labelSpan = document.createElement("span");
        labelSpan.className = "kk-tabLabel";
        labelSpan.textContent = item.label;
        node.appendChild(labelSpan);
        if (item.onClick) node.addEventListener("click", item.onClick);
        nav.appendChild(node);
      })(items[i]);
    }
    document.body.appendChild(nav);
    document.body.classList.add("kk-hasTabbar");
    return nav;
  }

  var CAFE_TOP_PROFILE_CSS =
    ".kk-cafeTopProfile{width:44px;height:44px;min-width:44px;min-height:44px;padding:0;" +
    "border:1px solid rgba(245,236,223,0.16) !important;border-radius:16px !important;" +
    "background:linear-gradient(180deg,#3a2a1c,#241710) !important;" +
    "display:inline-flex;align-items:center;justify-content:center;overflow:hidden;" +
    "box-shadow:0 8px 18px rgba(0,0,0,0.28) !important;color:#f5ecdf !important;" +
    "font-weight:900;font-size:15px;cursor:pointer;}" +
    ".kk-cafeTopProfile img{width:100%;height:100%;object-fit:cover;display:block;}";

  function injectCafeTopProfileCss() {
    if (document.getElementById("kkCafeTopProfileStyles")) return;
    var style = document.createElement("style");
    style.id = "kkCafeTopProfileStyles";
    style.textContent = CAFE_TOP_PROFILE_CSS;
    document.head.appendChild(style);
  }

  // Top-right Avatar (Logo/Initiale) mit Link zum Cafe-Profil - Gegenstueck
  // zum topProfileBtn der Kunden-App, ersetzt dort den "Karte"-Nav-Eintrag.
  function mountCafeTopProfile(options) {
    var o = options || {};
    var row = document.querySelector(".topbar .row");
    if (!row) return null;
    injectCafeTopProfileCss();
    var btn = document.getElementById("kkCafeTopProfileBtn");
    var isNew = !btn;
    if (isNew) {
      btn = document.createElement("button");
      btn.id = "kkCafeTopProfileBtn";
      btn.type = "button";
      btn.className = "kk-cafeTopProfile ghost";
    }
    btn.setAttribute(
      "aria-label",
      o.name ? "Profil von " + o.name : "Cafe-Profil",
    );
    btn.innerHTML = "";
    if (o.logoDataUrl) {
      var img = document.createElement("img");
      img.src = o.logoDataUrl;
      img.alt = "";
      img.decoding = "async";
      btn.appendChild(img);
    } else {
      var initial = String(o.name || "C").trim().slice(0, 1).toUpperCase() || "C";
      btn.textContent = initial;
    }
    btn.onclick = function () {
      location.href = o.href || "/cafe-profile";
    };
    if (isNew) row.insertBefore(btn, row.firstChild);
    return btn;
  }

  var CUSTOMER_TOP_PROFILE_CSS =
    ".kk-customerTopProfile{width:44px;height:44px;min-width:44px;min-height:44px;padding:0;" +
    "border:1px solid rgba(81,58,40,0.1) !important;border-radius:16px !important;" +
    "background:linear-gradient(180deg,rgba(255,252,247,0.98),rgba(247,238,228,0.96)) !important;" +
    "display:inline-flex;align-items:center;justify-content:center;overflow:hidden;" +
    "box-shadow:0 8px 18px rgba(68,41,22,0.08) !important;color:#6b452c !important;" +
    "font-weight:900;font-size:15px;cursor:pointer;}" +
    ".kk-customerTopProfile img{width:100%;height:100%;object-fit:cover;display:block;}";

  function injectCustomerTopProfileCss() {
    if (document.getElementById("kkCustomerTopProfileStyles")) return;
    var style = document.createElement("style");
    style.id = "kkCustomerTopProfileStyles";
    style.textContent = CUSTOMER_TOP_PROFILE_CSS;
    document.head.appendChild(style);
  }

  // Top-right Avatar (Foto/Initiale) mit Link zum Kundenprofil - fuer Seiten
  // ohne eigenes topProfileBtn (customer-qr-modern.html hat sein eigenes,
  // bereits fertiges - dieses hier ist fuer die anderen Kunden-Seiten wie
  // cafe-public.html, analog zu mountCafeTopProfile fuer die Cafe-Seite).
  function mountCustomerTopProfile(options) {
    var o = options || {};
    var row = document.querySelector(".topbar .row");
    if (!row) return null;
    injectCustomerTopProfileCss();
    var btn = document.getElementById("kkCustomerTopProfileBtn");
    var isNew = !btn;
    if (isNew) {
      btn = document.createElement("button");
      btn.id = "kkCustomerTopProfileBtn";
      btn.type = "button";
      btn.className = "kk-customerTopProfile ghost";
    }
    btn.setAttribute("aria-label", "Profil öffnen");
    btn.innerHTML = "";
    if (o.avatarDataUrl) {
      var img = document.createElement("img");
      img.src = o.avatarDataUrl;
      img.alt = "";
      img.decoding = "async";
      btn.appendChild(img);
    } else {
      var initial = String(o.initial || "P").trim().slice(0, 1).toUpperCase() || "P";
      btn.textContent = initial;
    }
    btn.onclick = function () {
      location.href = o.href || "/customer-profile";
    };
    if (isNew) row.insertBefore(btn, row.firstChild);
    return btn;
  }

  // Public API
  var api = (window.stampUI = window.stampUI || {});
  if (!api.copy) {
    api.copy = {
      navigation: {
        cafes: "Cafés",
        cards: "Karten",
        profile: "Profil",
        history: "Verlauf",
      },
      actions: {
        getCard: "Karte holen",
        showQr: "Im Café vorzeigen",
        openCards: "Stempelkarten",
        viewCafe: "Café ansehen",
        discoverCafes: "Cafés entdecken",
        addHome: "Zum Homescreen hinzufügen",
      },
      emptyStates: {
        noCardsTitle: "Noch kein Lieblingscafé dabei?",
        noCardsText:
          "Entdecke Cafés in deiner Nähe und hol dir deine erste Karte.",
        noRewardsTitle: "Noch ein paar Kaffees.",
        noRewardsText:
          "Wir sagen dir Bescheid, sobald deine nächste Belohnung bereit ist.",
      },
      feedback: {
        updatedCard: "Deine Karte ist wieder aktuell.",
        rewardReady: "Der nächste geht aufs Haus.",
        stampAdded: "Neuer Stempel. Bis zum nächsten Kaffee.",
        genericError: "Das hat gerade nicht geklappt. Versuch es noch einmal.",
        networkError:
          "Gerade keine Verbindung. Deine Karte wartet hier auf dich.",
      },
    };
  }
  if (!api.isDebugEnabled) api.isDebugEnabled = isDebugEnabled;
  if (!api.mountBottomNav) api.mountBottomNav = mountBottomNav;
  if (!api.mountCafeTopProfile) api.mountCafeTopProfile = mountCafeTopProfile;
  if (!api.mountCustomerTopProfile)
    api.mountCustomerTopProfile = mountCustomerTopProfile;
  if (!api.tabIcons)
    api.tabIcons = {
      discover: TAB_ICON_DISCOVER,
      wallet: TAB_ICON_WALLET,
      history: TAB_ICON_HISTORY,
    };
  if (!api.userSafeErrorMessage)
    api.userSafeErrorMessage = userSafeErrorMessage;

  // Compatibility aliases (older pages)
  if (!window.userSafeErrorMessage)
    window.userSafeErrorMessage = userSafeErrorMessage;
})();

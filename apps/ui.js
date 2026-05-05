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
      return "Keine Verbindung. Bitte prüfen, ob API und Apps-Server laufen.";
    }

    if (
      raw.indexOf("wrong_password") >= 0 ||
      raw.indexOf("invalid_email_or_password") >= 0
    ) {
      return "E-Mail oder Passwort stimmt nicht.";
    }
    if (raw.indexOf("email_already_registered") >= 0) {
      return "Zu dieser E-Mail gibt es bereits ein Konto. Bitte einloggen oder Passwort zurücksetzen.";
    }
    if (raw.indexOf("password_not_set") >= 0) {
      return "Fuer dieses Konto ist noch kein Passwort gesetzt.";
    }
    if (raw.indexOf("invalid_or_expired") >= 0) {
      return "Der Reset-Link ist ungueltig oder abgelaufen. Bitte fordere einen neuen an.";
    }
    if (raw.indexOf("invalid_token") >= 0) {
      return "Der Reset-Link ist ungueltig.";
    }
    if (raw.indexOf("not_found") >= 0 || raw.indexOf("customer_not_found") >= 0) {
      return "Konto nicht gefunden.";
    }

    // Session/auth
    if (
      status === 401 ||
      status === 403 ||
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
    return String(fallback || "Ein Fehler ist aufgetreten.");
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

  // Public API
  var api = (window.stampUI = window.stampUI || {});
  if (!api.isDebugEnabled) api.isDebugEnabled = isDebugEnabled;
  if (!api.userSafeErrorMessage)
    api.userSafeErrorMessage = userSafeErrorMessage;

  // Compatibility aliases (older pages)
  if (!window.userSafeErrorMessage)
    window.userSafeErrorMessage = userSafeErrorMessage;
})();

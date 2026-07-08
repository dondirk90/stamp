(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function qs(sel) {
    return document.querySelector(sel);
  }

  function getResetToken() {
    try {
      return new URL(location.href).searchParams.get("resetToken") || "";
    } catch (e) {
      return "";
    }
  }

  function clearQueryToken(name) {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has(name)) return;
      u.searchParams.delete(name);
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  function loginPrimaryActions() {
    var btn = qs('button[onclick="submitLogin()"]');
    return btn ? btn.closest(".button-group") : null;
  }

  function forgotActionWrap() {
    var btn = qs('button[onclick="toggleCafeForgotPassword(true)"]');
    return btn ? btn.parentElement : null;
  }

  function resendActionWrap() {
    var btn = qs('button[onclick="resendCafeVerification()"]');
    return btn ? btn.parentElement : null;
  }

  function resendButton() {
    return qs('button[onclick="resendCafeVerification()"]');
  }

  function loginEmailField() {
    return byId("loginEmail");
  }

  function loginPasswordField() {
    return byId("loginPassword");
  }

  function setResetMode(active) {
    var isActive = !!active;
    var resetPanel = byId("cafeResetPanel");
    var forgotBox = byId("cafeForgotBox");

    if (resetPanel) resetPanel.style.display = isActive ? "block" : "none";
    if (forgotBox) forgotBox.style.display = "none";

    var primary = loginPrimaryActions();
    var forgot = forgotActionWrap();
    var resend = resendActionWrap();
    if (primary) primary.style.display = isActive ? "none" : "";
    if (forgot) forgot.style.display = isActive ? "none" : "";
    if (resend) resend.style.display = isActive ? "none" : "";
  }

  function ensureBackButton() {
    var panel = byId("cafeResetPanel");
    if (!panel || byId("cafeResetBackToLoginBtn")) return;
    var preview = byId("cafeResetPreview");
    var wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    wrap.innerHTML =
      '<button class="btn btn-secondary" type="button" id="cafeResetBackToLoginBtn" style="width:100%">Zurueck zum Login</button>';
    panel.insertBefore(wrap, preview || panel.firstChild.nextSibling);
    var btn = byId("cafeResetBackToLoginBtn");
    if (btn) {
      btn.addEventListener("click", function () {
        exitResetMode();
      });
    }
  }

  function hideResetMessage() {
    var el = byId("cafeResetPwMsg");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function exitResetMode() {
    clearQueryToken("resetToken");
    if (typeof window.setMode === "function") window.setMode("login");
    setResetMode(false);
    hideResetMessage();
    try {
      var preview = byId("cafeResetPreview");
      if (preview) {
        preview.style.display = "none";
        preview.textContent = "";
      }
      var pw1 = byId("cafeResetNewPw");
      var pw2 = byId("cafeResetNewPw2");
      if (pw1) pw1.value = "";
      if (pw2) pw2.value = "";
    } catch (e) {}
  }

  async function previewResetToken() {
    var token = getResetToken();
    var preview = byId("cafeResetPreview");
    if (!token || !preview) return false;
    try {
      var resp = await fetch((window.apiBase || "/api") + "/cafes/reset-password/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token }),
      });
      var data = await resp.json().catch(function () {
        return {};
      });
      if (!resp.ok || !data || !data.ok) return false;
      var cafe = data.cafe || null;
      var parts = [];
      if (cafe && cafe.name) parts.push(String(cafe.name));
      if (cafe && cafe.locationAddress) parts.push(String(cafe.locationAddress));
      else if (cafe && cafe.address) parts.push(String(cafe.address));
      if (!parts.length) return false;
      preview.textContent = "Konto: " + parts.join(" - ");
      preview.style.display = "block";
      return true;
    } catch (e) {
      return false;
    }
  }

  function wireActionButton(sel, handler) {
    var btn = qs(sel);
    if (!btn || btn.dataset.authFixBound === "1") return;
    btn.dataset.authFixBound = "1";
    btn.addEventListener("click", function (ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      handler();
    });
  }

  async function enhancedResendVerification() {
    var emailField = loginEmailField();
    var btn = resendButton();
    var email = String((emailField && emailField.value) || "").trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      if (emailField && typeof emailField.focus === "function") emailField.focus();
      if (typeof window.showError === "function") {
        window.showError("Bitte gib zuerst deine E-Mail-Adresse im Login-Feld ein.");
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird gesendet...";
    }

    try {
      var resp = await fetch((window.apiBase || "/api") + "/cafes/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      var data = await resp.json().catch(function () {
        return {};
      });
      if (!resp.ok || !data || !data.ok) {
        var err = new Error("api_error");
        err.status = resp.status;
        err.code = data && (data.error || data.code) ? String(data.error || data.code) : "";
        try {
          err.responseText = JSON.stringify(data || {});
        } catch (e0) {
          err.responseText = "";
        }
        throw err;
      }
      if (typeof window.showSuccess === "function") {
        if (data.alreadyVerified) {
          window.showSuccess("Diese E-Mail-Adresse ist bereits bestaetigt. Du kannst dich direkt anmelden.");
        } else {
          window.showSuccess("Wenn die Adresse zu einem unbestaetigten Konto gehoert, haben wir dir gerade einen neuen Bestaetigungslink geschickt.");
        }
      }
    } catch (e) {
      if (typeof window.showError === "function") {
        var msg = window.stampUI
          ? window.stampUI.userSafeErrorMessage(e, "Bestaetigungslink konnte nicht neu gesendet werden.")
          : "Bestaetigungslink konnte nicht neu gesendet werden.";
        window.showError(msg);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Bestaetigungslink erneut senden";
      }
    }
  }

  async function enhancedSubmitResetPassword() {
    hideResetMessage();
    var token = getResetToken();
    if (!token) {
      if (typeof window.showCafeResetNotice === "function") {
        window.showCafeResetNotice("cafeResetPwMsg", "Reset-Token fehlt.");
      }
      return;
    }

    var pw1 = String((byId("cafeResetNewPw") || {}).value || "");
    var pw2 = String((byId("cafeResetNewPw2") || {}).value || "");

    if (!pw1 || pw1.length < 8) {
      if (typeof window.showCafeResetNotice === "function") {
        window.showCafeResetNotice("cafeResetPwMsg", "Passwort muss mindestens 8 Zeichen haben.");
      }
      return;
    }
    if (pw1 !== pw2) {
      if (typeof window.showCafeResetNotice === "function") {
        window.showCafeResetNotice("cafeResetPwMsg", "Passwoerter stimmen nicht ueberein.");
      }
      return;
    }

    try {
      var resp = await fetch((window.apiBase || "/api") + "/cafes/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, newPassword: pw1 }),
      });
      var data = await resp.json().catch(function () {
        return {};
      });
      if (!resp.ok || !data || !data.ok) throw new Error((data && data.error) || "invalid_or_expired");
      exitResetMode();
      if (typeof window.showSuccess === "function") {
        window.showSuccess("Passwort wurde gesetzt. Du kannst dich jetzt direkt einloggen.");
      }
      var pwField = loginPasswordField();
      var emailField = loginEmailField();
      if (pwField && typeof pwField.focus === "function") pwField.focus();
      else if (emailField && typeof emailField.focus === "function") emailField.focus();
    } catch (e) {
      if (typeof window.showCafeResetNotice === "function") {
        window.showCafeResetNotice("cafeResetPwMsg", "Reset-Link ist ungueltig oder abgelaufen.");
      }
    }
  }

  async function syncInitialState() {
    ensureBackButton();

    var token = getResetToken();
    if (!token) {
      setResetMode(false);
      return;
    }

    if (typeof window.setMode === "function") window.setMode("login");
    setResetMode(true);
    var ok = await previewResetToken();
    if (!ok) {
      exitResetMode();
      if (typeof window.showError === "function") {
        window.showError("Dieser Reset-Link ist ungueltig oder abgelaufen. Bitte fordere einen neuen an.");
      }
    }
  }

  function bootstrap() {
    window.resendCafeVerification = enhancedResendVerification;
    window.submitCafeResetPassword = enhancedSubmitResetPassword;
    window.loadCafeResetPreview = previewResetToken;

    var oldFinish = window.finishCafeVerificationStep;
    window.finishCafeVerificationStep = function () {
      if (typeof oldFinish === "function") oldFinish();
      setResetMode(false);
    };

    wireActionButton('button[onclick="resendCafeVerification()"]', enhancedResendVerification);
    wireActionButton('button[onclick="submitCafeResetPassword()"]', enhancedSubmitResetPassword);
    syncInitialState();
    setTimeout(syncInitialState, 0);
    setTimeout(syncInitialState, 150);
    window.addEventListener("pageshow", syncInitialState);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

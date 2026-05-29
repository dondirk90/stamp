(function () {
  const STORAGE_KEY = "customer_session_v1";

  const el = {
    buildBadge: document.getElementById("buildBadge"),
    sessionBadge: document.getElementById("sessionBadge"),
    logoutBtn: document.getElementById("logoutBtn"),

    notLoggedIn: document.getElementById("notLoggedIn"),
    authedOnly: document.getElementById("authedOnly"),
    forgotPanel: document.getElementById("forgotPanel"),
    profileInfo: document.getElementById("profileInfo"),

    currentPassword: document.getElementById("currentPassword"),
    newPassword: document.getElementById("newPassword"),
    newPassword2: document.getElementById("newPassword2"),
    changePwBtn: document.getElementById("changePwBtn"),
    changePwMsg: document.getElementById("changePwMsg"),

    resetEmail: document.getElementById("resetEmail"),
    forgotPwBtn: document.getElementById("forgotPwBtn"),
    forgotPwMsg: document.getElementById("forgotPwMsg"),
    devResetBox: document.getElementById("devResetBox"),
    devResetUrl: document.getElementById("devResetUrl"),

    resetPanel: document.getElementById("resetPanel"),
    resetNewPw: document.getElementById("resetNewPw"),
    resetNewPw2: document.getElementById("resetNewPw2"),
    resetPwBtn: document.getElementById("resetPwBtn"),
    resetPwMsg: document.getElementById("resetPwMsg"),
  };

  const apiBase =
    location.protocol === "file:"
      ? "http://127.0.0.1:3000"
      : location.port === "3000"
        ? location.origin
        : `${location.origin}/api`;

  function setBuildBadge() {
    if (!el.buildBadge) return;
    el.buildBadge.textContent = `v ${new Date().toLocaleString()}`;
  }

  function showNotice(target, kind, msg) {
    if (!target) return;
    target.style.display = "block";
    target.className = `notice ${kind || ""}`.trim();
    target.textContent = msg;
  }

  function hideNotice(target) {
    if (!target) return;
    target.style.display = "none";
    target.textContent = "";
    target.className = "notice";
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.email) return null;
      return s;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  async function apiFetch(path, init) {
    const res = await fetch(`${apiBase}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error("api_error");
      err.status = res.status;
      err.responseText = text || "";
      throw err;
    }
    return res.json();
  }

  function safeUiErrorMessage(err, fallback) {
    try {
      if (window.stampUI && stampUI.userSafeErrorMessage) {
        return stampUI.userSafeErrorMessage(err, fallback);
      }
    } catch (e) {}
    return String(fallback || "Ein Fehler ist aufgetreten.");
  }

  function getResetTokenFromUrl() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get("resetToken") || "";
    } catch {
      return "";
    }
  }

  function renderProfile(session) {
    if (!el.sessionBadge) return;

    if (!session) {
      el.sessionBadge.textContent = "Nicht eingeloggt";
      if (el.logoutBtn) el.logoutBtn.style.display = "none";
      if (el.notLoggedIn) el.notLoggedIn.style.display = "block";
      if (el.authedOnly) el.authedOnly.style.display = "none";
      if (el.forgotPanel) el.forgotPanel.style.display = "flex";
      return;
    }

    el.sessionBadge.textContent = `Eingeloggt: ${
      session.username || session.email
    }`;
    if (el.logoutBtn) el.logoutBtn.style.display = "inline-flex";
    if (el.notLoggedIn) el.notLoggedIn.style.display = "none";
    if (el.authedOnly) el.authedOnly.style.display = "block";
    if (el.forgotPanel) el.forgotPanel.style.display = "none";

    if (el.profileInfo) {
      const lines = [];
      if (session.username) lines.push(`Username: ${session.username}`);
      if (session.email) lines.push(`E-Mail: ${session.email}`);
      if (session.address) lines.push(`Kunden-Adresse: ${session.address}`);
      el.profileInfo.textContent = lines.join("\n");
    }

    if (el.resetEmail && session.email) el.resetEmail.value = session.email;
  }

  async function handleChangePassword(session) {
    hideNotice(el.changePwMsg);
    if (!session || !session.email) {
      showNotice(el.changePwMsg, "danger", "Bitte zuerst einloggen.");
      return;
    }

    const currentPassword = el.currentPassword
      ? String(el.currentPassword.value || "")
      : "";
    const newPassword = el.newPassword
      ? String(el.newPassword.value || "")
      : "";
    const newPassword2 = el.newPassword2
      ? String(el.newPassword2.value || "")
      : "";

    if (!currentPassword) {
      showNotice(
        el.changePwMsg,
        "danger",
        "Bitte aktuelles Passwort eingeben.",
      );
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showNotice(
        el.changePwMsg,
        "danger",
        "Neues Passwort muss mindestens 6 Zeichen haben.",
      );
      return;
    }
    if (newPassword !== newPassword2) {
      showNotice(
        el.changePwMsg,
        "danger",
        "Neue Passwörter stimmen nicht überein.",
      );
      return;
    }

    try {
      await apiFetch("/customers/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          currentPassword,
          newPassword,
        }),
      });
    } catch (e) {
      showNotice(
        el.changePwMsg,
        "danger",
        safeUiErrorMessage(e, "Passwort konnte nicht geändert werden."),
      );
      return;
    }

    if (el.currentPassword) el.currentPassword.value = "";
    if (el.newPassword) el.newPassword.value = "";
    if (el.newPassword2) el.newPassword2.value = "";

    showNotice(el.changePwMsg, "success", "Passwort wurde geändert.");
  }

  async function handleForgotPassword() {
    hideNotice(el.forgotPwMsg);
    if (el.devResetBox) el.devResetBox.style.display = "none";

    const email = el.resetEmail ? String(el.resetEmail.value || "").trim() : "";
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      showNotice(
        el.forgotPwMsg,
        "danger",
        "Bitte eine gültige E-Mail eingeben.",
      );
      return;
    }

    let resp = null;
    try {
      resp = await apiFetch("/customers/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (e) {
      showNotice(
        el.forgotPwMsg,
        "danger",
        safeUiErrorMessage(e, "Reset-Link konnte nicht gesendet werden."),
      );
      return;
    }

    showNotice(
      el.forgotPwMsg,
      "info",
      "Wenn die Adresse existiert, wurde ein Reset-Link versendet.",
    );

    // Dev convenience: show link if API returns it.
    if (resp && resp.devResetUrl && el.devResetUrl && el.devResetBox) {
      el.devResetUrl.textContent = String(resp.devResetUrl);
      el.devResetBox.style.display = "block";
    }
  }

  async function handleResetPassword(token) {
    hideNotice(el.resetPwMsg);

    const pw1 = el.resetNewPw ? String(el.resetNewPw.value || "") : "";
    const pw2 = el.resetNewPw2 ? String(el.resetNewPw2.value || "") : "";

    if (!pw1 || pw1.length < 6) {
      showNotice(
        el.resetPwMsg,
        "danger",
        "Passwort muss mindestens 6 Zeichen haben.",
      );
      return;
    }
    if (pw1 !== pw2) {
      showNotice(el.resetPwMsg, "danger", "Passwörter stimmen nicht überein.");
      return;
    }

    try {
      await apiFetch("/customers/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw1 }),
      });
    } catch (e) {
      showNotice(
        el.resetPwMsg,
        "danger",
        safeUiErrorMessage(e, "Passwort konnte nicht gesetzt werden."),
      );
      return;
    }

    if (el.resetNewPw) el.resetNewPw.value = "";
    if (el.resetNewPw2) el.resetNewPw2.value = "";

    showNotice(
      el.resetPwMsg,
      "success",
      "Passwort wurde gesetzt. Du kannst dich jetzt einloggen.",
    );

    // Remove token from URL for safety
    try {
      const u = new URL(location.href);
      u.searchParams.delete("resetToken");
      history.replaceState(null, "", u.toString());
    } catch {}
  }

  async function previewResetToken(token) {
    if (!token) return;
    hideNotice(el.resetPwMsg);
    try {
      const resp = await apiFetch("/customers/reset-password/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const who =
        (resp && (resp.username || resp.email)
          ? String(resp.username || resp.email)
          : "dieses Konto");
      showNotice(
        el.resetPwMsg,
        "info",
        `Reset-Link gueltig fuer ${who}. Du kannst jetzt ein neues Passwort setzen.`,
      );
    } catch (e) {
      showNotice(
        el.resetPwMsg,
        "danger",
        safeUiErrorMessage(
          e,
          "Reset-Link konnte nicht geprueft werden. Bitte neuen Link anfordern.",
        ),
      );
      if (el.resetPwBtn) el.resetPwBtn.disabled = true;
    }
  }

  function boot() {
    setBuildBadge();

    const session = loadSession();
    renderProfile(session);

    const resetToken = getResetTokenFromUrl();
    if (resetToken && el.resetPanel) {
      el.resetPanel.style.display = "block";
      void previewResetToken(resetToken);
    }

    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", () => {
        clearSession();
        renderProfile(null);
        showNotice(el.forgotPwMsg, "info", "Du wurdest ausgeloggt.");
      });
    }

    if (el.changePwBtn) {
      el.changePwBtn.addEventListener("click", () =>
        handleChangePassword(session),
      );
    }

    if (el.forgotPwBtn) {
      el.forgotPwBtn.addEventListener("click", handleForgotPassword);
    }

    if (el.resetPwBtn) {
      el.resetPwBtn.addEventListener("click", () => {
        const token = getResetTokenFromUrl();
        if (!token) {
          showNotice(el.resetPwMsg, "danger", "Reset-Token fehlt.");
          return;
        }
        void handleResetPassword(token);
      });
    }
  }

  boot();
})();

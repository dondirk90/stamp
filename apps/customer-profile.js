(function () {
  const STORAGE_KEY = "customer_session_v1";

  const el = {
    profileStatus: document.getElementById("profileStatus"),
    profileSub: document.getElementById("profileSub"),
    profileAvatarWrap: document.getElementById("profileAvatarWrap"),
    profileAvatarImg: document.getElementById("profileAvatarImg"),
    profileAvatarFallback: document.getElementById("profileAvatarFallback"),
    profileAvatarInput: document.getElementById("profileAvatarInput"),
    profileAvatarChooseBtn: document.getElementById("profileAvatarChooseBtn"),
    profileAvatarRemoveBtn: document.getElementById("profileAvatarRemoveBtn"),
    profileAvatarMsg: document.getElementById("profileAvatarMsg"),
    logoutBtn: document.getElementById("logoutBtn"),
    topUtilityBtn: document.getElementById("topUtilityBtn"),
    utilityMenu: document.getElementById("utilityMenu"),
    utilityLogoutBtn: document.getElementById("utilityLogoutBtn"),

    notLoggedIn: document.getElementById("notLoggedIn"),
    authedOnly: document.getElementById("authedOnly"),
    forgotPanel: document.getElementById("forgotPanel"),
    profileInfo: document.getElementById("profileInfo"),
    profileAdvancedInfo: document.getElementById("profileAdvancedInfo"),

    newUsername: document.getElementById("newUsername"),
    changeUsernameBtn: document.getElementById("changeUsernameBtn"),
    changeUsernameMsg: document.getElementById("changeUsernameMsg"),

    currentPassword: document.getElementById("currentPassword"),
    newPassword: document.getElementById("newPassword"),
    newPassword2: document.getElementById("newPassword2"),
    changePwBtn: document.getElementById("changePwBtn"),
    changePwMsg: document.getElementById("changePwMsg"),
    deletePassword: document.getElementById("deletePassword"),
    deleteConfirmText: document.getElementById("deleteConfirmText"),
    deleteAccountBtn: document.getElementById("deleteAccountBtn"),
    deleteAccountMsg: document.getElementById("deleteAccountMsg"),

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

  function saveSession(session) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session || null));
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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function profileInitial(session) {
    const raw =
      (session && (session.username || session.email || session.customer_id)) || "K";
    return String(raw).trim().slice(0, 1).toUpperCase() || "K";
  }

  function renderAvatar(session) {
    if (!el.profileAvatarWrap) return;
    const src = session && session.avatarDataUrl ? String(session.avatarDataUrl) : "";
    const fallback = profileInitial(session);
    if (el.profileAvatarFallback) el.profileAvatarFallback.textContent = fallback;
    if (src) {
      if (el.profileAvatarImg) {
        el.profileAvatarImg.src = src;
        el.profileAvatarImg.style.display = "block";
      }
      if (el.profileAvatarFallback) el.profileAvatarFallback.style.display = "none";
    } else {
      if (el.profileAvatarImg) {
        el.profileAvatarImg.removeAttribute("src");
        el.profileAvatarImg.style.display = "none";
      }
      if (el.profileAvatarFallback) el.profileAvatarFallback.style.display = "block";
    }
  }

  function updateAvatar(session, avatarDataUrl) {
    if (!session) return null;
    const next = { ...session };
    if (avatarDataUrl) next.avatarDataUrl = avatarDataUrl;
    else delete next.avatarDataUrl;
    saveSession(next);
    renderProfile(next);
    return next;
  }

  async function saveAvatarToServer(session, avatarDataUrl) {
    if (!session || !session.email || !session.customer_id || !session.address) {
      throw new Error("missing_customer_identity");
    }
    const data = await apiFetch("/customers/profile-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: session.email,
        customerId: session.customer_id,
        address: session.address,
        avatarDataUrl: avatarDataUrl || null,
      }),
    });
    const customer = data && data.customer ? data.customer : null;
    const next = {
      ...session,
      avatarDataUrl:
        customer && customer.avatarDataUrl ? String(customer.avatarDataUrl) : "",
    };
    if (!next.avatarDataUrl) delete next.avatarDataUrl;
    saveSession(next);
    renderProfile(next);
    return next;
  }

  function resizeAvatarFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("missing_file"));
        return;
      }
      if (!/^image\//i.test(String(file.type || ""))) {
        reject(new Error("invalid_image_type"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("file_read_failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("image_decode_failed"));
        img.onload = () => {
          const size = 256;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("canvas_unavailable"));
            return;
          }
          ctx.fillStyle = "#f6eee5";
          ctx.fillRect(0, 0, size, size);
          const sw = img.naturalWidth || img.width || size;
          const sh = img.naturalHeight || img.height || size;
          const scale = Math.max(size / sw, size / sh);
          const dw = sw * scale;
          const dh = sh * scale;
          const dx = (size - dw) / 2;
          const dy = (size - dh) / 2;
          ctx.drawImage(img, dx, dy, dw, dh);
          resolve(canvas.toDataURL("image/jpeg", 0.86));
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function getResetTokenFromUrl() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get("resetToken") || "";
    } catch {
      return "";
    }
  }

  function setUtilityMenuOpen(open) {
    if (!el.utilityMenu) return;
    el.utilityMenu.classList.toggle("open", !!open);
    if (el.topUtilityBtn) {
      el.topUtilityBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function wireUtilityMenu() {
    if (!el.topUtilityBtn || !el.utilityMenu) return;
    el.topUtilityBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setUtilityMenuOpen(!el.utilityMenu.classList.contains("open"));
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (el.utilityMenu.contains(target) || el.topUtilityBtn.contains(target)) {
        return;
      }
      setUtilityMenuOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setUtilityMenuOpen(false);
    });
    el.utilityMenu.querySelectorAll("a").forEach((node) => {
      node.addEventListener("click", () => setUtilityMenuOpen(false));
    });
    if (el.utilityLogoutBtn) {
      el.utilityLogoutBtn.addEventListener("click", () => {
        setUtilityMenuOpen(false);
        clearSession();
        location.href = "/wallet";
      });
    }
  }

  function renderProfile(session) {
    if (!el.profileStatus) return;

    renderAvatar(session);

    if (!session) {
      el.profileStatus.textContent = "Noch nicht eingeloggt";
      if (el.profileSub)
        el.profileSub.textContent =
          "Melde dich an oder lass dir einen Link für ein neues Passwort schicken.";
      if (el.logoutBtn) el.logoutBtn.style.display = "none";
      if (el.notLoggedIn) el.notLoggedIn.style.display = "block";
      if (el.authedOnly) el.authedOnly.style.display = "none";
      if (el.forgotPanel) el.forgotPanel.style.display = "block";
      return;
    }

    el.profileStatus.textContent = `Hallo ${session.username || session.email}`;
    if (el.profileSub)
      el.profileSub.textContent =
        "Dein Profil ist bereit. Deine Karten warten schon auf den nächsten Kaffee.";
    if (el.logoutBtn) el.logoutBtn.style.display = "inline-flex";
    if (el.notLoggedIn) el.notLoggedIn.style.display = "none";
    if (el.authedOnly) el.authedOnly.style.display = "grid";
    if (el.forgotPanel) el.forgotPanel.style.display = "none";

    if (el.profileInfo) {
      const fields = [];
      if (session.username) {
        fields.push(
          `<div class="profileField"><div class="profileFieldLabel">Benutzername</div><div class="profileFieldValue">${escapeHtml(session.username)}</div></div>`,
        );
      }
      if (session.email) {
        fields.push(
          `<div class="profileField"><div class="profileFieldLabel">E-Mail</div><div class="profileFieldValue">${escapeHtml(session.email)}</div></div>`,
        );
      }
      el.profileInfo.innerHTML = fields.join("");
    }

    if (el.profileAdvancedInfo) {
      const lines = [];
      if (session.customer_id != null) lines.push(`Profil-ID: ${session.customer_id}`);
      if (session.address) lines.push(`Karten-Adresse: ${session.address}`);
      el.profileAdvancedInfo.textContent = lines.length
        ? lines.join("\n")
        : "Noch keine weiteren Profildaten vorhanden.";
    }

    if (el.resetEmail && session.email) el.resetEmail.value = session.email;
    if (el.newUsername && session.username) el.newUsername.value = session.username;
  }

  async function handleChangeUsername() {
    const session = loadSession();
    hideNotice(el.changeUsernameMsg);
    if (!session || !session.email || !session.customer_id || !session.address) {
      showNotice(el.changeUsernameMsg, "danger", "Bitte zuerst einloggen.");
      return;
    }

    const username = String(el.newUsername?.value || "").trim();
    if (!username || username.length < 2) {
      showNotice(
        el.changeUsernameMsg,
        "danger",
        "Benutzername muss mindestens 2 Zeichen haben.",
      );
      return;
    }

    try {
      await apiFetch("/customers/change-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          customerId: session.customer_id,
          address: session.address,
          username,
        }),
      });
    } catch (e) {
      showNotice(
        el.changeUsernameMsg,
        "danger",
        safeUiErrorMessage(e, "Benutzername konnte nicht geändert werden."),
      );
      return;
    }

    session.username = username;
    saveSession(session);
    renderProfile(session);

    showNotice(el.changeUsernameMsg, "success", "Benutzername wurde geändert.");
  }

  async function handleChangePassword() {
    const session = loadSession();
    hideNotice(el.changePwMsg);
    if (!session || !session.email) {
      showNotice(el.changePwMsg, "danger", "Bitte zuerst einloggen.");
      return;
    }

    const currentPassword = String(el.currentPassword?.value || "");
    const newPassword = String(el.newPassword?.value || "");
    const newPassword2 = String(el.newPassword2?.value || "");

    if (!currentPassword) {
      showNotice(el.changePwMsg, "danger", "Bitte aktuelles Passwort eingeben.");
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
      showNotice(el.changePwMsg, "danger", "Neue Passwörter stimmen nicht überein.");
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

    const email = String(el.resetEmail?.value || "").trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      showNotice(el.forgotPwMsg, "danger", "Bitte eine gueltige E-Mail eingeben.");
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

    const isLocalDev =
      /^(localhost|127\.0\.0\.1)$/i.test(location.hostname || "") ||
      location.protocol === "file:";
    if (isLocalDev && resp && resp.devResetUrl && el.devResetUrl && el.devResetBox) {
      el.devResetUrl.textContent = String(resp.devResetUrl);
      el.devResetBox.style.display = "block";
    }
  }

  async function handleDeleteAccount() {
    const session = loadSession();
    hideNotice(el.deleteAccountMsg);
    if (!session || !session.email || !session.customer_id || !session.address) {
      showNotice(
        el.deleteAccountMsg,
        "danger",
        "Bitte zuerst regulär einloggen.",
      );
      return;
    }

    const currentPassword = String(el.deletePassword?.value || "");
    const confirmText = String(el.deleteConfirmText?.value || "").trim();
    if (confirmText !== "DELETE") {
      showNotice(
        el.deleteAccountMsg,
        "danger",
        "Bitte zur Bestätigung genau DELETE eingeben.",
      );
      return;
    }

    if (!window.confirm("Willst du dein Kundenprofil wirklich endgültig löschen?")) {
      return;
    }

    if (el.deleteAccountBtn) el.deleteAccountBtn.disabled = true;
    try {
      await apiFetch("/customers/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          currentPassword,
          confirmText,
          customerId: session.customer_id,
          address: session.address,
        }),
      });
      clearSession();
      renderProfile(null);
      if (el.deletePassword) el.deletePassword.value = "";
      if (el.deleteConfirmText) el.deleteConfirmText.value = "";
      showNotice(
        el.forgotPwMsg,
        "success",
        "Dein Profil wurde gelöscht.",
      );
      window.setTimeout(() => {
        location.href = "/wallet";
      }, 900);
    } catch (e) {
      showNotice(
        el.deleteAccountMsg,
        "danger",
        safeUiErrorMessage(e, "Profil konnte nicht gelöscht werden."),
      );
    } finally {
      if (el.deleteAccountBtn) el.deleteAccountBtn.disabled = false;
    }
  }

  async function handleResetPassword(token) {
    hideNotice(el.resetPwMsg);

    const pw1 = String(el.resetNewPw?.value || "");
    const pw2 = String(el.resetNewPw2?.value || "");

    if (!pw1 || pw1.length < 6) {
      showNotice(el.resetPwMsg, "danger", "Passwort muss mindestens 6 Zeichen haben.");
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

    try {
      const u = new URL(location.href);
      u.searchParams.delete("resetToken");
      history.replaceState(null, "", u.toString());
    } catch {}
  }

  async function handleAvatarChosen(file) {
    hideNotice(el.profileAvatarMsg);
    const session = loadSession();
    if (!session) {
      showNotice(el.profileAvatarMsg, "danger", "Bitte zuerst einloggen.");
      return;
    }
    try {
      const dataUrl = await resizeAvatarFile(file);
      await saveAvatarToServer(session, dataUrl);
      showNotice(el.profileAvatarMsg, "success", "Profilbild aktualisiert.");
    } catch (e) {
      showNotice(
        el.profileAvatarMsg,
        "danger",
        safeUiErrorMessage(e, "Bild konnte nicht verarbeitet werden."),
      );
    } finally {
      if (el.profileAvatarInput) el.profileAvatarInput.value = "";
    }
  }

  function handleAvatarRemove() {
    hideNotice(el.profileAvatarMsg);
    const session = loadSession();
    if (!session) {
      showNotice(el.profileAvatarMsg, "danger", "Bitte zuerst einloggen.");
      return;
    }
    saveAvatarToServer(session, "")
      .then(() => {
        showNotice(el.profileAvatarMsg, "info", "Profilbild entfernt.");
      })
      .catch((e) => {
        showNotice(
          el.profileAvatarMsg,
          "danger",
          safeUiErrorMessage(e, "Profilbild konnte nicht entfernt werden."),
        );
      });
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
        resp && (resp.username || resp.email)
          ? String(resp.username || resp.email)
          : "dieses Konto";
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
    wireUtilityMenu();

    const session = loadSession();
    renderProfile(session);

    const resetToken = getResetTokenFromUrl();
    if (resetToken && el.resetPanel) {
      el.resetPanel.style.display = "block";
      if (el.forgotPanel) el.forgotPanel.style.display = "none";
      void previewResetToken(resetToken);
    }

    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", () => {
        clearSession();
        location.href = "/wallet";
      });
    }

    if (el.changePwBtn) {
      el.changePwBtn.addEventListener("click", () => void handleChangePassword());
    }

    if (el.changeUsernameBtn) {
      el.changeUsernameBtn.addEventListener("click", () => void handleChangeUsername());
    }

    if (el.deleteAccountBtn) {
      el.deleteAccountBtn.addEventListener("click", () => void handleDeleteAccount());
    }

    if (el.profileAvatarChooseBtn && el.profileAvatarInput) {
      el.profileAvatarChooseBtn.addEventListener("click", () => {
        el.profileAvatarInput.click();
      });
    }

    if (el.profileAvatarInput) {
      el.profileAvatarInput.addEventListener("change", (event) => {
        const file =
          event && event.target && event.target.files && event.target.files[0]
            ? event.target.files[0]
            : null;
        if (!file) return;
        void handleAvatarChosen(file);
      });
    }

    if (el.profileAvatarRemoveBtn) {
      el.profileAvatarRemoveBtn.addEventListener("click", handleAvatarRemove);
    }

    if (el.forgotPwBtn) {
      el.forgotPwBtn.addEventListener("click", () => void handleForgotPassword());
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
